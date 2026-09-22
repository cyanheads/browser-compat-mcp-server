/**
 * @fileoverview Search service — one in-memory row per searchable entity (every
 * BCD leaf plus every web-features entry that owns no BCD keys), ranked in six
 * named tiers with a `matched_on` echo rather than a composite score, and
 * filterable by namespace, Baseline state, web-features group, and snapshot.
 * @module services/search/search-service
 */

import { getBaselineService } from '@/services/baseline/baseline-service.js';
import type { BaselineState, WebFeature } from '@/services/baseline/types.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';
import { getTargetsService } from '@/services/targets/targets-service.js';
import type { IndexRow, MatchedOn, SearchFilters, SearchHit } from './types.js';

/** Namespace ordering used as a within-tier tiebreak. */
const NAMESPACE_PRIORITY = [
  'api',
  'css',
  'javascript',
  'html',
  'http',
  'svg',
  'mathml',
  'webassembly',
  'manifests',
  'mediatypes',
  'webdriver',
  'webextensions',
];

/** Baseline ordering used as a within-tier tiebreak. */
const BASELINE_PRIORITY: Record<BaselineState, number> = {
  widely: 0,
  newly: 1,
  limited: 2,
  not_mapped: 3,
};

/** The five XML entities BCD descriptions use, plus the numeric apostrophe. */
const HTML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&amp;': '&',
};

/**
 * Reduce a BCD description to prose: drop the markup and decode the entities it
 * escapes, so `&lt;container-query&gt;` reads as the token an agent recognizes.
 */
export function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:lt|gt|quot|apos|#39|nbsp|amp);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize text for both the index and the query: split camelCase, lowercase,
 * drop punctuation except `-` (`<` and `>` included, so `<dialog>` keeps
 * `dialog`), then split on whitespace and dots. Markup is stripped only from
 * BCD descriptions, by `stripTags`, before they reach this function.
 */
export function tokenize(value: string): string[] {
  const camelSplit = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const cleaned = camelSplit.toLowerCase().replace(/[^a-z0-9\s.-]/g, ' ');
  return cleaned.split(/[\s.]+/).filter(Boolean);
}

/**
 * Split a query into the path segments the `path_suffix` tier compares against
 * a BCD key: lowercase, drop a trailing `()`, split on `.`, `:`, and whitespace,
 * and drop a `prototype` segment sitting between two others, so
 * `Array.prototype.at()` and `display: grid` read as `array.at` and `display.grid`.
 */
export function querySegments(value: string): string[] {
  const segments = value
    .trim()
    .replace(/\(\)$/, '')
    .toLowerCase()
    .split(/[\s.:]+/)
    .filter(Boolean);
  return segments.filter(
    (segment, index) => segment !== 'prototype' || index === 0 || index === segments.length - 1,
  );
}

/** Fewest query segments the `path_suffix` tier accepts; one segment is shared too widely. */
const MIN_SUFFIX_SEGMENTS = 2;

/** True when every query token appears inside some token of the field. */
function containsAll(fieldTokens: string[], queryTokens: string[]): boolean {
  if (fieldTokens.length === 0) return false;
  return queryTokens.every((queryToken) =>
    fieldTokens.some((fieldToken) => fieldToken.includes(queryToken)),
  );
}

/** Ranked, filterable index over every searchable entity. */
export class SearchService {
  private readonly rows: IndexRow[];
  private readonly byBcdKey: Map<string, IndexRow>;
  private readonly byFeatureId: Map<string, IndexRow[]>;
  private readonly aliasToTarget: Map<string, string>;
  private readonly exactNames: Map<string, IndexRow[]>;
  /** Rows keyed by the lowercased last segment of their BCD key, with the whole key's segments. */
  private readonly byLastSegment: Map<string, { row: IndexRow; segments: string[] }[]>;

  constructor(rows: IndexRow[], aliasToTarget: Map<string, string>) {
    this.rows = rows;
    this.aliasToTarget = aliasToTarget;
    this.byBcdKey = new Map();
    this.byFeatureId = new Map();
    this.exactNames = new Map();
    this.byLastSegment = new Map();
    for (const row of rows) {
      if (row.bcd_key !== undefined) {
        this.byBcdKey.set(row.bcd_key, row);
        const segments = row.bcd_key.toLowerCase().split('.');
        const last = segments[segments.length - 1] as string;
        const bucket = this.byLastSegment.get(last);
        if (bucket) bucket.push({ row, segments });
        else this.byLastSegment.set(last, [{ row, segments }]);
      }
      if (row.baseline_id !== undefined) {
        const bucket = this.byFeatureId.get(row.baseline_id);
        if (bucket) bucket.push(row);
        else this.byFeatureId.set(row.baseline_id, [row]);
      }
      for (const label of [row.name, row.caniuse_title]) {
        if (label === undefined) continue;
        const key = label.toLowerCase();
        const bucket = this.exactNames.get(key);
        if (bucket) bucket.push(row);
        else this.exactNames.set(key, [row]);
      }
    }
  }

  /** Number of searchable entities in the index. */
  get size(): number {
    return this.rows.length;
  }

  /**
   * Rank every matching row. Tier 1 and 2 are exact matches (tier 2 includes a
   * BCD key whose trailing segments equal the query's); tiers 3 to 6 widen from
   * name to last path segment to description to the whole path. Within a tier:
   * shorter BCD path, then namespace priority, then Baseline, then key.
   */
  rank(query: string, filters: SearchFilters): SearchHit[] {
    const trimmed = query.trim();
    const queryTokens = tokenize(trimmed);
    if (queryTokens.length === 0) return [];

    const best = new Map<IndexRow, SearchHit>();
    const consider = (row: IndexRow, tier: number, matchedOn: MatchedOn): void => {
      if (filters.namespace !== undefined && row.namespace !== filters.namespace) return;
      if (filters.baseline !== undefined && row.baseline_state !== filters.baseline) return;
      if (filters.group !== undefined && !row.groups.includes(filters.group)) return;
      if (filters.snapshot !== undefined && !row.snapshots.includes(filters.snapshot)) return;
      const existing = best.get(row);
      if (existing && existing.tier <= tier) return;
      best.set(row, { row, tier, matched_on: matchedOn });
    };

    const exactKeyRow = this.byBcdKey.get(trimmed);
    if (exactKeyRow) consider(exactKeyRow, 1, 'bcd_key');

    const aliasTarget = this.aliasToTarget.get(trimmed);
    for (const id of [trimmed, aliasTarget]) {
      if (id === undefined) continue;
      for (const row of this.byFeatureId.get(id) ?? []) consider(row, 1, 'baseline_id');
    }

    for (const row of this.exactNames.get(trimmed.toLowerCase()) ?? []) {
      const matchedOn: MatchedOn =
        row.name !== undefined && row.name.toLowerCase() === trimmed.toLowerCase()
          ? 'name'
          : 'caniuse_title';
      consider(row, 2, matchedOn);
    }

    const segments = querySegments(trimmed);
    const lastSegment = segments[segments.length - 1];
    if (segments.length >= MIN_SUFFIX_SEGMENTS && lastSegment !== undefined) {
      for (const candidate of this.byLastSegment.get(lastSegment) ?? []) {
        const start = candidate.segments.length - segments.length;
        if (start < 0) continue;
        if (segments.every((segment, index) => candidate.segments[start + index] === segment)) {
          consider(candidate.row, 2, 'path_suffix');
        }
      }
    }

    for (const row of this.rows) {
      if (containsAll(row.nameTokens, queryTokens)) {
        consider(row, 3, 'name');
        continue;
      }
      if (containsAll(row.lastSegmentTokens, queryTokens)) {
        consider(row, 4, 'path_segment');
        continue;
      }
      if (containsAll(row.descriptionTokens, queryTokens)) {
        consider(row, 5, 'description');
        continue;
      }
      if (containsAll(row.caniuseTitleTokens, queryTokens)) {
        consider(row, 5, 'caniuse_title');
        continue;
      }
      if (containsAll(row.pathTokens, queryTokens)) consider(row, 6, 'path_tokens');
    }

    return [...best.values()].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.row.pathSegmentCount !== b.row.pathSegmentCount) {
        return a.row.pathSegmentCount - b.row.pathSegmentCount;
      }
      const namespaceDelta = namespaceRank(a.row.namespace) - namespaceRank(b.row.namespace);
      if (namespaceDelta !== 0) return namespaceDelta;
      const baselineDelta =
        BASELINE_PRIORITY[a.row.baseline_state] - BASELINE_PRIORITY[b.row.baseline_state];
      if (baselineDelta !== 0) return baselineDelta;
      return (a.row.bcd_key ?? a.row.baseline_id ?? '').localeCompare(
        b.row.bcd_key ?? b.row.baseline_id ?? '',
      );
    });
  }
}

/** Position of a namespace in the fixed priority list; unknown namespaces sort last. */
function namespaceRank(namespace: string | undefined): number {
  if (namespace === undefined) return NAMESPACE_PRIORITY.length;
  const index = NAMESPACE_PRIORITY.indexOf(namespace);
  return index === -1 ? NAMESPACE_PRIORITY.length : index;
}

let servicePromise: Promise<SearchService> | undefined;

/** Build the row set from the three data services exactly once per process. */
async function loadSearchService(): Promise<SearchService> {
  const [bcd, baseline, targets] = await Promise.all([
    getBcdService(),
    getBaselineService(),
    getTargetsService(),
  ]);

  const titleFor = (featureId: string | undefined): string | undefined => {
    if (featureId === undefined) return undefined;
    for (const caniuseId of baseline.caniuseIds(featureId)) {
      const title = targets.caniuseTitle(caniuseId);
      if (title !== undefined) return title;
    }
    return undefined;
  };

  /** A feature's own groups plus every ancestor, so a filter on a parent reaches its descendants. */
  const groupsFor = (feature: WebFeature | undefined): string[] => {
    const expanded = new Set<string>();
    for (const start of feature?.group ?? []) {
      let id: string | undefined = start;
      while (id !== undefined && !expanded.has(id)) {
        expanded.add(id);
        id = baseline.groups[id]?.parent;
      }
    }
    return [...expanded];
  };

  const rows: IndexRow[] = [];

  for (const [key, leaf] of bcd.entries()) {
    const owner = baseline.keyOwner(key);
    const featureId = owner?.featureId ?? bcd.webFeatureTags(leaf)[0];
    const feature = featureId === undefined ? undefined : baseline.feature(featureId);
    const description =
      feature?.description ?? (leaf.description ? stripTags(leaf.description) : undefined);
    const caniuseTitle = titleFor(featureId);
    const segments = key.split('.');
    rows.push({
      bcd_key: key,
      ...(featureId === undefined ? {} : { baseline_id: featureId }),
      ...(feature?.name === undefined ? {} : { name: feature.name }),
      ...(description === undefined ? {} : { description }),
      ...(caniuseTitle === undefined ? {} : { caniuse_title: caniuseTitle }),
      ...(leaf.mdn_url === undefined ? {} : { mdn_url: leaf.mdn_url }),
      baseline_state: baseline.baselineForKey(key).state,
      namespace: segments[0] as string,
      pathSegmentCount: segments.length,
      nameTokens: feature?.name === undefined ? [] : tokenize(feature.name),
      descriptionTokens: description === undefined ? [] : tokenize(description),
      caniuseTitleTokens: caniuseTitle === undefined ? [] : tokenize(caniuseTitle),
      lastSegmentTokens: tokenize(segments[segments.length - 1] as string),
      pathTokens: tokenize(key),
      groups: groupsFor(feature),
      snapshots: [...(feature?.snapshot ?? [])],
    });
  }

  const aliasToTarget = new Map<string, string>();
  for (const [id, entry] of Object.entries(baseline.features)) {
    if (entry.kind !== 'feature') {
      const targetsForAlias = baseline.redirectTargets(id);
      const single = targetsForAlias.length === 1 ? targetsForAlias[0] : undefined;
      if (single !== undefined) aliasToTarget.set(id, single);
      continue;
    }
    if (entry.compat_features && entry.compat_features.length > 0) continue;
    const caniuseTitle = titleFor(id);
    rows.push({
      baseline_id: id,
      name: entry.name,
      description: entry.description,
      ...(caniuseTitle === undefined ? {} : { caniuse_title: caniuseTitle }),
      baseline_state: baseline.baselineForFeature(id)?.state ?? 'not_mapped',
      pathSegmentCount: 1,
      nameTokens: tokenize(entry.name),
      descriptionTokens: tokenize(entry.description),
      caniuseTitleTokens: caniuseTitle === undefined ? [] : tokenize(caniuseTitle),
      lastSegmentTokens: tokenize(id),
      pathTokens: tokenize(id),
      groups: groupsFor(entry),
      snapshots: [...(entry.snapshot ?? [])],
    });
  }

  return new SearchService(rows, aliasToTarget);
}

/** Promise-memoized accessor — the first caller pays the index build. */
export function getSearchService(): Promise<SearchService> {
  servicePromise ??= loadSearchService();
  return servicePromise;
}
