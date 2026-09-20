/**
 * @fileoverview Tests for the shared feature resolver: the fixed resolution
 * order (BCD key → web-features id → lowercased id → redirect → optional
 * search), verified against the real bundled datasets.
 * @module tests/services/baseline/feature-resolver.test
 */

import { describe, expect, it } from 'vitest';
import { resolveFeature } from '@/services/baseline/feature-resolver.js';

const OPTS = { resolve: false, toolName: 'browsercompat_get_feature' };

describe('resolveFeature — exact BCD key (step 2)', () => {
  it('resolves an exact, case-sensitive BCD key', async () => {
    const result = await resolveFeature('css.selectors.has', OPTS);
    expect(result).toEqual({
      found: true,
      resolved_as: {
        input: 'css.selectors.has',
        bcd_key: 'css.selectors.has',
        baseline_id: 'has',
        resolved_via: 'bcd_key',
      },
    });
  });

  it('trims whitespace before resolving', async () => {
    const result = await resolveFeature('  css.selectors.has  ', OPTS);
    expect(result).toMatchObject({ found: true, resolved_as: { input: 'css.selectors.has' } });
  });
});

describe('resolveFeature — BCD case-sensitivity collisions (D5)', () => {
  it('api.Crypto and api.crypto both resolve to themselves as distinct leaves', async () => {
    const upper = await resolveFeature('api.Crypto', OPTS);
    const lower = await resolveFeature('api.crypto', OPTS);
    expect(upper).toMatchObject({ found: true, resolved_as: { bcd_key: 'api.Crypto' } });
    expect(lower).toMatchObject({ found: true, resolved_as: { bcd_key: 'api.crypto' } });
  });

  it('API.CRYPTO misses — BCD keys never case-fold', async () => {
    const result = await resolveFeature('API.CRYPTO', OPTS);
    expect(result.found).toBe(false);
  });
});

describe('resolveFeature — web-features id (step 3) and lowercased retry (step 4)', () => {
  it('resolves an exact web-features id to its single BCD key', async () => {
    const result = await resolveFeature('has', OPTS);
    expect(result).toEqual({
      found: true,
      resolved_as: {
        input: 'has',
        bcd_key: 'css.selectors.has',
        baseline_id: 'has',
        resolved_via: 'web_features_id',
      },
    });
  });

  it('retries a lowercased id and reports resolved_via web_features_id_normalized', async () => {
    const result = await resolveFeature('HAS', OPTS);
    expect(result).toEqual({
      found: true,
      resolved_as: {
        input: 'HAS',
        bcd_key: 'css.selectors.has',
        baseline_id: 'has',
        resolved_via: 'web_features_id_normalized',
      },
    });
  });

  it('a multi-key feature id resolves with bcd_key null and the full compat_keys list', async () => {
    const result = await resolveFeature('grid', OPTS);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('unreachable');
    expect(result.resolved_as.bcd_key).toBeNull();
    expect(result.resolved_as.baseline_id).toBe('grid');
    expect(result.compat_keys?.length).toBeGreaterThan(1);
  });

  it('masonry (D26/no compat_features) resolves found: true with an empty compat_keys array', async () => {
    const result = await resolveFeature('masonry', OPTS);
    expect(result).toEqual({
      found: true,
      resolved_as: {
        input: 'masonry',
        bcd_key: null,
        baseline_id: 'masonry',
        resolved_via: 'web_features_id',
      },
      compat_keys: [],
    });
  });
});

describe('resolveFeature — redirect follow (step 5)', () => {
  it('follows a single-target moved entry and reports resolved_via redirect', async () => {
    const result = await resolveFeature('display-grid-lanes', OPTS);
    expect(result).toEqual({
      found: true,
      resolved_as: {
        input: 'display-grid-lanes',
        bcd_key: null,
        baseline_id: 'masonry',
        resolved_via: 'redirect',
      },
      compat_keys: [],
    });
  });

  it('a multi-target split entry misses with guidance naming every target', async () => {
    const result = await resolveFeature('text-wrap-style', OPTS);
    expect(result.found).toBe(false);
    if (result.found) throw new Error('unreachable');
    expect(result.guidance).toContain('text-wrap-style');
    expect(result.guidance).toContain('text-wrap, text-wrap-balance, text-wrap-pretty');
  });
});

describe('resolveFeature — miss (step 7)', () => {
  it('a completely unknown string misses with guidance naming the namespace count', async () => {
    const result = await resolveFeature('nope-xyz', OPTS);
    expect(result.found).toBe(false);
    if (result.found) throw new Error('unreachable');
    expect(result.guidance).toContain('nope-xyz');
    expect(result.guidance).toContain('12 top-level namespaces');
  });

  it('empty and over-length strings are the caller’s responsibility, not the resolver’s — trimming alone does not throw', async () => {
    const result = await resolveFeature('', OPTS);
    expect(result.found).toBe(false);
  });
});

describe('resolveFeature — resolve: true search fallback (step 6, D6)', () => {
  it('resolves an unambiguous top hit — ":has()" (tier 2, single row)', async () => {
    const result = await resolveFeature(':has()', { ...OPTS, resolve: true });
    expect(result).toEqual({
      found: true,
      resolved_as: {
        input: ':has()',
        bcd_key: 'css.selectors.has',
        baseline_id: 'has',
        resolved_via: 'search',
      },
    });
  });

  it('does NOT resolve "Container queries" — the name is shared across the feature’s 12 keys, tying tier 2', async () => {
    const result = await resolveFeature('Container queries', { ...OPTS, resolve: true });
    expect(result.found).toBe(false);
  });

  it('resolve: false never falls back to search, even for an unambiguous name', async () => {
    const result = await resolveFeature(':has()', OPTS);
    expect(result.found).toBe(false);
  });

  it('a tier-1/2 exact match still wins over resolve: true search when both apply', async () => {
    // "has" matches the web-features id directly (step 3) before search ever runs.
    const result = await resolveFeature('has', { ...OPTS, resolve: true });
    expect(result).toMatchObject({ resolved_as: { resolved_via: 'web_features_id' } });
  });
});
