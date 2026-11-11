/**
 * @fileoverview Domain types for the targets service — resolved browserslist
 * target tokens and the ones that could not be evaluated.
 * @module services/targets/types
 */

/**
 * Why a query target was not evaluated. The first two come from mapping the
 * token onto a release; `no_bcd_data` means a compared key's data does not
 * establish support either way for the target (the key records nothing for the
 * browser, or the target sits before a `≤` bound), `no_feature_level_data` means
 * a feature judged on web-features' feature-level support has no answer for it
 * (a non-core browser, or a release before a `≤` bound), and
 * `no_comparable_feature` means the call held no feature that could be compared
 * at all.
 */
export type UncheckedReason =
  | 'no_bcd_browser'
  | 'unknown_version'
  | 'no_bcd_data'
  | 'no_feature_level_data'
  | 'no_comparable_feature';

/** One BCD release a target covers: its ordinal, and its version or `null` before every release. */
export interface SpannedRelease {
  index: number;
  version: string | null;
}

/**
 * A browserslist token that mapped onto a concrete BCD release. `bcd_version`
 * and `bcd_release_index` name the release the token maps to — for a grouped
 * token such as `15.0-15.1`, its lower endpoint's.
 */
export interface ResolvedTarget {
  agent: string;
  bcd_browser: string;
  bcd_release_index: number;
  bcd_version: string | null;
  /**
   * Every BCD release the token covers, oldest first: the release it maps to,
   * then for a grouped token each listed release through the one its upper
   * endpoint maps to. Judged release by release; never an output field.
   */
  span: readonly SpannedRelease[];
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
