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
import type { SupportStatementFields } from '@/services/bcd/types.js';
import {
  DataVersionSchema,
  getDataVersion,
  renderDataVersion,
} from '@/services/data-version/data-version-service.js';
import { CANIUSE_ATTRIBUTION, getTargetsService } from '@/services/targets/targets-service.js';
import type { ResolvedTarget, UncheckedTarget } from '@/services/targets/types.js';
import { markdownText } from '@/utils/markdown-text.js';
import {
  batchCompatKeys,
  FEATURES_MAX,
  FEATURES_PER_CALL,
  formatBatchCompatKeys,
  formatOmittedFeatures,
  formatStatementParts,
  ResolvedAsSchema,
  STATEMENT_FIELDS,
} from './compat-shapes.js';

/**
 * Every way a target can fail a feature, from either support source. Defined
 * once so every surface that names a failing verdict accepts the same members.
 */
const FailingVerdictSchema = z
  .enum([
    'partial',
    'prefixed',
    'flagged',
    'removed',
    'unsupported',
    'preview_only',
    'before_feature_support',
    'no_feature_support',
  ])
  .describe(
    'Why this target failed. From a key: partial means the implementation does not meet the mandatory specified behavior, prefixed means it only ships under a vendor prefix or a different name, flagged means it only works behind a preference or runtime flag, removed means it shipped and was later removed before this target version, unsupported means it was never added, preview_only means it only works in a preview channel. From web-features’ feature-level support: before_feature_support means the target predates the release web-features lists for the feature, no_feature_support means web-features lists no release of this core browser for the feature — which also covers a feature it lists no release for at all, such as a discontinued one (mutation-events) that older releases shipped; call again with one of compat_keys for a key-level verdict on such a target.',
  );

type FailingVerdict = z.infer<typeof FailingVerdictSchema>;

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
  verdict: FailingVerdictSchema,
  ...STATEMENT_FIELDS,
});

const FailingRangeSchema = z.object({
  agent: z.string().describe('browserslist agent id of every target in the run.'),
  newest: z.string().describe('Version token of the run’s first, newest target.'),
  oldest: z
    .string()
    .describe('Version token of the run’s last, oldest target; equals newest for a run of one.'),
  count: z.number().int().describe('Query targets in the run.'),
  verdict: FailingVerdictSchema,
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
      'True when every compared feature has compatibility data for this target. False when at least one compared feature records nothing for its browser or has no feature-level data for it, or when no feature in the call was comparable — the target then also appears in unchecked_targets. Mapping onto a release is not evaluation.',
    ),
});

const UncheckedTargetSchema = z.object({
  agent: z.string().describe('browserslist agent id.'),
  version_token: z.string().describe('Version token browserslist produced for that agent.'),
  reason: z
    .enum([
      'no_bcd_browser',
      'unknown_version',
      'no_bcd_data',
      'no_feature_level_data',
      'no_comparable_feature',
    ])
    .describe(
      'no_bcd_browser when the agent has no browser-compat-data counterpart, unknown_version when the token maps to no release, no_bcd_data when a compared key records nothing for that browser, no_feature_level_data when a feature judged on web-features’ feature-level support has no answer for the target — a browser outside the Baseline core set, or a release before a ≤ bound — so call again with one of its compat_keys for a key-level answer, no_comparable_feature when every entry in features was a miss or ambiguous so nothing was compared. In the top-level list a target unchecked by several compared features takes the reason of the first of them.',
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
      'Judged over the whole query, never over one page. fails when any evaluated target does not support the feature; inconclusive when nothing failed but at least one target in the query was not evaluated for this feature, including when none was; clears only when every target in the query was evaluated and supports it; miss when the entry did not resolve; ambiguous when the web-features id owns no browser-compat-data keys, so there is no support data to judge.',
    ),
  support_source: z
    .enum(['bcd_key', 'web_features_feature'])
    .optional()
    .describe(
      'What the verdict was judged on. bcd_key: one browser-compat-data key’s per-browser support. web_features_feature: for an id spanning more than one key, web-features’ own release per Baseline core browser for the feature as a whole — never a combination of its keys, and a key can differ from it either way; browsers outside the core set are then not evaluated. Present on every compared result.',
    ),
  failing_targets: z
    .array(FailingTargetSchema.describe('A target this feature does not clear.'))
    .describe(
      'The failing targets among the query targets on this page, with the verdict that caused each. A row judged on a key also carries the fields of the support statement behind its verdict — version_added, prefix, alternative_name, flags, and the rest — each only when that statement has it; an unsupported or preview_only row, and a row judged on web-features’ feature-level support, carry none. Empty on a page that holds none even when failing_total is above zero.',
    ),
  failing_total: z
    .number()
    .int()
    .optional()
    .describe(
      'Failing targets across the whole query. Present when the feature was compared, as are the six fields after it.',
    ),
  failing_ranges: z
    .array(FailingRangeSchema.describe('A run of consecutive failing query targets.'))
    .optional()
    .describe(
      'Every failing target across the whole query, grouped into runs: consecutive query targets of one browserslist agent that fail with the same verdict, in query order — agents in browserslist’s order, newest run first. A run breaks at any target that passed or was not evaluated for this feature, so it spans only versions the query contains. The counts sum to failing_total, and the list is the same on every page. Empty when nothing failed.',
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
      'The browser-compat-data keys a web-features id owns, its first 10 in declaration order: present when the id spans more than one key and was judged on its feature-level support, and as an empty list on an ambiguous verdict. compat_keys_total counts all of them; call browsercompat_get_feature with the id for the rest. Call again with one of them for a key-level verdict that also covers non-core browsers.',
    ),
  compat_keys_total: z
    .number()
    .int()
    .optional()
    .describe('Every browser-compat-data key the id owns. Present with compat_keys.'),
  guidance: z.string().optional().describe('What to do next on a miss or an ambiguous verdict.'),
});

type FailingTarget = z.infer<typeof FailingTargetSchema>;
type FailingRange = z.infer<typeof FailingRangeSchema>;

/** One feature's evaluation against every query target, in query order. */
interface Comparison {
  evaluatedCoverage: number;
  evaluatedTotal: number;
  failing: FailingTarget[];
  ranges: FailingRange[];
  unchecked: UncheckedTarget[];
  uncheckedCoverage: number;
}

/**
 * How one support source judged one mapped target, with the fields of the BCD
 * statement behind a key's verdict. The feature-level source reads none.
 */
interface Judgement {
  statement?: SupportStatementFields;
  verdict: FailingVerdict | 'supported' | 'unknown';
}

/** Query targets one page covers at most; a larger target_limit is served at this size (D52). */
const TARGET_LIMIT_CAP = 10;

/** Hard ceiling on target_limit; values past it are rejected against the schema. */
const TARGET_LIMIT_MAX = 1000;

/** The browserslist token a target row came from. */
const tokenOf = (target: { agent: string; version_token: string }) =>
  `${target.agent} ${target.version_token}`.trim();

export const browsercompatCompareSupport = tool('browsercompat_compare_support', {
  description:
    'Compute whether a set of web features clears an explicit browserslist target query. Compares up to 20 features per call; up to 100 may be sent, and entries past the 20th come back unevaluated in omitted_features for the next call. Every call evaluates the whole query: each feature gets a verdict, the count of failing targets, those targets grouped into runs of consecutive query targets per browser in failing_ranges, and its own evaluated and unevaluated target counts with the share of tracked traffic each covers. The target rows behind those numbers — which release each target maps to, which targets were not evaluated and why, and the failing and unevaluated targets of each feature, a failing row carrying the prefix, alternative name, or flag behind its verdict — cover at most ten query targets per call; page through them with target_offset and target_limit, and the verdicts, coverage, and totals stay identical on every page. A target counts as evaluated only where compatibility data was read for it, so a feature clears only when every target in the query was evaluated and supports it, and is inconclusive otherwise — a query that includes a browser with no compatibility data, as "defaults" does, never clears. A BCD key is judged on its own per-browser support. A web-features id spanning several keys, such as grid, is judged on the release web-features lists for the feature as a whole in each Baseline core browser, as support_source says; its other browsers are not evaluated.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  input: z.object({
    features: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(FEATURES_MAX)
      .describe(
        'Entries to compare, each a browser-compat-data key such as css.selectors.has or a web-features id such as has, 1 to 200 characters. The first 20 are compared per call; up to 100 are accepted, and entries past the 20th are returned unevaluated in omitted_features. More than 100 entries, or an empty or longer entry anywhere in the list, is rejected against this schema; a whitespace-only entry anywhere returns invalid_feature_input. Call browsercompat_search_features first for any entry whose key you do not already know.',
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
        'When true, an entry that is neither a key nor an id falls back to the search index, such as "Container queries (size)" or "Element.prototype.animate". Its best exact matches are accepted only when they name one feature: a single key resolves to that key and is judged on it, several keys of one web-features feature resolve to the feature and are judged on its feature-level support with compat_keys, and matches spanning two features are a miss. Off by default so a typo returns a miss you can correct rather than a confident answer about the wrong feature.',
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
      .max(TARGET_LIMIT_MAX)
      .default(TARGET_LIMIT_CAP)
      .describe(
        'How many query targets this page covers, at most 10 per call; a value from 11 to 1000 is served as 10, and the cap enrichment field reports the size applied. It bounds every list of target rows in the response and never the evaluation: verdicts, coverage, and totals always describe the whole query.',
      ),
  }),

  output: z.object({
    query_echo: z.string().describe('The targets query as the server parsed it.'),
    comparable_features: z
      .number()
      .int()
      .describe(
        'How many entries in features were compared against the targets, on a key or on web-features’ feature-level support. A miss or an ambiguous entry is not comparable; at 0 nothing was evaluated.',
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
      .array(ResultSchema.describe('One result per evaluated entry, in input order.'))
      .describe(
        'Per-feature verdicts and totals over the whole query for the first 20 entries, each with its own target rows for this page.',
      ),
    omitted_features: z
      .array(z.string())
      .optional()
      .describe(
        'Entries past the first 20, verbatim and in input order, that were not compared. Present only when the call sent more than 20; pass them as features in the next call.',
      ),
    all_clear: z
      .boolean()
      .describe(
        'True only when every feature clears, which requires every target in the query to have been evaluated for it — for a feature judged on web-features’ feature-level support, every target must be a Baseline core browser. Any entry in omitted_features forces false.',
      ),
  }),

  enrichment: {
    data_version: DataVersionSchema.describe('Vintage of each bundled dataset behind this answer.'),
    totalCount: z.number().describe('Number of targets the query resolved to, across every page.'),
    shown: z.number().describe('Number of query targets this page covers.'),
    cap: z
      .number()
      .describe('The page size applied: target_limit, or 10 when target_limit was above 10.'),
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
      when: 'An entry in features is whitespace-only, including an entry past the 20th. An empty or over-200-character entry is rejected against the input schema instead.',
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

    const pageSize = Math.min(input.target_limit, TARGET_LIMIT_CAP);
    const onPage = new Set(tokens.slice(input.target_offset, input.target_offset + pageSize));
    const isOnPage = (target: { agent: string; version_token: string }) =>
      onPage.has(tokenOf(target));

    const usage = new Map<string, number>();
    /** A mapped target a comparison could not evaluate, reported the way an unmapped one is. */
    const uncheckedRow = (
      target: { agent: string; version_token: string },
      reason: 'no_bcd_data' | 'no_feature_level_data' | 'no_comparable_feature',
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

    /**
     * Judge every query target with one support source. A target the source has
     * no answer for is unchecked with that source's reason, never a failure.
     * Failing targets are also grouped into runs as they arrive in query order:
     * a run continues only across consecutive targets of one agent failing with
     * one verdict, and any target that passed or went unevaluated ends it.
     */
    const compare = (
      judge: (target: ResolvedTarget) => Judgement,
      unknownReason: 'no_bcd_data' | 'no_feature_level_data',
    ): Comparison => {
      const failing: FailingTarget[] = [];
      const ranges: FailingRange[] = [];
      const notEvaluated: UncheckedTarget[] = [];
      const evaluatedTokens: string[] = [];
      let run: FailingRange | undefined;
      for (const target of queryTargets) {
        if ('reason' in target) {
          notEvaluated.push(target);
          run = undefined;
          continue;
        }
        const { verdict, statement } = judge(target);
        if (verdict === 'unknown') {
          notEvaluated.push(uncheckedRow(target, unknownReason));
          run = undefined;
          continue;
        }
        evaluatedTokens.push(tokenOf(target));
        if (verdict === 'supported') {
          run = undefined;
          continue;
        }
        failing.push({
          agent: target.agent,
          version_token: target.version_token,
          bcd_browser: target.bcd_browser,
          bcd_version: target.bcd_version,
          verdict,
          ...statement,
        });
        if (run?.agent === target.agent && run.verdict === verdict) {
          run.oldest = target.version_token;
          run.count += 1;
        } else {
          run = {
            agent: target.agent,
            newest: target.version_token,
            oldest: target.version_token,
            count: 1,
            verdict,
          };
          ranges.push(run);
        }
      }
      return {
        failing,
        ranges,
        unchecked: notEvaluated,
        evaluatedTotal: evaluatedTokens.length,
        evaluatedCoverage: targets.coverage(evaluatedTokens),
        uncheckedCoverage: targets.coverage(notEvaluated.map(tokenOf)),
      };
    };

    /**
     * Keyed by compat key, or by feature id for a feature-level comparison (keys
     * always contain a dot and ids never do), so a repeated entry is evaluated once.
     */
    const comparisons = new Map<string, Comparison>();
    const results: z.infer<typeof ResultSchema>[] = [];
    const omitted = input.features.slice(FEATURES_PER_CALL);
    let comparableFeatures = 0;

    for (const entry of input.features.slice(0, FEATURES_PER_CALL)) {
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
      const compatKeys = resolution.compat_keys ?? [];
      /** An id spanning several keys is judged on web-features' own feature-level support. */
      const featureLevel =
        featureId !== null && compatKeys.length > 0
          ? baseline.featureSupport(featureId)
          : undefined;

      const subject =
        leaf !== undefined
          ? {
              source: 'bcd_key' as const,
              cacheKey: `${key}`,
              unknownReason: 'no_bcd_data' as const,
              judge: (target: ResolvedTarget): Judgement => {
                const { verdict, detail } = bcd.supportAt(
                  leaf,
                  target.bcd_browser,
                  target.bcd_release_index,
                );
                if (verdict === 'supported' || verdict === 'unknown') return { verdict };
                const { notes: _notes, impl_url: _implUrl, ...statement } = detail;
                return { verdict, statement };
              },
            }
          : featureLevel !== undefined
            ? {
                source: 'web_features_feature' as const,
                cacheKey: `${featureId}`,
                unknownReason: 'no_feature_level_data' as const,
                judge: (target: ResolvedTarget): Judgement => ({
                  verdict: bcd.featureSupportAt(
                    featureLevel,
                    baseline.coreBrowserIds,
                    target.bcd_browser,
                    target.bcd_release_index,
                  ),
                }),
              }
            : undefined;

      if (subject === undefined) {
        results.push({
          input: entry,
          found: true,
          resolved_as: resolvedAs,
          ...(name === undefined ? {} : { name }),
          verdict: 'ambiguous',
          failing_targets: [],
          ...batchCompatKeys(compatKeys),
          guidance: `"${featureId ?? query}" is tracked by web-features but owns no browser-compat-data keys, so there is no per-browser support to compare. Call browsercompat_check_baseline for its Baseline state.`,
        });
        continue;
      }

      let comparison = comparisons.get(subject.cacheKey);
      if (comparison === undefined) {
        comparison = compare(subject.judge, subject.unknownReason);
        comparisons.set(subject.cacheKey, comparison);
      }

      comparableFeatures += 1;
      results.push({
        input: entry,
        found: true,
        resolved_as: resolvedAs,
        ...(name === undefined ? {} : { name }),
        support_source: subject.source,
        verdict:
          comparison.failing.length > 0
            ? 'fails'
            : comparison.unchecked.length > 0
              ? 'inconclusive'
              : 'clears',
        failing_targets: comparison.failing.filter(isOnPage),
        failing_total: comparison.failing.length,
        failing_ranges: comparison.ranges,
        evaluated_total: comparison.evaluatedTotal,
        evaluated_coverage_percent: comparison.evaluatedCoverage,
        unchecked_total: comparison.unchecked.length,
        unchecked_coverage_percent: comparison.uncheckedCoverage,
        unchecked_targets: comparison.unchecked.filter(isOnPage),
        ...(subject.source === 'web_features_feature' ? batchCompatKeys(compatKeys) : {}),
      });
    }

    /**
     * A target is evaluated for the call only when every compared feature has
     * data for it: the aggregate evaluated set is the intersection of the
     * per-feature sets, and everything else in the query is unchecked. A mapped
     * target several features left unchecked takes the reason of the earliest
     * compared result — comparisons are keyed in first-seen input order.
     */
    const withoutData = new Map<string, 'no_bcd_data' | 'no_feature_level_data'>();
    for (const comparison of comparisons.values()) {
      for (const target of comparison.unchecked) {
        const token = tokenOf(target);
        if (
          (target.reason === 'no_bcd_data' || target.reason === 'no_feature_level_data') &&
          !withoutData.has(token)
        ) {
          withoutData.set(token, target.reason);
        }
      }
    }
    const uncheckedTargets = queryTargets.flatMap((target) => {
      if ('reason' in target) return [target];
      if (comparableFeatures === 0) return [uncheckedRow(target, 'no_comparable_feature')];
      const reason = withoutData.get(tokenOf(target));
      return reason === undefined ? [] : [uncheckedRow(target, reason)];
    });
    const uncheckedTokens = new Set(uncheckedTargets.map(tokenOf));
    const evaluatedTokens = tokens.filter((token) => !uncheckedTokens.has(token));
    const uncheckedCoverage = targets.coverage([...uncheckedTokens]);

    const shown = onPage.size;
    const nextOffset = input.target_offset + shown;
    const truncated = nextOffset < tokens.length;
    ctx.enrich({ totalCount: tokens.length, shown, cap: pageSize, truncated });
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
      omitted: omitted.length,
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
      ...(omitted.length === 0 ? {} : { omitted_features: omitted }),
      all_clear: omitted.length === 0 && results.every((result) => result.verdict === 'clears'),
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
      ...(result.omitted_features ? [formatOmittedFeatures(result.omitted_features)] : []),
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
      if (item.support_source) {
        lines.push(
          item.support_source === 'bcd_key'
            ? '  - support_source: bcd_key'
            : '  - support_source: web_features_feature — web-features’ release per Baseline core browser for the feature as a whole',
        );
      }
      if (item.unchecked_targets) {
        lines.push(
          `  - evaluated on ${item.evaluated_total} of ${queryTotal} target versions (${item.evaluated_coverage_percent}% of tracked traffic) · failing ${item.failing_total} · not evaluated ${item.unchecked_total} (${item.unchecked_coverage_percent}%)`,
          `  - on this page: ${item.failing_targets.length} of ${item.failing_total} failing, ${item.unchecked_targets.length} of ${item.unchecked_total} not evaluated`,
        );
      }
      if (item.failing_ranges) {
        const runs = item.failing_ranges.map(
          (range) =>
            `${markdownText(range.agent)} ${markdownText(range.newest)}${range.oldest === range.newest ? '' : ` to ${markdownText(range.oldest)}`}: ${range.count} ${range.verdict}`,
        );
        lines.push(
          `  - failing_ranges (whole query): ${runs.length === 0 ? 'none' : runs.join('; ')}`,
        );
      }
      for (const target of item.failing_targets) {
        const statement = formatStatementParts(target);
        lines.push(
          `  - fails on ${markdownText(target.agent)} ${markdownText(target.version_token)} → ${markdownText(target.bcd_browser)} ${markdownText(target.bcd_version ?? 'older than all releases')} (${target.verdict})${statement.length === 0 ? '' : ` · ${statement.join(' · ')}`}`,
        );
      }
      for (const target of item.unchecked_targets ?? []) {
        lines.push(
          `  - not evaluated on ${markdownText(target.agent)} ${markdownText(target.version_token)} (${target.reason}, ${target.usage_percent}% usage)`,
        );
      }
      if (item.compat_keys) {
        lines.push(
          `  - compat_keys: ${formatBatchCompatKeys(item.compat_keys, item.compat_keys_total ?? item.compat_keys.length, item.resolved_as?.baseline_id ?? item.input)}`,
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
