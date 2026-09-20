/**
 * @fileoverview Tests for browsercompat_compare_support — the design's worked
 * `defaults` example (3 features, 1 clears), unchecked_targets reasons,
 * ambiguous/inconclusive/miss verdicts, error paths, and format() rendering.
 * @module tests/tools/browsercompat-compare-support.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';

async function run(features: string[], targets: string, resolve = false) {
  const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
  const input = browsercompatCompareSupport.input.parse({ features, targets, resolve });
  return { ctx, result: await browsercompatCompareSupport.handler(input, ctx) };
}

describe('browsercompat_compare_support — worked example: defaults', () => {
  const FEATURES = [
    'css.selectors.has',
    'javascript.builtins.Array.fromAsync',
    'css.properties.anchor-name',
  ];

  it('resolves 27 of 32 defaults tokens, with the 5 unmapped agents in unchecked_targets', async () => {
    const { result } = await run(FEATURES, 'defaults');
    expect(result.query_echo).toBe('defaults');
    expect(result.targets_resolved).toHaveLength(27);
    expect(result.unchecked_targets).toHaveLength(5);
    expect(result.unchecked_targets.map((t) => t.agent).sort()).toEqual(
      ['and_qq', 'and_uc', 'kaios', 'kaios', 'op_mini'].sort(),
    );
    expect(result.unchecked_targets.every((t) => t.reason === 'no_bcd_browser')).toBe(true);
  });

  it('reports coverage figures matching the real caniuse-derived percentages', async () => {
    const { result } = await run(FEATURES, 'defaults');
    expect(result.target_coverage_percent).toBeCloseTo(83.8794, 3);
    expect(result.unchecked_coverage_percent).toBeCloseTo(0.7842, 3);
  });

  it('1 of 3 features clears — css.selectors.has clears, the other two fail', async () => {
    const { result } = await run(FEATURES, 'defaults');
    expect(result.results.map((r) => r.verdict)).toEqual(['clears', 'fails', 'fails']);
    expect(result.all_clear).toBe(false);
  });

  it('Array.fromAsync fails exactly on chrome 120, chrome 109, op_mob 80 (unsupported)', async () => {
    const { result } = await run(FEATURES, 'defaults');
    const fromAsync = result.results[1];
    expect(fromAsync?.failing_targets).toEqual([
      {
        agent: 'chrome',
        version_token: '120',
        bcd_browser: 'chrome',
        bcd_version: '120',
        verdict: 'unsupported',
      },
      {
        agent: 'chrome',
        version_token: '109',
        bcd_browser: 'chrome',
        bcd_version: '109',
        verdict: 'unsupported',
      },
      {
        agent: 'op_mob',
        version_token: '80',
        bcd_browser: 'opera_android',
        bcd_version: '80',
        verdict: 'unsupported',
      },
    ]);
  });

  it('anchor-name additionally fails on firefox 140 and ios_saf 18.5-18.7', async () => {
    const { result } = await run(FEATURES, 'defaults');
    const anchorName = result.results[2];
    expect(anchorName?.failing_targets.map((t) => `${t.agent} ${t.version_token}`)).toEqual([
      'chrome 120',
      'chrome 109',
      'firefox 140',
      'ios_saf 18.5-18.7',
      'op_mob 80',
    ]);
    expect(anchorName?.failing_targets.every((t) => t.verdict === 'unsupported')).toBe(true);
  });

  it('conforms to the declared output schema', async () => {
    const { result } = await run(FEATURES, 'defaults');
    expect(result).toEqual(expect.schemaMatching(browsercompatCompareSupport.output));
  });
});

describe('browsercompat_compare_support — verdicts', () => {
  it('clears when every resolved target is supported', async () => {
    const { result } = await run(['css.selectors.has'], 'chrome 120');
    expect(result.results[0]).toMatchObject({ verdict: 'clears', failing_targets: [] });
    expect(result.all_clear).toBe(true);
  });

  it('miss: an unresolvable feature carries no failing_targets and guidance', async () => {
    const { result } = await run(['nope-xyz'], 'chrome 120');
    expect(result.results[0]).toEqual({
      input: 'nope-xyz',
      found: false,
      resolved_as: null,
      verdict: 'miss',
      failing_targets: [],
      guidance: expect.stringContaining('nope-xyz'),
    });
    expect(result.all_clear).toBe(false);
  });

  it('ambiguous: a multi-key id reports compat_keys and asks for a single key (D26)', async () => {
    const { result } = await run(['grid'], 'defaults');
    const gridResult = result.results[0];
    expect(gridResult).toMatchObject({
      found: true,
      verdict: 'ambiguous',
      failing_targets: [],
    });
    expect(gridResult?.compat_keys?.length).toBeGreaterThan(1);
    expect(gridResult?.guidance).toContain('compat_keys');
    expect(result.all_clear).toBe(false);
  });

  it('ambiguous with an empty compat_keys list (no_compat_data feature) still reports ambiguous, not a crash', async () => {
    const { result } = await run(['masonry'], 'defaults');
    expect(result.results[0]).toMatchObject({ verdict: 'ambiguous', compat_keys: [] });
    expect(result.results[0]?.guidance).toContain('browsercompat_check_baseline');
  });

  it('inconclusive: an unknown verdict for a resolved target moves it to unchecked_targets (D12)', async () => {
    // webextensions leaves omit several BCD browsers entirely from `support`.
    const { result } = await run(['webextensions.api.action.ColorArray'], 'ie 11, chrome 88');
    const item = result.results[0];
    expect(item?.verdict).toBe('inconclusive');
    expect(result.unchecked_targets).toContainEqual(
      expect.objectContaining({ agent: 'ie', version_token: '11', reason: 'no_bcd_data' }),
    );
  });
});

describe('browsercompat_compare_support — every token unchecked, none unmapped', () => {
  it('a single mapped agent with an unresolvable version is an ordinary response, not an error', async () => {
    const { result } = await run(['css.selectors.has'], 'safari TP');
    expect(result.query_echo).toBe('safari TP');
    expect(result.targets_resolved).toEqual([]);
    expect(result.unchecked_targets).toEqual([
      expect.objectContaining({ agent: 'safari', version_token: 'TP', reason: 'unknown_version' }),
    ]);
  });

  it('every feature is inconclusive when no target was evaluated — never a vacuous clears', async () => {
    const { result } = await run(['css.selectors.has', 'nope-xyz', 'grid'], 'safari TP');
    expect(result.results.map((r) => r.verdict)).toEqual(['inconclusive', 'miss', 'ambiguous']);
    expect(result.results[0]?.failing_targets).toEqual([]);
    expect(result.all_clear).toBe(false);
    expect(result.target_coverage_percent).toBe(0);
  });

  it('a mix of unmapped agent and unresolvable version keeps both per-token reasons', async () => {
    const { result } = await run(['css.selectors.has'], 'safari TP, op_mini all');
    expect(
      result.unchecked_targets.map((t) => `${t.agent} ${t.version_token} ${t.reason}`).sort(),
    ).toEqual(['op_mini all no_bcd_browser', 'safari TP unknown_version']);
    expect(result.results[0]?.verdict).toBe('inconclusive');
    expect(result.all_clear).toBe(false);
  });

  it('conforms to the declared output schema', async () => {
    const { result } = await run(['css.selectors.has'], 'safari TP');
    expect(result).toEqual(expect.schemaMatching(browsercompatCompareSupport.output));
  });

  it('uncheckedNotice still names the agents that went unevaluated', async () => {
    const { ctx } = await run(['css.selectors.has'], 'safari TP');
    expect(getEnrichment(ctx).uncheckedNotice).toContain('safari');
  });
});

describe('browsercompat_compare_support — resolve: true', () => {
  it('resolves an unambiguous punctuated alias per-entry', async () => {
    const { result } = await run([':has()'], 'chrome 120', true);
    expect(result.results[0]).toMatchObject({
      found: true,
      resolved_as: { resolved_via: 'search' },
    });
  });
});

describe('browsercompat_compare_support — errors', () => {
  it('invalid_target_query forwards the browserslist message verbatim', async () => {
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    const input = browsercompatCompareSupport.input.parse({
      features: ['has'],
      targets: 'Xyz 1',
    });
    await expect(browsercompatCompareSupport.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_target_query' },
      message: expect.stringContaining('Unknown browser Xyz'),
    });
  });

  it('a negation-only query is rejected as invalid_target_query', async () => {
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    const input = browsercompatCompareSupport.input.parse({
      features: ['has'],
      targets: 'not dead',
    });
    await expect(browsercompatCompareSupport.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_target_query' },
    });
  });

  it('no_targets_resolved names the unmapped agents when every token maps to one', async () => {
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    const input = browsercompatCompareSupport.input.parse({
      features: ['has'],
      targets: 'op_mini all',
    });
    await expect(browsercompatCompareSupport.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'no_targets_resolved' },
      message: expect.stringContaining('no browser-compat-data counterpart: op_mini'),
    });
  });

  it('no_targets_resolved says the query matched nothing when browserslist yields no tokens', async () => {
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    const input = browsercompatCompareSupport.input.parse({
      features: ['has'],
      targets: '> 100%',
    });
    await expect(browsercompatCompareSupport.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_targets_resolved' },
      message: expect.stringContaining('matched no browser versions'),
    });
  });

  it('invalid_feature_input fires for a whitespace-only entry and names that case in the hint', async () => {
    const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
    const input = browsercompatCompareSupport.input.parse({
      features: ['has', ' '],
      targets: 'chrome 120',
    });
    await expect(browsercompatCompareSupport.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'invalid_feature_input',
        recovery: { hint: expect.stringContaining('whitespace-only') },
      },
    });
  });

  it('rejects an empty targets string at the schema boundary (min(1))', () => {
    expect(
      browsercompatCompareSupport.input.safeParse({ features: ['has'], targets: '' }).success,
    ).toBe(false);
  });

  it('rejects an empty features array and an over-cap features array at the schema boundary', () => {
    expect(
      browsercompatCompareSupport.input.safeParse({ features: [], targets: 'defaults' }).success,
    ).toBe(false);
    expect(
      browsercompatCompareSupport.input.safeParse({
        features: Array(21).fill('has'),
        targets: 'defaults',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty and an over-200-character entry at the schema boundary', () => {
    expect(
      browsercompatCompareSupport.input.safeParse({ features: ['has', ''], targets: 'defaults' })
        .success,
    ).toBe(false);
    expect(
      browsercompatCompareSupport.input.safeParse({
        features: ['a'.repeat(201)],
        targets: 'defaults',
      }).success,
    ).toBe(false);
    expect(
      browsercompatCompareSupport.input.safeParse({
        features: ['a'.repeat(200)],
        targets: 'defaults',
      }).success,
    ).toBe(true);
  });
});

describe('browsercompat_compare_support — enrichment', () => {
  it('always echoes data_version, attribution, and totalCount', async () => {
    const { ctx } = await run(['has'], 'chrome 120');
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.1' });
    expect(getEnrichment(ctx).attribution).toMatch(/caniuse\.com/);
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('uncheckedNotice names the agents and combined usage share when targets go unchecked', async () => {
    const { ctx } = await run(['has'], 'defaults');
    const notice = getEnrichment(ctx).uncheckedNotice as string | undefined;
    expect(notice).toContain('5 target versions');
    expect(notice).toMatch(/op_mini|and_qq|and_uc|kaios/);
  });

  it('uncheckedNotice is absent when every target resolves cleanly', async () => {
    const { ctx } = await run(['has'], 'chrome 120');
    expect(getEnrichment(ctx).uncheckedNotice).toBeUndefined();
  });
});

describe('browsercompat_compare_support — format()', () => {
  it('renders the clears-count heading, per-feature verdicts, the evaluated table, and the unchecked table', async () => {
    const { result } = await run(
      ['css.selectors.has', 'javascript.builtins.Array.fromAsync', 'css.properties.anchor-name'],
      'defaults',
    );
    const blocks = browsercompatCompareSupport.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('# 1 of 3 features clears `defaults`');
    expect(text).toContain('**all_clear:** false');
    expect(text).toContain('**clears**');
    expect(text).toContain('**fails**');
    expect(text).toContain('## Targets evaluated');
    expect(text).toContain('## Not evaluated');
    expect(text).toContain('no_bcd_browser');
  });

  it('renders "every resolved target was evaluated" when nothing is unchecked', async () => {
    const { result } = await run(['has'], 'chrome 120');
    const blocks = browsercompatCompareSupport.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('Every resolved target was evaluated.');
  });

  it('renders the no-target-evaluated case with the per-token reason, not an empty table', async () => {
    const { result } = await run(['css.selectors.has'], 'safari TP');
    const blocks = browsercompatCompareSupport.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('# 0 of 1 features clears `safari TP`');
    expect(text).toContain('**inconclusive**');
    expect(text).toContain('## Targets evaluated');
    expect(text).toContain('No target version was evaluated.');
    expect(text).toContain('| safari TP | unknown_version |');
  });

  it('renders compat_keys and guidance for an ambiguous result', async () => {
    const { result } = await run(['grid'], 'defaults');
    const blocks = browsercompatCompareSupport.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('**ambiguous**');
    expect(text).toContain('compat_keys:');
    expect(text).toMatch(/css\.properties\.display\.grid/);
  });
});
