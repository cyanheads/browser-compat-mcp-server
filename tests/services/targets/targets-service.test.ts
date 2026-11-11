/**
 * @fileoverview Tests for the targets service: browserslist query resolution,
 * agent-to-BCD mapping, usage weighting, and the excluded-usage computation.
 * Runs against the real bundled `browserslist` + `caniuse-lite` snapshots.
 * @module tests/services/targets/targets-service.test
 */

import { readFile } from 'node:fs/promises';
import { McpError } from '@cyanheads/mcp-ts-core/errors';
import browserslist from 'browserslist';
import { describe, expect, it, vi } from 'vitest';
import {
  CANIUSE_ATTRIBUTION,
  getTargetsService,
  TargetsService,
} from '@/services/targets/targets-service.js';
import { syntheticUsage } from '../../helpers/synthetic-targets.js';

describe('CANIUSE_ATTRIBUTION', () => {
  it('is the exact CC BY 4.0 attribution string used verbatim on every response (D20)', async () => {
    const { agents } = await import('caniuse-lite');
    const total = Object.values(agents).reduce(
      (sum, agent) =>
        sum +
        Object.values(agent?.usage_global ?? {}).reduce((subtotal, usage) => subtotal + usage, 0),
      0,
    );
    expect(CANIUSE_ATTRIBUTION).toBe(
      `Usage data from caniuse.com, © Can I Use contributors, CC BY 4.0. Figures are percentage points of global traffic. The bundled data tracks ~${total.toFixed(1)}% of global traffic; the remainder is untracked and unknown.`,
    );
  });

  it('keeps every documentation quotation identical to the runtime attribution', async () => {
    for (const path of ['README.md', 'THIRD_PARTY_NOTICES.md', 'docs/design.md']) {
      expect(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8')).toContain(
        CANIUSE_ATTRIBUTION,
      );
    }
  });

  it('states the share of global traffic the bundled caniuse-lite data sums to, to one decimal', async () => {
    const { agents } = await import('caniuse-lite');
    const tracked = Object.values(agents).reduce(
      (sum, agent) =>
        sum + Object.values(agent?.usage_global ?? {}).reduce((total, usage) => total + usage, 0),
      0,
    );
    expect(CANIUSE_ATTRIBUTION).toContain(`~${tracked.toFixed(1)}% of global traffic`);
  });
});

describe('TargetsService#agentIds / agentUsageTotal', () => {
  it('lists 19 agents, matching the browserslist-bcd-map agent set', async () => {
    const targets = await getTargetsService();
    expect(targets.agentIds()).toHaveLength(19);
  });

  it('reports per-agent usage totals matching the bundled snapshot', async () => {
    const targets = await getTargetsService();
    expect(targets.agentUsageTotal('ie')).toBeCloseTo(0.165, 3);
    expect(targets.agentUsageTotal('edge')).toBeCloseTo(5.0546, 3);
    expect(targets.agentUsageTotal('firefox')).toBeCloseTo(2.1263, 3);
    expect(targets.agentUsageTotal('chrome')).toBeCloseTo(24.9624, 3);
    expect(targets.agentUsageTotal('safari')).toBeCloseTo(2.913, 3);
    expect(targets.agentUsageTotal('opera')).toBeCloseTo(0.925, 3);
    expect(targets.agentUsageTotal('ios_saf')).toBeCloseTo(13.2284, 3);
  });

  it('is memoized — the same call twice returns the identical rounded value', async () => {
    const targets = await getTargetsService();
    expect(targets.agentUsageTotal('chrome')).toBe(targets.agentUsageTotal('chrome'));
  });
});

describe('TargetsService#caniuseFeature / caniuseTitle', () => {
  it('unpacks a known caniuse feature id to its title', async () => {
    const targets = await getTargetsService();
    expect(targets.caniuseTitle('css-has')).toBe(':has() CSS relational pseudo-class');
  });

  it('returns undefined for an id caniuse-lite does not carry', async () => {
    const targets = await getTargetsService();
    expect(targets.caniuseFeature('not-a-real-caniuse-id')).toBeUndefined();
    expect(targets.caniuseTitle('not-a-real-caniuse-id')).toBeUndefined();
  });
});

describe('TargetsService#queryTokens', () => {
  it.each(
    [
      'extends browserslist-config-nonexistent',
      '> 1% in browserslist-config-x stats',
      'cover 90% in browserslist-config-x stats',
      'browserslist config',
    ].flatMap((query) => [
      query,
      `chrome 120, ${query}`,
      `defaults, not ${query}`,
      `  ${query.toUpperCase().replaceAll(' ', '\t')}\n`,
    ]),
  )('refuses config node %s before invoking the resolver', (query) => {
    const resolver = Object.assign(vi.fn(browserslist), browserslist);
    const service = new TargetsService(resolver, {}, {}, () => {
      throw new Error('unreachable');
    });
    expect(() => service.queryTokens(query)).toThrow(
      expect.objectContaining({ data: { reason: 'invalid_target_query' } }),
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(['defaults', '> 1% in US', 'last 2 versions', 'chrome 120', '> 1%', 'cover 90%'])(
    'preserves explicit query %s',
    async (query) => {
      expect((await getTargetsService()).queryTokens(query)).toEqual(
        browserslist(query, { path: false }),
      );
    },
  );

  it.each(['> 1% in my stats', 'cover 90% in my stats'])(
    'preserves actionable custom-stat rejection: %s',
    async (query) => {
      const service = await getTargetsService();
      expect(() => service.queryTokens(query)).toThrow(
        expect.objectContaining({ data: { reason: 'invalid_target_query' } }),
      );
    },
  );
  it('runs a browserslist query with config discovery disabled (D22)', async () => {
    const targets = await getTargetsService();
    const tokens = targets.queryTokens('chrome 100');
    expect(tokens).toEqual(['chrome 100']);
  });

  it('wraps a rejected query as invalid_target_query, forwarding the browserslist message verbatim', async () => {
    const targets = await getTargetsService();
    try {
      targets.queryTokens('Xyz 1');
      throw new Error('expected queryTokens to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.message).toContain('Unknown browser Xyz');
      expect((mcpError.data as { reason?: string } | undefined)?.reason).toBe(
        'invalid_target_query',
      );
    }
  });

  it('a negation-only query without a base is rejected the same way', async () => {
    const targets = await getTargetsService();
    expect(() => targets.queryTokens('not dead')).toThrow(McpError);
  });

  it('a non-browserslist error propagates unwrapped', async () => {
    const targets = await getTargetsService();
    // An empty query string is not a BrowserslistError — confirm the
    // isBrowserslistError guard does not swallow arbitrary throws.
    expect(() => targets.queryTokens('')).not.toThrow(McpError);
  });
});

describe('TargetsService#coverage', () => {
  it('returns 0 for an empty token list without calling into browserslist', async () => {
    const targets = await getTargetsService();
    expect(targets.coverage([])).toBe(0);
  });

  it('reports real caniuse-derived coverage for a known token', async () => {
    const targets = await getTargetsService();
    expect(targets.coverage(['ie 11'])).toBeCloseTo(0.165, 3);
  });
});

describe('TargetsService#resolveTargets', () => {
  it('splits tokens into resolved, no_bcd_browser, and unknown_version buckets', async () => {
    const targets = await getTargetsService();
    const { resolved, unchecked } = await targets.resolveTargets([
      'chrome 100',
      'op_mini all',
      'safari TP',
    ]);
    expect(resolved).toEqual([
      {
        agent: 'chrome',
        version_token: '100',
        bcd_browser: 'chrome',
        bcd_version: '100',
        bcd_release_index: 98,
        span: [{ index: 98, version: '100' }],
      },
    ]);
    expect(unchecked).toContainEqual(
      expect.objectContaining({ agent: 'op_mini', version_token: 'all', reason: 'no_bcd_browser' }),
    );
    expect(unchecked).toContainEqual(
      expect.objectContaining({ agent: 'safari', version_token: 'TP', reason: 'unknown_version' }),
    );
  });

  it('op_mob 10 predates BCD’s oldest opera_android release (10.1) — still "resolved" at index -1, never dropped', async () => {
    // resolveTargetVersion's nearest-at-or-below search finds nothing and
    // returns { resolved: true, index: -1, version: null } (Core Mechanics
    // §2) rather than failing outright, so this target lands in `resolved`
    // with a null version and a -1 index, not in `unchecked`.
    const targets = await getTargetsService();
    const { resolved, unchecked } = await targets.resolveTargets(['op_mob 10']);
    expect(unchecked).toEqual([]);
    expect(resolved).toEqual([
      {
        agent: 'op_mob',
        version_token: '10',
        bcd_browser: 'opera_android',
        bcd_version: null,
        bcd_release_index: -1,
        span: [{ index: -1, version: null }],
      },
    ]);
  });

  it('a token with no version segment is treated as an empty version token', async () => {
    const targets = await getTargetsService();
    const { unchecked } = await targets.resolveTargets(['op_mini']);
    expect(unchecked[0]).toMatchObject({ agent: 'op_mini', version_token: '' });
  });

  /** Release ordinals of BCD 8.1.8, as `version@index`. */
  it.each([
    { token: 'ios_saf 15.0-15.1', browser: 'safari_ios', span: '15@22 15.1@23' },
    { token: 'samsung 5.0-5.4', browser: 'samsunginternet_android', span: '5.0@9 5.2@10 5.4@11' },
    // BCD lists no 18.7 and no 11.1: each endpoint takes the nearest release at or below it.
    { token: 'ios_saf 18.5-18.7', browser: 'safari_ios', span: '18.5@48 18.6@49' },
    { token: 'samsung 11.1-11.2', browser: 'samsunginternet_android', span: '11.0@25 11.2@26' },
    { token: 'android 4.4.3-4.4.4', browser: 'webview_android', span: '4.4.3@7' },
    { token: 'ios_saf 14.0-14.4', browser: 'safari_ios', span: '14@20' },
  ])(
    'grouped token $token spans every BCD release from its lower endpoint’s through its upper endpoint’s',
    async ({ token, browser, span }) => {
      const targets = await getTargetsService();
      const { resolved, unchecked } = await targets.resolveTargets([token]);
      const [agent, version] = token.split(' ');
      const releases = span.split(' ').map((entry) => {
        const [name, index] = entry.split('@');
        return { index: Number(index), version: name };
      });
      expect(unchecked).toEqual([]);
      expect(resolved).toEqual([
        {
          agent,
          version_token: version,
          bcd_browser: browser,
          bcd_version: releases[0]?.version,
          bcd_release_index: releases[0]?.index,
          span: releases,
        },
      ]);
    },
  );

  it('a grouped token whose upper endpoint maps to no release is unknown_version, never judged on half its range', async () => {
    const targets = await getTargetsService();
    const { resolved, unchecked } = await targets.resolveTargets(['ios_saf 15.0-TP']);
    expect(resolved).toEqual([]);
    expect(unchecked).toEqual([
      expect.objectContaining({
        agent: 'ios_saf',
        version_token: '15.0-TP',
        reason: 'unknown_version',
      }),
    ]);
  });
});

describe('TargetsService#excludedUsage — caniuse stat qualifiers', () => {
  it.each([
    ['y', 0, 0],
    ['y #1', 0, 0],
    ['y x', 1, 1],
    ['y x #2', 1, 1],
    ['y d #5', 1, 0],
    ['a x', 1, 0],
    ['n d', 1, 0],
    ['n x d', 1, 0],
    ['p d', 1, 0],
    ['u', 1, 0],
  ])('one mapped stat %j excludes %d point, %d of it prefixed', (stat, excluded, prefixed) => {
    const service = syntheticUsage({ '1': 1 }, { f: { '1': stat } });
    expect(service.excludedUsage(['f'])).toEqual({
      excludedPercent: excluded,
      prefixedPercent: prefixed,
    });
  });

  it('a missing stat excludes the cell, not as prefixed', () => {
    expect(syntheticUsage({ '1': 1 }, { f: {} }).excludedUsage(['f'])).toEqual({
      excludedPercent: 1,
      prefixedPercent: 0,
    });
  });

  it.each([
    ['y', 'y x', 1, 1],
    ['y x', 'y', 1, 1],
    ['y x', 'a', 1, 0],
    ['a', 'y x', 1, 0],
    ['y x', 'y d', 1, 0],
    ['y d', 'y x', 1, 0],
  ])(
    'two mapped stats %j + %j exclude %d point, %d of it prefixed',
    (first, second, excluded, prefixed) => {
      const service = syntheticUsage({ '1': 1 }, { f: { '1': first }, g: { '1': second } });
      expect(service.excludedUsage(['f', 'g'])).toEqual({
        excludedPercent: excluded,
        prefixedPercent: prefixed,
      });
    },
  );

  const mixedCells = { '1': 0.25, '2': 0.123456, '3': 1, '4': 2, '5': 0 };
  const mixedStats = { f: { '1': 'y', '2': 'y x #1', '3': 'a x', '4': 'y d #5', '5': 'n' } };

  it('sums every excluded cell across versions, rounded to 4 decimals, and skips zero-usage cells', () => {
    expect(syntheticUsage(mixedCells, mixedStats).excludedUsage(['f'])).toEqual({
      excludedPercent: 3.1235,
      prefixedPercent: 0.1235,
    });
  });

  it('spelledWithPrefix counts y x as supported and leaves a, d, and unsupported cells excluded', () => {
    expect(
      syntheticUsage(mixedCells, mixedStats).excludedUsage(['f'], { spelledWithPrefix: true }),
    ).toEqual({ excludedPercent: 3, prefixedPercent: 0 });
  });
});

describe('TargetsService#excludedUsage', () => {
  it('is undefined when the feature reaches no caniuse id — never zero (per design)', async () => {
    const targets = await getTargetsService();
    expect(targets.excludedUsage([])).toBeUndefined();
  });

  it('is undefined for an id caniuse-lite does not carry', async () => {
    const targets = await getTargetsService();
    expect(targets.excludedUsage(['not-a-real-caniuse-id'])).toBeUndefined();
  });

  it('computes the real excluded share for css-has (1.4843%), none of it prefix-required', async () => {
    const targets = await getTargetsService();
    expect(targets.excludedUsage(['css-has'])).toEqual({
      excludedPercent: 1.4843,
      prefixedPercent: 0,
    });
  });

  it('bundled user-select-none: every excluded point is prefix-required Safari and iOS Safari (caniuse-lite 1.0.30001823)', async () => {
    const targets = await getTargetsService();
    expect(targets.excludedUsage(['user-select-none'])).toEqual({
      excludedPercent: 16.3334,
      prefixedPercent: 16.3334,
    });
  });
});
