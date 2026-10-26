/**
 * @fileoverview Regression contracts for bounded support, summaries, usage and target queries.
 * @module tests/tools/support-regressions.test
 */
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import type { SimpleSupportStatement } from '@mdn/browser-compat-data/types';
import { describe, expect, it } from 'vitest';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { browsercompatListReference } from '@/mcp-server/tools/definitions/browsercompat-list-reference.tool.js';
import { browsercompatSearchFeatures } from '@/mcp-server/tools/definitions/browsercompat-search-features.tool.js';
import { formatSupportSummary } from '@/mcp-server/tools/definitions/compat-shapes.js';
import { BcdService } from '@/services/bcd/bcd-service.js';
import { CANIUSE_ATTRIBUTION, getTargetsService } from '@/services/targets/targets-service.js';

function text(response: Awaited<ReturnType<typeof runToolContract>>): string {
  return response.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
}

describe('same-dataset characterization', () => {
  it('preserves raw global usage values and ordinary explicit resolution', async () => {
    const targets = await getTargetsService();
    expect(targets.agentUsageTotal('chrome')).toBe(23.7987);
    expect(targets.coverage(['ie 11'])).toBe(0.2118);
    expect(targets.excludedUsage(['css-has'])).toBe(1.5832);
    expect(targets.queryTokens('chrome 120')).toEqual(['chrome 120']);
    expect(targets.queryTokens('current node')).toEqual([`node ${process.versions.node}`]);
  });
});

describe('#32 uncertain removal', () => {
  const service = new BcdService({
    __meta: { version: 'fixture', timestamp: '' },
    browsers: {
      chrome: {
        name: 'Chrome',
        type: 'desktop',
        releases: {
          '1': { index: 0, status: 'retired' },
          '2': { index: 1, status: 'retired' },
          '3': { index: 2, status: 'retired' },
          '4': { index: 3, status: 'current' },
        },
      },
    },
  });
  it.each([
    [0, 'unsupported'],
    [1, 'unknown'],
    [2, 'unknown'],
    [3, 'removed'],
    [4, 'removed'],
  ])('bounded removal at index %i is %s', (index, verdict) => {
    expect(
      service.supportAt(
        {
          source_file: 'fixture.json',
          support: { chrome: { version_added: '2', version_removed: '≤4' } },
        },
        'chrome',
        index,
      ).verdict,
    ).toBe(verdict);
  });
  it.each([
    [0, 'unsupported'],
    [1, 'supported'],
    [2, 'supported'],
    [3, 'removed'],
    [4, 'removed'],
  ])('preserves exact removal at index %i as %s', (index, verdict) => {
    expect(
      service.supportAt(
        {
          source_file: 'fixture.json',
          support: { chrome: { version_added: '2', version_removed: '4' } },
        },
        'chrome',
        index,
      ).verdict,
    ).toBe(verdict);
  });
  it.each([
    [{ version_added: '1' }, 'supported'],
    [{ version_added: '1', version_removed: '2' }, 'unknown'],
  ] satisfies [SimpleSupportStatement, string][])(
    'aggregates sibling %j as %s',
    (sibling, verdict) => {
      expect(
        service.supportAt(
          {
            source_file: 'fixture.json',
            support: { chrome: [sibling, { version_added: '2', version_removed: '≤4' }] },
          },
          'chrome',
          2,
        ).verdict,
      ).toBe(verdict);
    },
  );
  it.each([
    ['chrome 60', 'inconclusive', 1],
    ['edge 79', 'inconclusive', 1],
    ['chrome 62', 'fails', 0],
    ['edge 80', 'fails', 0],
  ])('wires %s to %s on both surfaces', async (targets, verdict, unchecked) => {
    const response = await runToolContract(browsercompatCompareSupport, {
      features: ['html.elements.object.codebase'],
      targets,
    });
    expect(response.structuredContent).toMatchObject({
      all_clear: false,
      results: [{ verdict, unchecked_total: unchecked }],
    });
    expect(text(response)).toContain(`**${verdict}**`);
  });
  it('keeps whole-query uncertain/removal counts through first, second, last and past-end pages', async () => {
    for (const target_offset of [0, 2, 4, 6]) {
      const response = await runToolContract(browsercompatCompareSupport, {
        features: ['html.elements.object.codebase'],
        targets: 'chrome 58-63',
        target_limit: 2,
        target_offset,
      });
      expect(response.structuredContent).toMatchObject({
        all_clear: false,
        evaluated_targets_total: 2,
        unchecked_targets_total: 4,
        results: [{ verdict: 'fails', evaluated_total: 2, unchecked_total: 4, failing_total: 2 }],
      });
      expect(text(response)).toContain('**fails**');
      const output = browsercompatCompareSupport.output.parse(response.structuredContent);
      expect(output.targets_resolved).toHaveLength(target_offset === 6 ? 0 : 2);
      expect(output.results[0]?.failing_targets).toHaveLength(target_offset === 0 ? 2 : 0);
      expect(output.results[0]?.unchecked_targets).toHaveLength(
        target_offset === 2 || target_offset === 4 ? 2 : 0,
      );
    }
  });
});

describe('#33 selected support summary', () => {
  it.each(['supported', 'partial', 'prefixed', 'flagged'] as const)(
    'keeps %s and its addition bound',
    (verdict) => {
      for (const bound of [false, true]) {
        expect(
          formatSupportSummary([
            {
              browser_id: 'chrome',
              browser_name: 'Chrome',
              verdict,
              version_added: '94',
              ...(bound ? { version_added_is_upper_bound: true } : {}),
            },
          ]),
        ).toBe(`Chrome ${bound ? '≤' : ''}94${verdict === 'supported' ? '' : ` (${verdict})`}`);
      }
    },
  );
  it.each([
    ['api.AudioTrack', 'Firefox 33 (flagged)'],
    ['css.properties.user-select', 'Safari 3 (prefixed)'],
    ['api.MediaStreamTrackProcessor', 'Chrome 94 (partial)'],
    ['api.FileSystem', 'Edge ≤18'],
  ])('search %s preserves %s on both surfaces', async (query, expected) => {
    const response = await runToolContract(browsercompatSearchFeatures, { query, limit: 1 });
    const output = browsercompatSearchFeatures.output.parse(response.structuredContent);
    expect(output.results[0]?.support_summary).toContain(expected);
    expect(text(response)).toContain(expected);
  });
});

describe('#34 global population', () => {
  it('attributes global percentage points and unknown remainder', () => {
    expect(CANIUSE_ATTRIBUTION).toContain('percentage points of global traffic');
    expect(CANIUSE_ATTRIBUTION).toContain('remainder is untracked and unknown');
  });
  it('preserves raw agent usage while identifying the global population on both surfaces', async () => {
    const response = await runToolContract(browsercompatListReference, {
      topic: 'browserslist_agents',
    });
    const output = browsercompatListReference.output.parse(response.structuredContent);
    expect(output.entries.find((entry) => entry.id === 'chrome')?.usage_percent).toBe(23.7987);
    expect(text(response)).toContain('usage_percent: 23.7987% of global traffic');
    expect(response.structuredContent).toMatchObject({ attribution: CANIUSE_ATTRIBUTION });
    expect(text(response).replaceAll('\\~', '~')).toContain(CANIUSE_ATTRIBUTION);
  });
});

describe('#35 self-contained target queries', () => {
  it.each(['extends browserslist-config-nonexistent', 'browserslist config'])(
    'wires rejection of %s to both surfaces',
    async (targets) => {
      const response = await runToolContract(browsercompatCompareSupport, {
        features: ['has'],
        targets,
      });
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toMatchObject({
        error: { data: { reason: 'invalid_target_query' } },
      });
      expect(text(response)).toContain('self-contained');
    },
  );
  it('preserves current node as no_targets_resolved rather than invalid_target_query', async () => {
    const response = await runToolContract(browsercompatCompareSupport, {
      features: ['has'],
      targets: 'current node',
    });
    expect(response.structuredContent).toMatchObject({
      error: { data: { reason: 'no_targets_resolved' } },
    });
    expect(text(response)).toContain('no_targets_resolved');
  });
});
