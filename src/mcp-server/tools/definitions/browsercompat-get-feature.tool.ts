/**
 * @fileoverview Tool returning the full compatibility record for one web
 * feature: Baseline state and dates, standards status, per-browser support with
 * flags and prefixes, the limiting browser, and MDN and specification links.
 * @module mcp-server/tools/definitions/browsercompat-get-feature
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
import { markdownText } from '@/utils/markdown-text.js';
import {
  BaselineSchema,
  DiscouragedSchema,
  formatBaselineLine,
  formatSupportRow,
  LimitingBrowserSchema,
  ResolvedAsSchema,
  SupportRowSchema,
} from './compat-shapes.js';

const StatusSchema = z.object({
  deprecated: z.boolean().describe('True when browser-compat-data marks the feature deprecated.'),
  experimental: z
    .boolean()
    .describe('True when browser-compat-data marks the feature experimental.'),
  standard_track: z
    .boolean()
    .describe('True when the feature is part of an active specification process.'),
  discouraged: DiscouragedSchema.optional().describe(
    'Present when web-features records that the feature is discouraged.',
  ),
});

export const browsercompatGetFeature = tool('browsercompat_get_feature', {
  description:
    'Get the compatibility record for one web feature: Baseline state and the date it crossed, deprecation and standards status, per-browser version added and removed with flags, vendor prefixes and partial-implementation notes, and the MDN and specification links. Accepts a BCD key such as css.selectors.has or a web-features id such as has; the response echoes which one it matched. An unresolved feature returns found: false with guidance rather than an error.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  input: z.object({
    feature: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'A browser-compat-data key such as css.selectors.has, or a web-features id such as has, 1 to 200 characters. An empty or longer string is rejected against this schema; a whitespace-only string returns invalid_feature_input. Call browsercompat_search_features first if you do not already know the key.',
      ),
    resolve: z
      .boolean()
      .default(false)
      .describe(
        'When true, a string that is neither a key nor an id falls back to the search index, such as "Container queries (size)" or "Element.prototype.animate". Its best exact matches are accepted only when they name one feature: a single key resolves to that key, several keys of one web-features feature resolve to the feature with compat_keys, and matches spanning two features are a miss. Off by default so a typo returns a miss you can correct rather than a confident answer about the wrong feature.',
      ),
    include_runtimes: z
      .boolean()
      .default(false)
      .describe(
        'Add the bun, deno, nodejs, and oculus rows to support. Leave off for browser ship decisions.',
      ),
    subkeys_offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Direct child keys to skip, default 0. Each subkeys page contains at most 100 keys; pass its next_offset to continue.',
      ),
  }),

  output: z.object({
    found: z.boolean().describe('True when the feature string resolved to a tracked entry.'),
    outcome: z
      .enum(['found', 'no_compat_data', 'miss'])
      .describe(
        'found when per-feature data was returned, no_compat_data when the entry is tracked but owns no browser-compat-data keys, miss when nothing matched.',
      ),
    resolved_as: ResolvedAsSchema.nullable().describe(
      'How the feature string was matched, or null on a miss.',
    ),
    name: z.string().optional().describe('web-features display name for the feature.'),
    description: z
      .string()
      .optional()
      .describe(
        'web-features description, or the browser-compat-data description with tags stripped.',
      ),
    baseline: BaselineSchema.optional().describe(
      'Baseline state for the resolved key, or the feature rollup when a web-features id resolved to more than one key.',
    ),
    status: StatusSchema.optional().describe(
      'Standards status for the resolved key. Absent for webextensions keys, which record none, and when the id spans more than one key.',
    ),
    discouraged: DiscouragedSchema.optional().describe(
      'Feature-level discouragement, independent of leaf standards status. Also retained in status.discouraged when status exists.',
    ),
    limiting_browser: LimitingBrowserSchema.optional().describe(
      'Among the Baseline core browsers, the one requiring the newest release. Present only when every core browser has full, unprefixed, unflagged support at a resolvable added release.',
    ),
    support: z
      .array(SupportRowSchema.describe('Support for one reported browser.'))
      .optional()
      .describe(
        'One row per reported browser. Absent when the id spans more than one browser-compat-data key.',
      ),
    mdn_url: z.string().optional().describe('MDN reference page for the resolved key.'),
    spec_urls: z
      .array(z.string())
      .optional()
      .describe('Specification URLs for the resolved key, always an array.'),
    compat_keys: z
      .array(z.string())
      .optional()
      .describe(
        'Present when the web-features id spans more than one browser-compat-data key. Call this tool again with one of them for the per-browser fields.',
      ),
    subkeys: z
      .object({
        total: z.number().int().describe('Total direct callable child keys, before paging.'),
        keys: z
          .array(z.string())
          .describe(
            'At most 100 direct child keys, in BCD traversal order. Call browsercompat_get_feature for one, or browsercompat_check_baseline for up to 20.',
          ),
        truncated: z.boolean().describe('True when more direct children remain after this page.'),
        next_offset: z
          .number()
          .int()
          .optional()
          .describe('Offset for the next page; absent at or past the end.'),
      })
      .optional()
      .describe(
        'Direct child compat records of the resolved BCD key. Absent for childless keys and resolutions without a single key.',
      ),
    guidance: z.string().optional().describe('What to do next on a miss or with no compat data.'),
  }),

  enrichment: {
    data_version: DataVersionSchema.describe('Vintage of each bundled dataset behind this answer.'),
    baselineNotMapped: z
      .string()
      .optional()
      .describe('Explains why a resolved key carries no Baseline state.'),
    runtimesExcluded: z
      .string()
      .optional()
      .describe('Notes that the feature carries server-runtime or XR data that was left out.'),
  },

  enrichmentTrailer: {
    data_version: { render: renderDataVersion },
    baselineNotMapped: { render: (value) => `**Baseline mapping:** ${markdownText(value ?? '')}` },
    runtimesExcluded: { render: (value) => `**Runtimes:** ${markdownText(value ?? '')}` },
  },

  errors: [
    {
      reason: 'invalid_feature_input',
      code: JsonRpcErrorCode.ValidationError,
      when: 'feature is whitespace-only. An empty or over-200-character string is rejected against the input schema instead.',
      recovery:
        'Pass a BCD key such as css.selectors.has or a web-features id such as has, then call browsercompat_search_features if you do not know the key.',
    },
  ],

  async handler(input, ctx) {
    const dataVersion = await getDataVersion();
    ctx.enrich({ data_version: dataVersion });

    const query = input.feature.trim();
    if (query.length === 0) {
      throw ctx.fail('invalid_feature_input', 'The feature string is whitespace-only.');
    }

    const resolution = await resolveFeature(query, {
      resolve: input.resolve,
      toolName: 'browsercompat_get_feature',
    });
    if (!resolution.found) {
      return {
        found: false,
        outcome: 'miss' as const,
        resolved_as: null,
        guidance: resolution.guidance,
      };
    }

    const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);
    const resolvedAs = resolution.resolved_as;
    const key = resolvedAs.bcd_key;
    const featureId = resolvedAs.baseline_id;
    const feature = featureId === null ? undefined : baseline.feature(featureId);
    const leaf = key === null ? undefined : bcd.leaf(key);

    const baselineInfo =
      key !== null
        ? baseline.baselineForKey(key)
        : featureId !== null
          ? baseline.baselineForFeature(featureId)
          : undefined;
    if (baselineInfo?.state === 'not_mapped') {
      ctx.enrich({
        baselineNotMapped: `${key ?? query} sits outside the web-features mapping, so no Baseline state is computed for it. Call browsercompat_search_features to find a mapped sibling key.`,
      });
    }

    const description = feature?.description ?? leaf?.description;

    const discouraged = featureId === null ? undefined : baseline.discouraged(featureId);
    const status =
      leaf?.status === undefined
        ? undefined
        : {
            deprecated: leaf.status.deprecated,
            experimental: leaf.status.experimental,
            standard_track: leaf.status.standard_track,
            ...(discouraged === undefined ? {} : { discouraged }),
          };

    const support =
      leaf === undefined
        ? undefined
        : bcd.supportRows(leaf, [
            ...bcd.reportedBrowserIds,
            ...(input.include_runtimes ? bcd.runtimeBrowserIds : []),
          ]);

    if (leaf !== undefined && !input.include_runtimes) {
      const carried = bcd.runtimeBrowserIds.filter(
        (id) => leaf.support[id as keyof typeof leaf.support] !== undefined,
      );
      if (carried.length > 0) {
        ctx.enrich({
          runtimesExcluded: `This key also records support for ${carried.join(', ')}. Re-run with include_runtimes: true to see those rows.`,
        });
      }
    }

    const limiting =
      leaf === undefined ? undefined : bcd.limitingBrowser(leaf, baseline.coreBrowserIds);

    const specUrls =
      leaf?.spec_url === undefined
        ? undefined
        : typeof leaf.spec_url === 'string'
          ? [leaf.spec_url]
          : [...leaf.spec_url];

    const compatKeys = resolution.compat_keys;
    const children = key === null ? [] : bcd.directChildren(key);
    const childKeys = children.slice(input.subkeys_offset, input.subkeys_offset + 100);
    const nextOffset = input.subkeys_offset + childKeys.length;
    const subkeys =
      children.length === 0
        ? undefined
        : {
            total: children.length,
            keys: childKeys,
            truncated: nextOffset < children.length,
            ...(nextOffset < children.length ? { next_offset: nextOffset } : {}),
          };
    const noCompatData = key === null && (compatKeys?.length ?? 0) === 0;
    const guidance = noCompatData
      ? `"${featureId ?? query}" is a tracked web-features entry with no browser-compat-data keys yet, so there is no per-browser support to report. Call browsercompat_check_baseline for its Baseline state.`
      : undefined;

    ctx.log.debug('Resolved feature', { input: query, via: resolvedAs.resolved_via, key });

    return {
      found: true,
      outcome: noCompatData ? ('no_compat_data' as const) : ('found' as const),
      resolved_as: resolvedAs,
      ...(feature?.name === undefined ? {} : { name: feature.name }),
      ...(description === undefined ? {} : { description }),
      ...(baselineInfo === undefined ? {} : { baseline: baselineInfo }),
      ...(status === undefined ? {} : { status }),
      ...(discouraged === undefined ? {} : { discouraged }),
      ...(limiting === undefined ? {} : { limiting_browser: limiting }),
      ...(support === undefined ? {} : { support }),
      ...(leaf?.mdn_url === undefined ? {} : { mdn_url: leaf.mdn_url }),
      ...(specUrls === undefined ? {} : { spec_urls: specUrls }),
      ...(compatKeys === undefined ? {} : { compat_keys: compatKeys }),
      ...(subkeys === undefined ? {} : { subkeys }),
      ...(guidance === undefined ? {} : { guidance }),
    };
  },

  format: (result) => {
    const resolved = result.resolved_as;
    const heading = result.name ?? resolved?.bcd_key ?? resolved?.baseline_id ?? 'No match';
    const lines = [`# ${markdownText(heading)}`];
    lines.push(`**found:** ${result.found} · **outcome:** ${result.outcome}`);
    if (resolved) {
      lines.push(
        `**Resolved:** "${markdownText(resolved.input)}" → bcd_key ${markdownText(resolved.bcd_key ?? 'none')} · baseline_id ${markdownText(resolved.baseline_id ?? 'none')} · via ${resolved.resolved_via}`,
      );
    }
    if (result.baseline) lines.push(formatBaselineLine(result.baseline));
    if (result.status) {
      lines.push(
        `**Status:** standard_track ${result.status.standard_track} · deprecated ${result.status.deprecated} · experimental ${result.status.experimental}`,
      );
    } else if (result.found) {
      lines.push(
        resolved?.bcd_key === null
          ? '**Status:** not reported — this id spans more than one browser-compat-data key.'
          : '**Status:** not recorded for this key.',
      );
    }
    const advisories = [result.discouraged, result.status?.discouraged].filter(
      (value) => value !== undefined,
    );
    if (advisories.length > 0) {
      const reasons = [...new Set(advisories.map((value) => value.reason))];
      const sources = [...new Set(advisories.flatMap((value) => value.according_to))];
      lines.push(
        `**Discouraged:** ${reasons.map(markdownText).join('; ')} (according_to ${sources.map(markdownText).join(', ')})`,
      );
    }
    if (result.limiting_browser) {
      lines.push(
        `**Limiting browser:** ${markdownText(result.limiting_browser.name)} (${markdownText(result.limiting_browser.browser_id)}) ${markdownText(result.limiting_browser.version)} — full support in every core browser`,
      );
    }
    if (result.description) lines.push('', markdownText(result.description));
    if (result.support) {
      lines.push('', '## Support');
      for (const row of result.support) lines.push(...formatSupportRow(row));
    }
    if (result.compat_keys) {
      lines.push(
        '',
        `**compat_keys:** ${result.compat_keys.length === 0 ? 'none — this entry owns no browser-compat-data keys' : result.compat_keys.map(markdownText).join(', ')}`,
      );
    }
    if (result.mdn_url) lines.push('', `MDN: ${markdownText(result.mdn_url)}`);
    if (result.subkeys) {
      lines.push(
        '',
        '## Direct subkeys',
        `total: ${result.subkeys.total} · truncated: ${result.subkeys.truncated}`,
      );
      for (const child of result.subkeys.keys) lines.push(`- ${markdownText(child)}`);
      if (result.subkeys.keys.length === 0) lines.push('No child keys on this page.');
      if (result.subkeys.next_offset !== undefined)
        lines.push(
          `next_offset: ${result.subkeys.next_offset} — re-run with subkeys_offset: ${result.subkeys.next_offset}.`,
        );
      lines.push(
        'Call browsercompat_get_feature with one child key, or browsercompat_check_baseline with up to 20 child keys.',
      );
    }
    if (result.spec_urls) lines.push(`Spec: ${result.spec_urls.map(markdownText).join(' · ')}`);
    if (result.guidance) lines.push('', markdownText(result.guidance));
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
