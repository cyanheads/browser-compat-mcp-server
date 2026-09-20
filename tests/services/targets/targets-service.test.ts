/**
 * @fileoverview Tests for the targets service: browserslist query resolution,
 * agent-to-BCD mapping, usage weighting, and the excluded-usage computation.
 * Runs against the real bundled `browserslist` + `caniuse-lite` snapshots.
 * @module tests/services/targets/targets-service.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { CANIUSE_ATTRIBUTION, getTargetsService } from '@/services/targets/targets-service.js';

describe('CANIUSE_ATTRIBUTION', () => {
  it('is the exact CC BY 4.0 attribution string used verbatim on every response (D20)', () => {
    expect(CANIUSE_ATTRIBUTION).toBe(
      'Usage data from caniuse.com, © Can I Use contributors, CC BY 4.0. ' +
        'Figures are a share of the ~96.7% of global traffic caniuse tracks.',
    );
  });
});

describe('TargetsService#agentIds / agentUsageTotal', () => {
  it('lists 19 agents, matching the browserslist-bcd-map agent set', async () => {
    const targets = await getTargetsService();
    expect(targets.agentIds()).toHaveLength(19);
  });

  it('reports per-agent usage totals matching the verified design figures', async () => {
    const targets = await getTargetsService();
    expect(targets.agentUsageTotal('ie')).toBeCloseTo(0.266, 2);
    expect(targets.agentUsageTotal('edge')).toBeCloseTo(5.088, 2);
    expect(targets.agentUsageTotal('firefox')).toBeCloseTo(2.893, 2);
    expect(targets.agentUsageTotal('chrome')).toBeCloseTo(22.17, 1);
    expect(targets.agentUsageTotal('safari')).toBeCloseTo(2.47, 2);
    expect(targets.agentUsageTotal('opera')).toBeCloseTo(0.248, 2);
    expect(targets.agentUsageTotal('ios_saf')).toBeCloseTo(13.728, 2);
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
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    const tokens = targets.queryTokens('chrome 100', ctx);
    expect(tokens).toEqual(['chrome 100']);
  });

  it('wraps a rejected query as invalid_target_query, forwarding the browserslist message verbatim', async () => {
    const targets = await getTargetsService();
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    try {
      targets.queryTokens('Xyz 1', ctx);
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
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    expect(() => targets.queryTokens('not dead', ctx)).toThrow(McpError);
  });

  it('a non-browserslist error propagates unwrapped', async () => {
    const targets = await getTargetsService();
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    // An empty query string is not a BrowserslistError — confirm the
    // isBrowserslistError guard does not swallow arbitrary throws.
    expect(() => targets.queryTokens('', ctx)).not.toThrow(McpError);
  });
});

describe('TargetsService#coverage', () => {
  it('returns 0 for an empty token list without calling into browserslist', async () => {
    const targets = await getTargetsService();
    expect(targets.coverage([])).toBe(0);
  });

  it('reports real caniuse-derived coverage for a known token', async () => {
    const targets = await getTargetsService();
    expect(targets.coverage(['ie 11'])).toBeCloseTo(0.2663, 3);
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

  it('computes the real excluded share for css-has (2.6222%)', async () => {
    const targets = await getTargetsService();
    expect(targets.excludedUsage(['css-has'])).toBeCloseTo(2.6222, 3);
  });
});
