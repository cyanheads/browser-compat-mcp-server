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

/** Statement-derived detail for one browser, with absent upstream fields left absent. */
export interface SupportDetail {
  alternative_name?: string;
  flags?: SupportFlag[];
  impl_url?: string[];
  notes?: string[];
  partial?: boolean;
  prefix?: string;
  version_added?: string;
  version_added_is_upper_bound?: boolean;
  version_last?: string;
  version_removed?: string;
}

/** One reported browser's support for a compat leaf. */
export interface SupportRow extends SupportDetail {
  browser_id: string;
  browser_name: string;
  verdict: SupportVerdict;
}

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
