/**
 * @fileoverview Tool for finding web features by plain name or keyword when the
 * canonical key is unknown. Ranks matches in six named tiers and echoes which
 * field matched, so the ordering is inspectable rather than asserted.
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
      'path_segment',
      'description',
      'path_tokens',
    ])
    .describe('Which field matched the query, so the ranking can be inspected.'),
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
      .describe('Plain-language name or keyword, for example "container query" or "fromAsync".'),
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
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum results to return, from 1 to 50.'),
  }),

  output: z.object({
    results: z
      .array(ResultSchema.describe('One ranked match.'))
      .describe('Ranked matches, best first. An empty array is a successful search with no hits.'),
  }),

  enrichment: {
    data_version: DataVersionSchema.describe('Vintage of each bundled dataset behind this answer.'),
    totalCount: z.number().describe('Matches before the display cap was applied.'),
    truncated: z.boolean().optional().describe('True when matches exceeded limit.'),
    shown: z.number().optional().describe('Number of results returned.'),
    cap: z.number().optional().describe('The limit that was applied.'),
    appliedFilters: z
      .object({
        namespace: z.string().optional().describe('Namespace filter the search applied.'),
        baseline: z.string().optional().describe('Baseline filter the search applied.'),
      })
      .optional()
      .describe('Filters the server applied to this search.'),
    noMatchNotice: z.string().optional().describe('How to broaden a search that matched nothing.'),
  },

  enrichmentTrailer: {
    data_version: { render: renderDataVersion },
    appliedFilters: {
      render: (filters) =>
        `**Filters:** ${[
          filters?.namespace === undefined ? undefined : `namespace ${filters.namespace}`,
          filters?.baseline === undefined ? undefined : `baseline ${filters.baseline}`,
        ]
          .filter(Boolean)
          .join(' · ')}`,
    },
    noMatchNotice: { label: 'No matches' },
  },

  errors: [
    {
      reason: 'invalid_query',
      code: JsonRpcErrorCode.ValidationError,
      when: 'query is whitespace-only after normalization, or normalizes to zero tokens.',
      recovery:
        'Pass at least one word, e.g. "container query" or "fromAsync". Call browsercompat_list_reference with topic bcd_namespaces to browse by area instead.',
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

    if (input.namespace !== undefined || input.baseline !== undefined) {
      ctx.enrich({
        appliedFilters: {
          ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
          ...(input.baseline === undefined ? {} : { baseline: input.baseline }),
        },
      });
    }

    const hits = search.rank(query, {
      ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
      ...(input.baseline === undefined ? {} : { baseline: input.baseline }),
    });
    ctx.enrich.total(hits.length);

    const results = hits.slice(0, input.limit).map((hit) => {
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

    if (hits.length > input.limit) {
      ctx.enrich.truncated({ shown: results.length, cap: input.limit });
    }

    if (hits.length === 0) ctx.enrich({ noMatchNotice: await zeroHitNotice(input, query) });

    ctx.log.debug('Searched features', { query, matches: hits.length, shown: results.length });
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

/** Build the zero-hit guidance for whichever filters were in play. */
async function zeroHitNotice(
  input: { namespace?: string | undefined; baseline?: string | undefined },
  query: string,
): Promise<string> {
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
