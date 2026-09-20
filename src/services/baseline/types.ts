/**
 * @fileoverview Domain types for the Baseline service — the web-features
 * entries this server reads, the four reported Baseline states, and the shape
 * every tool echoes back describing how a feature string was resolved.
 * @module services/baseline/types
 */

/** Reported Baseline state. `not_mapped` covers BCD keys web-features does not own. */
export type BaselineState = 'widely' | 'newly' | 'limited' | 'not_mapped';

/** Raw `status.baseline` value as web-features records it. */
export type RawBaseline = 'high' | 'low' | false;

/** Baseline state plus the dates it crossed, with `≤` bounds passed through verbatim. */
export interface BaselineInfo {
  date_is_upper_bound?: boolean;
  high_date?: string;
  since_date?: string;
  state: BaselineState;
}

/** Baseline status computed for one BCD key, or rolled up for one feature. */
export interface WebFeatureStatus {
  baseline: RawBaseline;
  baseline_high_date?: string;
  baseline_low_date?: string;
  by_compat_key?: Record<string, WebFeatureStatus>;
  support?: Record<string, string>;
}

/** Why a feature is discouraged, straight from web-features. */
export interface DiscouragedInfo {
  according_to: string[];
  reason: string;
}

/** A tracked web platform feature. */
export interface WebFeature {
  caniuse?: string[];
  compat_features?: string[];
  description: string;
  description_html: string;
  discouraged?: { according_to: string[]; reason: string; reason_html: string };
  group?: string[];
  kind: 'feature';
  name: string;
  snapshot?: string[];
  spec: string[];
  status: WebFeatureStatus;
}

/** A web-features entry that has moved or split into other entries. */
export interface WebFeatureRedirect {
  kind: 'moved' | 'split';
  redirect_target?: string;
  redirect_targets?: string[];
}

/** Any entry in the web-features `features` map. */
export type WebFeatureEntry = WebFeature | WebFeatureRedirect;

/** A web-features group. */
export interface WebFeatureGroup {
  name: string;
  parent?: string;
}

/** An ECMAScript snapshot web-features tracks. */
export interface WebFeatureSnapshot {
  name: string;
  spec: string;
}

/** How a caller's feature string was matched, echoed on every tool response. */
export interface ResolvedAs {
  baseline_id: string | null;
  bcd_key: string | null;
  input: string;
  resolved_via:
    | 'bcd_key'
    | 'web_features_id'
    | 'web_features_id_normalized'
    | 'redirect'
    | 'search';
}

/** Result of running a feature string through the fixed resolution order. */
export type FeatureResolution =
  | { found: true; resolved_as: ResolvedAs; compat_keys?: string[] }
  | { found: false; guidance: string };
