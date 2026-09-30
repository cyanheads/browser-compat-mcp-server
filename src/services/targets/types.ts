/**
 * @fileoverview Domain types for the targets service — resolved browserslist
 * target tokens and the ones that could not be evaluated.
 * @module services/targets/types
 */

/**
 * Why a query target was not evaluated. The first two come from mapping the
 * token onto a release; `no_bcd_data` means a compared feature records nothing
 * for the mapped browser, and `no_comparable_feature` means the call held no
 * feature that could be compared at all.
 */
export type UncheckedReason =
  | 'no_bcd_browser'
  | 'unknown_version'
  | 'no_bcd_data'
  | 'no_comparable_feature';

/** A browserslist token that mapped onto a concrete BCD release. */
export interface ResolvedTarget {
  agent: string;
  bcd_browser: string;
  bcd_release_index: number;
  bcd_version: string | null;
  version_token: string;
}

/** A browserslist token the server declined to claim a verdict for. */
export interface UncheckedTarget {
  agent: string;
  reason: UncheckedReason;
  usage_percent: number;
  version_token: string;
}

/** Outcome of mapping a whole browserslist query onto BCD browsers and releases. */
export interface TargetResolution {
  resolved: ResolvedTarget[];
  unchecked: UncheckedTarget[];
}
