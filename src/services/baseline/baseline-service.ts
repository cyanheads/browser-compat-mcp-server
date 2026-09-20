/**
 * @fileoverview Baseline service — the web-features feature map, the
 * `by_compat_key` index that is the authority for per-key Baseline state, the
 * redirect map for moved and split entries, groups, and snapshots.
 * @module services/baseline/baseline-service
 */

import type {
  BaselineInfo,
  BaselineState,
  DiscouragedInfo,
  RawBaseline,
  WebFeature,
  WebFeatureEntry,
  WebFeatureGroup,
  WebFeatureSnapshot,
  WebFeatureStatus,
} from './types.js';

/** Map a raw web-features baseline value onto the reported state word. */
function stateFor(raw: RawBaseline): Exclude<BaselineState, 'not_mapped'> {
  if (raw === 'high') return 'widely';
  if (raw === 'low') return 'newly';
  return 'limited';
}

/** Build the reported Baseline shape from a status block, preserving `≤` dates verbatim. */
function baselineFrom(status: WebFeatureStatus): BaselineInfo {
  const low = status.baseline_low_date;
  const high = status.baseline_high_date;
  const isUpperBound = Boolean(low?.startsWith('≤')) || Boolean(high?.startsWith('≤'));
  return {
    state: stateFor(status.baseline),
    ...(low === undefined ? {} : { since_date: low }),
    ...(high === undefined ? {} : { high_date: high }),
    ...(isUpperBound ? { date_is_upper_bound: true } : {}),
  };
}

/**
 * In-memory index over the bundled web-features snapshot. Immutable and
 * process-global.
 */
export class BaselineService {
  readonly features: Record<string, WebFeatureEntry>;
  readonly groups: Record<string, WebFeatureGroup>;
  readonly snapshots: Record<string, WebFeatureSnapshot>;
  readonly coreBrowserIds: readonly string[];

  private readonly owners: Map<string, { featureId: string; status: WebFeatureStatus }>;

  constructor(
    features: Record<string, WebFeatureEntry>,
    groups: Record<string, WebFeatureGroup>,
    snapshots: Record<string, WebFeatureSnapshot>,
    browsers: Record<string, unknown>,
  ) {
    this.features = features;
    this.groups = groups;
    this.snapshots = snapshots;
    this.coreBrowserIds = Object.keys(browsers).sort();

    this.owners = new Map();
    for (const [featureId, entry] of Object.entries(features)) {
      if (entry.kind !== 'feature') continue;
      const byCompatKey = entry.status.by_compat_key;
      if (!byCompatKey) continue;
      for (const [key, status] of Object.entries(byCompatKey)) {
        this.owners.set(key, { featureId, status });
      }
    }
  }

  /** True when the id names a web-features entry of any kind. */
  has(id: string): boolean {
    return Object.hasOwn(this.features, id);
  }

  /** The web-features entry for an id, or `undefined`. */
  entry(id: string): WebFeatureEntry | undefined {
    return this.features[id];
  }

  /** The entry for an id when it is a real feature rather than a redirect. */
  feature(id: string): WebFeature | undefined {
    const entry = this.features[id];
    return entry && entry.kind === 'feature' ? entry : undefined;
  }

  /** Targets of a moved or split entry, in declaration order. */
  redirectTargets(id: string): string[] {
    const entry = this.features[id];
    if (!entry || entry.kind === 'feature') return [];
    if (entry.redirect_targets) return [...entry.redirect_targets];
    return entry.redirect_target ? [entry.redirect_target] : [];
  }

  /** The feature that owns a BCD key in `by_compat_key`, the authority for Baseline. */
  keyOwner(bcdKey: string): { featureId: string; status: WebFeatureStatus } | undefined {
    return this.owners.get(bcdKey);
  }

  /** Baseline reported for one BCD key — `not_mapped` when web-features owns no entry. */
  baselineForKey(bcdKey: string): BaselineInfo {
    const owner = this.owners.get(bcdKey);
    if (!owner) return { state: 'not_mapped' };
    return baselineFrom(owner.status);
  }

  /** Baseline rolled up for one feature id, when the id names a real feature. */
  baselineForFeature(id: string): BaselineInfo | undefined {
    const feature = this.feature(id);
    return feature ? baselineFrom(feature.status) : undefined;
  }

  /** The BCD keys a feature owns, in declaration order. */
  compatKeys(id: string): string[] {
    return [...(this.feature(id)?.compat_features ?? [])];
  }

  /** caniuse feature ids a web feature maps onto, in declaration order. */
  caniuseIds(id: string): string[] {
    return [...(this.feature(id)?.caniuse ?? [])];
  }

  /** Why a feature is discouraged, when web-features says so. */
  discouraged(id: string): DiscouragedInfo | undefined {
    const discouraged = this.feature(id)?.discouraged;
    if (!discouraged) return undefined;
    return { reason: discouraged.reason, according_to: [...discouraged.according_to] };
  }
}

let servicePromise: Promise<BaselineService> | undefined;

/** Load and index the bundled web-features snapshot exactly once per process. */
async function loadBaselineService(): Promise<BaselineService> {
  const imported = await import('web-features');
  return new BaselineService(
    imported.features as unknown as Record<string, WebFeatureEntry>,
    imported.groups as unknown as Record<string, WebFeatureGroup>,
    imported.snapshots as unknown as Record<string, WebFeatureSnapshot>,
    imported.browsers as unknown as Record<string, unknown>,
  );
}

/** Promise-memoized accessor — the first caller pays the load, everyone else awaits it. */
export function getBaselineService(): Promise<BaselineService> {
  servicePromise ??= loadBaselineService();
  return servicePromise;
}
