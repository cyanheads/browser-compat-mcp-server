/**
 * @fileoverview Tool that enumerates the reference vocabulary the other tools
 * expect: BCD namespaces and browser ids, browserslist agent ids and their BCD
 * counterparts, Baseline states, web-features groups, and ECMAScript snapshots.
 * @module mcp-server/tools/definitions/browsercompat-list-reference
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { bcdBrowserForAgent } from '@/data/browserslist-bcd-map.js';
import { getBaselineService } from '@/services/baseline/baseline-service.js';
import type { BaselineState } from '@/services/baseline/types.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';
import {
  DataVersionSchema,
  getDataVersion,
  renderDataVersion,
} from '@/services/data-version/data-version-service.js';
import { CANIUSE_ATTRIBUTION, getTargetsService } from '@/services/targets/targets-service.js';

/** Short human labels for the BCD namespaces, which carry no display name in the data. */
const NAMESPACE_LABELS: Record<string, string> = {
  api: 'Web APIs',
  css: 'CSS',
  html: 'HTML',
  http: 'HTTP',
  javascript: 'JavaScript',
  manifests: 'Web app manifests',
  mathml: 'MathML',
  mediatypes: 'Media types',
  svg: 'SVG',
  webassembly: 'WebAssembly',
  webdriver: 'WebDriver',
  webextensions: 'WebExtensions',
};

/** The four reported Baseline states, with the raw web-features value each maps from. */
const BASELINE_STATES: Array<{
  id: BaselineState;
  label: string;
  detail: string;
  maps_from: 'high' | 'low' | false | null;
}> = [
  {
    id: 'widely',
    label: 'Widely available',
    detail:
      'Supported in every Baseline core browser and has been long enough to be safe without a fallback.',
    maps_from: 'high',
  },
  {
    id: 'newly',
    label: 'Newly available',
    detail:
      'Supported in every Baseline core browser, but only recently — older installs may not have it yet.',
    maps_from: 'low',
  },
  {
    id: 'limited',
    label: 'Limited availability',
    detail: 'Not yet supported in every Baseline core browser.',
    maps_from: false,
  },
  {
    id: 'not_mapped',
    label: 'Not mapped',
    detail:
      'The browser-compat-data key sits outside the web-features mapping, so no Baseline state is computed for it.',
    maps_from: null,
  },
];

const EntrySchema = z.object({
  id: z.string().describe('Identifier callers pass to the other tools, or filter results by.'),
  label: z.string().describe('Human-readable name for this entry.'),
  detail: z.string().describe('One line explaining what the entry covers.'),
  count: z
    .number()
    .int()
    .optional()
    .describe('How many items the entry covers — compat keys for a namespace or Baseline state.'),
  bcd_browser: z
    .string()
    .nullable()
    .optional()
    .describe(
      'browser-compat-data browser this browserslist agent maps to, or null when none exists.',
    ),
  reported: z
    .boolean()
    .optional()
    .describe(
      'True when this browser is in the reported set (desktop or mobile). Runtimes are added only by include_runtimes.',
    ),
  usage_percent: z
    .number()
    .optional()
    .describe('Share of tracked global traffic attributed to this browserslist agent.'),
  maps_from: z
    .union([z.literal('high'), z.literal('low'), z.literal(false), z.literal(null)])
    .optional()
    .describe(
      'Raw web-features status.baseline value this reported state maps from; null for not_mapped, which has none.',
    ),
  spec_url: z.string().optional().describe('Specification URL for this ECMAScript snapshot.'),
});

type ReferenceEntry = z.infer<typeof EntrySchema>;

export const browsercompatListReference = tool('browsercompat_list_reference', {
  description:
    'Enumerate the reference vocabulary this server uses: BCD namespaces, BCD browser ids, browserslist agent ids and their BCD counterparts, Baseline states, web-features groups, and ECMAScript snapshots. Use it to build valid inputs for the other tools and to see which target browsers can be evaluated.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },

  input: z.object({
    topic: z
      .enum([
        'bcd_namespaces',
        'bcd_browsers',
        'browserslist_agents',
        'baseline_states',
        'groups',
        'snapshots',
      ])
      .describe(
        'Which vocabulary to list: bcd_namespaces for the 12 top-level browser-compat-data namespaces, bcd_browsers for the 17 tracked browsers, browserslist_agents for the 19 browserslist ids mapped to browser-compat-data browsers, baseline_states for the 4 Baseline states, groups for the 104 web-features groups, or snapshots for the 11 ECMAScript snapshots.',
      ),
  }),

  output: z.object({
    topic: z.string().describe('The topic that was listed.'),
    entries: z
      .array(EntrySchema.describe('One vocabulary entry.'))
      .describe('Every entry in the requested vocabulary.'),
  }),

  enrichment: {
    data_version: DataVersionSchema.describe('Vintage of each bundled dataset behind this answer.'),
    attribution: z
      .string()
      .optional()
      .describe('Required attribution for the caniuse-derived usage figures in this response.'),
  },

  enrichmentTrailer: {
    data_version: { render: renderDataVersion },
    attribution: { label: 'Usage data' },
  },

  async handler(input, ctx) {
    const [bcd, baseline, targets, dataVersion] = await Promise.all([
      getBcdService(),
      getBaselineService(),
      getTargetsService(),
      getDataVersion(),
    ]);
    ctx.enrich({ data_version: dataVersion });

    const entries: ReferenceEntry[] = [];

    if (input.topic === 'bcd_namespaces') {
      for (const namespace of bcd.namespaces) {
        entries.push({
          id: namespace,
          label: NAMESPACE_LABELS[namespace] ?? namespace,
          detail: `Top-level browser-compat-data namespace. Example key: ${bcd.namespaceExample(namespace) ?? namespace}`,
          count: bcd.namespaceLeafCount(namespace),
        });
      }
    }

    if (input.topic === 'bcd_browsers') {
      for (const [id, browser] of Object.entries(bcd.browsers)) {
        const latest = bcd.latestShippedRelease(id);
        const upstream = browser.upstream ? ` · upstream ${browser.upstream}` : '';
        const newest = latest ? ` · newest released ${latest.version}` : '';
        entries.push({
          id,
          label: browser.name,
          detail: `${browser.type}${upstream} · ${bcd.releaseCount(id)} releases${newest}`,
          reported: bcd.reportedBrowserIds.includes(id),
        });
      }
    }

    if (input.topic === 'browserslist_agents') {
      ctx.enrich({ attribution: CANIUSE_ATTRIBUTION });
      for (const agentId of targets.agentIds()) {
        const bcdBrowser = bcdBrowserForAgent(agentId);
        entries.push({
          id: agentId,
          label: targets.agents[agentId]?.browser ?? agentId,
          detail: bcdBrowser
            ? `Maps to browser-compat-data browser ${bcdBrowser}.`
            : 'No browser-compat-data counterpart — always reported in unchecked_targets.',
          bcd_browser: bcdBrowser,
          usage_percent: targets.agentUsageTotal(agentId),
        });
      }
    }

    if (input.topic === 'baseline_states') {
      const counts: Record<BaselineState, number> = {
        widely: 0,
        newly: 0,
        limited: 0,
        not_mapped: 0,
      };
      for (const [key] of bcd.entries()) counts[baseline.baselineForKey(key).state] += 1;
      for (const state of BASELINE_STATES) {
        entries.push({
          id: state.id,
          label: state.label,
          detail: state.detail,
          count: counts[state.id],
          maps_from: state.maps_from,
        });
      }
    }

    if (input.topic === 'groups') {
      const parents = new Set(Object.values(baseline.groups).map((group) => group.parent));
      for (const id of Object.keys(baseline.groups).sort()) {
        const group = baseline.groups[id];
        if (!group) continue;
        const place = group.parent
          ? `web-features group inside ${group.parent}.`
          : 'Top-level web-features group.';
        const nested = parents.has(id) ? '; nested groups are included' : '';
        entries.push({
          id,
          label: group.name,
          detail: `${place} Pass as group to browsercompat_search_features${nested}.`,
        });
      }
    }

    if (input.topic === 'snapshots') {
      for (const id of Object.keys(baseline.snapshots).sort()) {
        const snapshot = baseline.snapshots[id];
        if (!snapshot) continue;
        entries.push({
          id,
          label: snapshot.name,
          detail:
            'ECMAScript snapshot tracked by web-features. Pass as snapshot to browsercompat_search_features.',
          spec_url: snapshot.spec,
        });
      }
    }

    ctx.log.debug('Listed reference vocabulary', { topic: input.topic, count: entries.length });
    return { topic: input.topic, entries };
  },

  format: (result) => {
    const lines = [`# ${result.topic} — ${result.entries.length} entries`, ''];
    for (const entry of result.entries) {
      lines.push(`## ${entry.id} — ${entry.label}`);
      lines.push(entry.detail);
      if (entry.count !== undefined) lines.push(`- count: ${entry.count}`);
      if (entry.reported !== undefined) {
        lines.push(`- reported: ${entry.reported ? 'yes, reported browser' : 'no, runtime only'}`);
      }
      if (entry.bcd_browser !== undefined) {
        lines.push(`- bcd_browser: ${entry.bcd_browser ?? 'none'}`);
      }
      if (entry.usage_percent !== undefined) {
        lines.push(`- usage_percent: ${entry.usage_percent}% of tracked traffic`);
      }
      if (entry.maps_from !== undefined) {
        lines.push(`- maps_from: ${String(entry.maps_from)}`);
      }
      if (entry.spec_url !== undefined) lines.push(`- spec_url: ${entry.spec_url}`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
