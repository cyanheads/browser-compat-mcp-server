/**
 * @fileoverview Tests for browsercompat_compare_support — the design's worked
 * `defaults` example (3 features, none clears), unchecked_targets reasons,
 * ambiguous/inconclusive/miss verdicts, target paging, error paths, and
 * format() rendering.
 * @module tests/tools/browsercompat-compare-support.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';

async function run(
  features: string[],
  targets: string,
  resolve = false,
  page: { target_offset?: number; target_limit?: number } = {},
) {
  const ctx = createMockContext({ errors: browsercompatCompareSupport.errors });
  const input = browsercompatCompareSupport.input.parse({ features, targets, resolve, ...page });
  return { ctx, result: await browsercompatCompareSupport.handler(input, ctx) };
}

/** Every page of a query at the default page size, following `nextOffset`. */
async function runAllPages(features: string[], targets: string) {
  const pages: Awaited<ReturnType<typeof run>>['result'][] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const { ctx, result } = await run(features, targets, false, { target_offset: offset });
    pages.push(result);
    offset = getEnrichment(ctx).nextOffset as number | undefined;
  }
  return pages;
}

describe('browsercompat_compare_support — worked example: defaults', () => {
  const FEATURES = [
    'css.selectors.has',
    'javascript.builtins.Array.fromAsync',
    'css.properties.anchor-name',
  ];

  it('maps 30 of 35 defaults tokens, with the 5 unmapped tokens in unchecked_targets', async () => {
    const pages = await runAllPages(FEATURES, 'defaults');
    expect(pages).toHaveLength(4);
    for (const page of pages) {
      expect(page).toMatchObject({
        query_echo: 'defaults',
        comparable_features: 3,
        targets_resolved_total: 30,
        evaluated_targets_total: 30,
        unchecked_targets_total: 5,
      });
    }
    const mapped = pages.flatMap((page) => page.targets_resolved);
    const unchecked = pages.flatMap((page) => page.unchecked_targets);
    expect(mapped).toHaveLength(30);
    expect(mapped.every((t) => t.evaluated)).toBe(true);
    expect(unchecked.map((t) => t.agent).sort()).toEqual(
      ['and_qq', 'and_uc', 'kaios', 'kaios', 'op_mini'].sort(),
    );
    expect(unchecked.every((t) => t.reason === 'no_bcd_browser')).toBe(true);
    // The first page covers ten query tokens: eight mapped, two unmapped.
    expect(pages[0]?.targets_resolved).toHaveLength(8);
    expect(pages[0]?.unchecked_targets.map((t) => t.agent)).toEqual(['and_qq', 'and_uc']);
  });

  it('reports coverage figures matching the real caniuse-derived percentages', async () => {
    const { result } = await run(FEATURES, 'defaults');
    expect(result.target_coverage_percent).toBeCloseTo(84.1977, 3);
    expect(result.unchecked_coverage_percent).toBeCloseTo(0.7324, 3);
  });

  it('0 of 3 features clears — css.selectors.has is inconclusive over the 5 unmapped tokens, the other two fail', async () => {
    const { result } = await run(FEATURES, 'defaults');
    expect(result.results.map((r) => r.verdict)).toEqual(['inconclusive', 'fails', 'fails']);
    expect(result.results[0]).toMatchObject({
      failing_total: 0,
      evaluated_total: 30,
      evaluated_coverage_percent: 84.1977,
      unchecked_total: 5,
      unchecked_coverage_percent: 0.7324,
    });
    expect(result.all_clear).toBe(false);
  });

  it('Array.fromAsync fails exactly on chrome 120, chrome 109, op_mob 80 (unsupported)', async () => {
    const pages = await runAllPages(FEATURES, 'defaults');
    expect(pages.map((page) => page.results[1]?.failing_total)).toEqual([3, 3, 3, 3]);
    expect(pages.map((page) => page.results[1]?.failing_targets.length)).toEqual([0, 2, 1, 0]);
    expect(pages.flatMap((page) => page.results[1]?.failing_targets ?? [])).toEqual([
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
    const pages = await runAllPages(FEATURES, 'defaults');
    const failing = pages.flatMap((page) => page.results[2]?.failing_targets ?? []);
    expect(failing.map((t) => `${t.agent} ${t.version_token}`)).toEqual([
      'chrome 120',
      'chrome 109',
      'firefox 140',
      'ios_saf 18.5-18.7',
      'op_mob 80',
    ]);
    expect(failing.every((t) => t.verdict === 'unsupported')).toBe(true);
    expect(pages[0]?.results[2]).toMatchObject({ verdict: 'fails', failing_total: 5 });
  });

  it('conforms to the declared output schema on every page', async () => {
    for (const page of await runAllPages(FEATURES, 'defaults')) {
      expect(page).toEqual(expect.schemaMatching(browsercompatCompareSupport.output));
    }
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
    const { result } = await run(['intersection-observer-v2'], 'defaults');
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

  it('a multi-key feature name is ambiguous with compat_keys, not a miss', async () => {
    const { result } = await run(['Container queries (size)'], 'chrome 120', true);
    expect(result.results[0]).toMatchObject({
      found: true,
      verdict: 'ambiguous',
      resolved_as: { bcd_key: null, baseline_id: 'container-queries', resolved_via: 'search' },
      failing_targets: [],
    });
    expect(result.results[0]?.compat_keys).toHaveLength(12);
    expect(result.all_clear).toBe(false);
  });

  it('a path_suffix notation gets a real verdict against its exact key', async () => {
    const { result } = await run(['display: grid'], 'chrome 120', true);
    expect(result.results[0]).toMatchObject({
      found: true,
      verdict: 'clears',
      resolved_as: { bcd_key: 'css.properties.display.grid', resolved_via: 'search' },
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

  it('rejects an over-500-character targets query at the schema boundary', () => {
    expect(
      browsercompatCompareSupport.input.safeParse({
        features: ['has'],
        targets: 'a'.repeat(501),
      }).success,
    ).toBe(false);
    expect(
      browsercompatCompareSupport.input.safeParse({
        features: ['has'],
        targets: 'a'.repeat(500),
      }).success,
    ).toBe(true);
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
  it('always echoes data_version, attribution, and the page arithmetic, with totalCount counting query targets', async () => {
    const { ctx } = await run(['has', 'grid', 'nope-xyz'], 'chrome 120, chrome 109');
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.3' });
    expect(getEnrichment(ctx).attribution).toMatch(/caniuse\.com/);
    expect(getEnrichment(ctx)).toMatchObject({
      totalCount: 2,
      shown: 2,
      cap: 10,
      truncated: false,
    });
    expect(getEnrichment(ctx).nextOffset).toBeUndefined();
    expect(getEnrichment(ctx).offsetNotice).toBeUndefined();
  });

  it('a page short of the query carries truncated and the next offset', async () => {
    const { ctx, result } = await run(['has'], 'defaults', false, {
      target_offset: 30,
      target_limit: 3,
    });
    expect(getEnrichment(ctx)).toMatchObject({
      totalCount: 35,
      shown: 3,
      cap: 3,
      truncated: true,
      nextOffset: 33,
    });
    expect(result.targets_resolved.map((t) => `${t.agent} ${t.version_token}`)).toEqual([
      'safari 27',
      'safari 26.6',
      'safari 26.5',
    ]);
  });

  it('an offset past the end sets offsetNotice and no continuation', async () => {
    const { ctx, result } = await run(['has'], 'defaults', false, { target_offset: 35 });
    expect(getEnrichment(ctx)).toMatchObject({ totalCount: 35, shown: 0, truncated: false });
    expect(getEnrichment(ctx).nextOffset).toBeUndefined();
    expect(getEnrichment(ctx).offsetNotice).toContain('target_offset below 35');
    expect(result.targets_resolved).toEqual([]);
    expect(result.results[0]).toMatchObject({ verdict: 'inconclusive', evaluated_total: 30 });
  });

  it('uncheckedNotice names the agents and combined usage share when targets go unchecked', async () => {
    const { ctx } = await run(['has'], 'defaults');
    const notice = getEnrichment(ctx).uncheckedNotice as string | undefined;
    expect(notice).toContain('5 of 35 target versions were not evaluated');
    expect(notice).toContain('(and_qq, and_uc, kaios, op_mini)');
    expect(notice).toContain('0.7324% of tracked traffic');
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
    expect(text).toContain('# 0 of 3 features clears `defaults`');
    expect(text).toContain(
      'Evaluated for every compared feature: 30 of 35 target versions (84.1977% of tracked traffic) · not evaluated: 5 (0.7324%)',
    );
    expect(text).toContain(
      'Compared 3 of 3 features · 30 of 35 target versions map to a browser-compat-data release',
    );
    expect(text).toContain('**all_clear:** false');
    expect(text).toContain('**inconclusive**');
    expect(text).toContain('**fails**');
    expect(text).toContain('## Targets mapped to a release — 8 of 30 on this page');
    expect(text).toContain('## Not evaluated for every compared feature — 2 of 5 on this page');
    expect(text).toContain('no_bcd_browser');
    expect(text).not.toContain('## Targets evaluated');
  });

  it('renders a clean sweep with every target evaluated and nothing unchecked', async () => {
    const { result } = await run(['has'], 'chrome 120');
    const blocks = browsercompatCompareSupport.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('# 1 of 1 features clears `chrome 120`');
    expect(text).toContain(
      '  - evaluated on 1 of 1 target versions (0.5159% of tracked traffic) · failing 0 · not evaluated 0 (0%)',
    );
    expect(text).toContain('Every target version was evaluated for every compared feature.');
  });

  it('renders the no-target-evaluated case with the per-token reason, not an empty table', async () => {
    const { result } = await run(['css.selectors.has'], 'safari TP');
    const blocks = browsercompatCompareSupport.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('# 0 of 1 features clears `safari TP`');
    expect(text).toContain('**inconclusive**');
    expect(text).toContain('## Targets mapped to a release — 0 of 0 on this page');
    expect(text).toContain('No target version maps to a browser-compat-data release.');
    expect(text).toContain('Evaluated for every compared feature: 0 of 1 target versions');
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
