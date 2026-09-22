/**
 * @fileoverview Tests for resolver step 6 (`resolve: true`) against a
 * synthetic search index: the real `SearchService` ranking and the real
 * resolver, with only `getSearchService` swapped so each test controls exactly
 * which rows share the top tier. Covers the one-entity rule — one row resolves
 * to its key, several rows of one feature resolve through the feature, rows
 * from two entities are a miss.
 * @module tests/services/baseline/feature-resolver.search-step.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFeature } from '@/services/baseline/feature-resolver.js';
import { getSearchService, SearchService, tokenize } from '@/services/search/search-service.js';
import type { IndexRow } from '@/services/search/types.js';

vi.mock('@/services/search/search-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/search/search-service.js')>();
  return { ...actual, getSearchService: vi.fn() };
});

const OPTS = { resolve: true, toolName: 'browsercompat_get_feature' };

/** A BCD-leaf row. The name is what the synthetic queries below match on. */
function leaf(bcdKey: string, name: string, baselineId?: string): IndexRow {
  const segments = bcdKey.split('.');
  return {
    bcd_key: bcdKey,
    ...(baselineId === undefined ? {} : { baseline_id: baselineId }),
    name,
    baseline_state: 'widely',
    namespace: segments[0] as string,
    pathSegmentCount: segments.length,
    nameTokens: tokenize(name),
    descriptionTokens: [],
    caniuseTitleTokens: [],
    lastSegmentTokens: tokenize(segments.at(-1) as string),
    pathTokens: tokenize(bcdKey),
    groups: [],
    snapshots: [],
  };
}

/** Real BCD keys, so the resolver's own lookups on the winning key behave as in production. */
const CONTAINER_KEYS = [
  'css.at-rules.container',
  'css.properties.container',
  'css.properties.container-name',
] as const;
const UNMAPPED_KEY = 'api.Element.getHTML.escapes_lt_gt_in_attributes';
const OTHER_UNMAPPED_KEY = 'api.Element.innerHTML.escapes_lt_gt_in_attributes';

function useIndex(rows: IndexRow[]): void {
  vi.mocked(getSearchService).mockResolvedValue(new SearchService(rows, new Map()));
}

beforeEach(() => {
  vi.mocked(getSearchService).mockReset();
});

describe('resolveFeature step 6 — grouping the top tier by entity (synthetic index)', () => {
  it('one row alone in the top tier resolves to its exact key', async () => {
    useIndex([leaf(UNMAPPED_KEY, 'Widget')]);
    const result = await resolveFeature('Widget', OPTS);
    expect(result).toEqual({
      found: true,
      resolved_as: {
        input: 'Widget',
        bcd_key: UNMAPPED_KEY,
        baseline_id: null,
        resolved_via: 'search',
      },
    });
  });

  it('several rows of one feature resolve through the feature id with its compat_keys', async () => {
    useIndex(CONTAINER_KEYS.map((key) => leaf(key, 'Widget', 'container-queries')));
    const result = await resolveFeature('Widget', OPTS);
    expect(result).toMatchObject({
      found: true,
      resolved_as: { bcd_key: null, baseline_id: 'container-queries', resolved_via: 'search' },
    });
    if (!result.found) throw new Error('unreachable');
    expect(result.compat_keys).toHaveLength(12);
  });

  it('rows from two different features in the top tier are a miss', async () => {
    useIndex([
      leaf(CONTAINER_KEYS[0], 'Widget', 'container-queries'),
      leaf(CONTAINER_KEYS[1], 'Widget', 'container-queries'),
      leaf('css.selectors.has', 'Widget', 'has'),
    ]);
    const result = await resolveFeature('Widget', OPTS);
    expect(result.found).toBe(false);
  });

  it('two rows with no feature group by BCD key, so they are two entities and a miss', async () => {
    useIndex([leaf(UNMAPPED_KEY, 'Widget'), leaf(OTHER_UNMAPPED_KEY, 'Widget')]);
    const result = await resolveFeature('Widget', OPTS);
    expect(result.found).toBe(false);
  });

  it('a feature-less row and a feature row sharing the top tier are two entities and a miss', async () => {
    useIndex([
      leaf(UNMAPPED_KEY, 'Widget'),
      leaf(CONTAINER_KEYS[0], 'Widget', 'container-queries'),
    ]);
    const result = await resolveFeature('Widget', OPTS);
    expect(result.found).toBe(false);
  });

  it('only the top tier is grouped: one tier 1 row wins over tier 2 rows from other features', async () => {
    const tierOne = leaf('css.types.widget', 'Other', 'has');
    useIndex([
      tierOne,
      leaf(CONTAINER_KEYS[0], 'css.types.widget', 'container-queries'),
      leaf(UNMAPPED_KEY, 'css.types.widget'),
    ]);
    const result = await resolveFeature('css.types.widget', OPTS);
    expect(result).toMatchObject({
      found: true,
      resolved_as: { bcd_key: 'css.types.widget', baseline_id: null, resolved_via: 'search' },
    });
  });

  it('an exact name match outranks a path_suffix row from another entity in the same tier', async () => {
    useIndex([
      leaf('css.selectors.has', 'properties.container', 'has'),
      leaf(CONTAINER_KEYS[1], 'Unrelated'),
    ]);
    const hits = (await getSearchService()).rank('properties.container', {});
    expect(hits.map((hit) => `${hit.tier} ${hit.matched_on}`).sort()).toEqual([
      '2 name',
      '2 path_suffix',
    ]);
    const result = await resolveFeature('properties.container', OPTS);
    expect(result).toMatchObject({
      found: true,
      resolved_as: { bcd_key: 'css.selectors.has', baseline_id: 'has', resolved_via: 'search' },
    });
  });

  it('path_suffix rows decide the tier when no row matches by name', async () => {
    useIndex([leaf(CONTAINER_KEYS[1], 'Unrelated'), leaf('css.selectors.has', 'Other', 'has')]);
    const result = await resolveFeature('properties.container', OPTS);
    expect(result).toMatchObject({
      found: true,
      resolved_as: { bcd_key: CONTAINER_KEYS[1], resolved_via: 'search' },
    });
  });

  it('a single feature whose only top rows sit below tier 2 is still a miss', async () => {
    useIndex(CONTAINER_KEYS.map((key) => leaf(key, 'Widget things', 'container-queries')));
    const result = await resolveFeature('Widget', OPTS);
    expect(result.found).toBe(false);
  });

  it('resolve: false never consults the index', async () => {
    useIndex([leaf(UNMAPPED_KEY, 'Widget')]);
    const result = await resolveFeature('Widget', { ...OPTS, resolve: false });
    expect(result.found).toBe(false);
    expect(getSearchService).not.toHaveBeenCalled();
  });
});
