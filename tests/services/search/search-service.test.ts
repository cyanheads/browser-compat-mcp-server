/**
 * @fileoverview Tests for the search service: `stripTags`/`tokenize`/
 * `querySegments` as pure functions, the six-tier ranking (including the tier 2
 * `path_suffix` match), its within-tier tie-breaks, and the group and snapshot
 * filters against a synthetic, fully controlled index; then ranking pins and
 * the design's worked examples against the real bundled data.
 * @module tests/services/search/search-service.test
 */

import { describe, expect, it } from 'vitest';
import { getBaselineService } from '@/services/baseline/baseline-service.js';
import type { BaselineState } from '@/services/baseline/types.js';
import {
  getSearchService,
  querySegments,
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

  it('treats < and > as punctuation, so a tag-shaped name keeps its word', () => {
    expect(tokenize('<dialog>')).toEqual(['dialog']);
    expect(tokenize('<a>')).toEqual(['a']);
    expect(tokenize('Customizable <select>')).toEqual(['customizable', 'select']);
    expect(tokenize('<fieldset> and <legend>')).toEqual(['fieldset', 'and', 'legend']);
  });

  it('returns an empty array for punctuation-only input', () => {
    expect(tokenize('!!!')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('querySegments', () => {
  it('splits on dots, colons, and whitespace, lowercasing each segment', () => {
    expect(querySegments('Element.animate')).toEqual(['element', 'animate']);
    expect(querySegments('display: grid')).toEqual(['display', 'grid']);
    expect(querySegments('display grid')).toEqual(['display', 'grid']);
  });

  it('drops a trailing () and a prototype segment sitting between two others', () => {
    expect(querySegments('Array.prototype.at()')).toEqual(['array', 'at']);
    expect(querySegments('String.prototype.replaceAll')).toEqual(['string', 'replaceall']);
  });

  it('keeps prototype at either end and never splits a camelCase word', () => {
    expect(querySegments('prototype')).toEqual(['prototype']);
    expect(querySegments('prototype.at')).toEqual(['prototype', 'at']);
    expect(querySegments('Element.prototype')).toEqual(['element', 'prototype']);
    expect(querySegments('isPrototypeOf')).toEqual(['isprototypeof']);
    expect(querySegments('Object.setPrototypeOf')).toEqual(['object', 'setprototypeof']);
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
    groups: [],
    snapshots: [],
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
    const target = row({ baseline_id: 'grid-lanes', name: 'Grid lanes' });
    const aliasMap = new Map([['display-grid-lanes', 'grid-lanes']]);
    const service = new SearchService([target], aliasMap);
    const direct = service.rank('grid-lanes', {});
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

describe('SearchService#rank — tier 2 path_suffix (synthetic index)', () => {
  const animate = row({ bcd_key: 'api.Element.animate', name: 'Web animations' });
  const svgAnimate = row({ bcd_key: 'api.SVGElement.animate' });
  const grid = row({ bcd_key: 'css.properties.display.grid', name: 'Grid' });

  it('ranks a key whose trailing segments equal the query at tier 2, case-insensitively', () => {
    const service = new SearchService([svgAnimate, animate], new Map());
    const hits = service.rank('ELEMENT.Animate', {});
    expect(hits[0]).toEqual({ row: animate, tier: 2, matched_on: 'path_suffix' });
    expect(hits.find((hit) => hit.row === svgAnimate)?.matched_on).not.toBe('path_suffix');
  });

  it('matches the property-value and prototype notations developers type', () => {
    const service = new SearchService([animate, grid], new Map());
    for (const query of ['display grid', 'display: grid', 'properties.display.grid']) {
      expect(service.rank(query, {})[0]).toEqual({ row: grid, tier: 2, matched_on: 'path_suffix' });
    }
    for (const query of ['Element.prototype.animate', 'Element.animate()']) {
      expect(service.rank(query, {})[0]).toMatchObject({ row: animate, matched_on: 'path_suffix' });
    }
  });

  it('needs at least two segments: a one-segment query never produces a path_suffix hit', () => {
    const service = new SearchService([animate, grid], new Map());
    const hits = service.rank('animate', {});
    expect(hits[0]).toMatchObject({ row: animate, tier: 4, matched_on: 'path_segment' });
    expect(hits.some((hit) => hit.matched_on === 'path_suffix')).toBe(false);
  });

  it('never matches a query longer than the key or a segment out of order', () => {
    const service = new SearchService([animate], new Map());
    expect(service.rank('foo.api.Element.animate', {})).toEqual([]);
    expect(service.rank('animate.element', {}).some((h) => h.matched_on === 'path_suffix')).toBe(
      false,
    );
    expect(service.rank('prototype.animate', {}).some((h) => h.matched_on === 'path_suffix')).toBe(
      false,
    );
  });

  it('lists every key that shares the suffix at tier 2, ordered by the usual tie-breaks', () => {
    const htmlKey = row({ bcd_key: 'html.elements.a.referrerpolicy.unsafe-url' });
    const apiKey = row({ bcd_key: 'api.HTMLAnchorElement.referrerPolicy.unsafe-url' });
    const service = new SearchService([htmlKey, apiKey], new Map());
    const hits = service.rank('referrerpolicy.unsafe-url', {});
    expect(hits).toEqual([
      { row: apiKey, tier: 2, matched_on: 'path_suffix' },
      { row: htmlKey, tier: 2, matched_on: 'path_suffix' },
    ]);
  });

  it('a row matching both an exact name and the suffix is counted once, as a name hit', () => {
    const target = row({ bcd_key: 'css.properties.display.grid', name: 'display grid' });
    const service = new SearchService([target], new Map());
    expect(service.rank('display grid', {})).toEqual([
      { row: target, tier: 2, matched_on: 'name' },
    ]);
  });

  it('respects the filters like every other tier', () => {
    const service = new SearchService([animate], new Map());
    expect(service.rank('element.animate', { namespace: 'css' })).toEqual([]);
  });
});

describe('SearchService#rank — group and snapshot filters (synthetic index)', () => {
  const selectors = row({
    bcd_key: 'css.selectors.has',
    name: 'thing',
    groups: ['selectors', 'css'],
  });
  const es2023 = row({ bcd_key: 'javascript.builtins.Array.findLast', name: 'thing' });
  es2023.snapshots = ['ecmascript-2023'];
  const unmapped = row({ bcd_key: 'api.thing', name: 'thing' });

  it('group keeps only rows whose group set holds the id', () => {
    const service = new SearchService([selectors, es2023, unmapped], new Map());
    expect(service.rank('thing', { group: 'css' }).map((hit) => hit.row)).toEqual([selectors]);
  });

  it('snapshot keeps only rows whose snapshot set holds the id', () => {
    const service = new SearchService([selectors, es2023, unmapped], new Map());
    const hits = service.rank('thing', { snapshot: 'ecmascript-2023' });
    expect(hits.map((hit) => hit.row)).toEqual([es2023]);
  });

  it('combines with namespace and baseline as an intersection', () => {
    const service = new SearchService([selectors, es2023, unmapped], new Map());
    expect(service.rank('thing', { group: 'css', namespace: 'api' })).toEqual([]);
    expect(service.rank('thing', { group: 'css', baseline: 'widely' })).toHaveLength(1);
  });
});

describe('SearchService — real bundled index', () => {
  it('has 20,564 rows: every BCD leaf plus the 21 compat_features-less features', async () => {
    const search = await getSearchService();
    expect(search.size).toBe(20_564);
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

  it('BCD descriptions reach the index with their markup stripped', async () => {
    const search = await getSearchService();
    const key = 'api.Element.getHTML.escapes_lt_gt_in_attributes';
    const row = search.rank(key, {})[0]?.row;
    expect(row?.bcd_key).toBe(key);
    expect(row?.description).toBe(
      'Serializes < and > in attributes as &lt; and &gt; (see this spec issue )',
    );
    expect(row?.descriptionTokens).toContain('serializes');
    for (const markup of ['code', 'href', 'github', 'https']) {
      expect(row?.descriptionTokens).not.toContain(markup);
    }
  });
});

/** Render a ranking as `key|tier|matched_on` lines so a pin reads like the ranking itself. */
function pin(hits: { row: IndexRow; tier: number; matched_on: string }[], take = 8): string[] {
  return hits
    .slice(0, take)
    .map((hit) => `${hit.row.bcd_key ?? hit.row.baseline_id}|${hit.tier}|${hit.matched_on}`);
}

describe('SearchService — ranking pins for queries the path_suffix tier and tag handling must not move', () => {
  it('"container query": 5 hits, tier 4 then 5', async () => {
    const hits = (await getSearchService()).rank('container query', {});
    expect(hits).toHaveLength(5);
    expect(pin(hits)).toEqual([
      'api.CSSContainerRule.containerQuery|4|path_segment',
      'css.types.length.container_query_length_units|4|path_segment',
      'css.at-rules.container.container-query_optional|4|path_segment',
      'css.at-rules.container.style_queries_for_custom_properties.range_syntax|5|description',
      'css.types.if.style.range_syntax|5|description',
    ]);
  });

  it('"Container queries": 30 hits, led by tier 2 name rows', async () => {
    const hits = (await getSearchService()).rank('Container queries', {});
    /**
     * 29 before `<` and `>` became punctuation: the 30th is a description that
     * decodes to "<container-query> is optional", whose token the tag pass erased.
     */
    expect(hits).toHaveLength(30);
    expect(
      pin(
        hits.filter((hit) => hit.tier === 5),
        1,
      ),
    ).toEqual(['css.at-rules.container.container-query_optional|5|description']);
    expect(pin(hits, 4)).toEqual([
      'api.CSSContainerRule|2|name',
      'api.CSSContainerRule.containerName|2|name',
      'api.CSSContainerRule.containerQuery|2|name',
      'css.at-rules.container|2|name',
    ]);
  });

  it('"prototype": 39 hits, tier 4 path segments first', async () => {
    const hits = (await getSearchService()).rank('prototype', {});
    expect(hits).toHaveLength(39);
    expect(pin(hits, 3)).toEqual([
      'javascript.builtins.Object.getPrototypeOf|4|path_segment',
      'javascript.builtins.Object.isPrototypeOf|4|path_segment',
      'javascript.builtins.Object.setPrototypeOf|4|path_segment',
    ]);
  });

  it('"css.selectors.has": the exact key at tier 1, then tiers 5 and 6', async () => {
    const hits = (await getSearchService()).rank('css.selectors.has', {});
    expect(hits).toHaveLength(5);
    expect(pin(hits)).toEqual([
      'css.selectors.has|1|bcd_key',
      'css.properties.scroll-target-group|5|description',
      'css.properties.scroll-target-group.auto|5|description',
      'css.properties.scroll-target-group.none|5|description',
      'css.selectors.has-slotted|6|path_tokens',
    ]);
  });

  it('"fromAsync", "grid", and filtered "display" / "has" keep their totals and heads', async () => {
    const search = await getSearchService();
    const fromAsync = search.rank('fromAsync', {});
    expect(fromAsync).toHaveLength(8);
    expect(pin(fromAsync, 2)).toEqual([
      'javascript.builtins.Array.fromAsync|3|name',
      'webassembly.jspi|5|description',
    ]);
    const grid = search.rank('grid', {});
    expect(grid).toHaveLength(255);
    expect(pin(grid, 2)).toEqual([
      'css.properties.gap|1|baseline_id',
      'css.properties.grid|1|baseline_id',
    ]);
    const display = search.rank('display', { namespace: 'css' });
    expect(display).toHaveLength(341);
    expect(pin(display, 1)).toEqual(['css.properties.display|1|baseline_id']);
    const has = search.rank('has', { baseline: 'widely' });
    expect(has).toHaveLength(254);
    expect(pin(has, 2)).toEqual(['css.selectors.has|1|baseline_id', 'api.HashChangeEvent|3|name']);
  });
});

describe('SearchService — path_suffix on the real bundled index', () => {
  it.each([
    ['Array.prototype.at', 'javascript.builtins.Array.at'],
    ['String.prototype.replaceAll', 'javascript.builtins.String.replaceAll'],
    ['Element.prototype.animate', 'api.Element.animate'],
    ['element.animate', 'api.Element.animate'],
    ['display grid', 'css.properties.display.grid'],
    ['display: grid', 'css.properties.display.grid'],
    ['Array.prototype.at()', 'javascript.builtins.Array.at'],
    ['Object.setPrototypeOf', 'javascript.builtins.Object.setPrototypeOf'],
    ['position: sticky', 'css.properties.position.sticky'],
  ])('"%s" ranks %s first as path_suffix', async (query, key) => {
    const hits = (await getSearchService()).rank(query, {});
    expect(hits[0]).toMatchObject({ tier: 2, matched_on: 'path_suffix', row: { bcd_key: key } });
  });

  it('a suffix shared by 13 keys lists all 13 at tier 2', async () => {
    const hits = (await getSearchService()).rank('referrerpolicy.unsafe-url', {});
    const suffixHits = hits.filter((hit) => hit.matched_on === 'path_suffix');
    expect(suffixHits).toHaveLength(13);
    expect(suffixHits.every((hit) => hit.tier === 2)).toBe(true);
    expect(new Set(suffixHits.map((hit) => hit.row.baseline_id))).toEqual(
      new Set(['referrer-policy', 'svg']),
    );
  });

  it('one-segment queries gain no path_suffix hits', async () => {
    const search = await getSearchService();
    for (const query of ['display', 'prototype', 'isPrototypeOf', 'animate']) {
      expect(search.rank(query, {}).some((hit) => hit.matched_on === 'path_suffix')).toBe(false);
    }
  });

  it('"prototype" and "isPrototypeOf" still find Object.isPrototypeOf', async () => {
    const search = await getSearchService();
    for (const query of ['prototype', 'isPrototypeOf']) {
      const keys = search.rank(query, {}).map((hit) => hit.row.bcd_key);
      expect(keys).toContain('javascript.builtins.Object.isPrototypeOf');
    }
  });
});

describe('SearchService — tag-shaped names on the real bundled index', () => {
  it('"<dialog>" ranks the dialog feature at tier 2 on its exact name', async () => {
    const hits = (await getSearchService()).rank('<dialog>', {});
    expect(hits[0]).toMatchObject({ tier: 2, matched_on: 'name', row: { baseline_id: 'dialog' } });
  });

  it('"<a>" returns the a feature instead of nothing', async () => {
    const hits = (await getSearchService()).rank('<a>', {});
    expect(hits[0]).toMatchObject({ tier: 2, matched_on: 'name', row: { baseline_id: 'a' } });
  });

  it('a name holding a <...> fragment matches on name for the fragment typed either way', async () => {
    const search = await getSearchService();
    const legend = search.rank('legend', {}).find((hit) => hit.row.baseline_id === 'fieldset');
    expect(legend).toMatchObject({ tier: 3, matched_on: 'name' });
    const select = search
      .rank('<select>', {})
      .find((hit) => hit.row.baseline_id === 'customizable-select');
    expect(select).toMatchObject({ tier: 3, matched_on: 'name' });
  });
});

describe('SearchService — group and snapshot filters on the real bundled index', () => {
  /** Independent oracle: walk a group's parent chain in the test, not through the index. */
  async function inGroup(featureId: string | undefined, group: string): Promise<boolean> {
    const baseline = await getBaselineService();
    const own = featureId === undefined ? [] : (baseline.feature(featureId)?.group ?? []);
    return own.some((start) => {
      for (let id: string | undefined = start; id !== undefined; id = baseline.groups[id]?.parent) {
        if (id === group) return true;
      }
      return false;
    });
  }

  it('"has" in selectors at Baseline limited returns 3 rows, all inside selectors', async () => {
    const hits = (await getSearchService()).rank('has', {
      group: 'selectors',
      baseline: 'limited',
    });
    expect(hits).toHaveLength(3);
    for (const hit of hits) {
      expect(hit.row.baseline_state).toBe('limited');
      expect(await inGroup(hit.row.baseline_id, 'selectors')).toBe(true);
    }
  });

  it('"array" in ecmascript-2023 returns 11 rows across 2 features', async () => {
    const hits = (await getSearchService()).rank('array', { snapshot: 'ecmascript-2023' });
    expect(hits).toHaveLength(11);
    expect(new Set(hits.map((hit) => hit.row.baseline_id))).toEqual(
      new Set(['array-by-copy', 'array-findlast']),
    );
  });

  it('group walks the ancestry: css reaches features tagged positioning, two levels down', async () => {
    const search = await getSearchService();
    for (const group of ['positioning', 'layout', 'css']) {
      const ids = new Set(search.rank('sticky', { group }).map((hit) => hit.row.baseline_id));
      expect(ids).toContain('sticky-positioning');
    }
  });

  it('group does not reach upward: positioning excludes features tagged only layout', async () => {
    const search = await getSearchService();
    const layoutIds = new Set(
      search.rank('margin', { group: 'layout' }).map((h) => h.row.baseline_id),
    );
    expect(layoutIds).toContain('margin');
    const positioningIds = new Set(
      search.rank('margin', { group: 'positioning' }).map((h) => h.row.baseline_id),
    );
    expect(positioningIds).not.toContain('margin');
  });

  it('every row a group filter keeps is in that group or a descendant, and none it drops is', async () => {
    const search = await getSearchService();
    const all = search.rank('grid', {});
    const kept = new Set(search.rank('grid', { group: 'css' }).map((hit) => hit.row));
    expect(kept.size).toBeGreaterThan(0);
    for (const hit of all) {
      expect(kept.has(hit.row)).toBe(await inGroup(hit.row.baseline_id, 'css'));
    }
  });

  it('rows with no web-features id never match either filter', async () => {
    const search = await getSearchService();
    const unmapped = search.rank('grid', {}).filter((hit) => hit.row.baseline_id === undefined);
    expect(unmapped.length).toBeGreaterThan(0);
    for (const hit of unmapped) {
      expect(hit.row.groups).toEqual([]);
      expect(hit.row.snapshots).toEqual([]);
    }
  });
});
