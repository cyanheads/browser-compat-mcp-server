/**
 * @fileoverview Domain types for the search service — one index row per
 * searchable entity and the tiered, inspectable hit it produces.
 * @module services/search/types
 */

import type { BaselineState } from '@/services/baseline/types.js';

/** The field a hit matched on, echoed so the ranking is inspectable. */
export type MatchedOn =
  | 'bcd_key'
  | 'baseline_id'
  | 'name'
  | 'caniuse_title'
  | 'path_suffix'
  | 'path_segment'
  | 'description'
  | 'path_tokens';

/** One searchable entity: a BCD leaf, or a feature that owns no BCD keys. */
export interface IndexRow {
  baseline_id?: string;
  baseline_state: BaselineState;
  bcd_key?: string;
  caniuse_title?: string;
  caniuseTitleTokens: string[];
  description?: string;
  descriptionTokens: string[];
  /** web-features groups of this row's feature plus every ancestor group; empty without a feature. */
  groups: string[];
  lastSegmentTokens: string[];
  mdn_url?: string;
  name?: string;
  namespace?: string;
  nameTokens: string[];
  pathSegmentCount: number;
  pathTokens: string[];
  /** ECMAScript snapshots of this row's feature; empty without a feature. */
  snapshots: string[];
}

/** A ranked match: the row, the tier it landed in, and the field that matched. */
export interface SearchHit {
  matched_on: MatchedOn;
  row: IndexRow;
  tier: number;
}

/** Optional restrictions applied before ranking. */
export interface SearchFilters {
  baseline?: BaselineState;
  /** A web-features group id; matches the group and every group nested under it. */
  group?: string;
  namespace?: string;
  /** An ECMAScript snapshot id. */
  snapshot?: string;
}
