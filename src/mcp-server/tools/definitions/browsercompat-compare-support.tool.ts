/**
 * @fileoverview Tool computing whether a set of web features clears an explicit
 * browserslist target query. The whole query is evaluated on every call; the
 * target rows behind the verdicts are returned one page of query targets at a
 * time, and a target counts as evaluated only where compatibility data was
 * actually read for it.
 * @module mcp-server/tools/definitions/browsercompat-compare-support
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { markdown } from '@cyanheads/mcp-ts-core/utils';
import { getBaselineService } from '@/services/baseline/baseline-service.js';
import { resolveFeature } from '@/services/baseline/feature-resolver.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';
import {
  DataVersionSchema,
  getDataVersion,
  renderDataVersion,
} from '@/services/data-version/data-version-service.js';
import { CANIUSE_ATTRIBUTION, getTargetsService } from '@/services/targets/targets-service.js';
import type { UncheckedTarget } from '@/services/targets/types.js';
import { markdownText } from '@/utils/markdown-text.js';
import { ResolvedAsSchema } from './compat-shapes.js';

const FailingTargetSchema = z.object({
  agent: z.string().describe('browserslist agent id the target came from.'),
  version_token: z.string().describe('Version token browserslist produced for that agent.'),
  bcd_browser: z.string().describe('browser-compat-data browser the agent maps to.'),
  bcd_version: z
    .string()
    .nullable()
    .describe(
      'browser-compat-data release the token mapped to, or null when it predates them all.',
    ),
  verdict: z
    .enum(['partial', 'prefixed', 'flagged', 'removed', 'unsupported', 'preview_only'])
    .describe(
      'Why this target failed: partial means the implementation does not meet the mandatory specified behavior, prefixed means it only ships under a vendor prefix or a different name, flagged means it only works behind a preference or runtime flag, removed means it shipped and was later removed before this target version, unsupported means it was never added, preview_only means it only works in a preview channel.',
    ),
});

const ResolvedTargetSchema = z.object({
  agent: z.string().describe('browserslist agent id.'),
  version_token: z.string().describe('Version token browserslist produced for that agent.'),
  bcd_browser: z.string().describe('browser-compat-data browser the agent maps to.'),
  bcd_version: z
    .string()
    .nullable()
    .describe(
      'browser-compat-data release the token mapped to, or null when it predates them all.',
    ),
  bcd_release_index: z
    .number()
    .int()
    .describe('Release ordinal used for comparison; -1 when the token predates every release.'),
  evaluated: z
    .boolean()
    .describe(
      'True when every compared feature has compatibility data for this target. False when at least one compared feature records nothing for its browser, or when no feature in the call was comparable — the target then also appears in unchecked_targets. Mapping onto a release is not evaluation.',
    ),
});

const UncheckedTargetSchema = z.object({
  agent: z.string().describe('browserslist agent id.'),
  version_token: z.string().describe('Version token browserslist produced for that agent.'),
  reason: z
    .enum(['no_bcd_browser', 'unknown_version', 'no_bcd_data', 'no_comparable_feature'])
    .describe(
      'no_bcd_browser when the agent has no browser-compat-data counterpart, unknown_version when the token maps to no release, no_bcd_data when a compared feature records nothing for that browser, no_comparable_feature when every entry in features was a miss or ambiguous so nothing was compared.',
    ),
  usage_percent: z.number().describe('Share of tracked global traffic this target covers.'),
});

const ResultSchema = z.object({
  input: z.string().describe('The feature string as the caller sent it.'),
  found: z.boolean().describe('True when the feature string resolved to a tracked entry.'),
  resolved_as: ResolvedAsSchema.nullable().describe(
    'How the feature string was matched, or null on a miss.',
  ),
  name: z.string().optional().describe('web-features display name for the feature.'),
  verdict: z
    .enum(['clears', 'fails', 'inconclusive', 'miss', 'ambiguous'])
    .describe(
      'Judged over the whole query, never over one page. fails when any evaluated target does not support the feature; inconclusive when nothing failed but at least one target in the query was not evaluated for this feature, including when none was; clears only when every target in the query was evaluated and supports it; miss when the entry did not resolve; ambiguous when the id spans more than one compat key or owns none.',
    ),
  failing_targets: z
    .array(FailingTargetSchema.describe('A target this feature does not clear.'))
    .describe(
      'The failing targets among the query targets on this page, with the verdict that caused each. Empty on a page that holds none even when failing_total is above zero.',
    ),
  failing_total: z
    .number()
    .int()
    .optional()
    .describe(
      'Failing targets across the whole query. Present when the feature was compared, as are the five fields after it.',
    ),
  evaluated_total: z
    .number()
    .int()
    .optional()
    .describe('Query targets this feature has compatibility data for, across the whole query.'),
  evaluated_coverage_percent: z
    .number()
    .optional()
    .describe('Share of tracked global traffic the targets evaluated for this feature cover.'),
  unchecked_total: z
    .number()
    .int()
    .optional()
    .describe(
      'Query targets not evaluated for this feature, across the whole query. evaluated_total plus unchecked_total is the number of targets in the query.',
    ),
  unchecked_coverage_percent: z
    .number()
    .optional()
    .describe('Share of tracked global traffic the targets not evaluated for this feature cover.'),
  unchecked_targets: z
    .array(UncheckedTargetSchema.describe('A target this feature was not evaluated against.'))
    .optional()
    .describe(
      'The targets not evaluated for this feature among the query targets on this page, each with its reason.',
    ),
  compat_keys: z
    .array(z.string())
    .optional()
    .describe(
      'Present on an ambiguous verdict — the browser-compat-data keys the feature owns. Re-run with one of them.',
    ),
  guidance: z.string().optional().describe('What to do next on a miss or an ambiguous verdict.'),
});

type FailingTarget = z.infer<typeof FailingTargetSchema>;

/** One feature's evaluation against every query target, in query order. */
interface Comparison {
  evaluatedCoverage: number;
  evaluatedTotal: number;
  failing: FailingTarget[];
  unchecked: UncheckedTarget[];
  uncheckedCoverage: number;
}

/** The browserslist token a target row came from. */
const tokenOf = (target: { agent: string; version_token: string }) =>
  `${target.agent} ${target.version_token}`.trim();

export const browsercompatCompareSupport = tool('browsercompat_compare_support', {
  description:
    'Compute whether a set of web features clears an explicit browserslist target query. Every call evaluates the whole query: each feature gets a verdict, the count of failing targets, and its own evaluated and unevaluated target counts with the share of tracked traffic each covers. The target rows behind those numbers — which release each target maps to, which targets were not evaluated and why, and the failing and unevaluated targets of each feature — cover at most ten query targets per call; page through them with target_offset and target_limit, and the verdicts, coverage, and totals stay identical on every page. A target counts as evaluated only where compatibility data was read for it, so a feature clears only when every target in the query was evaluated and supports it, and is inconclusive otherwise — a query that includes a browser with no compatibility data, as "defaults" does, never clears.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  input: z.object({
    features: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(20)
      .describe(
        'Up to 20 entries, each a browser-compat-data key such as css.selectors.has or a web-features id such as has, 1 to 200 characters. An empty or longer entry is rejected against this schema; a whitespace-only entry returns invalid_feature_input. Call browsercompat_search_features first for any entry whose key you do not already know.',
      ),
    targets: z
      .string()
      .min(1)
      .max(500)
      .describe(
        'A browserslist query, for example "defaults" or "> 0.5%, last 2 versions", 1 to 500 characters. Required: with no query browserslist would read config from the process working directory rather than from your project.',
      ),
    resolve: z
      .boolean()
      .default(false)
      .describe(
        'When true, an entry that is neither a key nor an id falls back to the search index, such as "Container queries (size)" or "Element.prototype.animate". Its best exact matches are accepted only when they name one feature: a single key resolves to that key and gets a verdict, several keys of one web-features feature resolve to the feature as verdict ambiguous with compat_keys, and matches spanning two features are a miss. Off by default so a typo returns a miss you can correct rather than a confident answer about the wrong feature.',
      ),
    target_offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based position in the target list of the query at which this page of target rows starts. Pass the nextOffset of the previous response to continue. An offset at or past the number of targets returns the whole-query verdicts and totals with no target rows.',
      ),
    target_limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(10)
      .describe(
        'How many query targets this page covers, 1 to 10. It bounds every list of target rows in the response and never the evaluation: verdicts, coverage, and totals always describe the whole query.',
      ),
  }),

  output: z.object({
    query_echo: z.string().describe('The targets query as the server parsed it.'),
    comparable_features: z
      .number()
      .int()
      .describe(
        'How many entries in features were compared against the targets. A miss or an ambiguous entry is not comparable; at 0 nothing was evaluated.',
      ),
    targets_resolved: z
      .array(ResolvedTargetSchema.describe('A target that mapped onto a concrete release.'))
      .describe(
        'The mapping inventory for the query targets on this page: each target that maps onto a browser-compat-data release, and whether it was evaluated. A target with no mapping appears only in unchecked_targets.',
      ),
    targets_resolved_total: z
      .number()
      .int()
      .describe('Query targets that map onto a browser-compat-data release, across every page.'),
    evaluated_targets_total: z
      .number()
      .int()
      .describe(
        'Query targets evaluated for every compared feature, across every page. evaluated_targets_total plus unchecked_targets_total is the number of targets in the query.',
      ),
    unchecked_targets: z
      .array(UncheckedTargetSchema.describe('A target that was not evaluated.'))
      .describe(
        'The query targets on this page that were not evaluated for every compared feature, each with the reason.',
      ),
    unchecked_targets_total: z
      .number()
      .int()
      .describe('Query targets not evaluated for every compared feature, across every page.'),
    target_coverage_percent: z
      .number()
      .describe(
        'Share of tracked global traffic covered by the targets evaluated for every compared feature; 0 when no feature was comparable.',
      ),
    unchecked_coverage_percent: z
      .number()
      .describe(
        'Share of tracked global traffic covered by the targets counted in unchecked_targets_total.',
      ),
    results: z
      .array(ResultSchema.describe('One result per input entry, in input order.'))
      .describe(
        'Per-feature verdicts and totals over the whole query, each with its own target rows for this page.',
      ),
    all_clear: z
      .boolean()
      .describe(
        'True only when every feature clears, which requires every target in the query to have been evaluated for it.',
      ),
  }),

  enrichment: {
    data_version: DataVersionSchema.describe('Vintage of each bundled dataset behind this answer.'),
    totalCount: z.number().describe('Number of targets the query resolved to, across every page.'),
    shown: z.number().describe('Number of query targets this page covers.'),
    cap: z.number().describe('The target_limit that was applied.'),
    truncated: z.boolean().describe('True when more query targets remain past this page.'),
    nextOffset: z
      .number()
      .optional()
      .describe(
        'The target_offset of the next page. Present only while targets remain past this page.',
      ),
    attribution: z
      .string()
      .describe('Required attribution for the caniuse-derived coverage figures in this response.'),
    uncheckedNotice: z
      .string()
      .optional()
      .describe(
        'How many of the query targets were not evaluated for every compared feature, the agents they belong to, and their combined usage share.',
      ),
    offsetNotice: z
      .string()
      .optional()
      .describe('Why this page carries no target rows, and the offsets that do.'),
  },

  enrichmentTrailer: {
    data_version: { render: renderDataVersion },
    totalCount: { render: (value) => `**Targets in query:** ${value}` },
    shown: { render: (value) => `**Targets on this page:** ${value}` },
    cap: { render: (value) => `**Page size (target_limit):** ${value}` },
    truncated: { render: (value) => `**More targets remain:** ${value ? 'yes' : 'no'}` },
    nextOffset: { render: (value) => `**Next page:** call again with target_offset ${value}` },
    attribution: { render: (value) => `**Usage data:** ${markdownText(value)}` },
    uncheckedNotice: { render: (value) => `**Not evaluated:** ${markdownText(value ?? '')}` },
    offsetNotice: { render: (value) => `**Empty page:** ${value}` },
  },

  errors: [
    {
      reason: 'invalid_target_query',
      code: JsonRpcErrorCode.ValidationError,
      when: 'browserslist rejected the targets query.',
      recovery:
        'Fix the query and retry — call browsercompat_list_reference with topic browserslist_agents for the 19 valid agent ids. A negation-only query needs a base, e.g. "defaults, not dead" rather than "not dead".',
      thrownBy: 'service',
    },
    {
      reason: 'no_targets_resolved',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The query matched no browser versions at all, or only agents with no browser-compat-data counterpart. A mapped agent whose version token does not resolve is reported in unchecked_targets instead.',
      recovery:
        'Widen the targets query so it selects at least one browser that has compatibility data — call browsercompat_list_reference with topic browserslist_agents to see which of the 19 agents do.',
    },
    {
      reason: 'invalid_feature_input',
      code: JsonRpcErrorCode.ValidationError,
      when: 'An entry in features is whitespace-only. An empty or over-200-character entry is rejected against the input schema instead.',
      recovery:
        'Replace the whitespace-only entry with a BCD key such as css.selectors.has or a web-features id such as has; use browsercompat_search_features to find one.',
    },
  ],

  async handler(input, ctx) {
    const dataVersion = await getDataVersion();
    ctx.enrich({ data_version: dataVersion, attribution: CANIUSE_ATTRIBUTION });

    if (input.features.some((entry) => entry.trim().length === 0)) {
      throw ctx.fail(
        'invalid_feature_input',
        'One or more entries in features are whitespace-only.',
        { ...ctx.recoveryFor('invalid_feature_input') },
      );
    }

    const [bcd, baseline, targets] = await Promise.all([
      getBcdService(),
      getBaselineService(),
      getTargetsService(),
    ]);

    const tokens = targets.queryTokens(input.targets);
    const { resolved, unchecked: unmapped } = await targets.resolveTargets(tokens);
    /**
     * Only a query with nothing left to evaluate is an error. A mapped agent
     * whose version token does not resolve carries a per-token reason of its
     * own, so it stays an ordinary response with the token in unchecked_targets
     * — the same treatment it gets alongside a token that did resolve.
     */
    if (resolved.length === 0 && !unmapped.some((target) => target.reason === 'unknown_version')) {
      const agents = [...new Set(unmapped.map((target) => target.agent))].join(', ');
      throw ctx.fail(
        'no_targets_resolved',
        unmapped.length === 0
          ? `"${input.targets}" matched no browser versions at all.`
          : `"${input.targets}" resolved only to agents with no browser-compat-data counterpart: ${agents}.`,
      );
    }

    /** Every query target in browserslist order, whether or not it mapped onto a release. */
    const byToken = new Map([...resolved, ...unmapped].map((target) => [tokenOf(target), target]));
    const queryTargets = tokens
      .map((token) => byToken.get(token))
      .filter((target) => target !== undefined);

    const onPage = new Set(
      tokens.slice(input.target_offset, input.target_offset + input.target_limit),
    );
    const isOnPage = (target: { agent: string; version_token: string }) =>
      onPage.has(tokenOf(target));

    const usage = new Map<string, number>();
    /** A mapped target a comparison could not evaluate, reported the way an unmapped one is. */
    const uncheckedRow = (
      target: { agent: string; version_token: string },
      reason: 'no_bcd_data' | 'no_comparable_feature',
    ): UncheckedTarget => {
      const token = tokenOf(target);
      let usagePercent = usage.get(token);
      if (usagePercent === undefined) {
        usagePercent = targets.coverage([token]);
        usage.set(token, usagePercent);
      }
      return {
        agent: target.agent,
        version_token: target.version_token,
        reason,
        usage_percent: usagePercent,
      };
    };

    /** Keyed by compat key, so a repeated entry is evaluated once. */
    const comparisons = new Map<string, Comparison>();
    const results: z.infer<typeof ResultSchema>[] = [];
    let comparableFeatures = 0;

    for (const entry of input.features) {
      const query = entry.trim();
      const resolution = await resolveFeature(query, {
        resolve: input.resolve,
        toolName: 'browsercompat_compare_support',
      });
      if (!resolution.found) {
        results.push({
          input: entry,
          found: false,
          resolved_as: null,
          verdict: 'miss',
          failing_targets: [],
          guidance: resolution.guidance,
        });
        continue;
      }

      const resolvedAs = resolution.resolved_as;
      const featureId = resolvedAs.baseline_id;
      const name = featureId === null ? undefined : baseline.feature(featureId)?.name;
      const key = resolvedAs.bcd_key;
      const leaf = key === null ? undefined : bcd.leaf(key);

      if (key === null || leaf === undefined) {
        const compatKeys = resolution.compat_keys ?? [];
        results.push({
          input: entry,
          found: true,
          resolved_as: resolvedAs,
          ...(name === undefined ? {} : { name }),
          verdict: 'ambiguous',
          failing_targets: [],
          compat_keys: compatKeys,
          guidance:
            compatKeys.length === 0
              ? `"${featureId ?? query}" is tracked by web-features but owns no browser-compat-data keys, so there is no per-browser support to compare. Call browsercompat_check_baseline for its Baseline state.`
              : `"${featureId ?? query}" spans ${compatKeys.length} browser-compat-data keys, so no single support verdict applies. Call browsercompat_compare_support again with one of compat_keys.`,
        });
        continue;
      }

      let comparison = comparisons.get(key);
      if (comparison === undefined) {
        const failing: FailingTarget[] = [];
        const notEvaluated: UncheckedTarget[] = [];
        const evaluatedTokens: string[] = [];
        for (const target of queryTargets) {
          if ('reason' in target) {
            notEvaluated.push(target);
            continue;
          }
          const evaluation = bcd.supportAt(leaf, target.bcd_browser, target.bcd_release_index);
          if (evaluation.verdict === 'unknown') {
            notEvaluated.push(uncheckedRow(target, 'no_bcd_data'));
            continue;
          }
          evaluatedTokens.push(tokenOf(target));
          if (evaluation.verdict === 'supported') continue;
          failing.push({
            agent: target.agent,
            version_token: target.version_token,
            bcd_browser: target.bcd_browser,
            bcd_version: target.bcd_version,
            verdict: evaluation.verdict,
          });
        }
        comparison = {
          failing,
          unchecked: notEvaluated,
          evaluatedTotal: evaluatedTokens.length,
          evaluatedCoverage: targets.coverage(evaluatedTokens),
          uncheckedCoverage: targets.coverage(notEvaluated.map(tokenOf)),
        };
        comparisons.set(key, comparison);
      }

      comparableFeatures += 1;
      results.push({
        input: entry,
        found: true,
        resolved_as: resolvedAs,
        ...(name === undefined ? {} : { name }),
        verdict:
          comparison.failing.length > 0
            ? 'fails'
            : comparison.unchecked.length > 0
              ? 'inconclusive'
              : 'clears',
        failing_targets: comparison.failing.filter(isOnPage),
        failing_total: comparison.failing.length,
        evaluated_total: comparison.evaluatedTotal,
        evaluated_coverage_percent: comparison.evaluatedCoverage,
        unchecked_total: comparison.unchecked.length,
        unchecked_coverage_percent: comparison.uncheckedCoverage,
        unchecked_targets: comparison.unchecked.filter(isOnPage),
      });
    }

    /**
     * A target is evaluated for the call only when every compared feature has
     * data for it: the aggregate evaluated set is the intersection of the
     * per-feature sets, and everything else in the query is unchecked.
     */
    const withoutData = new Set(
      [...comparisons.values()].flatMap((comparison) =>
        comparison.unchecked
          .filter((target) => target.reason === 'no_bcd_data')
          .map((target) => tokenOf(target)),
      ),
    );
    const uncheckedTargets = queryTargets.flatMap((target) => {
      if ('reason' in target) return [target];
      if (comparableFeatures === 0) return [uncheckedRow(target, 'no_comparable_feature')];
      return withoutData.has(tokenOf(target)) ? [uncheckedRow(target, 'no_bcd_data')] : [];
    });
    const uncheckedTokens = new Set(uncheckedTargets.map(tokenOf));
    const evaluatedTokens = tokens.filter((token) => !uncheckedTokens.has(token));
    const uncheckedCoverage = targets.coverage([...uncheckedTokens]);

    const shown = onPage.size;
    const nextOffset = input.target_offset + shown;
    const truncated = nextOffset < tokens.length;
    ctx.enrich({ totalCount: tokens.length, shown, cap: input.target_limit, truncated });
    if (truncated) ctx.enrich({ nextOffset });
    if (shown === 0) {
      ctx.enrich({
        offsetNotice: `target_offset ${input.target_offset} is at or past the ${tokens.length} targets in the query. Call again with a target_offset below ${tokens.length}, or omit it for the first page.`,
      });
    }
    if (comparableFeatures === 0) {
      ctx.enrich({
        uncheckedNotice: `No feature was comparable, so none of the ${tokens.length} target versions was evaluated (${uncheckedCoverage}% of tracked traffic). Resolve the miss and ambiguous entries and call again.`,
      });
    } else if (uncheckedTargets.length > 0) {
      const agents = [...new Set(uncheckedTargets.map((target) => target.agent))].join(', ');
      ctx.enrich({
        uncheckedNotice: `${uncheckedTargets.length} of ${tokens.length} target versions were not evaluated for every compared feature (${agents}), together ${uncheckedCoverage}% of tracked traffic. No feature is reported as clearing them.`,
      });
    }

    ctx.log.debug('Compared support', {
      targets: input.targets,
      queryTargets: tokens.length,
      mapped: resolved.length,
      evaluated: evaluatedTokens.length,
      offset: input.target_offset,
      shown,
    });

    return {
      query_echo: input.targets.trim(),
      comparable_features: comparableFeatures,
      targets_resolved: resolved
        .filter(isOnPage)
        .map((target) => ({ ...target, evaluated: !uncheckedTokens.has(tokenOf(target)) })),
      targets_resolved_total: resolved.length,
      evaluated_targets_total: evaluatedTokens.length,
      unchecked_targets: uncheckedTargets.filter(isOnPage),
      unchecked_targets_total: uncheckedTargets.length,
      target_coverage_percent: targets.coverage(evaluatedTokens),
      unchecked_coverage_percent: uncheckedCoverage,
      results,
      all_clear: results.every((result) => result.verdict === 'clears'),
    };
  },

  format: (result) => {
    const clearing = result.results.filter((item) => item.verdict === 'clears').length;
    const queryTotal = result.evaluated_targets_total + result.unchecked_targets_total;
    const lines = [
      `# ${clearing} of ${result.results.length} features clears ${markdown().inlineCode(result.query_echo).build()}`,
      ...(result.comparable_features === 0
        ? ['No feature was comparable, so no target version was evaluated.']
        : []),
      `Evaluated for every compared feature: ${result.evaluated_targets_total} of ${queryTotal} target versions (${result.target_coverage_percent}% of tracked traffic) · not evaluated: ${result.unchecked_targets_total} (${result.unchecked_coverage_percent}%)`,
      `Compared ${result.comparable_features} of ${result.results.length} features · ${result.targets_resolved_total} of ${queryTotal} target versions map to a browser-compat-data release`,
      `**all_clear:** ${result.all_clear}`,
      '',
    ];

    for (const item of result.results) {
      lines.push(
        `**${item.verdict}** ${markdownText(item.name ?? item.input)} (input ${markdownText(item.input)}, found ${item.found})`,
      );
      if (item.resolved_as) {
        lines.push(
          `  - resolved: "${markdownText(item.resolved_as.input)}" → bcd_key ${markdownText(item.resolved_as.bcd_key ?? 'none')} · baseline_id ${markdownText(item.resolved_as.baseline_id ?? 'none')} · via ${item.resolved_as.resolved_via}`,
        );
      }
      if (item.unchecked_targets) {
        lines.push(
          `  - evaluated on ${item.evaluated_total} of ${queryTotal} target versions (${item.evaluated_coverage_percent}% of tracked traffic) · failing ${item.failing_total} · not evaluated ${item.unchecked_total} (${item.unchecked_coverage_percent}%)`,
          `  - on this page: ${item.failing_targets.length} of ${item.failing_total} failing, ${item.unchecked_targets.length} of ${item.unchecked_total} not evaluated`,
        );
      }
      for (const target of item.failing_targets) {
        lines.push(
          `  - fails on ${markdownText(target.agent)} ${markdownText(target.version_token)} → ${markdownText(target.bcd_browser)} ${markdownText(target.bcd_version ?? 'older than all releases')} (${target.verdict})`,
        );
      }
      for (const target of item.unchecked_targets ?? []) {
        lines.push(
          `  - not evaluated on ${markdownText(target.agent)} ${markdownText(target.version_token)} (${target.reason}, ${target.usage_percent}% usage)`,
        );
      }
      if (item.compat_keys) {
        lines.push(
          `  - compat_keys: ${item.compat_keys.length === 0 ? 'none — this entry owns no browser-compat-data keys' : item.compat_keys.map(markdownText).join(', ')}`,
        );
      }
      if (item.guidance) lines.push(`  - ${markdownText(item.guidance)}`);
    }

    lines.push(
      '',
      `## Targets mapped to a release — ${result.targets_resolved.length} of ${result.targets_resolved_total} on this page`,
    );
    if (result.targets_resolved_total === 0) {
      lines.push('No target version maps to a browser-compat-data release.');
    } else if (result.targets_resolved.length === 0) {
      lines.push(
        `None of the ${result.targets_resolved_total} mapped target versions is on this page.`,
      );
    } else {
      lines.push(
        '| Target | browser-compat-data | Evaluated for every compared feature |',
        '|:--|:--|:--|',
      );
      for (const target of result.targets_resolved) {
        lines.push(
          `| ${markdownText(target.agent)} ${markdownText(target.version_token)} | ${markdownText(target.bcd_browser)} ${markdownText(target.bcd_version ?? 'older than all releases')} (index ${target.bcd_release_index}) | ${target.evaluated ? 'yes' : 'no'} |`,
        );
      }
    }

    lines.push(
      '',
      `## Not evaluated for every compared feature — ${result.unchecked_targets.length} of ${result.unchecked_targets_total} on this page`,
    );
    if (result.unchecked_targets_total === 0) {
      lines.push('Every target version was evaluated for every compared feature.');
    } else if (result.unchecked_targets.length === 0) {
      lines.push(
        `None of the ${result.unchecked_targets_total} unevaluated target versions is on this page.`,
      );
    } else {
      lines.push('| Target | Reason | Usage |', '|:--|:--|:--|');
      for (const target of result.unchecked_targets) {
        lines.push(
          `| ${markdownText(target.agent)} ${markdownText(target.version_token)} | ${target.reason} | ${target.usage_percent}% |`,
        );
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
