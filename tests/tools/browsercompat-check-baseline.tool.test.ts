/**
 * @fileoverview Tests for browsercompat_check_baseline — the worked
 * `['has','array-fromasync','intersection-observer-v2','nope-xyz']` example, `all_widely_available`
 * semantics (D30), usage exclusion, and error/enrichment behavior.
 * @module tests/tools/browsercompat-check-baseline.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatCheckBaseline } from '@/mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';
import { formatOmittedFeatures } from '@/mcp-server/tools/definitions/compat-shapes.js';
import { getBaselineService } from '@/services/baseline/baseline-service.js';

/** Every text block of an assembled result, joined. */
function textOf(result: Awaited<ReturnType<typeof runToolContract>>): string {
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

async function run(features: string[], resolve = false) {
  const ctx = createMockContext({ errors: browsercompatCheckBaseline.errors });
  const input = browsercompatCheckBaseline.input.parse({ features, resolve });
  return { ctx, result: await browsercompatCheckBaseline.handler(input, ctx) };
}

describe('browsercompat_check_baseline — worked example', () => {
  it('reports found/no_compat_data/miss outcomes in input order, all_widely_available false', async () => {
    const { result } = await run([
      'has',
      'array-fromasync',
      'intersection-observer-v2',
      'nope-xyz',
    ]);
    expect(result.results.map((r) => [r.input, r.outcome])).toEqual([
      ['has', 'found'],
      ['array-fromasync', 'found'],
      ['intersection-observer-v2', 'no_compat_data'],
      ['nope-xyz', 'miss'],
    ]);
    expect(result.all_widely_available).toBe(false);
  });

  it('has: widely, limiting_browser firefox 121, deprecated/experimental false, usage excluded 1.5832%', async () => {
    const { result } = await run(['has']);
    const has = result.results[0];
    expect(has).toMatchObject({
      found: true,
      outcome: 'found',
      name: ':has()',
      baseline: { state: 'widely', since_date: '2023-12-19', high_date: '2026-06-19' },
      limiting_browser: { browser_id: 'firefox', name: 'Firefox', version: '121' },
      deprecated: false,
      experimental: false,
      usage_source:
        'Feature-level caniuse figure; reported for a BCD key only when it is the feature’s sole declared compat key. Percentage points of global traffic; untracked traffic is unknown.',
    });
    expect(has?.usage_percent_excluded).toBeCloseTo(1.5832, 3);
  });

  it('usage_source states the global population and unknown untracked traffic', async () => {
    const { result } = await run(['has']);
    expect(result.results[0]?.usage_source).toContain(
      'Percentage points of global traffic; untracked traffic is unknown.',
    );
  });

  it('intersection-observer-v2: limited, no compat_keys, usage still computed via caniuse mapping, no limiting_browser', async () => {
    const { result } = await run([
      'has',
      'array-fromasync',
      'intersection-observer-v2',
      'nope-xyz',
    ]);
    const ioV2 = result.results[2];
    expect(ioV2).toMatchObject({
      found: true,
      outcome: 'no_compat_data',
      baseline: { state: 'limited' },
      compat_keys: [],
    });
    expect(ioV2?.limiting_browser).toBeUndefined();
    expect(ioV2?.deprecated).toBeUndefined();
    expect(ioV2?.usage_percent_excluded).toBeGreaterThan(0);
  });

  it('nope-xyz: a miss carries guidance and no baseline/limiting_browser fields', async () => {
    const { result } = await run([
      'has',
      'array-fromasync',
      'intersection-observer-v2',
      'nope-xyz',
    ]);
    const miss = result.results[3];
    expect(miss).toEqual({
      input: 'nope-xyz',
      found: false,
      outcome: 'miss',
      resolved_as: null,
      guidance: expect.stringContaining('nope-xyz'),
    });
  });

  it('conforms to the declared output schema', async () => {
    const { result } = await run([
      'has',
      'array-fromasync',
      'intersection-observer-v2',
      'nope-xyz',
    ]);
    expect(result).toEqual(expect.schemaMatching(browsercompatCheckBaseline.output));
  });
});

describe('browsercompat_check_baseline — all_widely_available (D30)', () => {
  it('is true only when every entry resolves and reports widely', async () => {
    const { result } = await run(['has']);
    expect(result.all_widely_available).toBe(true);
  });

  it('a single miss forces it false even when everything else is widely', async () => {
    const { result } = await run(['has', 'nope-xyz']);
    expect(result.all_widely_available).toBe(false);
  });

  it('a non-widely (limited) result forces it false', async () => {
    const { result } = await run(['intersection-observer-v2']);
    expect(result.all_widely_available).toBe(false);
  });

  it('deprecation/discouragement ride alongside the boolean without feeding it — the field answers Baseline only', async () => {
    const baselineService = await (
      await import('@/services/baseline/baseline-service.js')
    ).getBaselineService();
    const discouragedEntry = Object.entries(baselineService.features).find(
      ([, entry]) => entry.kind === 'feature' && entry.discouraged,
    );
    expect(discouragedEntry).toBeDefined();
    const [discouragedId] = discouragedEntry as [string, unknown];
    const { result } = await run([discouragedId, 'has']);
    const discouragedResult = result.results[0];
    // The discouraged flag is reported per result regardless of its own
    // Baseline state, and never forces all_widely_available false by itself —
    // only a non-widely baseline or a miss does that.
    expect(discouragedResult?.discouraged).toBeDefined();
    if (discouragedResult?.baseline?.state !== 'widely') {
      expect(result.all_widely_available).toBe(false);
    }
  });
});

describe('browsercompat_check_baseline — enrichment', () => {
  it('always echoes data_version and totalCount', async () => {
    const { ctx, result } = await run(['has', 'intersection-observer-v2']);
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.7' });
    expect(getEnrichment(ctx).totalCount).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  it('attribution is populated only when a result carries a usage figure', async () => {
    const { ctx } = await run(['nope-xyz']);
    expect(getEnrichment(ctx).attribution).toBeUndefined();
  });

  it('populates attribution when any result carries usage_percent_excluded', async () => {
    const { ctx } = await run(['has']);
    expect(getEnrichment(ctx).attribution).toMatch(/caniuse\.com/);
  });

  it('unresolvedNotice names the unresolved entries and the resolution count', async () => {
    const { ctx } = await run(['has', 'nope-xyz', 'also-fake']);
    const notice = getEnrichment(ctx).unresolvedNotice as string | undefined;
    expect(notice).toContain('2 of 3');
    expect(notice).toContain('nope-xyz');
    expect(notice).toContain('also-fake');
  });

  it('unresolvedNotice is absent when everything resolves', async () => {
    const { ctx } = await run(['has']);
    expect(getEnrichment(ctx).unresolvedNotice).toBeUndefined();
  });
});

describe('browsercompat_check_baseline — limiting_browser for multi-key ids (#26) and ≤ bounds (#30)', () => {
  it('grid: Edge 16 from web-features’ feature-level support, compat_keys retained, no feature_support', async () => {
    const result = await runToolContract(browsercompatCheckBaseline, { features: ['grid'] });
    expect(result.isError).not.toBe(true);
    const [grid] = browsercompatCheckBaseline.output.parse(result.structuredContent).results;
    expect(grid?.limiting_browser).toStrictEqual({
      browser_id: 'edge',
      name: 'Edge',
      version: '16',
    });
    expect(grid?.compat_keys).toHaveLength(10);
    expect(grid?.compat_keys_total).toBe(61);
    // Checked on the raw structuredContent: the output parse would strip an undeclared field.
    expect(result.structuredContent).not.toHaveProperty('results.0.feature_support');
    const text = textOf(result);
    expect(text.split('\n')).toContain(
      '**Limiting browser:** Edge (edge) 16 — web-features lists every core browser for the feature as a whole',
    );
    expect(text).not.toContain('feature_support');
  });

  it('a zero-key id has no limiting_browser', async () => {
    const { result } = await run(['http2']);
    expect(result.results[0]).toMatchObject({ outcome: 'no_compat_data', compat_keys: [] });
    expect(result.results[0]).not.toHaveProperty('limiting_browser');
  });

  it('api.FileSystem keeps Edge’s ≤18 bound on both surfaces', async () => {
    const result = await runToolContract(browsercompatCheckBaseline, {
      features: ['api.FileSystem', 'css.selectors.has'],
    });
    const [fileSystem, has] = browsercompatCheckBaseline.output.parse(
      result.structuredContent,
    ).results;
    expect(fileSystem?.limiting_browser).toEqual({
      browser_id: 'edge',
      name: 'Edge',
      version: '18',
      version_is_upper_bound: true,
    });
    expect(has?.limiting_browser).not.toHaveProperty('version_is_upper_bound');
    const text = textOf(result);
    expect(text).toContain(
      '**Limiting browser:** Edge (edge) 18 · version_is_upper_bound true — full support in every core browser',
    );
    expect(text).toContain(
      '**Limiting browser:** Firefox (firefox) 121 — full support in every core browser',
    );
  });

  it('a multi-key id whose feature-level limiting release is ≤ keeps the bound', async () => {
    const result = await runToolContract(browsercompatCheckBaseline, {
      features: ['opacity-svg'],
    });
    expect(
      browsercompatCheckBaseline.output.parse(result.structuredContent).results[0]
        ?.limiting_browser,
    ).toEqual({
      browser_id: 'safari',
      name: 'Safari',
      version: '13.1',
      version_is_upper_bound: true,
    });
    expect(textOf(result).split('\n')).toContain(
      '**Limiting browser:** Safari (safari) 13.1 · version_is_upper_bound true — web-features lists every core browser for the feature as a whole',
    );
  });
});

describe('browsercompat_check_baseline — resolve: true', () => {
  it('resolves an unambiguous punctuated alias per-entry', async () => {
    const { result } = await run([':has()'], true);
    expect(result.results[0]).toMatchObject({
      found: true,
      resolved_as: { resolved_via: 'search' },
    });
  });

  it('a multi-key feature name reports the feature-level Baseline and its compat_keys', async () => {
    const { result } = await run(['Container queries (size)', 'Cascade layers'], true);
    const baseline = await getBaselineService();
    const [containers, layers] = result.results;
    expect(containers).toMatchObject({
      found: true,
      outcome: 'found',
      resolved_as: { bcd_key: null, baseline_id: 'container-queries', resolved_via: 'search' },
      baseline: baseline.baselineForFeature('container-queries'),
    });
    expect(containers?.compat_keys).toHaveLength(10);
    expect(containers?.compat_keys_total).toBe(12);
    expect(containers?.limiting_browser).toEqual({
      browser_id: 'firefox',
      name: 'Firefox',
      version: '110',
    });
    expect(layers).toMatchObject({
      resolved_as: { baseline_id: 'cascade-layers' },
      baseline: baseline.baselineForFeature('cascade-layers'),
    });
    expect(layers?.compat_keys).toHaveLength(8);
  });
});

describe('browsercompat_check_baseline — schema and error boundaries', () => {
  it('rejects an empty features array at the schema boundary', () => {
    expect(browsercompatCheckBaseline.input.safeParse({ features: [] }).success).toBe(false);
  });

  it('rejects an array over the 100-entry ceiling at the schema boundary', () => {
    expect(
      browsercompatCheckBaseline.input.safeParse({ features: Array(101).fill('has') }).success,
    ).toBe(false);
    for (const length of [21, 100]) {
      expect(
        browsercompatCheckBaseline.input.safeParse({ features: Array(length).fill('has') }).success,
      ).toBe(true);
    }
  });

  it('rejects an empty and an over-200-character entry at the schema boundary', () => {
    expect(browsercompatCheckBaseline.input.safeParse({ features: ['has', ''] }).success).toBe(
      false,
    );
    expect(
      browsercompatCheckBaseline.input.safeParse({ features: ['a'.repeat(201)] }).success,
    ).toBe(false);
    expect(
      browsercompatCheckBaseline.input.safeParse({ features: ['a'.repeat(200)] }).success,
    ).toBe(true);
  });

  it('throws invalid_feature_input for a whitespace-only entry and names that case in the hint', async () => {
    const ctx = createMockContext({ errors: browsercompatCheckBaseline.errors });
    const input = browsercompatCheckBaseline.input.parse({ features: ['has', '  '] });
    await expect(browsercompatCheckBaseline.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'invalid_feature_input',
        recovery: { hint: expect.stringContaining('whitespace-only') },
      },
    });
  });
});

describe('browsercompat_check_baseline — format()', () => {
  it('renders the all_widely_available line and one section per result', async () => {
    const { result } = await run([
      'has',
      'array-fromasync',
      'intersection-observer-v2',
      'nope-xyz',
    ]);
    const blocks = browsercompatCheckBaseline.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('# Baseline check — 4 features');
    expect(text).toContain('**all_widely_available:** false');
    expect(text).toContain('## :has()');
    expect(text).toContain('**usage_percent_excluded:**');
    expect(text).toContain('## Intersection observer visibility tracking');
    expect(text).toContain('none — this entry owns no browser-compat-data keys');
    expect(text).toContain('## nope-xyz');
  });
});

/** Parse an assembled result through the production output schema, with its text. */
async function contract(features: string[]) {
  const result = await runToolContract(browsercompatCheckBaseline, { features });
  expect(result.isError).not.toBe(true);
  return {
    result,
    output: browsercompatCheckBaseline.output.parse(result.structuredContent),
    text: textOf(result),
  };
}

const serializedBytes = (result: Awaited<ReturnType<typeof runToolContract>>) =>
  Buffer.byteLength(
    JSON.stringify({ content: result.content, structuredContent: result.structuredContent }),
  );

describe('browsercompat_check_baseline — compat_keys per result (#25)', () => {
  it('grid carries its first 10 keys with total 61 and a pointer naming the resolved id; promise carries all 10', async () => {
    const baseline = await getBaselineService();
    // "Grid" resolves to the id "grid"; the pointer must name the id, not the input.
    const { output, text } = await contract(['Grid', 'promise']);
    const [grid, promise] = output.results;
    const gridKeys = baseline.compatKeys('grid').slice(0, 10);
    const promiseKeys = baseline.compatKeys('promise');
    expect(grid?.resolved_as?.baseline_id).toBe('grid');
    expect(grid?.compat_keys).toEqual(gridKeys);
    expect(grid?.compat_keys_total).toBe(61);
    expect(promiseKeys).toHaveLength(10);
    expect(promise?.compat_keys).toEqual(promiseKeys);
    expect(promise?.compat_keys_total).toBe(10);
    const lines = text.split('\n');
    expect(lines).toContain(
      `**compat_keys:** 10 of 61: ${gridKeys.join(', ')} — call browsercompat_get_feature with grid for all 61`,
    );
    expect(lines).toContain(`**compat_keys:** 10 of 10: ${promiseKeys.join(', ')}`);
  });

  it('a repeated entry keeps its own result with the same slice, and 20 × svg stays under 40,000 bytes', async () => {
    const { output, result } = await contract(Array(20).fill('svg'));
    expect(output.results).toHaveLength(20);
    for (const item of output.results) {
      expect(item.compat_keys).toHaveLength(10);
      expect(item.compat_keys_total).toBe(618);
    }
    expect(serializedBytes(result)).toBeLessThanOrEqual(40_000);
  });

  it('a zero-key id carries an empty list with total 0; a single key carries neither field', async () => {
    const { output, result } = await contract(['http2', 'has', 'css.selectors.has']);
    expect(output.results[0]).toMatchObject({ compat_keys: [], compat_keys_total: 0 });
    for (const index of [1, 2]) {
      expect(result.structuredContent).not.toHaveProperty(`results.${index}.compat_keys`);
      expect(result.structuredContent).not.toHaveProperty(`results.${index}.compat_keys_total`);
    }
  });
});

describe('browsercompat_check_baseline — features past the per-call cap (#29)', () => {
  it('21 entries evaluate the first 20 and return entry 21 in omitted_features; all_widely_available is false', async () => {
    const features = [...Array(20).fill('has'), 'grid'];
    const { output, text } = await contract(features);
    expect(output.results).toHaveLength(20);
    expect(output.results.every((item) => item.baseline?.state === 'widely')).toBe(true);
    expect(output.omitted_features).toEqual(['grid']);
    expect(output.all_widely_available).toBe(false);
    expect(text.split('\n')).toContain(formatOmittedFeatures(['grid']));
  });

  it('100 entries succeed with 80 omitted, verbatim and in input order', async () => {
    const features = Array.from({ length: 100 }, (_, index) =>
      index < 20 ? 'has' : index % 2 === 0 ? ` grid-${index} ` : `css.selectors.has`,
    );
    const { output } = await contract(features);
    expect(output.results).toHaveLength(20);
    expect(output.omitted_features).toEqual(features.slice(20));
  });

  it('repeats count toward the 20, and entries resolving to one feature are evaluated separately', async () => {
    const { output } = await contract([
      ...Array(19).fill('has'),
      'css.selectors.has',
      'has',
      ' has',
    ]);
    expect(output.results.map((item) => item.resolved_as?.baseline_id)).toEqual(
      Array(20).fill('has'),
    );
    expect(output.results[19]?.input).toBe('css.selectors.has');
    expect(output.omitted_features).toEqual(['has', ' has']);
    expect(output.all_widely_available).toBe(false);
  });

  it('20 or fewer entries return no omitted_features and the same answer as before', async () => {
    const { output, result } = await contract(Array(20).fill('has'));
    expect(result.structuredContent).not.toHaveProperty('omitted_features');
    expect(output.results).toHaveLength(20);
    expect(output.all_widely_available).toBe(true);
  });

  it('a malformed entry past position 20 still rejects the call', async () => {
    const base = Array(30).fill('has');
    const long = [...base.slice(0, 25), 'a'.repeat(201), ...base.slice(25)];
    expect(browsercompatCheckBaseline.input.safeParse({ features: long }).success).toBe(false);
    const blank = runToolContract(browsercompatCheckBaseline, {
      features: [...base.slice(0, 25), '   ', ...base.slice(25)],
    });
    expect(await blank).toMatchObject({
      isError: true,
      structuredContent: { error: { data: { reason: 'invalid_feature_input' } } },
    });
  });
});
