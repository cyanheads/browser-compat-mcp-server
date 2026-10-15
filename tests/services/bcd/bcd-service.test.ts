/**
 * @fileoverview Tests for the browser-compat-data service: version-token
 * resolution, per-browser support evaluation, the reported/runtime browser
 * split, and the limiting-browser computation. Runs against the real bundled
 * `@mdn/browser-compat-data` snapshot except where a synthetic fixture is the
 * only way to force a specific tie-break or status-filter branch.
 * @module tests/services/bcd/bcd-service.test
 */

import { describe, expect, it } from 'vitest';
import { getBaselineService } from '@/services/baseline/baseline-service.js';
import { BcdService, getBcdService } from '@/services/bcd/bcd-service.js';

describe('BcdService — real bundled data', () => {
  it('indexes 20,696 leaves across the 12 documented namespaces', async () => {
    const bcd = await getBcdService();
    expect(bcd.leafCount).toBe(20_696);
    expect([...bcd.namespaces]).toEqual([
      'api',
      'css',
      'html',
      'http',
      'javascript',
      'manifests',
      'mathml',
      'mediatypes',
      'svg',
      'webassembly',
      'webdriver',
      'webextensions',
    ]);
    expect(bcd.namespaceLeafCount('api')).toBe(10_267);
    expect(bcd.namespaceLeafCount('css')).toBe(4_212);
    expect(bcd.namespaceLeafCount('webextensions')).toBe(2_075);
  });

  it('derives the reported browser set from type, never a hardcoded list (D8)', async () => {
    const bcd = await getBcdService();
    expect([...bcd.reportedBrowserIds]).toEqual([
      'chrome',
      'chrome_android',
      'edge',
      'firefox',
      'firefox_android',
      'ie',
      'opera',
      'opera_android',
      'safari',
      'safari_ios',
      'samsunginternet_android',
      'webview_android',
      'webview_ios',
    ]);
    expect([...bcd.runtimeBrowserIds]).toEqual(['bun', 'deno', 'nodejs', 'oculus']);
  });

  it('leaf() returns undefined for a path that is not a __compat leaf', async () => {
    const bcd = await getBcdService();
    expect(bcd.leaf('css.selectors.has')).toBeDefined();
    expect(bcd.leaf('css.selectors')).toBeUndefined();
    expect(bcd.leaf('not.a.real.key')).toBeUndefined();
  });

  it('webFeatureTags reads the web-features: prefixed tags off a leaf', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('css.selectors.has');
    expect(leaf).toBeDefined();
    expect(bcd.webFeatureTags(leaf!)).toContain('has');
  });

  it('webFeatureTags returns an empty array when the leaf carries no tags', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('webextensions.api.action.ColorArray');
    expect(leaf).toBeDefined();
    expect(bcd.webFeatureTags(leaf!)).toEqual([]);
  });
});

describe('BcdService#resolveTargetVersion — verified against the installed BCD snapshot', () => {
  it('safari 16.0 → 16 (trailing-zero normalization, idx 32)', async () => {
    const bcd = await getBcdService();
    expect(bcd.resolveTargetVersion('safari', '16.0')).toEqual({
      resolved: true,
      index: 32,
      version: '16',
    });
  });

  it('samsunginternet_android 20 → 20.0 (trailing-zero normalization, idx 41)', async () => {
    const bcd = await getBcdService();
    expect(bcd.resolveTargetVersion('samsunginternet_android', '20')).toEqual({
      resolved: true,
      index: 41,
      version: '20.0',
    });
  });

  it('safari_ios 18.5-18.7 → 18.5, lower bound of the range (idx 48)', async () => {
    const bcd = await getBcdService();
    expect(bcd.resolveTargetVersion('safari_ios', '18.5-18.7')).toEqual({
      resolved: true,
      index: 48,
      version: '18.5',
    });
  });

  it('opera_android all → the oldest release, 10.1 (idx 0)', async () => {
    const bcd = await getBcdService();
    expect(bcd.resolveTargetVersion('opera_android', 'all')).toEqual({
      resolved: true,
      index: 0,
      version: '10.1',
    });
  });

  it('safari TP is unresolvable — non-numeric after range/all handling', async () => {
    const bcd = await getBcdService();
    expect(bcd.resolveTargetVersion('safari', 'TP')).toEqual({
      resolved: false,
      reason: 'unknown_version',
    });
  });

  it('opera_android 10 predates BCD’s oldest release (10.1) → idx -1, version null', async () => {
    const bcd = await getBcdService();
    expect(bcd.resolveTargetVersion('opera_android', '10')).toEqual({
      resolved: true,
      index: -1,
      version: null,
    });
  });

  it('safari 3.2 nearest-at-or-below resolves to 3.1 (idx 6)', async () => {
    const bcd = await getBcdService();
    expect(bcd.resolveTargetVersion('safari', '3.2')).toEqual({
      resolved: true,
      index: 6,
      version: '3.1',
    });
  });

  it('an unknown browser id resolves to unknown_version rather than throwing', async () => {
    const bcd = await getBcdService();
    expect(bcd.resolveTargetVersion('not_a_real_browser', '10')).toEqual({
      resolved: false,
      reason: 'unknown_version',
    });
  });
});

/** A minimal BCD-shaped fixture for testing the version-tuple comparator in isolation. */
function fixtureData(releases: Record<string, { index: number; status: string }>) {
  return {
    __meta: { version: '0.0.0-fixture', timestamp: '2020-01-01T00:00:00.000Z' },
    browsers: {
      test: {
        name: 'Test Browser',
        type: 'desktop',
        accepts_flags: false,
        releases,
      },
    },
    css: {
      properties: {
        foo: { __compat: { support: { test: { version_added: '1' } } } },
      },
    },
  };
}

describe('BcdService#resolveTargetVersion — nearest-at-or-below tie-break (D9)', () => {
  it('never trusts key order: releases fed out of order still sort by index', () => {
    // Object.keys order is deliberately scrambled — the real safari data does
    // this too (… 17, 18, 26, 27, 1.1, 1.2 …).
    const service = new BcdService(
      fixtureData({
        '10': { index: 2, status: 'current' },
        '1': { index: 0, status: 'retired' },
        '5': { index: 1, status: 'retired' },
      }),
    );
    expect(service.resolveTargetVersion('test', '10')).toEqual({
      resolved: true,
      index: 2,
      version: '10',
    });
    expect(service.resolveTargetVersion('test', '7')).toEqual({
      resolved: true,
      index: 1,
      version: '5',
    });
  });

  it('compares version tuples, not lexicographic version strings, then tie-breaks on index', () => {
    // '2' and '2.0' parse to the same tuple ([2] vs [2,0], missing segments
    // read as 0) — compareTuples reports them equal, so the winner must come
    // from the index tie-break, not tuple comparison alone.
    const service = new BcdService(
      fixtureData({
        '1': { index: 0, status: 'retired' },
        '2': { index: 1, status: 'retired' },
        '2.0': { index: 2, status: 'current' },
      }),
    );
    expect(service.resolveTargetVersion('test', '2.5')).toEqual({
      resolved: true,
      index: 2,
      version: '2.0',
    });
  });

  it('an exact match short-circuits the loop even when other releases tie its tuple', () => {
    const service = new BcdService(
      fixtureData({
        '2': { index: 0, status: 'retired' },
        '2.0': { index: 1, status: 'current' },
      }),
    );
    expect(service.resolveTargetVersion('test', '2')).toEqual({
      resolved: true,
      index: 0,
      version: '2',
    });
  });

  it('an empty release list resolves to unknown_version', () => {
    const service = new BcdService(fixtureData({}));
    expect(service.resolveTargetVersion('test', '1')).toEqual({
      resolved: false,
      reason: 'unknown_version',
    });
  });
});

describe('BcdService#latestShippedRelease', () => {
  it('excludes beta, nightly, and planned releases, keeping current/esr/retired', () => {
    const service = new BcdService(
      fixtureData({
        '1': { index: 0, status: 'retired' },
        '2': { index: 1, status: 'current' },
        '3': { index: 2, status: 'nightly' },
        '4': { index: 3, status: 'beta' },
        '5': { index: 4, status: 'planned' },
      }),
    );
    expect(service.latestShippedRelease('test')).toMatchObject({ version: '2', index: 1 });
  });

  it('returns undefined for a browser with no shipped release at all', () => {
    const service = new BcdService(fixtureData({ '1': { index: 0, status: 'nightly' } }));
    expect(service.latestShippedRelease('test')).toBeUndefined();
  });

  it('returns undefined for a browser id BCD does not know', () => {
    const service = new BcdService(fixtureData({ '1': { index: 0, status: 'current' } }));
    expect(service.latestShippedRelease('not_a_real_browser')).toBeUndefined();
  });
});

describe('BcdService#supportAt — real leaves, verdict-by-verdict (per Core Mechanics §2)', () => {
  it('api.ANGLE_instanced_arrays [chrome]: a clean statement beats an earlier partial+removed one', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.ANGLE_instanced_arrays');
    expect(leaf).toBeDefined();
    const latest = bcd.latestShippedRelease('chrome');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'chrome', latest!.index);
    expect(result.verdict).toBe('supported');
    expect(result.detail.version_added).toBe('32');
  });

  it('api.DOMMatrix [firefox]: out-of-order array statements ["33","49","1.5"] still pick 33', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.DOMMatrix');
    expect(leaf).toBeDefined();
    const latest = bcd.latestShippedRelease('firefox');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'firefox', latest!.index);
    expect(result.verdict).toBe('supported');
    expect(result.detail.version_added).toBe('33');
  });

  it('api.Attr.localName [opera]: ≤12.1 at or after the bound is a plain yes with an upper-bound flag', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.Attr.localName');
    expect(leaf).toBeDefined();
    const latest = bcd.latestShippedRelease('opera');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'opera', latest!.index);
    expect(result.verdict).toBe('supported');
    expect(result.detail.version_added).toBe('12.1');
    expect(result.detail.version_added_is_upper_bound).toBe(true);
  });

  it('api.Attr.localName [opera]: ≤12.1 evaluated before the bound is unknown, never no', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.Attr.localName');
    expect(leaf).toBeDefined();
    const result = bcd.supportAt(leaf!, 'opera', 0);
    expect(result.verdict).toBe('unknown');
  });

  it('api.AnimationTimeline.duration [firefox]: preview-only support reports preview_only', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.AnimationTimeline.duration');
    expect(leaf).toBeDefined();
    const latest = bcd.latestShippedRelease('firefox');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'firefox', latest!.index);
    expect(result.verdict).toBe('preview_only');
  });

  it('api.BatteryManager [firefox]: removed reports version_last, the final supporting release', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.BatteryManager');
    expect(leaf).toBeDefined();
    const latest = bcd.latestShippedRelease('firefox');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'firefox', latest!.index);
    expect(result.verdict).toBe('removed');
    expect(result.detail.version_last).toBe('51');
  });

  it('api.AmbientLightSensor.AmbientLightSensor [chrome]: flag-gated support reports flagged', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.AmbientLightSensor.AmbientLightSensor');
    expect(leaf).toBeDefined();
    const latest = bcd.latestShippedRelease('chrome');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'chrome', latest!.index);
    expect(result.verdict).toBe('flagged');
    expect(result.detail.flags).toEqual([
      {
        name: '#enable-experimental-web-platform-features',
        type: 'preference',
        value_to_set: 'Enabled',
      },
    ]);
  });

  it('api.CanvasRenderingContext2D.imageSmoothingEnabled [ie]: prefixed support reports the prefix', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.CanvasRenderingContext2D.imageSmoothingEnabled');
    expect(leaf).toBeDefined();
    const latest = bcd.latestShippedRelease('ie');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'ie', latest!.index);
    expect(result.verdict).toBe('prefixed');
    expect(result.detail.prefix).toBe('ms');
  });

  it('api.AudioParam.cancelScheduledValues [firefox]: partial_implementation reports partial', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('api.AudioParam.cancelScheduledValues');
    expect(leaf).toBeDefined();
    const latest = bcd.latestShippedRelease('firefox');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'firefox', latest!.index);
    expect(result.verdict).toBe('partial');
    expect(result.detail.partial).toBe(true);
  });

  it('a webextensions leaf absent from a browser’s support map is unknown, never unsupported', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('webextensions.api.action.ColorArray');
    expect(leaf).toBeDefined();
    expect(leaf?.support && 'ie' in leaf.support).toBe(false);
    const latest = bcd.latestShippedRelease('ie');
    expect(latest).toBeDefined();
    const result = bcd.supportAt(leaf!, 'ie', latest!.index);
    expect(result.verdict).toBe('unknown');
  });

  it('an unresolvable statement version (e.g. a browser BCD does not track) yields unknown', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('css.selectors.has');
    expect(leaf).toBeDefined();
    const result = bcd.supportAt(leaf!, 'not_a_real_browser', 0);
    expect(result.verdict).toBe('unknown');
  });

  /** The statement each verdict below is read from is the one compare_support's failing rows report (#27). */
  it.each([
    {
      label:
        'api.Element.matches [edge 12]: two alternative names tie and the first BCD lists wins',
      key: 'api.Element.matches',
      browser: 'edge',
      version: '12',
      expected: {
        verdict: 'prefixed',
        detail: { version_added: '12', alternative_name: 'webkitMatchesSelector' },
      },
    },
    {
      label: 'css.properties.backdrop-filter [safari 15]: the -webkit- statement since 9',
      key: 'css.properties.backdrop-filter',
      browser: 'safari',
      version: '15',
      expected: { verdict: 'prefixed', detail: { version_added: '9', prefix: '-webkit-' } },
    },
    {
      label: 'css.properties.font-smooth [chrome 120]: an alternative name',
      key: 'css.properties.font-smooth',
      browser: 'chrome',
      version: '120',
      expected: {
        verdict: 'prefixed',
        detail: { version_added: '5', alternative_name: '-webkit-font-smoothing' },
      },
    },
    {
      label: 'api.AudioTrack [firefox 140]: the preference flag',
      key: 'api.AudioTrack',
      browser: 'firefox',
      version: '140',
      expected: {
        verdict: 'flagged',
        detail: {
          version_added: '33',
          flags: [{ name: 'media.track.enabled', type: 'preference', value_to_set: 'true' }],
        },
      },
    },
  ])('$label', async ({ key, browser, version, expected }) => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf(key);
    expect(leaf).toBeDefined();
    const resolved = bcd.resolveTargetVersion(browser, version);
    expect(resolved).toMatchObject({ resolved: true, version });
    if (!resolved.resolved) throw new Error(`${browser} ${version} must resolve`);
    expect(bcd.supportAt(leaf!, browser, resolved.index)).toEqual(expected);
  });
});

describe('BcdService#supportRows', () => {
  it('returns one row per requested browser id, using each browser’s current release', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('css.selectors.has');
    expect(leaf).toBeDefined();
    const rows = bcd.supportRows(leaf!, ['chrome', 'ie']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      browser_id: 'chrome',
      browser_name: 'Chrome',
      verdict: 'supported',
    });
    expect(rows[1]).toMatchObject({
      browser_id: 'ie',
      browser_name: 'Internet Explorer',
      verdict: 'unsupported',
    });
  });

  it('#27: css.properties.backdrop-filter [safari] keeps its row and lists the -webkit- statement beside it', async () => {
    const bcd = await getBcdService();
    const [row] = bcd.supportRows(bcd.leaf('css.properties.backdrop-filter')!, ['safari']);
    expect(row).toEqual({
      browser_id: 'safari',
      browser_name: 'Safari',
      verdict: 'supported',
      version_added: '18',
      other_statements: [{ version_added: '9', prefix: '-webkit-' }],
    });
  });

  it('#27: css.properties.user-select [safari]: the winner sits mid-list, and the rest keep BCD order around it', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('css.properties.user-select')!;
    expect(leaf.support.safari).toEqual([
      { version_added: 'preview' },
      { version_added: '3', prefix: '-webkit-' },
      { version_added: '2', version_removed: '3', version_last: '2', prefix: '-khtml-' },
    ]);
    const [row] = bcd.supportRows(leaf, ['safari']);
    expect(row).toEqual({
      browser_id: 'safari',
      browser_name: 'Safari',
      verdict: 'prefixed',
      version_added: '3',
      prefix: '-webkit-',
      other_statements: [
        { version_added: 'preview' },
        { version_added: '2', version_removed: '3', version_last: '2', prefix: '-khtml-' },
      ],
    });
  });

  it('#27: a browser with one statement carries no other_statements', async () => {
    const bcd = await getBcdService();
    const rows = bcd.supportRows(bcd.leaf('css.selectors.has')!, bcd.reportedBrowserIds);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).not.toHaveProperty('other_statements');
  });

  it('#27: over every leaf, no statement appears both as a row and in its list, and the list keeps BCD order', async () => {
    const bcd = await getBcdService();
    let listed = 0;
    for (const [, leaf] of bcd.entries()) {
      for (const row of bcd.supportRows(leaf, bcd.reportedBrowserIds)) {
        const entry = leaf.support[row.browser_id as keyof typeof leaf.support];
        const statements = entry === undefined ? [] : Array.isArray(entry) ? entry : [entry];
        const others = row.other_statements ?? [];
        listed += others.length;
        const behindRow =
          row.verdict === 'unknown'
            ? 0
            : row.verdict === 'unsupported'
              ? statements.filter((statement) => statement.version_added === false).length
              : row.verdict === 'preview_only'
                ? statements.filter((statement) => statement.version_added === 'preview').length
                : 1;
        expect(others.length).toBe(statements.length - behindRow);
        if (row.other_statements !== undefined) expect(others.length).toBeGreaterThan(0);
        const {
          browser_id: _id,
          browser_name: _name,
          verdict: _verdict,
          other_statements: _others,
          ...own
        } = row;
        if (behindRow === 1) expect(others).not.toContainEqual(own);
        /** The listed statements are a subsequence of BCD's, matched in declaration order. */
        let cursor = 0;
        for (const other of others) {
          while (
            cursor < statements.length &&
            !(
              (statements[cursor]?.version_added === other.version_added ||
                statements[cursor]?.version_added === `≤${other.version_added}`) &&
              statements[cursor]?.prefix === other.prefix &&
              statements[cursor]?.alternative_name === other.alternative_name &&
              statements[cursor]?.version_removed === other.version_removed
            )
          ) {
            cursor += 1;
          }
          expect(cursor).toBeLessThan(statements.length);
          cursor += 1;
        }
      }
    }
    expect(listed).toBeGreaterThan(1_000);
  }, 60_000);
});

describe('BcdService#limitingBrowser (D27)', () => {
  it('picks the Baseline core browser with the newest support release, by release date', async () => {
    const bcd = await getBcdService();
    const baseline = (await import('@/services/baseline/baseline-service.js')).getBaselineService;
    const baselineService = await baseline();
    const leaf = bcd.leaf('css.selectors.has');
    expect(leaf).toBeDefined();
    const result = bcd.limitingBrowser(leaf!, baselineService.coreBrowserIds);
    expect(result).toEqual({ browser_id: 'firefox', name: 'Firefox', version: '121' });
  });

  it('is undefined once any core browser has removed the feature (no "newest version" answer)', async () => {
    const bcd = await getBcdService();
    const baseline = (await import('@/services/baseline/baseline-service.js')).getBaselineService;
    const baselineService = await baseline();
    const leaf = bcd.leaf('api.BatteryManager');
    expect(leaf).toBeDefined();
    const result = bcd.limitingBrowser(leaf!, baselineService.coreBrowserIds);
    expect(result).toBeUndefined();
  });

  it('is undefined when a core browser is absent from the leaf entirely (unknown)', async () => {
    const bcd = await getBcdService();
    const leaf = bcd.leaf('webextensions.api.action.ColorArray');
    expect(leaf).toBeDefined();
    // Chrome is a core browser and IS present on this leaf, but the leaf is
    // fully absent from web-features Baseline core coverage requirements —
    // exercise the function directly against a core set the leaf can't fully answer.
    const result = bcd.limitingBrowser(leaf!, ['chrome', 'not_a_real_browser']);
    expect(result).toBeUndefined();
  });

  it('#30 keeps the ≤ bound of api.FileSystem visible as version_is_upper_bound', async () => {
    const bcd = await getBcdService();
    const baselineService = await getBaselineService();
    const leaf = bcd.leaf('api.FileSystem');
    expect(leaf?.support.edge).toMatchObject({ version_added: '≤18' });
    expect(bcd.limitingBrowser(leaf!, baselineService.coreBrowserIds)).toEqual({
      browser_id: 'edge',
      name: 'Edge',
      version: '18',
      version_is_upper_bound: true,
    });
  });
});

describe('BcdService#featureLimitingBrowser — web-features status.support (#26)', () => {
  const limitingFor = async (id: string) => {
    const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);
    const support = baseline.featureSupport(id);
    expect(support).toBeDefined();
    return bcd.featureLimitingBrowser(support!, baseline.coreBrowserIds);
  };

  it('picks the listed version with the newest release date once all seven are listed', async () => {
    expect(await limitingFor('grid')).toEqual({ browser_id: 'edge', name: 'Edge', version: '16' });
    expect(await limitingFor('popover')).toEqual({
      browser_id: 'safari_ios',
      name: 'Safari on iOS',
      version: '18.3',
    });
  });

  it('is undefined while any core browser is unlisted', async () => {
    expect(await limitingFor('anchor-positioning')).toBeUndefined();
    expect(await limitingFor('display-contents')).toBeUndefined();
  });

  it('flags a ≤ listing as an upper bound when it limits, through the same rule as a key', async () => {
    const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);
    const ranged = { ...baseline.featureSupport('grid'), edge: '≤18' };
    expect(bcd.featureLimitingBrowser(ranged, baseline.coreBrowserIds)).toEqual({
      browser_id: 'edge',
      name: 'Edge',
      version: '18',
      version_is_upper_bound: true,
    });
  });

  it('matches limitingBrowser for a single-key feature whose listing equals its key', async () => {
    const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);
    const firefox121 = { browser_id: 'firefox', name: 'Firefox', version: '121' };
    expect(
      bcd.featureLimitingBrowser(baseline.featureSupport('has')!, baseline.coreBrowserIds),
    ).toStrictEqual(firefox121);
    expect(
      bcd.limitingBrowser(bcd.leaf('css.selectors.has')!, baseline.coreBrowserIds),
    ).toStrictEqual(firefox121);
  });

  it('dates a listed release through the same trailing-zero rule as a target token', async () => {
    const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);
    // BCD records edge "16"; a listing spelled "16.0" must still date to it and limit.
    const respelled = { ...baseline.featureSupport('grid'), edge: '16.0' };
    expect(bcd.featureLimitingBrowser(respelled, baseline.coreBrowserIds)).toStrictEqual({
      browser_id: 'edge',
      name: 'Edge',
      version: '16.0',
    });
  });
});

describe('BcdService#featureSupportAt — a target judged on web-features status.support (#26)', () => {
  const judge = async (id: string, browser: string, token: string) => {
    const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);
    const target = bcd.resolveTargetVersion(browser, token);
    if (!target.resolved) throw new Error(`${browser} ${token} must resolve`);
    return bcd.featureSupportAt(
      baseline.featureSupport(id)!,
      baseline.coreBrowserIds,
      browser,
      target.index,
    );
  };

  it('supported at and after the listed release, before_feature_support before it', async () => {
    expect(await judge('popover', 'chrome', '116')).toBe('supported');
    expect(await judge('popover', 'chrome', '140')).toBe('supported');
    expect(await judge('popover', 'chrome', '115')).toBe('before_feature_support');
    expect(await judge('popover', 'chrome', '109')).toBe('before_feature_support');
  });

  it('resolves a listed version through the same trailing-zero rule as a target token', async () => {
    // safari 10.1 is listed for grid; the caniuse-style token 10.1.0 maps onto it.
    expect(await judge('grid', 'safari', '10.1.0')).toBe('supported');
    expect(await judge('grid', 'safari', '10')).toBe('before_feature_support');
  });

  it('a target before a ≤ bound is unknown, at the bound supported', async () => {
    expect(await judge('paint-order', 'firefox', '60')).toBe('unknown');
    expect(await judge('paint-order', 'firefox', '66')).toBe('supported');
    expect(await judge('paint-order', 'firefox', '67')).toBe('supported');
  });

  it('an unlisted core browser is no_feature_support at every release', async () => {
    expect(await judge('anchor-positioning', 'chrome', '140')).toBe('no_feature_support');
    expect(await judge('display-contents', 'safari_ios', '18.0')).toBe('no_feature_support');
  });

  it('a non-core browser is unknown even when the feature is listed everywhere it is published', async () => {
    expect(await judge('grid', 'opera', '100')).toBe('unknown');
    expect(await judge('grid', 'samsunginternet_android', '20.0')).toBe('unknown');
  });

  it('a target that predates every release fails an exact listing', async () => {
    const [bcd, baseline] = await Promise.all([getBcdService(), getBaselineService()]);
    expect(
      bcd.featureSupportAt(baseline.featureSupport('grid')!, baseline.coreBrowserIds, 'edge', -1),
    ).toBe('before_feature_support');
  });
});
