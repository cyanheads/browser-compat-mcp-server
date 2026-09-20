/**
 * @fileoverview Tests for browsercompat_search_features — the worked
 * "container query" limit-3 example, zero-hit notices per filter combo,
 * truncation enrichment, and format() rendering.
 * @module tests/tools/browsercompat-search-features.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatSearchFeatures } from '@/mcp-server/tools/definitions/browsercompat-search-features.tool.js';

async function run(input: {
  query: string;
  namespace?: string;
  baseline?: string;
  limit?: number;
}) {
  const ctx = createMockContext({ errors: browsercompatSearchFeatures.errors });
  const parsed = browsercompatSearchFeatures.input.parse(input);
  return { ctx, result: await browsercompatSearchFeatures.handler(parsed, ctx) };
}

describe('browsercompat_search_features — worked example: "container query" limit 3', () => {
  it('returns exactly 3 ranked matches, best first', async () => {
    const { result } = await run({ query: 'container query', limit: 3 });
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toMatchObject({
      bcd_key: 'api.CSSContainerRule.containerQuery',
      baseline_id: 'container-queries',
      name: 'Container queries',
      baseline_state: 'widely',
      matched_on: 'path_segment',
    });
    expect(result.results[0]?.support_summary).toContain('Chrome 111');
  });

  it('reports the truncation trailer in enrichment since matches exceed limit', async () => {
    const { ctx } = await run({ query: 'container query', limit: 3 });
    expect(getEnrichment(ctx).truncated).toBe(true);
    expect(getEnrichment(ctx).shown).toBe(3);
    expect(getEnrichment(ctx).cap).toBe(3);
    expect(getEnrichment(ctx).totalCount as number).toBeGreaterThan(3);
  });

  it('conforms to the declared output schema', async () => {
    const { result } = await run({ query: 'container query', limit: 3 });
    expect(result).toEqual(expect.schemaMatching(browsercompatSearchFeatures.output));
  });
});

describe('browsercompat_search_features — filters', () => {
  it('namespace filter restricts results to that subtree', async () => {
    const { result } = await run({ query: ':has()', namespace: 'css' });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.bcd_key).toMatch(/^css\./);
  });

  it('baseline filter restricts results to that Baseline state', async () => {
    const { result } = await run({ query: 'has', baseline: 'widely', limit: 50 });
    for (const item of result.results) expect(item.baseline_state).toBe('widely');
  });

  it('does not populate truncated when results fit within limit', async () => {
    const { ctx } = await run({ query: 'css.selectors.has', limit: 10 });
    expect(getEnrichment(ctx).truncated).toBeUndefined();
  });
});

describe('browsercompat_search_features — zero-hit notices (per filter combo)', () => {
  it('namespace-filtered zero hits names the namespace and points at list_reference', async () => {
    const { ctx, result } = await run({ query: 'zzzznomatch12345', namespace: 'mathml' });
    expect(result.results).toEqual([]);
    const notice = getEnrichment(ctx).noMatchNotice as string | undefined;
    expect(notice).toContain('mathml namespace');
    expect(notice).toContain('browsercompat_list_reference');
  });

  it('baseline-filtered zero hits names the not_mapped share', async () => {
    const { ctx, result } = await run({ query: 'zzzznomatch12345', baseline: 'not_mapped' });
    expect(result.results).toEqual([]);
    const notice = getEnrichment(ctx).noMatchNotice as string | undefined;
    expect(notice).toMatch(/\d+\.\d% of/);
    expect(notice).toContain('not_mapped');
  });

  it('unfiltered zero hits echoes the query and points at list_reference', async () => {
    const { ctx, result } = await run({ query: 'zzzznomatch12345' });
    expect(result.results).toEqual([]);
    const notice = getEnrichment(ctx).noMatchNotice as string | undefined;
    expect(notice).toContain('zzzznomatch12345');
    expect(notice).toContain('browsercompat_list_reference');
  });

  it('a zero-hit result is a success, not an error', async () => {
    const { result } = await run({ query: 'zzzznomatch12345' });
    expect(result).toEqual({ results: [] });
  });
});

describe('browsercompat_search_features — enrichment', () => {
  it('appliedFilters is populated only when namespace or baseline was set', async () => {
    const { ctx: withFilters } = await run({ query: 'has', namespace: 'css', baseline: 'widely' });
    expect(getEnrichment(withFilters).appliedFilters).toEqual({
      namespace: 'css',
      baseline: 'widely',
    });

    const { ctx: withoutFilters } = await run({ query: 'has' });
    expect(getEnrichment(withoutFilters).appliedFilters).toBeUndefined();
  });

  it('always echoes data_version and totalCount (matches before the cap)', async () => {
    const { ctx } = await run({ query: 'has', limit: 1 });
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.1' });
    expect(typeof getEnrichment(ctx).totalCount).toBe('number');
  });
});

describe('browsercompat_search_features — errors (invalid_query)', () => {
  it('rejects a punctuation-only query that normalizes to zero tokens', async () => {
    const ctx = createMockContext({ errors: browsercompatSearchFeatures.errors });
    const input = browsercompatSearchFeatures.input.parse({ query: '!!!' });
    await expect(browsercompatSearchFeatures.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_query' },
    });
  });

  it('rejects a whitespace-only query at the handler boundary', async () => {
    const ctx = createMockContext({ errors: browsercompatSearchFeatures.errors });
    const input = browsercompatSearchFeatures.input.parse({ query: '   .   ' });
    await expect(browsercompatSearchFeatures.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_query' },
    });
  });

  it('rejects an empty query at the schema boundary (min(1))', () => {
    expect(browsercompatSearchFeatures.input.safeParse({ query: '' }).success).toBe(false);
  });

  it('rejects a query over 100 characters at the schema boundary', () => {
    expect(browsercompatSearchFeatures.input.safeParse({ query: 'a'.repeat(101) }).success).toBe(
      false,
    );
  });

  it('rejects limit outside 1..50 at the schema boundary', () => {
    expect(browsercompatSearchFeatures.input.safeParse({ query: 'x', limit: 0 }).success).toBe(
      false,
    );
    expect(browsercompatSearchFeatures.input.safeParse({ query: 'x', limit: 51 }).success).toBe(
      false,
    );
  });

  it('defaults limit to 10 when omitted', () => {
    const parsed = browsercompatSearchFeatures.input.parse({ query: 'x' });
    expect(parsed.limit).toBe(10);
  });
});

describe('browsercompat_search_features — format()', () => {
  it('renders one heading per result with identity, baseline, support summary', async () => {
    const { result } = await run({ query: 'css.selectors.has' });
    const blocks = browsercompatSearchFeatures.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain(`# ${result.results.length} matches`);
    expect(text).toContain('bcd_key css.selectors.has');
    expect(text).toContain('**baseline_state:**');
    expect(text).toContain('**support_summary:**');
  });

  it('renders zero matches without throwing', async () => {
    const { result } = await run({ query: 'zzzznomatch12345' });
    const blocks = browsercompatSearchFeatures.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toBe('# 0 matches');
  });
});
