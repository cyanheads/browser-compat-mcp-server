/**
 * @fileoverview Domain types for the browser-compat-data service — support
 * verdicts, normalized support rows, and version-resolution results.
 * @module services/bcd/types
 */

/** How a feature behaves in one browser at one release index. */
export type SupportVerdict =
  | 'supported'
  | 'partial'
  | 'prefixed'
  | 'flagged'
  | 'removed'
  | 'unsupported'
  | 'preview_only'
  | 'unknown';

/** A preference or runtime flag that gates support. */
export interface SupportFlag {
  name: string;
  type: 'preference' | 'runtime_flag';
  value_to_set?: string;
}

/**
 * The qualifiers of one BCD support statement, with absent upstream fields left
 * absent. `version_added` drops a `≤` prefix into `version_added_is_upper_bound`.
 */
export interface SupportStatementFields {
  alternative_name?: string;
  flags?: SupportFlag[];
  partial?: boolean;
  prefix?: string;
  version_added?: string;
  version_added_is_upper_bound?: boolean;
  version_last?: string;
  version_removed?: string;
}

/** Statement-derived detail for one browser: the statement's fields plus its notes and links. */
export interface SupportDetail extends SupportStatementFields {
  impl_url?: string[];
  notes?: string[];
}

/** One reported browser's support for a compat leaf. */
export interface SupportRow extends SupportDetail {
  browser_id: string;
  browser_name: string;
  /** Every statement BCD records for the browser other than the one(s) behind the row, in BCD order. */
  other_statements?: SupportDetail[];
  verdict: SupportVerdict;
}

/**
 * The core browser requiring the newest release. `version` is the release as
 * the data records it; `version_is_upper_bound` marks a `≤` bound — support
 * arrived at or before that release, not exactly at it.
 */
export interface LimitingBrowser {
  browser_id: string;
  name: string;
  version: string;
  version_is_upper_bound?: boolean;
}

/**
 * A target judged on web-features' feature-level `status.support`: at or after
 * the listed release, before it, a core browser the feature lists no release
 * for, or `unknown` — a non-core browser, or a target before a `≤` bound.
 */
export type FeatureSupportVerdict =
  | 'supported'
  | 'before_feature_support'
  | 'no_feature_support'
  | 'unknown';

/**
 * Outcome of mapping a version token onto a browser's release ordering. `index`
 * is `-1` when the token predates every known release; `version` is the BCD
 * release key the token matched, or `null` when it matched none.
 */
export type VersionResolution =
  | { resolved: true; index: number; version: string | null }
  | { resolved: false; reason: 'unknown_version' };

/** A single release of a browser, carrying its ordinal and parsed version tuple. */
export interface ReleaseEntry {
  index: number;
  release_date?: string;
  status: string;
  tuple: number[];
  version: string;
}
