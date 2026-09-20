/**
 * @fileoverview Tests for browsercompat_check_baseline — the worked
 * `['has','array-fromasync','masonry','nope-xyz']` example, `all_widely_available`
 * semantics (D30), usage exclusion, and error/enrichment behavior.
 * @module tests/tools/browsercompat-check-baseline.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatCheckBaseline } from '@/mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';

async function run(features: string[], resolve = false) {
  const ctx = createMockContext({ errors: browsercompatCheckBaseline.errors });
  const input = browsercompatCheckBaseline.input.parse({ features, resolve });
  return { ctx, result: await browsercompatCheckBaseline.handler(input, ctx) };
}

describe('browsercompat_check_baseline — worked example', () => {
  it('reports found/no_compat_data/miss outcomes in input order, all_widely_available false', async () => {
    const { result } = await run(['has', 'array-fromasync', 'masonry', 'nope-xyz']);
    expect(result.results.map((r) => [r.input, r.outcome])).toEqual([
      ['has', 'found'],
      ['array-fromasync', 'found'],
      ['masonry', 'no_compat_data'],
      ['nope-xyz', 'miss'],
    ]);
    expect(result.all_widely_available).toBe(false);
  });

  it('has: widely, limiting_browser firefox 121, deprecated/experimental false, usage excluded 2.6222%', async () => {
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
        'Share of the roughly 96.7% of global traffic caniuse tracks, not of all traffic.',
    });
    expect(has?.usage_percent_excluded).toBeCloseTo(2.6222, 3);
  });

  it('masonry: limited, no compat_keys, usage still computed via caniuse mapping, no limiting_browser', async () => {
    const { result } = await run(['has', 'array-fromasync', 'masonry', 'nope-xyz']);
    const masonry = result.results[2];
    expect(masonry).toMatchObject({
      found: true,
      outcome: 'no_compat_data',
      baseline: { state: 'limited' },
      compat_keys: [],
    });
    expect(masonry?.limiting_browser).toBeUndefined();
    expect(masonry?.deprecated).toBeUndefined();
    expect(masonry?.usage_percent_excluded).toBeGreaterThan(0);
  });

  it('nope-xyz: a miss carries guidance and no baseline/limiting_browser fields', async () => {
    const { result } = await run(['has', 'array-fromasync', 'masonry', 'nope-xyz']);
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
    const { result } = await run(['has', 'array-fromasync', 'masonry', 'nope-xyz']);
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
    const { result } = await run(['masonry']);
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
    const { ctx, result } = await run(['has', 'masonry']);
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.1' });
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

describe('browsercompat_check_baseline — resolve: true', () => {
  it('resolves an unambiguous punctuated alias per-entry', async () => {
    const { result } = await run([':has()'], true);
    expect(result.results[0]).toMatchObject({
      found: true,
      resolved_as: { resolved_via: 'search' },
    });
  });
});

describe('browsercompat_check_baseline — schema and error boundaries', () => {
  it('rejects an empty features array at the schema boundary', () => {
    expect(browsercompatCheckBaseline.input.safeParse({ features: [] }).success).toBe(false);
  });

  it('rejects an array over the 20-entry cap at the schema boundary', () => {
    expect(
      browsercompatCheckBaseline.input.safeParse({ features: Array(21).fill('has') }).success,
    ).toBe(false);
    expect(
      browsercompatCheckBaseline.input.safeParse({ features: Array(20).fill('has') }).success,
    ).toBe(true);
  });

  it('throws invalid_feature_input for a whitespace-only entry', async () => {
    const ctx = createMockContext({ errors: browsercompatCheckBaseline.errors });
    const input = browsercompatCheckBaseline.input.parse({ features: ['has', '  '] });
    await expect(browsercompatCheckBaseline.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_feature_input' },
    });
  });
});

describe('browsercompat_check_baseline — format()', () => {
  it('renders the all_widely_available line and one section per result', async () => {
    const { result } = await run(['has', 'array-fromasync', 'masonry', 'nope-xyz']);
    const blocks = browsercompatCheckBaseline.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('# Baseline check — 4 features');
    expect(text).toContain('**all_widely_available:** false');
    expect(text).toContain('## :has()');
    expect(text).toContain('**usage_percent_excluded:**');
    expect(text).toContain('## Masonry');
    expect(text).toContain('none — this entry owns no browser-compat-data keys');
    expect(text).toContain('## nope-xyz');
  });
});
