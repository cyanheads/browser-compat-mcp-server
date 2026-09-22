/**
 * @fileoverview Tests for the Baseline service — the `by_compat_key` index,
 * the four reported Baseline states, redirect targets, and per-feature
 * caniuse/discouraged lookups. Runs against the real bundled `web-features`
 * snapshot.
 * @module tests/services/baseline/baseline-service.test
 */

import { describe, expect, it } from 'vitest';
import { getBaselineService } from '@/services/baseline/baseline-service.js';

describe('BaselineService — identity and lookups', () => {
  it('has() is true for a feature, a moved entry, and a split entry alike', async () => {
    const baseline = await getBaselineService();
    expect(baseline.has('has')).toBe(true);
    expect(baseline.has('display-grid-lanes')).toBe(true); // kind: moved
    expect(baseline.has('text-wrap-style')).toBe(true); // kind: split
    expect(baseline.has('not-a-real-feature-id')).toBe(false);
  });

  it('feature() returns undefined for a redirect entry, defined for a real feature', async () => {
    const baseline = await getBaselineService();
    expect(baseline.feature('has')).toBeDefined();
    expect(baseline.feature('display-grid-lanes')).toBeUndefined();
  });

  it('redirectTargets() reads a single moved target and a multi-target split in order', async () => {
    const baseline = await getBaselineService();
    expect(baseline.redirectTargets('display-grid-lanes')).toEqual(['grid-lanes']);
    expect(baseline.redirectTargets('text-wrap-style')).toEqual([
      'text-wrap',
      'text-wrap-balance',
      'text-wrap-pretty',
    ]);
  });

  it('redirectTargets() is empty for a real feature', async () => {
    const baseline = await getBaselineService();
    expect(baseline.redirectTargets('has')).toEqual([]);
  });
});

describe('BaselineService#keyOwner / baselineForKey — the by_compat_key authority (D13)', () => {
  it('keyOwner finds the single feature that owns a BCD key', async () => {
    const baseline = await getBaselineService();
    const owner = baseline.keyOwner('css.selectors.has');
    expect(owner?.featureId).toBe('has');
  });

  it('baselineForKey reports not_mapped for a key with no by_compat_key entry (D14)', async () => {
    const baseline = await getBaselineService();
    expect(baseline.baselineForKey('webextensions.api.action.ColorArray')).toEqual({
      state: 'not_mapped',
    });
  });

  it('baselineForKey resolves widely with the crossed dates for :has()', async () => {
    const baseline = await getBaselineService();
    expect(baseline.baselineForKey('css.selectors.has')).toEqual({
      state: 'widely',
      since_date: '2023-12-19',
      high_date: '2026-06-19',
    });
  });

  it('grid: the per-key Baseline can diverge in its dates from the feature-level rollup (D13)', async () => {
    const baseline = await getBaselineService();
    const rollup = baseline.baselineForFeature('grid');
    expect(rollup).toEqual({ state: 'widely', since_date: '2017-10-17', high_date: '2020-04-17' });

    const keys = baseline.compatKeys('grid');
    expect(keys.length).toBeGreaterThan(1);
    // At least one owned key must NOT share the rollup's high_date — proving
    // baselineForKey is never substituted with the feature-level rollup.
    const diverges = keys.some(
      (key) => baseline.baselineForKey(key).high_date !== rollup?.high_date,
    );
    expect(diverges).toBe(true);
  });

  it('passes a ≤-prefixed date through verbatim with date_is_upper_bound', async () => {
    // Verified against the installed web-features snapshot: two features carry
    // a ≤-prefixed baseline_low_date (≤2020-03-24, ≤2018-10-02).
    const baseline = await getBaselineService();
    const withUpperBound = Object.entries(baseline.features).find(
      ([, entry]) => entry.kind === 'feature' && entry.status.baseline_low_date?.startsWith('≤'),
    );
    expect(withUpperBound).toBeDefined();
    const [id] = withUpperBound as [string, unknown];
    const info = baseline.baselineForFeature(id);
    expect(info?.date_is_upper_bound).toBe(true);
    expect(info?.since_date?.startsWith('≤')).toBe(true);
  });
});

describe('BaselineService#compatKeys / caniuseIds / discouraged', () => {
  it('compatKeys returns a single-entry array for a single-key feature', async () => {
    const baseline = await getBaselineService();
    expect(baseline.compatKeys('has')).toEqual(['css.selectors.has']);
  });

  it('compatKeys returns an empty array for the 21 features that own no BCD keys', async () => {
    const baseline = await getBaselineService();
    expect(baseline.compatKeys('intersection-observer-v2')).toEqual([]);
  });

  it('caniuseIds returns the feature’s caniuse[] array', async () => {
    const baseline = await getBaselineService();
    expect(baseline.caniuseIds('has')).toEqual(['css-has']);
  });

  it('caniuseIds is empty for a feature with no caniuse mapping', async () => {
    const baseline = await getBaselineService();
    const withoutCaniuse = Object.entries(baseline.features).find(
      ([, entry]) => entry.kind === 'feature' && !entry.caniuse,
    );
    expect(withoutCaniuse).toBeDefined();
    const [id] = withoutCaniuse as [string, unknown];
    expect(baseline.caniuseIds(id)).toEqual([]);
  });

  it('discouraged reports reason and according_to for a discouraged feature', async () => {
    const baseline = await getBaselineService();
    const discouragedEntry = Object.entries(baseline.features).find(
      ([, entry]) => entry.kind === 'feature' && entry.discouraged,
    );
    expect(discouragedEntry).toBeDefined();
    const [id] = discouragedEntry as [string, unknown];
    const result = baseline.discouraged(id);
    expect(result).toBeDefined();
    expect(typeof result?.reason).toBe('string');
    expect(Array.isArray(result?.according_to)).toBe(true);
  });

  it('discouraged is undefined for a feature web-features does not flag', async () => {
    const baseline = await getBaselineService();
    expect(baseline.discouraged('has')).toBeUndefined();
  });
});

describe('BaselineService — groups, snapshots, core browsers', () => {
  it('exposes 104 groups and 11 ECMAScript snapshots', async () => {
    const baseline = await getBaselineService();
    expect(Object.keys(baseline.groups)).toHaveLength(104);
    expect(Object.keys(baseline.snapshots)).toHaveLength(11);
  });

  it('coreBrowserIds is the 7-browser Baseline core set', async () => {
    const baseline = await getBaselineService();
    expect([...baseline.coreBrowserIds]).toEqual([
      'chrome',
      'chrome_android',
      'edge',
      'firefox',
      'firefox_android',
      'safari',
      'safari_ios',
    ]);
  });
});
