/**
 * @fileoverview Tests for browsercompat_search_features — the worked
 * "container query" limit-3 example, zero-hit notices per filter combo,
 * truncation and offset paging, the group and snapshot filters and their
 * errors, dotted and tag-shaped queries, and both output surfaces.
 * @module tests/tools/browsercompat-search-features.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatSearchFeatures } from '@/mcp-server/tools/definitions/browsercompat-search-features.tool.js';
import { getSearchService } from '@/services/search/search-service.js';

async function run(input: {
  query: string;
  namespace?: string;
  baseline?: string;
  group?: string;
  snapshot?: string;
  limit?: number;
  offset?: number;
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

  it('renders totalCount, truncation, and filters in the content[] trailer as well as structuredContent', async () => {
    const response = await runToolContract(browsercompatSearchFeatures, {
      query: 'display',
      namespace: 'css',
      limit: 2,
    });
    expect(response.structuredContent).toMatchObject({
      totalCount: 341,
      truncated: true,
      shown: 2,
      cap: 2,
      appliedFilters: { namespace: 'css' },
    });
    const text = response.content.map((block) => (block as { text: string }).text).join('\n');
    expect(text).toContain('# 2 matches');
    expect(text).toContain('**Filters:** namespace css');
    expect(text).toContain('**341 total**');
    expect(text).toContain('**truncated:** true');
    expect(text).toContain('**shown:** 2');
    expect(text).toContain('**cap:** 2');
  });

  it('always echoes data_version and totalCount (matches before the cap)', async () => {
    const { ctx } = await run({ query: 'has', limit: 1 });
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.2' });
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

/** Join every content[] block, so a test reads the markdown surface a client like Claude Desktop shows. */
function contentText(response: Awaited<ReturnType<typeof runToolContract>>): string {
  return response.content.map((block) => (block as { text: string }).text).join('\n');
}

describe('browsercompat_search_features — offset paging', () => {
  it('pages "display" in css across every page to the end: 341 distinct rows equal to the full ranking', async () => {
    const full = (await getSearchService()).rank('display', { namespace: 'css' });
    expect(full).toHaveLength(341);

    const seen: string[] = [];
    const nextOffsets: (number | undefined)[] = [];
    for (let offset = 0; offset < 341; offset += 50) {
      const { ctx, result } = await run({ query: 'display', namespace: 'css', limit: 50, offset });
      const enrichment = getEnrichment(ctx);
      const remaining = 341 - offset - result.results.length;
      expect(enrichment.totalCount).toBe(341);
      expect(enrichment.shown).toBe(remaining > 0 ? result.results.length : undefined);
      expect(enrichment.truncated).toBe(remaining > 0 ? true : undefined);
      nextOffsets.push(enrichment.nextOffset as number | undefined);
      seen.push(...result.results.map((item) => item.bcd_key ?? item.baseline_id ?? ''));
    }

    expect(nextOffsets).toEqual([50, 100, 150, 200, 250, 300, undefined]);
    expect(new Set(seen).size).toBe(341);
    expect(seen).toEqual(full.map((hit) => hit.row.bcd_key ?? hit.row.baseline_id));
  });

  it('the last page reports its own size and no truncation', async () => {
    const { ctx, result } = await run({
      query: 'display',
      namespace: 'css',
      limit: 50,
      offset: 300,
    });
    expect(result.results).toHaveLength(41);
    expect(getEnrichment(ctx)).toMatchObject({ totalCount: 341 });
    expect(getEnrichment(ctx).truncated).toBeUndefined();
    expect(getEnrichment(ctx).nextOffset).toBeUndefined();
  });

  it('pages the path_suffix ordering: the exact key leads page one, never repeats on page two', async () => {
    const first = await run({ query: 'element.animate', limit: 1 });
    expect(first.result.results[0]).toMatchObject({
      bcd_key: 'api.Element.animate',
      matched_on: 'path_suffix',
    });
    expect(getEnrichment(first.ctx).nextOffset).toBe(1);
    const second = await run({ query: 'element.animate', limit: 1, offset: 1 });
    expect(second.result.results).toHaveLength(1);
    expect(second.result.results[0]?.bcd_key).not.toBe('api.Element.animate');
    expect(second.result.results[0]?.matched_on).not.toBe('path_suffix');
  });

  it('an offset at or past the end returns no results and a notice naming totalCount', async () => {
    for (const offset of [341, 1000]) {
      const { ctx, result } = await run({ query: 'display', namespace: 'css', offset });
      expect(result.results).toEqual([]);
      const enrichment = getEnrichment(ctx);
      expect(enrichment.totalCount).toBe(341);
      expect(enrichment.offsetNotice).toContain(`offset ${offset}`);
      expect(enrichment.offsetNotice).toContain('341');
      expect(enrichment.noMatchNotice).toBeUndefined();
      expect(enrichment.nextOffset).toBeUndefined();
      expect(enrichment.truncated).toBeUndefined();
    }
  });

  it('zero matches with an offset still gets the zero-hit notice, not the offset notice', async () => {
    const { ctx } = await run({ query: 'zzzznomatch12345', offset: 50 });
    expect(getEnrichment(ctx).noMatchNotice).toContain('zzzznomatch12345');
    expect(getEnrichment(ctx).offsetNotice).toBeUndefined();
  });

  it('renders nextOffset and the past-the-end notice in content[] as well as structuredContent', async () => {
    const paged = await runToolContract(browsercompatSearchFeatures, {
      query: 'display',
      namespace: 'css',
      limit: 50,
      offset: 50,
    });
    expect(paged.structuredContent).toMatchObject({ nextOffset: 100, totalCount: 341 });
    expect(contentText(paged)).toContain('**nextOffset:** 100');

    const past = await runToolContract(browsercompatSearchFeatures, {
      query: 'display',
      namespace: 'css',
      offset: 400,
    });
    expect(past.structuredContent).toMatchObject({ results: [], totalCount: 341 });
    expect(contentText(past)).toContain('# 0 matches');
    expect(contentText(past)).toContain('offset 400');
  });

  it('defaults offset to 0 and rejects a negative or non-integer offset at the schema boundary', () => {
    expect(browsercompatSearchFeatures.input.parse({ query: 'x' }).offset).toBe(0);
    expect(browsercompatSearchFeatures.input.safeParse({ query: 'x', offset: -1 }).success).toBe(
      false,
    );
    expect(browsercompatSearchFeatures.input.safeParse({ query: 'x', offset: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('browsercompat_search_features — group and snapshot filters', () => {
  it('"has" in selectors at Baseline limited returns 3 rows', async () => {
    const { ctx, result } = await run({ query: 'has', group: 'selectors', baseline: 'limited' });
    expect(result.results).toHaveLength(3);
    for (const item of result.results) expect(item.baseline_state).toBe('limited');
    expect(getEnrichment(ctx).appliedFilters).toEqual({ group: 'selectors', baseline: 'limited' });
  });

  it('"array" in ecmascript-2023 returns 11 rows from 2 features', async () => {
    const { result } = await run({ query: 'array', snapshot: 'ecmascript-2023', limit: 50 });
    expect(result.results).toHaveLength(11);
    expect(new Set(result.results.map((item) => item.baseline_id))).toEqual(
      new Set(['array-by-copy', 'array-findlast']),
    );
  });

  it('group includes descendant groups: css reaches a feature tagged positioning', async () => {
    const { result } = await run({ query: 'sticky', group: 'css', limit: 50 });
    expect(result.results.map((item) => item.baseline_id)).toContain('sticky-positioning');
  });

  it('echoes both filters in appliedFilters and its content[] trailer', async () => {
    const response = await runToolContract(browsercompatSearchFeatures, {
      query: 'array',
      group: 'javascript',
      snapshot: 'ecmascript-2023',
    });
    expect(response.structuredContent).toMatchObject({
      appliedFilters: { group: 'javascript', snapshot: 'ecmascript-2023' },
    });
    expect(contentText(response)).toContain(
      '**Filters:** group javascript (and nested groups) · snapshot ecmascript-2023',
    );
  });

  it('a group id that is a feature id, not a group, fails with unknown_group on both surfaces', async () => {
    const ctx = createMockContext({ errors: browsercompatSearchFeatures.errors });
    const input = browsercompatSearchFeatures.input.parse({
      query: 'popover',
      group: 'popover',
    });
    await expect(browsercompatSearchFeatures.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'unknown_group',
        recovery: { hint: expect.stringContaining('browsercompat_list_reference') },
      },
    });

    const response = await runToolContract(browsercompatSearchFeatures, {
      query: 'popover',
      group: 'popover',
    });
    expect(response.isError).toBe(true);
    expect(contentText(response)).toContain('topic groups');
    expect(contentText(response)).toContain('reason unknown_group');
  });

  it('an unknown snapshot fails with unknown_snapshot naming the snapshots topic', async () => {
    const response = await runToolContract(browsercompatSearchFeatures, {
      query: 'array',
      snapshot: 'es2023',
    });
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      error: { data: { reason: 'unknown_snapshot' } },
    });
    expect(contentText(response)).toContain('topic snapshots');
  });

  it('a zero-hit group search names the group filter to drop', async () => {
    const { ctx, result } = await run({ query: 'zzzznomatch12345', group: 'selectors' });
    expect(result.results).toEqual([]);
    const notice = getEnrichment(ctx).noMatchNotice as string;
    expect(notice).toContain('selectors group');
    expect(notice).toContain('Re-run without group');
    expect(notice).toContain('topic groups');
  });

  it('with several filters set, the zero-hit notice names only the first of snapshot, group, namespace', async () => {
    const all = await run({
      query: 'zzzznomatch12345',
      namespace: 'css',
      group: 'selectors',
      snapshot: 'ecmascript-2023',
    });
    expect(getEnrichment(all.ctx).noMatchNotice).toContain('Re-run without snapshot');
    const noSnapshot = await run({
      query: 'zzzznomatch12345',
      namespace: 'css',
      group: 'selectors',
    });
    expect(getEnrichment(noSnapshot.ctx).noMatchNotice).toContain('Re-run without group');
  });

  it('a zero-hit snapshot search names the snapshot filter to drop', async () => {
    const { ctx } = await run({ query: 'zzzznomatch12345', snapshot: 'ecmascript-2023' });
    const notice = getEnrichment(ctx).noMatchNotice as string;
    expect(notice).toContain('ecmascript-2023 snapshot');
    expect(notice).toContain('Re-run without snapshot');
    expect(notice).toContain('topic snapshots');
  });
});

describe('browsercompat_search_features — notations and tag-shaped queries', () => {
  it('"element.animate" returns api.Element.animate first as path_suffix on both surfaces', async () => {
    const response = await runToolContract(browsercompatSearchFeatures, {
      query: 'element.animate',
      limit: 1,
    });
    expect(response.structuredContent).toMatchObject({
      results: [{ bcd_key: 'api.Element.animate', matched_on: 'path_suffix' }],
    });
    expect(contentText(response)).toContain('bcd_key api.Element.animate');
    expect(contentText(response)).toContain('**matched_on:** path_suffix');
  });

  it('"Array.prototype.at" returns the exact key instead of nothing', async () => {
    const { result } = await run({ query: 'Array.prototype.at' });
    expect(result.results[0]).toMatchObject({
      bcd_key: 'javascript.builtins.Array.at',
      matched_on: 'path_suffix',
    });
  });

  it('"<dialog>" returns the dialog feature instead of invalid_query', async () => {
    const { result } = await run({ query: '<dialog>' });
    expect(result.results[0]).toMatchObject({ baseline_id: 'dialog', matched_on: 'name' });
  });

  it('"<a>" returns results instead of invalid_query', async () => {
    const { result } = await run({ query: '<a>' });
    expect(result.results[0]).toMatchObject({ baseline_id: 'a', matched_on: 'name' });
  });

  it('"<>" still normalizes to nothing and fails with invalid_query', async () => {
    const ctx = createMockContext({ errors: browsercompatSearchFeatures.errors });
    const input = browsercompatSearchFeatures.input.parse({ query: '<>' });
    await expect(browsercompatSearchFeatures.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_query' },
    });
  });
});
