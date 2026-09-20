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
import { CANIUSE_ATTRIBUTION, getTargetsService } from '@/services/targets/targets-service.js';
import {
  BaselineSchema,
  DiscouragedSchema,
  formatBaselineLine,
  LimitingBrowserSchema,
  ResolvedAsSchema,
} from './compat-shapes.js';

/** What the usage figure is a share of, stated on every result that carries one. */
const USAGE_SOURCE =
  'Share of the roughly 96.7% of global traffic caniuse tracks, not of all traffic.';

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
    'Among the Baseline core browsers, the one requiring the newest release.',
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
      'Share of tracked global traffic that requiring this feature would exclude. Absent when the feature reaches no caniuse id — never zero in that case.',
    ),
  usage_source: z
    .string()
    .optional()
    .describe('What usage_percent_excluded is a share of. Present whenever that figure is.'),
  compat_keys: z
    .array(z.string())
    .optional()
    .describe(
      'Present when the web-features id spans more than one browser-compat-data key. Call browsercompat_get_feature with one of them for per-browser data.',
    ),
  guidance: z.string().optional().describe('What to do next when the feature did not resolve.'),
});

export const browsercompatCheckBaseline = tool('browsercompat_check_baseline', {
  description:
    'Check whether web features are safe to ship: Baseline state and the date it crossed, the browser and version that limits support, whether the feature is deprecated or discouraged, and the share of tracked global traffic that requiring it would exclude. Accepts up to 20 BCD keys or web-features ids in one call.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  input: z.object({
    features: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(20)
      .describe(
        'Up to 20 entries, each a browser-compat-data key such as css.selectors.has or a web-features id such as has, 1 to 200 characters. An empty or longer entry is rejected against this schema; a whitespace-only entry returns invalid_feature_input. Call browsercompat_search_features first for any entry whose key you do not already know.',
      ),
    resolve: z
      .boolean()
      .default(false)
      .describe(
        'When true, fall back to the search index and accept its single unambiguous top hit for each entry. Off by default so a typo returns a miss you can correct.',
      ),
  }),

  output: z.object({
    results: z
      .array(ResultSchema.describe('One result per input entry, in input order.'))
      .describe('One result per requested feature. A miss is a result, not a failure.'),
    all_widely_available: z
      .boolean()
      .describe(
        'True only when every entry resolved and reports Baseline widely. A single miss forces false. Deprecation and discouragement do not enter this answer.',
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
    attribution: { label: 'Usage data' },
    unresolvedNotice: { label: 'Unresolved' },
  },

  errors: [
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

    const results: z.infer<typeof ResultSchema>[] = [];
    const unresolved: string[] = [];
    let anyUsage = false;

    for (const entry of input.features) {
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
      const limiting =
        leaf === undefined ? undefined : bcd.limitingBrowser(leaf, baseline.coreBrowserIds);
      const discouraged = featureId === null ? undefined : baseline.discouraged(featureId);
      const excluded =
        featureId === null ? undefined : targets.excludedUsage(baseline.caniuseIds(featureId));
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
        ...(compatKeys === undefined ? {} : { compat_keys: compatKeys }),
      });
    }

    ctx.enrich.total(results.length);
    if (anyUsage) ctx.enrich({ attribution: CANIUSE_ATTRIBUTION });
    if (unresolved.length > 0) {
      ctx.enrich({
        unresolvedNotice: `${unresolved.length} of ${results.length} entries did not resolve: ${unresolved.join(', ')}. Call browsercompat_search_features with a plain-language name to find the right key.`,
      });
    }

    const allWidelyAvailable = results.every(
      (result) => result.outcome !== 'miss' && result.baseline?.state === 'widely',
    );

    ctx.log.debug('Checked Baseline', {
      requested: input.features.length,
      unresolved: unresolved.length,
    });

    return { results, all_widely_available: allWidelyAvailable };
  },

  format: (result) => {
    const lines = [`# Baseline check — ${result.results.length} features`];
    lines.push(`**all_widely_available:** ${result.all_widely_available}`);
    for (const item of result.results) {
      lines.push('');
      lines.push(`## ${item.name ?? item.input}`);
      lines.push(
        `**input:** ${item.input} · **found:** ${item.found} · **outcome:** ${item.outcome}`,
      );
      if (item.resolved_as) {
        lines.push(
          `**Resolved:** "${item.resolved_as.input}" → bcd_key ${item.resolved_as.bcd_key ?? 'none'} · baseline_id ${item.resolved_as.baseline_id ?? 'none'} · via ${item.resolved_as.resolved_via}`,
        );
      }
      if (item.baseline) lines.push(formatBaselineLine(item.baseline));
      if (item.limiting_browser) {
        lines.push(
          `**Limiting browser:** ${item.limiting_browser.name} (${item.limiting_browser.browser_id}) ${item.limiting_browser.version}`,
        );
      }
      if (item.deprecated !== undefined) lines.push(`**deprecated:** ${item.deprecated}`);
      if (item.experimental !== undefined) lines.push(`**experimental:** ${item.experimental}`);
      if (item.discouraged) {
        lines.push(
          `**Discouraged:** ${item.discouraged.reason} (according_to ${item.discouraged.according_to.join(', ')})`,
        );
      }
      if (item.usage_percent_excluded !== undefined) {
        lines.push(`**usage_percent_excluded:** ${item.usage_percent_excluded}%`);
      }
      if (item.usage_source !== undefined) lines.push(`**usage_source:** ${item.usage_source}`);
      if (item.compat_keys) {
        lines.push(
          `**compat_keys:** ${item.compat_keys.length === 0 ? 'none — this entry owns no browser-compat-data keys' : item.compat_keys.join(', ')}`,
        );
      }
      if (item.guidance) lines.push(item.guidance);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
