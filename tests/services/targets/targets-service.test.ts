/**
 * @fileoverview Tests for the targets service: browserslist query resolution,
 * agent-to-BCD mapping, usage weighting, and the excluded-usage computation.
 * Runs against the real bundled `browserslist` + `caniuse-lite` snapshots.
 * @module tests/services/targets/targets-service.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { describe, expect, it } from 'vitest';
import { CANIUSE_ATTRIBUTION, getTargetsService } from '@/services/targets/targets-service.js';

describe('CANIUSE_ATTRIBUTION', () => {
  it('is the exact CC BY 4.0 attribution string used verbatim on every response (D20)', () => {
    expect(CANIUSE_ATTRIBUTION).toBe(
      'Usage data from caniuse.com, © Can I Use contributors, CC BY 4.0. ' +
        'Figures are a share of the ~97.3% of global traffic caniuse tracks.',
    );
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
    expect(targets.agentUsageTotal('ie')).toBeCloseTo(0.2358, 3);
    expect(targets.agentUsageTotal('edge')).toBeCloseTo(5.1193, 3);
    expect(targets.agentUsageTotal('firefox')).toBeCloseTo(2.5056, 3);
    expect(targets.agentUsageTotal('chrome')).toBeCloseTo(25.4149, 3);
    expect(targets.agentUsageTotal('safari')).toBeCloseTo(2.4712, 3);
    expect(targets.agentUsageTotal('opera')).toBeCloseTo(0.8942, 3);
    expect(targets.agentUsageTotal('ios_saf')).toBeCloseTo(13.2051, 3);
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
    expect(targets.coverage(['ie 11'])).toBeCloseTo(0.2358, 3);
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
      },
    ]);
  });

  it('a token with no version segment is treated as an empty version token', async () => {
    const targets = await getTargetsService();
    const { unchecked } = await targets.resolveTargets(['op_mini']);
    expect(unchecked[0]).toMatchObject({ agent: 'op_mini', version_token: '' });
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

  it('computes the real excluded share for css-has (2.4496%)', async () => {
    const targets = await getTargetsService();
    expect(targets.excludedUsage(['css-has'])).toBeCloseTo(2.4496, 3);
  });
});
