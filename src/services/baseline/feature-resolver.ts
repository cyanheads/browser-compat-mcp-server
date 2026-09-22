/**
 * @fileoverview The shared feature resolver every tool runs its `feature`
 * string through: exact BCD key, exact web-features id, lowercased id, redirect
 * follow, then — only when asked — the top search tier when it names one entity.
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
  /** Enables the search fallback (resolver step 6): accept a top tier naming one feature or key. */
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
    const topTier = hits[0]?.tier;
    if (topTier === 1 || topTier === 2) {
      /**
       * An exact label (key, id, name, caniuse title) outranks a path_suffix row
       * sharing the tier: the feature named "window.external" is the answer, not
       * a key it does not own that ends in `window.external`. A feature's name is
       * joined onto every key it owns, so one feature fills the tier with several
       * rows. Count entities, not rows: a feature id, or the key itself for a row
       * no feature covers.
       */
      const tier = hits.filter((hit) => hit.tier === topTier);
      const labelled = tier.filter((hit) => hit.matched_on !== 'path_suffix');
      const top = labelled.length > 0 ? labelled : tier;
      const entities = new Set(top.map((hit) => hit.row.baseline_id ?? hit.row.bcd_key));
      const first = top[0]?.row;
      if (first && entities.size === 1) {
        if (top.length === 1 && first.bcd_key !== undefined) {
          return fromBcdKey(first.bcd_key, 'search');
        }
        if (first.baseline_id !== undefined) return fromFeatureId(first.baseline_id, 'search');
      }
    }
  }

  return { found: false, guidance: missGuidance(trimmed, bcd.namespaces.length) };
}
