/**
 * @fileoverview The shared feature resolver every tool runs its `feature`
 * string through: exact BCD key, exact web-features id, lowercased id, redirect
 * follow, then — only when asked — the single unambiguous top search hit.
 * @module services/baseline/feature-resolver
 */

import { getBaselineService } from '@/services/baseline/baseline-service.js';
import type { FeatureResolution, ResolvedAs } from '@/services/baseline/types.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';
import { getSearchService } from '@/services/search/search-service.js';

/** Guidance returned when nothing in either namespace matched the caller's string. */
function missGuidance(input: string, namespaceCount: number): string {
  return (
    `No BCD key or web-features id matched "${input}". Call browsercompat_search_features with ` +
    `a plain-language name, or browsercompat_list_reference with topic bcd_namespaces to see ` +
    `the ${namespaceCount} top-level namespaces.`
  );
}

/** Options controlling the optional search step and the tool named in split guidance. */
export interface ResolveOptions {
  /** Enables the single-best-search-hit fallback (resolver step 6). */
  resolve: boolean;
  /** Tool the caller should re-run with one concrete target after a split. */
  toolName: string;
}

/**
 * Resolve a caller's feature string. BCD keys always contain a dot and
 * web-features ids never do, so the two namespaces cannot collide. A miss is a
 * result carrying guidance, never a throw.
 */
export async function resolveFeature(
  input: string,
  options: ResolveOptions,
): Promise<FeatureResolution> {
  const trimmed = input.trim();
  const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);

  const fromBcdKey = (key: string, via: ResolvedAs['resolved_via']): FeatureResolution => {
    const leaf = bcd.leaf(key);
    const owner = baseline.keyOwner(key);
    const taggedId = leaf ? bcd.webFeatureTags(leaf)[0] : undefined;
    return {
      found: true,
      resolved_as: {
        input: trimmed,
        bcd_key: key,
        baseline_id: owner?.featureId ?? taggedId ?? null,
        resolved_via: via,
      },
    };
  };

  const fromFeatureId = (id: string, via: ResolvedAs['resolved_via']): FeatureResolution => {
    const keys = baseline.compatKeys(id);
    const single = keys.length === 1 ? keys[0] : undefined;
    return {
      found: true,
      resolved_as: {
        input: trimmed,
        bcd_key: single ?? null,
        baseline_id: id,
        resolved_via: via,
      },
      ...(single === undefined ? { compat_keys: keys } : {}),
    };
  };

  if (bcd.leaf(trimmed)) return fromBcdKey(trimmed, 'bcd_key');

  const lowered = trimmed.toLowerCase();
  const matchedId = baseline.has(trimmed) ? trimmed : baseline.has(lowered) ? lowered : undefined;
  if (matchedId !== undefined) {
    const via = matchedId === trimmed ? 'web_features_id' : 'web_features_id_normalized';
    const entry = baseline.entry(matchedId);
    if (entry && entry.kind !== 'feature') {
      const targets = baseline.redirectTargets(matchedId);
      const singleTarget = targets.length === 1 ? targets[0] : undefined;
      if (singleTarget !== undefined) return fromFeatureId(singleTarget, 'redirect');
      return {
        found: false,
        guidance:
          `"${trimmed}" was split into ${targets.join(', ')}. ` +
          `Call ${options.toolName} again with one of them.`,
      };
    }
    return fromFeatureId(matchedId, via);
  }

  if (options.resolve) {
    const search = await getSearchService();
    const hits = search.rank(trimmed, {});
    const top = hits[0];
    if (top && (top.tier === 1 || top.tier === 2) && hits[1]?.tier !== top.tier) {
      if (top.row.bcd_key !== undefined) return fromBcdKey(top.row.bcd_key, 'search');
      if (top.row.baseline_id !== undefined) return fromFeatureId(top.row.baseline_id, 'search');
    }
  }

  return { found: false, guidance: missGuidance(trimmed, bcd.namespaces.length) };
}
