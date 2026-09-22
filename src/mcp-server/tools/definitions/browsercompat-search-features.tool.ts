/**
 * @fileoverview Tool for finding web features by plain name or keyword when the
 * canonical key is unknown. Ranks matches in six named tiers and echoes which
 * field matched, so the ordering is inspectable rather than asserted; filters
 * by namespace, Baseline, web-features group, and snapshot, and pages by offset.
 * @module mcp-server/tools/definitions/browsercompat-search-features
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getBaselineService } from '@/services/baseline/baseline-service.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';
import {
  DataVersionSchema,
  getDataVersion,
  renderDataVersion,
} from '@/services/data-version/data-version-service.js';
import { getSearchService, tokenize } from '@/services/search/search-service.js';
import { formatSupportSummary } from './compat-shapes.js';

const ResultSchema = z.object({
  bcd_key: z
    .string()
    .optional()
    .describe('browser-compat-data key. Absent for entries that own no compat keys.'),
  baseline_id: z.string().optional().describe('web-features id covering this entry.'),
  name: z.string().optional().describe('web-features display name.'),
  description: z.string().optional().describe('One-line description of the feature.'),
  baseline_state: z
    .enum(['widely', 'newly', 'limited', 'not_mapped'])
    .describe('Baseline state for this entry, reported per browser-compat-data key.'),
  matched_on: z
    .enum([
      'bcd_key',
      'baseline_id',
      'name',
      'caniuse_title',
      'path_suffix',
      'path_segment',
      'description',
      'path_tokens',
    ])
    .describe(
      'Which field matched the query, so the ranking can be inspected. path_suffix means the key ends in the dotted or property-value notation the query used, such as Element.animate or display: grid.',
    ),
  support_summary: z
    .string()
    .describe(
      'One line over the Baseline core browsers, with — for unsupported and ? for unknown.',
    ),
  mdn_url: z.string().optional().describe('MDN reference page for this key.'),
});

export const browsercompatSearchFeatures = tool('browsercompat_search_features', {
  description:
    'Find web features by plain name or keyword when the canonical key is unknown, across CSS, JavaScript, HTML, Web APIs, SVG, MathML, WebAssembly, and HTTP headers. Returns ranked matches with the BCD key, the web-features id, the Baseline state, a one-line support summary, and which field matched. Feed a result key into browsercompat_get_feature for the full record.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  input: z.object({
    query: z
      .string()
      .min(1)
      .max(100)
      .describe(
        'Plain-language name, keyword, or code notation, for example "container query", "fromAsync", "Array.prototype.at", "display: grid", or "<dialog>".',
      ),
    namespace: z
      .enum([
        'api',
        'css',
        'html',
        'http',
        'javascript',
        'manifests',
        'mathml',
        'mediatypes',
        'svg',
        'webassembly',
        'webdriver',
        'webextensions',
      ])
      .optional()
      .describe('Restrict results to one top-level browser-compat-data namespace.'),
    baseline: z
      .enum(['widely', 'newly', 'limited', 'not_mapped'])
      .optional()
      .describe('Restrict results to one Baseline state.'),
    group: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        'Restrict results to features in one web-features group or any group nested under it, for example "selectors" or "css". Keys with no web-features mapping never match. Call browsercompat_list_reference with topic groups for valid ids.',
      ),
    snapshot: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        'Restrict results to features in one ECMAScript snapshot, for example "ecmascript-2023". Call browsercompat_list_reference with topic snapshots for valid ids.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum results to return, from 1 to 50.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Number of ranked matches to skip before returning results, for paging past limit. Pass the nextOffset from the previous response.',
      ),
  }),

  output: z.object({
    results: z
      .array(ResultSchema.describe('One ranked match.'))
      .describe('Ranked matches, best first. An empty array is a successful search with no hits.'),
  }),

  enrichment: {
    data_version: DataVersionSchema.describe('Vintage of each bundled dataset behind this answer.'),
    totalCount: z.number().describe('Matches across every page, before offset and limit apply.'),
    truncated: z.boolean().optional().describe('True when more matches remain past this page.'),
    shown: z.number().optional().describe('Number of results on this page.'),
    cap: z.number().optional().describe('The limit that was applied.'),
    nextOffset: z
      .number()
      .optional()
      .describe('The offset of the next page. Present only while matches remain past this page.'),
    appliedFilters: z
      .object({
        namespace: z.string().optional().describe('Namespace filter the search applied.'),
        baseline: z.string().optional().describe('Baseline filter the search applied.'),
        group: z
          .string()
          .optional()
          .describe('web-features group filter the search applied, nested groups included.'),
        snapshot: z.string().optional().describe('ECMAScript snapshot filter the search applied.'),
      })
      .optional()
      .describe('Filters the server applied to this search.'),
    noMatchNotice: z.string().optional().describe('How to broaden a search that matched nothing.'),
    offsetNotice: z
      .string()
      .optional()
      .describe('Why a page came back empty although the search matched.'),
  },

  enrichmentTrailer: {
    data_version: { render: renderDataVersion },
    appliedFilters: {
      render: (filters) =>
        `**Filters:** ${[
          filters?.namespace === undefined ? undefined : `namespace ${filters.namespace}`,
          filters?.baseline === undefined ? undefined : `baseline ${filters.baseline}`,
          filters?.group === undefined ? undefined : `group ${filters.group} (and nested groups)`,
          filters?.snapshot === undefined ? undefined : `snapshot ${filters.snapshot}`,
        ]
          .filter(Boolean)
          .join(' · ')}`,
    },
    noMatchNotice: { label: 'No matches' },
    offsetNotice: { label: 'Past the end' },
  },

  errors: [
    {
      reason: 'invalid_query',
      code: JsonRpcErrorCode.ValidationError,
      when: 'query is whitespace-only after normalization, or normalizes to zero tokens.',
      recovery:
        'Pass at least one word, e.g. "container query" or "fromAsync". Call browsercompat_list_reference with topic bcd_namespaces to browse by area instead.',
    },
    {
      reason: 'unknown_group',
      code: JsonRpcErrorCode.ValidationError,
      when: 'group names no web-features group in the bundled data.',
      recovery:
        'Call browsercompat_list_reference with topic groups for the valid group ids, then retry with one of them or without group.',
    },
    {
      reason: 'unknown_snapshot',
      code: JsonRpcErrorCode.ValidationError,
      when: 'snapshot names no ECMAScript snapshot in the bundled data.',
      recovery:
        'Call browsercompat_list_reference with topic snapshots for the valid snapshot ids, then retry with one of them or without snapshot.',
    },
  ],

  async handler(input, ctx) {
    const dataVersion = await getDataVersion();
    ctx.enrich({ data_version: dataVersion });

    const query = input.query.trim();
    if (tokenize(query).length === 0) {
      throw ctx.fail('invalid_query', `"${input.query}" normalizes to zero searchable tokens.`, {
        ...ctx.recoveryFor('invalid_query'),
      });
    }

    const [bcd, baseline, search] = await Promise.all([
      getBcdService(),
      getBaselineService(),
      getSearchService(),
    ]);

    if (input.group !== undefined && !Object.hasOwn(baseline.groups, input.group)) {
      throw ctx.fail('unknown_group', `"${input.group}" is not a web-features group.`, {
        ...ctx.recoveryFor('unknown_group'),
      });
    }
    if (input.snapshot !== undefined && !Object.hasOwn(baseline.snapshots, input.snapshot)) {
      throw ctx.fail('unknown_snapshot', `"${input.snapshot}" is not an ECMAScript snapshot.`, {
        ...ctx.recoveryFor('unknown_snapshot'),
      });
    }

    const filters = {
      ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
      ...(input.baseline === undefined ? {} : { baseline: input.baseline }),
      ...(input.group === undefined ? {} : { group: input.group }),
      ...(input.snapshot === undefined ? {} : { snapshot: input.snapshot }),
    };
    if (Object.keys(filters).length > 0) ctx.enrich({ appliedFilters: filters });

    const hits = search.rank(query, filters);
    ctx.enrich.total(hits.length);

    const results = hits.slice(input.offset, input.offset + input.limit).map((hit) => {
      const leaf = hit.row.bcd_key === undefined ? undefined : bcd.leaf(hit.row.bcd_key);
      const summary =
        leaf === undefined
          ? 'No browser-compat-data keys for this entry.'
          : formatSupportSummary(bcd.supportRows(leaf, baseline.coreBrowserIds));
      return {
        ...(hit.row.bcd_key === undefined ? {} : { bcd_key: hit.row.bcd_key }),
        ...(hit.row.baseline_id === undefined ? {} : { baseline_id: hit.row.baseline_id }),
        ...(hit.row.name === undefined ? {} : { name: hit.row.name }),
        ...(hit.row.description === undefined ? {} : { description: hit.row.description }),
        baseline_state: hit.row.baseline_state,
        matched_on: hit.matched_on,
        support_summary: summary,
        ...(hit.row.mdn_url === undefined ? {} : { mdn_url: hit.row.mdn_url }),
      };
    });

    const nextOffset = input.offset + results.length;
    if (results.length > 0 && hits.length > nextOffset) {
      ctx.enrich.truncated({ shown: results.length, cap: input.limit });
      ctx.enrich({ nextOffset });
    }

    if (hits.length === 0) ctx.enrich({ noMatchNotice: await zeroHitNotice(input, query) });
    else if (results.length === 0) {
      ctx.enrich({
        offsetNotice: `offset ${input.offset} is at or past totalCount ${hits.length}. Re-run with an offset below ${hits.length}, or omit offset for the first page.`,
      });
    }

    ctx.log.debug('Searched features', {
      query,
      matches: hits.length,
      offset: input.offset,
      shown: results.length,
    });
    return { results };
  },

  format: (result) => {
    const lines = [`# ${result.results.length} matches`];
    for (const item of result.results) {
      lines.push('');
      lines.push(`## ${item.name ?? item.bcd_key ?? item.baseline_id ?? 'Match'}`);
      const identity = [
        item.bcd_key === undefined ? undefined : `bcd_key ${item.bcd_key}`,
        item.baseline_id === undefined ? undefined : `baseline_id ${item.baseline_id}`,
      ].filter(Boolean);
      if (identity.length > 0) lines.push(identity.join(' · '));
      lines.push(`**baseline_state:** ${item.baseline_state} · **matched_on:** ${item.matched_on}`);
      lines.push(`**support_summary:** ${item.support_summary}`);
      if (item.description) lines.push(item.description);
      if (item.mdn_url) lines.push(`MDN: ${item.mdn_url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});

/**
 * Build the zero-hit guidance for whichever filters were in play. Only the first
 * set filter is named, in the order snapshot, group, namespace, baseline.
 */
async function zeroHitNotice(
  input: {
    namespace?: string | undefined;
    baseline?: string | undefined;
    group?: string | undefined;
    snapshot?: string | undefined;
  },
  query: string,
): Promise<string> {
  if (input.snapshot !== undefined) {
    return `No match in the ${input.snapshot} snapshot. Re-run without snapshot, or call browsercompat_list_reference with topic snapshots to pick a different edition.`;
  }
  if (input.group !== undefined) {
    return `No match in the ${input.group} group or the groups nested under it. Re-run without group, or call browsercompat_list_reference with topic groups to pick a different group.`;
  }
  if (input.namespace !== undefined) {
    return `No match in the ${input.namespace} namespace. Re-run without namespace, or call browsercompat_list_reference with topic bcd_namespaces to pick a different area.`;
  }
  if (input.baseline !== undefined) {
    const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);
    let notMapped = 0;
    for (const [key] of bcd.entries()) {
      if (baseline.baselineForKey(key).state === 'not_mapped') notMapped += 1;
    }
    const share = ((notMapped / bcd.leafCount) * 100).toFixed(1);
    return `No match at Baseline ${input.baseline}. Re-run without the baseline filter — ${share}% of BCD keys are not_mapped and are excluded by any other baseline value.`;
  }
  return `No feature matched "${query}". Try the CSS property, JS method, or HTML element name on its own, or call browsercompat_list_reference with topic bcd_namespaces to browse by area.`;
}
