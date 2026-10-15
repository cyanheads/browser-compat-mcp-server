/**
 * @fileoverview Tool answering ship-or-not across up to 20 web features at
 * once: Baseline state and date, the limiting browser, deprecation and
 * discouragement flags, and the share of tracked traffic each feature excludes.
 * @module mcp-server/tools/definitions/browsercompat-check-baseline
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
import {
  CANIUSE_ATTRIBUTION,
  CANIUSE_TRACKED_PERCENT,
  getTargetsService,
} from '@/services/targets/targets-service.js';
import { markdownText } from '@/utils/markdown-text.js';
import {
  BaselineSchema,
  batchCompatKeys,
  DiscouragedSchema,
  FEATURES_MAX,
  FEATURES_PER_CALL,
  formatBaselineLine,
  formatBatchCompatKeys,
  formatLimitingBrowser,
  formatOmittedFeatures,
  LimitingBrowserSchema,
  ResolvedAsSchema,
} from './compat-shapes.js';

/** What the usage figure is a share of, stated on every result that carries one. */
const USAGE_SOURCE = `Feature-level caniuse figure; reported for a BCD key only when it is the feature’s sole declared compat key. Share of the roughly ${CANIUSE_TRACKED_PERCENT}% of global traffic caniuse tracks, not of all traffic.`;

const ResultSchema = z.object({
  input: z.string().describe('The feature string as the caller sent it.'),
  found: z.boolean().describe('True when the feature string resolved to a tracked entry.'),
  outcome: z
    .enum(['found', 'no_compat_data', 'miss'])
    .describe(
      'found when Baseline data was returned, no_compat_data when the entry owns no browser-compat-data keys, miss when nothing matched.',
    ),
  resolved_as: ResolvedAsSchema.nullable().describe(
    'How the feature string was matched, or null on a miss.',
  ),
  name: z.string().optional().describe('web-features display name for the feature.'),
  baseline: BaselineSchema.optional().describe('Baseline state and the dates it crossed.'),
  limiting_browser: LimitingBrowserSchema.optional().describe(
    'Among the Baseline core browsers, the one whose required release is newest by release date. For a single key, present only when every core browser has full, unprefixed, unflagged support at a resolvable added release; for an id spanning more than one key, read from web-features’ feature-level support for the feature as a whole and present only when it lists all seven core browsers.',
  ),
  deprecated: z
    .boolean()
    .optional()
    .describe(
      'True when browser-compat-data marks the key deprecated. Absent for keys that record no status and for ids spanning more than one key.',
    ),
  experimental: z
    .boolean()
    .optional()
    .describe(
      'True when browser-compat-data marks the key experimental. Absent under the same conditions as deprecated.',
    ),
  discouraged: DiscouragedSchema.optional().describe(
    'Present when web-features records that the feature is discouraged.',
  ),
  usage_percent_excluded: z
    .number()
    .optional()
    .describe(
      'Feature-level share of tracked traffic excluded. A resolved BCD key receives it only when it is the feature’s sole declared compat key. Absent without caniuse data — never zero in that case.',
    ),
  usage_source: z
    .string()
    .optional()
    .describe('What usage_percent_excluded is a share of. Present whenever that figure is.'),
  compat_keys: z
    .array(z.string())
    .optional()
    .describe(
      'Present when the web-features id spans more than one browser-compat-data key, or as an empty list when it owns none: its first 10 keys in declaration order, with compat_keys_total counting all of them. Call browsercompat_get_feature with the id for the rest and its feature-level support per core browser, or with one of these keys for per-browser data.',
    ),
  compat_keys_total: z
    .number()
    .int()
    .optional()
    .describe('Every browser-compat-data key the id owns. Present with compat_keys.'),
  guidance: z.string().optional().describe('What to do next when the feature did not resolve.'),
});

export const browsercompatCheckBaseline = tool('browsercompat_check_baseline', {
  description:
    'Check whether web features are safe to ship: Baseline state and the date it crossed, the browser and version that limits support, whether the feature is deprecated or discouraged, and the share of tracked global traffic that requiring it would exclude. Evaluates up to 20 BCD keys or web-features ids per call; up to 100 may be sent, and entries past the 20th come back unevaluated in omitted_features for the next call.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  input: z.object({
    features: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(FEATURES_MAX)
      .describe(
        'Entries to check, each a browser-compat-data key such as css.selectors.has or a web-features id such as has, 1 to 200 characters. The first 20 are evaluated per call; up to 100 are accepted, and entries past the 20th are returned unevaluated in omitted_features. More than 100 entries, or an empty or longer entry anywhere in the list, is rejected against this schema; a whitespace-only entry anywhere returns invalid_feature_input. Call browsercompat_search_features first for any entry whose key you do not already know.',
      ),
    resolve: z
      .boolean()
      .default(false)
      .describe(
        'When true, an entry that is neither a key nor an id falls back to the search index, such as "Container queries (size)" or "Element.prototype.animate". Its best exact matches are accepted only when they name one feature: a single key resolves to that key, several keys of one web-features feature resolve to the feature with its feature-level Baseline and compat_keys, and matches spanning two features are a miss. Off by default so a typo returns a miss you can correct.',
      ),
  }),

  output: z.object({
    results: z
      .array(ResultSchema.describe('One result per evaluated entry, in input order.'))
      .describe(
        'One result per evaluated entry — the first 20. A miss is a result, not a failure.',
      ),
    omitted_features: z
      .array(z.string())
      .optional()
      .describe(
        'Entries past the first 20, verbatim and in input order, that were not evaluated. Present only when the call sent more than 20; pass them as features in the next call.',
      ),
    all_widely_available: z
      .boolean()
      .describe(
        'True only when every entry resolved and reports Baseline widely. A single miss, or any entry in omitted_features, forces false. Deprecation and discouragement do not enter this answer.',
      ),
  }),

  enrichment: {
    data_version: DataVersionSchema.describe('Vintage of each bundled dataset behind this answer.'),
    totalCount: z.number().describe('Number of results returned.'),
    attribution: z
      .string()
      .optional()
      .describe('Required attribution for the caniuse-derived usage figures in this response.'),
    unresolvedNotice: z
      .string()
      .optional()
      .describe('Names the entries that did not resolve and how to find the right key.'),
  },

  enrichmentTrailer: {
    data_version: { render: renderDataVersion },
    attribution: { render: (value) => `**Usage data:** ${markdownText(value ?? '')}` },
    unresolvedNotice: { render: (value) => `**Unresolved:** ${markdownText(value ?? '')}` },
  },

  errors: [
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
    ctx.enrich({ data_version: dataVersion });

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

    const evaluated = input.features.slice(0, FEATURES_PER_CALL);
    const omitted = input.features.slice(FEATURES_PER_CALL);
    const results: z.infer<typeof ResultSchema>[] = [];
    const unresolved: string[] = [];
    let anyUsage = false;

    for (const entry of evaluated) {
      const query = entry.trim();
      const resolution = await resolveFeature(query, {
        resolve: input.resolve,
        toolName: 'browsercompat_check_baseline',
      });
      if (!resolution.found) {
        unresolved.push(query);
        results.push({
          input: entry,
          found: false,
          outcome: 'miss',
          resolved_as: null,
          guidance: resolution.guidance,
        });
        continue;
      }

      const resolvedAs = resolution.resolved_as;
      const key = resolvedAs.bcd_key;
      const featureId = resolvedAs.baseline_id;
      const feature = featureId === null ? undefined : baseline.feature(featureId);
      const leaf = key === null ? undefined : bcd.leaf(key);
      const compatKeys = resolution.compat_keys;

      const baselineInfo =
        key !== null
          ? baseline.baselineForKey(key)
          : featureId !== null
            ? baseline.baselineForFeature(featureId)
            : undefined;
      /** An id spanning several keys is answered from web-features' own feature-level support. */
      const featureLevel =
        featureId !== null && (compatKeys?.length ?? 0) > 0
          ? baseline.featureSupport(featureId)
          : undefined;
      const limiting =
        leaf !== undefined
          ? bcd.limitingBrowser(leaf, baseline.coreBrowserIds)
          : featureLevel !== undefined
            ? bcd.featureLimitingBrowser(featureLevel, baseline.coreBrowserIds)
            : undefined;
      const discouraged = featureId === null ? undefined : baseline.discouraged(featureId);
      const featureKeys = featureId === null ? [] : baseline.compatKeys(featureId);
      const usageMatches = key === null || (featureKeys.length === 1 && featureKeys[0] === key);
      const excluded =
        featureId === null || !usageMatches
          ? undefined
          : targets.excludedUsage(baseline.caniuseIds(featureId));
      if (excluded !== undefined) anyUsage = true;

      results.push({
        input: entry,
        found: true,
        outcome: key === null && (compatKeys?.length ?? 0) === 0 ? 'no_compat_data' : 'found',
        resolved_as: resolvedAs,
        ...(feature?.name === undefined ? {} : { name: feature.name }),
        ...(baselineInfo === undefined ? {} : { baseline: baselineInfo }),
        ...(limiting === undefined ? {} : { limiting_browser: limiting }),
        ...(leaf?.status === undefined
          ? {}
          : { deprecated: leaf.status.deprecated, experimental: leaf.status.experimental }),
        ...(discouraged === undefined ? {} : { discouraged }),
        ...(excluded === undefined
          ? {}
          : { usage_percent_excluded: excluded, usage_source: USAGE_SOURCE }),
        ...(compatKeys === undefined ? {} : batchCompatKeys(compatKeys)),
      });
    }

    ctx.enrich.total(results.length);
    if (anyUsage) ctx.enrich({ attribution: CANIUSE_ATTRIBUTION });
    if (unresolved.length > 0) {
      ctx.enrich({
        unresolvedNotice: `${unresolved.length} of ${results.length} entries did not resolve: ${unresolved.join(', ')}. Call browsercompat_search_features with a plain-language name to find the right key.`,
      });
    }

    const allWidelyAvailable =
      omitted.length === 0 &&
      results.every((result) => result.outcome !== 'miss' && result.baseline?.state === 'widely');

    ctx.log.debug('Checked Baseline', {
      requested: input.features.length,
      omitted: omitted.length,
      unresolved: unresolved.length,
    });

    return {
      results,
      ...(omitted.length === 0 ? {} : { omitted_features: omitted }),
      all_widely_available: allWidelyAvailable,
    };
  },

  format: (result) => {
    const lines = [`# Baseline check — ${result.results.length} features`];
    lines.push(`**all_widely_available:** ${result.all_widely_available}`);
    for (const item of result.results) {
      lines.push('');
      lines.push(`## ${markdownText(item.name ?? item.input)}`);
      lines.push(
        `**input:** ${markdownText(item.input)} · **found:** ${item.found} · **outcome:** ${item.outcome}`,
      );
      if (item.resolved_as) {
        lines.push(
          `**Resolved:** "${markdownText(item.resolved_as.input)}" → bcd_key ${markdownText(item.resolved_as.bcd_key ?? 'none')} · baseline_id ${markdownText(item.resolved_as.baseline_id ?? 'none')} · via ${item.resolved_as.resolved_via}`,
        );
      }
      if (item.baseline) lines.push(formatBaselineLine(item.baseline));
      if (item.limiting_browser) {
        lines.push(
          formatLimitingBrowser(
            item.limiting_browser,
            item.resolved_as?.bcd_key === null ? 'feature' : 'key',
          ),
        );
      }
      if (item.deprecated !== undefined) lines.push(`**deprecated:** ${item.deprecated}`);
      if (item.experimental !== undefined) lines.push(`**experimental:** ${item.experimental}`);
      if (item.discouraged) {
        lines.push(
          `**Discouraged:** ${markdownText(item.discouraged.reason)} (according_to ${item.discouraged.according_to.map(markdownText).join(', ')})`,
        );
      }
      if (item.usage_percent_excluded !== undefined) {
        lines.push(`**usage_percent_excluded:** ${item.usage_percent_excluded}%`);
      }
      if (item.usage_source !== undefined)
        lines.push(`**usage_source:** ${markdownText(item.usage_source)}`);
      if (item.compat_keys) {
        lines.push(
          `**compat_keys:** ${formatBatchCompatKeys(item.compat_keys, item.compat_keys_total ?? item.compat_keys.length, item.resolved_as?.baseline_id ?? item.input)}`,
        );
      }
      if (item.guidance) lines.push(markdownText(item.guidance));
    }
    if (result.omitted_features) lines.push('', formatOmittedFeatures(result.omitted_features));
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
