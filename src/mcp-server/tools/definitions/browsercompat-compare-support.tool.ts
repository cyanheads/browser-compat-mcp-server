/**
 * @fileoverview Tool computing whether a set of web features clears an explicit
 * browserslist target query, reporting the failing target per feature and every
 * resolved target browser the server could not evaluate.
 * @module mcp-server/tools/definitions/browsercompat-compare-support
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
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
});

const UncheckedTargetSchema = z.object({
  agent: z.string().describe('browserslist agent id.'),
  version_token: z.string().describe('Version token browserslist produced for that agent.'),
  reason: z
    .enum(['no_bcd_browser', 'unknown_version', 'no_bcd_data'])
    .describe(
      'no_bcd_browser when the agent has no counterpart, unknown_version when the token maps to no release, no_bcd_data when a feature records nothing for that browser.',
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
      'clears only when every resolved target is supported; inconclusive when a target could not be evaluated, including when no target resolved at all; ambiguous when the id spans more than one compat key.',
    ),
  failing_targets: z
    .array(FailingTargetSchema.describe('A target this feature does not clear.'))
    .describe('Every resolved target that failed, with the verdict that caused it.'),
  compat_keys: z
    .array(z.string())
    .optional()
    .describe(
      'Present on an ambiguous verdict — the browser-compat-data keys the feature owns. Re-run with one of them.',
    ),
  guidance: z.string().optional().describe('What to do next on a miss or an ambiguous verdict.'),
});

export const browsercompatCompareSupport = tool('browsercompat_compare_support', {
  description:
    'Compute whether a set of web features clears an explicit browserslist target query. Returns a per-feature verdict, the target browser and version that fails, the share of tracked traffic the targets cover, and unchecked_targets for every resolved target browser with no compatibility data. A feature is never reported as clearing a target the server could not evaluate.',
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
      .describe(
        'A browserslist query, for example "defaults" or "> 0.5%, last 2 versions". Required: with no query browserslist would read config from the process working directory rather than from your project.',
      ),
    resolve: z
      .boolean()
      .default(false)
      .describe(
        'When true, fall back to the search index and accept its single unambiguous top hit for each entry. Off by default so a typo returns a miss you can correct rather than a confident answer about the wrong feature.',
      ),
  }),

  output: z.object({
    query_echo: z.string().describe('The targets query as the server parsed it.'),
    targets_resolved: z
      .array(ResolvedTargetSchema.describe('A target that mapped onto a concrete release.'))
      .describe('Every browserslist token that was evaluated.'),
    unchecked_targets: z
      .array(UncheckedTargetSchema.describe('A target that was not evaluated.'))
      .describe('Every target the server declined to claim a verdict for, with the reason.'),
    target_coverage_percent: z
      .number()
      .describe('Share of tracked global traffic the evaluated targets cover.'),
    unchecked_coverage_percent: z
      .number()
      .describe('Share of tracked global traffic the unevaluated targets cover.'),
    results: z
      .array(ResultSchema.describe('One result per input entry, in input order.'))
      .describe('Per-feature verdicts against the resolved targets.'),
    all_clear: z
      .boolean()
      .describe('True only when every feature clears and unchecked_targets is empty.'),
  }),

  enrichment: {
    data_version: DataVersionSchema.describe('Vintage of each bundled dataset behind this answer.'),
    totalCount: z.number().describe('Number of feature results returned.'),
    attribution: z
      .string()
      .describe('Required attribution for the caniuse-derived coverage figures in this response.'),
    uncheckedNotice: z
      .string()
      .optional()
      .describe('Names the target agents that were not evaluated and their combined usage share.'),
  },

  enrichmentTrailer: {
    data_version: { render: renderDataVersion },
    attribution: { label: 'Usage data' },
    uncheckedNotice: { label: 'Not evaluated' },
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

    const tokens = targets.queryTokens(input.targets, ctx);
    const { resolved, unchecked } = await targets.resolveTargets(tokens);
    /**
     * Only a query with nothing left to evaluate is an error. A mapped agent
     * whose version token does not resolve carries a per-token reason of its
     * own, so it stays an ordinary response with the token in unchecked_targets
     * — the same treatment it gets alongside a token that did resolve.
     */
    if (resolved.length === 0 && !unchecked.some((target) => target.reason === 'unknown_version')) {
      const unmapped = [...new Set(unchecked.map((target) => target.agent))].join(', ');
      throw ctx.fail(
        'no_targets_resolved',
        unchecked.length === 0
          ? `"${input.targets}" matched no browser versions at all.`
          : `"${input.targets}" resolved only to agents with no browser-compat-data counterpart: ${unmapped}.`,
        { ...ctx.recoveryFor('no_targets_resolved') },
      );
    }

    const uncheckedByKey = new Map<string, UncheckedTarget>();
    for (const target of unchecked) {
      uncheckedByKey.set(`${target.agent} ${target.version_token} ${target.reason}`, target);
    }

    const results: z.infer<typeof ResultSchema>[] = [];

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

      if (leaf === undefined) {
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

      const failing: z.infer<typeof FailingTargetSchema>[] = [];
      /** No evaluated target means no feature can be said to clear one. */
      let inconclusive = resolved.length === 0;
      for (const target of resolved) {
        const evaluation = bcd.supportAt(leaf, target.bcd_browser, target.bcd_release_index);
        if (evaluation.verdict === 'supported') continue;
        if (evaluation.verdict === 'unknown') {
          inconclusive = true;
          const uncheckedKey = `${target.agent} ${target.version_token} no_bcd_data`;
          if (!uncheckedByKey.has(uncheckedKey)) {
            uncheckedByKey.set(uncheckedKey, {
              agent: target.agent,
              version_token: target.version_token,
              reason: 'no_bcd_data',
              usage_percent: targets.coverage([`${target.agent} ${target.version_token}`]),
            });
          }
          continue;
        }
        failing.push({
          agent: target.agent,
          version_token: target.version_token,
          bcd_browser: target.bcd_browser,
          bcd_version: target.bcd_version,
          verdict: evaluation.verdict,
        });
      }

      results.push({
        input: entry,
        found: true,
        resolved_as: resolvedAs,
        ...(name === undefined ? {} : { name }),
        verdict: failing.length > 0 ? 'fails' : inconclusive ? 'inconclusive' : 'clears',
        failing_targets: failing,
      });
    }

    const uncheckedTargets = [...uncheckedByKey.values()];
    const uncheckedTokens = [
      ...new Set(uncheckedTargets.map((t) => `${t.agent} ${t.version_token}`.trim())),
    ];
    const resolvedTokens = resolved.map((t) => `${t.agent} ${t.version_token}`.trim());

    ctx.enrich.total(results.length);
    if (uncheckedTargets.length > 0) {
      const agents = [...new Set(uncheckedTargets.map((t) => t.agent))].join(', ');
      ctx.enrich({
        uncheckedNotice: `${uncheckedTargets.length} target versions were not evaluated (${agents}), together ${targets.coverage(uncheckedTokens)}% of tracked traffic. No feature is reported as clearing them.`,
      });
    }

    ctx.log.debug('Compared support', {
      targets: input.targets,
      resolved: resolved.length,
      unchecked: uncheckedTargets.length,
    });

    return {
      query_echo: input.targets.trim(),
      targets_resolved: resolved,
      unchecked_targets: uncheckedTargets,
      target_coverage_percent: targets.coverage(resolvedTokens),
      unchecked_coverage_percent: targets.coverage(uncheckedTokens),
      results,
      all_clear:
        uncheckedTargets.length === 0 && results.every((result) => result.verdict === 'clears'),
    };
  },

  format: (result) => {
    const clearing = result.results.filter((item) => item.verdict === 'clears').length;
    const lines = [
      `# ${clearing} of ${result.results.length} features clears \`${result.query_echo}\``,
      `Targets evaluated cover ${result.target_coverage_percent.toFixed(2)}% of tracked traffic · ` +
        `${result.unchecked_targets.length} target versions not evaluated (${result.unchecked_coverage_percent.toFixed(2)}%)`,
      `**all_clear:** ${result.all_clear}`,
      '',
    ];

    for (const item of result.results) {
      lines.push(
        `**${item.verdict}** ${item.name ?? item.input} (input ${item.input}, found ${item.found})`,
      );
      if (item.resolved_as) {
        lines.push(
          `  - resolved: "${item.resolved_as.input}" → bcd_key ${item.resolved_as.bcd_key ?? 'none'} · baseline_id ${item.resolved_as.baseline_id ?? 'none'} · via ${item.resolved_as.resolved_via}`,
        );
      }
      for (const target of item.failing_targets) {
        lines.push(
          `  - fails on ${target.agent} ${target.version_token} → ${target.bcd_browser} ${target.bcd_version ?? 'older than all releases'} (${target.verdict})`,
        );
      }
      if (item.compat_keys) {
        lines.push(
          `  - compat_keys: ${item.compat_keys.length === 0 ? 'none — this entry owns no browser-compat-data keys' : item.compat_keys.join(', ')}`,
        );
      }
      if (item.guidance) lines.push(`  - ${item.guidance}`);
    }

    lines.push('', '## Targets evaluated');
    if (result.targets_resolved.length === 0) {
      lines.push('No target version was evaluated.');
    } else {
      lines.push('| Target | browser-compat-data |', '|:--|:--|');
      for (const target of result.targets_resolved) {
        lines.push(
          `| ${target.agent} ${target.version_token} | ${target.bcd_browser} ${target.bcd_version ?? 'older than all releases'} (index ${target.bcd_release_index}) |`,
        );
      }
    }

    lines.push('', '## Not evaluated');
    if (result.unchecked_targets.length === 0) {
      lines.push('Every resolved target was evaluated.');
    } else {
      lines.push('| Target | Reason | Usage |', '|:--|:--|:--|');
      for (const target of result.unchecked_targets) {
        lines.push(
          `| ${target.agent} ${target.version_token} | ${target.reason} | ${target.usage_percent}% |`,
        );
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
