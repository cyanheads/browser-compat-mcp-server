/**
 * @fileoverview Domain types for the targets service — resolved browserslist
 * target tokens and the ones that could not be evaluated.
 * @module services/targets/types
 */

/** Why a resolved target could not be checked against compatibility data. */
export type UncheckedReason = 'no_bcd_browser' | 'unknown_version' | 'no_bcd_data';

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
