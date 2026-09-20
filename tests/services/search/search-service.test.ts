/**
 * @fileoverview Tests for the search service: `stripTags`/`tokenize` as pure
 * functions, the six-tier ranking algorithm and its within-tier tie-breaks
 * against a synthetic, fully controlled index, and the real bundled-data
 * queries the design's worked examples specify.
 * @module tests/services/search/search-service.test
 */

import { describe, expect, it } from 'vitest';
import type { BaselineState } from '@/services/baseline/types.js';
import {
  getSearchService,
  SearchService,
  stripTags,
  tokenize,
} from '@/services/search/search-service.js';
import type { IndexRow } from '@/services/search/types.js';

describe('stripTags', () => {
  it('strips HTML tags and decodes the five entities BCD descriptions use', () => {
    expect(stripTags('<code>&lt;container-query&gt;</code>')).toBe('<container-query>');
    expect(stripTags('Tom&apos;s &amp; Jerry&#39;s')).toBe("Tom's & Jerry's");
    expect(stripTags('a&nbsp;b')).toBe('a b');
  });

  it('collapses runs of whitespace left behind by stripped tags', () => {
    expect(stripTags('<b>a</b>   <i>b</i>')).toBe('a b');
  });

  it('is a no-op on plain text', () => {
    expect(stripTags('plain text')).toBe('plain text');
  });
});

describe('tokenize', () => {
  it('splits camelCase boundaries', () => {
    expect(tokenize('containerQuery')).toEqual(['container', 'query']);
  });

  it('lowercases and splits on whitespace and dots', () => {
    expect(tokenize('CSS.Selectors.Has')).toEqual(['css', 'selectors', 'has']);
  });

  it('strips punctuation except hyphen', () => {
    expect(tokenize(':has()')).toEqual(['has']);
    expect(tokenize('grid-template-columns')).toEqual(['grid-template-columns']);
  });

  it('strips embedded HTML tags before tokenizing', () => {
    expect(tokenize('<code>fromAsync</code>')).toEqual(['from', 'async']);
  });

  it('returns an empty array for punctuation-only input', () => {
    expect(tokenize('!!!')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

/** Build a minimal, realistic IndexRow — only the fields a test cares about need overriding. */
function row(overrides: Partial<IndexRow> & { name?: string; description?: string }): IndexRow {
  const name = overrides.name;
  const description = overrides.description;
  const namespace = overrides.namespace ?? overrides.bcd_key?.split('.')[0];
  return {
    baseline_state: 'widely' as BaselineState,
    caniuseTitleTokens: overrides.caniuse_title ? tokenize(overrides.caniuse_title) : [],
    descriptionTokens: description ? tokenize(description) : [],
    lastSegmentTokens: overrides.bcd_key
      ? tokenize(overrides.bcd_key.split('.').at(-1) ?? '')
      : overrides.baseline_id
        ? tokenize(overrides.baseline_id)
        : [],
    ...(namespace === undefined ? {} : { namespace }),
    nameTokens: name ? tokenize(name) : [],
    pathSegmentCount: overrides.bcd_key ? overrides.bcd_key.split('.').length : 1,
    pathTokens: overrides.bcd_key
      ? tokenize(overrides.bcd_key)
      : overrides.baseline_id
        ? tokenize(overrides.baseline_id)
        : [],
    ...overrides,
  };
}

describe('SearchService#rank — tiered matching (synthetic index, one property per tier)', () => {
  it('tier 1: exact BCD key match wins even when a name would also match', () => {
    const target = row({ bcd_key: 'css.selectors.has', name: 'Has selector' });
    const service = new SearchService([target], new Map());
    const hits = service.rank('css.selectors.has', {});
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ tier: 1, matched_on: 'bcd_key' });
  });

  it('tier 1: exact web-features id match, including through an alias target', () => {
    const target = row({ baseline_id: 'masonry', name: 'Masonry' });
    const aliasMap = new Map([['display-grid-lanes', 'masonry']]);
    const service = new SearchService([target], aliasMap);
    const direct = service.rank('masonry', {});
    expect(direct[0]).toMatchObject({ tier: 1, matched_on: 'baseline_id' });
    const viaAlias = service.rank('display-grid-lanes', {});
    expect(viaAlias[0]).toMatchObject({ tier: 1, matched_on: 'baseline_id', row: target });
  });

  it('tier 2: exact name match (case-insensitive)', () => {
    const target = row({ bcd_key: 'css.selectors.has', name: ':has()' });
    const service = new SearchService([target], new Map());
    const hits = service.rank(':HAS()', {});
    expect(hits[0]).toMatchObject({ tier: 2, matched_on: 'name' });
  });

  it('tier 2: exact caniuse_title match when it differs from name', () => {
    const target = row({
      bcd_key: 'css.selectors.has',
      name: ':has()',
      caniuse_title: ':has() CSS relational pseudo-class',
    });
    const service = new SearchService([target], new Map());
    const hits = service.rank(':has() css relational pseudo-class', {});
    expect(hits[0]).toMatchObject({ tier: 2, matched_on: 'caniuse_title' });
  });

  it('tier 3: every query token appears in name (substring match, not a full-name equal)', () => {
    const target = row({ bcd_key: 'css.properties.display.grid', name: 'CSS Grid Layout' });
    const service = new SearchService([target], new Map());
    const hits = service.rank('grid', {});
    expect(hits[0]).toMatchObject({ tier: 3, matched_on: 'name' });
  });

  it('tier 4: every query token appears in the last path segment, not the name', () => {
    const target = row({
      bcd_key: 'api.CSSContainerRule.containerQuery',
      name: 'Container queries',
    });
    const service = new SearchService([target], new Map());
    // "container query" (singular) is not a substring of "queries" (plural),
    // so name (tier 3) misses; the camelCase-split last segment still hits.
    const hits = service.rank('container query', {});
    expect(hits[0]).toMatchObject({ tier: 4, matched_on: 'path_segment' });
  });

  it('tier 5: every query token appears in description', () => {
    const target = row({
      bcd_key: 'css.properties.gap',
      description: 'The gap property between rows and columns.',
    });
    const service = new SearchService([target], new Map());
    const hits = service.rank('rows and columns', {});
    expect(hits[0]).toMatchObject({ tier: 5, matched_on: 'description' });
  });

  it('tier 5: every query token appears in caniuse_title (checked after description)', () => {
    const target = row({ bcd_key: 'css.properties.gap', caniuse_title: 'CSS Grid Gap' });
    const service = new SearchService([target], new Map());
    const hits = service.rank('grid gap', {});
    expect(hits[0]).toMatchObject({ tier: 5, matched_on: 'caniuse_title' });
  });

  it('tier 6: every query token appears somewhere in the whole dotted path', () => {
    const target = row({ bcd_key: 'css.at-rules.container.name' });
    const service = new SearchService([target], new Map());
    const hits = service.rank('rules container', {});
    expect(hits[0]).toMatchObject({ tier: 6, matched_on: 'path_tokens' });
  });

  it('a row that matches nothing is excluded entirely', () => {
    const target = row({ bcd_key: 'css.selectors.has', name: ':has()' });
    const service = new SearchService([target], new Map());
    expect(service.rank('totally-unrelated-zzz', {})).toEqual([]);
  });

  it('an empty or whitespace-only query returns no hits', () => {
    const target = row({ bcd_key: 'css.selectors.has', name: ':has()' });
    const service = new SearchService([target], new Map());
    expect(service.rank('', {})).toEqual([]);
    expect(service.rank('   ', {})).toEqual([]);
  });

  it('a row is only counted once, at its BEST matching tier', () => {
    // Matches both name (tier 3) and description (tier 5) — must appear once, at tier 3.
    const target = row({
      bcd_key: 'css.selectors.has',
      name: 'The has selector',
      description: 'has selector description',
    });
    const service = new SearchService([target], new Map());
    const hits = service.rank('has selector', {});
    expect(hits).toHaveLength(1);
    expect(hits[0]?.tier).toBe(3);
  });
});

describe('SearchService#rank — within-tier tie-breaks', () => {
  it('shorter BCD path sorts first within a tier', () => {
    const shortRow = row({ bcd_key: 'css.grid', name: 'grid thing' });
    const longRow = row({ bcd_key: 'css.grid.sub.leaf', name: 'grid thing' });
    const service = new SearchService([longRow, shortRow], new Map());
    const hits = service.rank('grid thing', {});
    expect(hits.map((h) => h.row)).toEqual([shortRow, longRow]);
  });

  it('namespace priority breaks a tie when path length is equal', () => {
    // api sorts before css in NAMESPACE_PRIORITY.
    const cssRow = row({ bcd_key: 'css.thing', name: 'shared name' });
    const apiRow = row({ bcd_key: 'api.thing', name: 'shared name' });
    const service = new SearchService([cssRow, apiRow], new Map());
    const hits = service.rank('shared name', {});
    expect(hits.map((h) => h.row)).toEqual([apiRow, cssRow]);
  });

  it('Baseline priority (widely > newly > limited > not_mapped) breaks a tie next', () => {
    const limitedRow = row({
      bcd_key: 'api.thing.a',
      name: 'shared name',
      baseline_state: 'limited',
    });
    const widelyRow = row({
      bcd_key: 'api.thing.b',
      name: 'shared name',
      baseline_state: 'widely',
    });
    const service = new SearchService([limitedRow, widelyRow], new Map());
    const hits = service.rank('shared name', {});
    expect(hits.map((h) => h.row)).toEqual([widelyRow, limitedRow]);
  });

  it('lexicographic key is the final tie-break', () => {
    const bRow = row({ bcd_key: 'api.thing.b', name: 'shared name' });
    const aRow = row({ bcd_key: 'api.thing.a', name: 'shared name' });
    const service = new SearchService([bRow, aRow], new Map());
    const hits = service.rank('shared name', {});
    expect(hits.map((h) => h.row)).toEqual([aRow, bRow]);
  });
});

describe('SearchService#rank — filters', () => {
  it('namespace filter excludes rows outside the namespace', () => {
    const cssRow = row({ bcd_key: 'css.selectors.has', name: ':has()' });
    const apiRow = row({ bcd_key: 'api.has', name: ':has()' });
    const service = new SearchService([cssRow, apiRow], new Map());
    const hits = service.rank(':has()', { namespace: 'css' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.row).toBe(cssRow);
  });

  it('baseline filter excludes rows outside the requested state', () => {
    const widelyRow = row({ bcd_key: 'css.a', name: 'thing', baseline_state: 'widely' });
    const limitedRow = row({ bcd_key: 'css.b', name: 'thing', baseline_state: 'limited' });
    const service = new SearchService([widelyRow, limitedRow], new Map());
    const hits = service.rank('thing', { baseline: 'limited' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.row).toBe(limitedRow);
  });

  it('combining namespace and baseline filters narrows to the intersection', () => {
    const match = row({ bcd_key: 'css.a', name: 'thing', baseline_state: 'widely' });
    const wrongNamespace = row({ bcd_key: 'api.a', name: 'thing', baseline_state: 'widely' });
    const wrongBaseline = row({ bcd_key: 'css.b', name: 'thing', baseline_state: 'limited' });
    const service = new SearchService([match, wrongNamespace, wrongBaseline], new Map());
    const hits = service.rank('thing', { namespace: 'css', baseline: 'widely' });
    expect(hits).toEqual([{ row: match, tier: 2, matched_on: 'name' }]);
  });
});

describe('SearchService — real bundled index', () => {
  it('has 20,540 rows: every BCD leaf plus the 23 compat_features-less features', async () => {
    const search = await getSearchService();
    expect(search.size).toBe(20_540);
  });

  it('"container query" limit-relevant query surfaces the container-queries feature via path_segment', async () => {
    const search = await getSearchService();
    const hits = search.rank('container query', {});
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top?.row.baseline_id).toBe('container-queries');
    expect(top?.tier).toBe(4);
    expect(top?.matched_on).toBe('path_segment');
  });
});
