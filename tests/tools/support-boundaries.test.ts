/**
 * @fileoverview Synthetic dataset boundaries through real services, resolver, and tool assembly.
 * @module tests/tools/support-boundaries.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browsercompatCheckBaseline } from '@/mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { browsercompatGetFeature } from '@/mcp-server/tools/definitions/browsercompat-get-feature.tool.js';
import * as baselineModule from '@/services/baseline/baseline-service.js';
import type { WebFeature } from '@/services/baseline/types.js';
import * as bcdModule from '@/services/bcd/bcd-service.js';
import * as targetsModule from '@/services/targets/targets-service.js';
import { syntheticUsage } from '../helpers/synthetic-targets.js';

const advisory = {
  reason: 'Use <dialog> instead of **legacy**.',
  reason_html: '',
  according_to: ['https://example.test/one', 'https://example.test/two'],
};
const makeFeature = (keys: string[], caniuse = ['css-has']): WebFeature => ({
  kind: 'feature',
  name: 'Fixture <input>',
  description: 'Plain <textarea> &amp;lt;',
  description_html: '',
  spec: [],
  compat_features: keys,
  caniuse,
  discouraged: advisory,
  status: {
    baseline: 'high',
    by_compat_key: Object.fromEntries(keys.map((key) => [key, { baseline: 'high' }])),
  },
});
const compat = {
  support: { chrome: { version_added: '1' } },
  status: { deprecated: true, experimental: false, standard_track: false },
};
let fixtureBcd: bcdModule.BcdService;

beforeEach(() => {
  fixtureBcd = new bcdModule.BcdService({
    __meta: { version: 'fixture', timestamp: '2020-01-01' },
    browsers: {
      chrome: {
        name: 'Chrome',
        type: 'desktop',
        releases: { '1': { index: 0, status: 'current', release_date: '2020-01-01' } },
      },
    },
    api: {
      Parent: {
        __compat: compat,
        zebra: { __compat: compat, grandchild: { __compat: compat } },
        structural: { descendant: { __compat: compat } },
        alpha: { __compat: compat },
      },
      Statusless: { __compat: { support: compat.support } },
      Tagged: { __compat: { ...compat, tags: ['web-features:solo'] } },
      Text: {
        __compat: {
          description: '<code>&amp;lt;</code> <a href="https://example.test/a">label</a>',
          support: {
            chrome: {
              version_added: false,
              notes: [
                'Use <code>setOrientation()</code> &amp;lt;',
                'Use <code>setOrientation()</code> &amp;lt;',
              ],
              impl_url: 'https://example.test/tracking',
            },
          },
        },
      },
      Preview: {
        __compat: {
          support: {
            chrome: [
              {
                version_added: 'preview',
                notes: '<code>&lt;input&gt;</code>',
                impl_url: 'https://example.test/preview',
              },
              { version_added: false, notes: 'wrong verdict' },
            ],
          },
        },
      },
    },
  });
  const baseline = new baselineModule.BaselineService(
    {
      solo: makeFeature(['api.Parent']),
      multi: makeFeature(['api.Parent.zebra', 'api.Parent.alpha']),
      zero: makeFeature([]),
      statusless: makeFeature(['api.Statusless']),
      missing: makeFeature([], ['not-a-real-caniuse-id']),
      vendorNamed: makeFeature(
        [
          'css.properties.-webkit-fixture-a',
          'css.properties.-moz-fixture-b',
          'css.properties.-ms-fixture-c',
          'css.selectors.-o-fixture-d',
        ],
        ['fixture-prefix'],
      ),
      mixedNamed: makeFeature(
        ['css.properties.-webkit-fixture-e', 'css.properties.fixture-ms-f'],
        ['fixture-prefix'],
      ),
      zeroNamed: makeFeature([], ['fixture-prefix']),
    },
    {},
    {},
    { chrome: {} },
  );
  vi.spyOn(bcdModule, 'getBcdService').mockResolvedValue(fixtureBcd);
  vi.spyOn(baselineModule, 'getBaselineService').mockResolvedValue(baseline);
});
afterEach(() => vi.restoreAllMocks());

describe('#8 feature-level advisory boundaries', () => {
  it.each(['solo', 'multi', 'zero', 'statusless'])(
    'preserves %s advisory without fabricated status',
    async (feature) => {
      const result = await runToolContract(browsercompatGetFeature, { feature });
      expect(result.isError).not.toBe(true);
      const output = browsercompatGetFeature.output.parse(result.structuredContent);
      expect(output.discouraged).toEqual({
        reason: advisory.reason,
        according_to: advisory.according_to,
      });
      if (feature === 'solo')
        expect(output.status).toEqual({ ...compat.status, discouraged: output.discouraged });
      else expect(output.status).toBeUndefined();
      const text = result.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      expect(text.match(/\*\*Discouraged:\*\*/g)).toHaveLength(1);
      expect(text).toContain('&lt;dialog&gt;');
      for (const url of advisory.according_to) expect(text).toContain(url);
    },
  );
  it('omits the advisory on unmapped keys and misses', async () => {
    for (const feature of ['api.Text', 'no-such-feature']) {
      const result = await runToolContract(browsercompatGetFeature, { feature });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).not.toHaveProperty('discouraged');
    }
  });
});

describe('#13 usage scope boundaries', () => {
  it('excludes tag-only attribution and missing data; preserves real zero-key and multi-key feature figures', async () => {
    const result = await runToolContract(browsercompatCheckBaseline, {
      features: ['api.Tagged', 'missing', 'zero', 'multi'],
    });
    const rows = browsercompatCheckBaseline.output.parse(result.structuredContent).results;
    for (const row of rows.slice(0, 2)) {
      expect(row).not.toHaveProperty('usage_percent_excluded');
      expect(row).not.toHaveProperty('usage_percent_prefixed');
      expect(row).not.toHaveProperty('usage_source');
    }
    for (const row of rows.slice(2)) {
      expect(row.usage_percent_excluded).toBeTypeOf('number');
      expect(row.usage_percent_prefixed).toBeTypeOf('number');
      expect(row.usage_source).toContain('Feature-level');
    }
    expect(result.structuredContent).toHaveProperty('attribution');
    const noUsage = await runToolContract(browsercompatCheckBaseline, {
      features: ['api.Tagged', 'missing'],
    });
    expect(noUsage.structuredContent).not.toHaveProperty('attribution');
    expect(JSON.stringify(noUsage.content)).not.toContain('usage_percent_excluded');
    expect(JSON.stringify(noUsage.content)).not.toContain('usage_percent_prefixed');
    expect(
      browsercompatCheckBaseline.output.parse(result.structuredContent).all_widely_available,
    ).toBe(false);
  });
});

describe('#39 prefix-required usage boundaries', () => {
  beforeEach(() => {
    /** caniuse id `fixture-prefix` on one agent: 1 point prefix-required, 2 unsupported, 4 supported. */
    const targets = syntheticUsage(
      { '1': 1, '2': 2, '3': 4 },
      { 'fixture-prefix': { '1': 'y x #1', '2': 'n', '3': 'y' } },
    );
    vi.spyOn(targetsModule, 'getTargetsService').mockResolvedValue(targets);
  });

  it('counts prefix-required support as excluded unless every compat key is a vendor-prefixed name', async () => {
    const result = await runToolContract(browsercompatCheckBaseline, {
      features: ['vendorNamed', 'mixedNamed', 'zeroNamed'],
    });
    expect(result.isError).not.toBe(true);
    const rows = browsercompatCheckBaseline.output.parse(result.structuredContent).results;
    expect(rows.map((row) => row.usage_percent_excluded)).toEqual([2, 3, 3]);
    expect(rows.map((row) => row.usage_percent_prefixed)).toEqual([0, 1, 1]);
    const text = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
    expect(text.join('\n')).toContain(
      '**usage_percent_excluded:** 3%\n**usage_percent_prefixed:** 1%',
    );
  });
});

describe('#16 child-index and page boundaries', () => {
  it('indexes direct callable children in source order at several depths, ignoring structural nodes', async () => {
    expect(fixtureBcd.directChildren('api.Parent')).toEqual([
      'api.Parent.zebra',
      'api.Parent.alpha',
    ]);
    expect(fixtureBcd.directChildren('api.Parent.zebra')).toEqual(['api.Parent.zebra.grandchild']);
    expect(fixtureBcd.directChildren('api.Parent.structural')).toEqual([
      'api.Parent.structural.descendant',
    ]);
    for (const feature of ['api.Parent', 'solo']) {
      const result = await runToolContract(browsercompatGetFeature, { feature });
      expect(browsercompatGetFeature.output.parse(result.structuredContent).subkeys).toEqual({
        total: 2,
        keys: ['api.Parent.zebra', 'api.Parent.alpha'],
        truncated: false,
      });
    }
  });
  it.each([2, 3, 10000])('returns a truthful empty page at offset %i', async (subkeys_offset) => {
    const result = await runToolContract(browsercompatGetFeature, {
      feature: 'api.Parent',
      subkeys_offset,
    });
    expect(result.isError).not.toBe(true);
    expect(browsercompatGetFeature.output.parse(result.structuredContent).subkeys).toEqual({
      total: 2,
      keys: [],
      truncated: false,
    });
    expect(JSON.stringify(result.content)).toContain('No child keys on this page.');
  });
  it('returns detached page arrays so caller mutation cannot change the index or later totals', async () => {
    const first = await runToolContract(browsercompatGetFeature, { feature: 'api.Parent' });
    const page = browsercompatGetFeature.output.parse(first.structuredContent).subkeys;
    page?.keys.splice(0);
    const again = await runToolContract(browsercompatGetFeature, { feature: 'api.Parent' });
    expect(browsercompatGetFeature.output.parse(again.structuredContent).subkeys).toEqual({
      total: 2,
      keys: ['api.Parent.zebra', 'api.Parent.alpha'],
      truncated: false,
    });
  });
  it.each(['multi', 'zero', 'api.Statusless', 'miss'])('omits subkeys for %s', async (feature) => {
    const result = await runToolContract(browsercompatGetFeature, { feature });
    expect(result.structuredContent).not.toHaveProperty('subkeys');
  });
  it.each([-1, 0.5, 'ten', true])(
    'rejects invalid offset %j at the assembled schema boundary',
    async (subkeys_offset) => {
      const result = await runToolContract(browsercompatGetFeature, {
        feature: 'api.Parent',
        subkeys_offset,
      } as never);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toHaveProperty(
        'error',
        expect.objectContaining({
          code: JsonRpcErrorCode.InvalidParams,
          message: expect.stringContaining('subkeys_offset'),
        }),
      );
    },
  );
  it('keeps the declared whitespace-only reason/recovery distinct from input-length rejection', async () => {
    const result = await runToolContract(browsercompatGetFeature, {
      feature: ' ',
      subkeys_offset: 0,
    });
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.ValidationError,
        data: {
          reason: 'invalid_feature_input',
          recovery: { hint: expect.stringContaining('browsercompat_search_features') },
        },
      },
    });
    expect(JSON.stringify(result.content)).toContain('Recovery:');
    const invalid = await runToolContract(browsercompatGetFeature, {
      feature: '',
      subkeys_offset: 0,
    });
    expect(invalid.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
      },
    });
  });
});

describe('#9/#11 ingestion and unavailable metadata', () => {
  it('normalizes once, leaves plain web-features text intact, and deduplicates normalized notes', async () => {
    const result = await runToolContract(browsercompatGetFeature, { feature: 'api.Text' });
    const output = browsercompatGetFeature.output.parse(result.structuredContent);
    expect(output.description).toBe('&lt; label (https://example.test/a)');
    expect(output.support?.[0]).toMatchObject({
      verdict: 'unsupported',
      notes: ['Use setOrientation() &lt;'],
      impl_url: ['https://example.test/tracking'],
    });
    expect(output.support?.[0]).not.toHaveProperty('version_added');
    expect(JSON.stringify(result.content)).toContain('&amp;lt;');
    const plain = await runToolContract(browsercompatGetFeature, { feature: 'solo' });
    expect(plain.structuredContent).toHaveProperty('description', 'Plain <textarea> &amp;lt;');
  });
  it('renders only preview metadata on the row, with no invented release fields', async () => {
    const result = await runToolContract(browsercompatGetFeature, { feature: 'api.Preview' });
    const output = browsercompatGetFeature.output.parse(result.structuredContent);
    // The false statement's notes stay off the row; #27 lists that statement beside it.
    expect(output.support?.[0]).toEqual({
      browser_id: 'chrome',
      browser_name: 'Chrome',
      verdict: 'preview_only',
      notes: ['<input>'],
      impl_url: ['https://example.test/preview'],
      other_statements: [{ notes: ['wrong verdict'] }],
    });
    const text = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
    expect(text.join('\n')).toContain(
      [
        '- **Chrome** (chrome): preview_only',
        '  - notes: &lt;input&gt;',
        '  - impl_url: <https://example.test/preview>',
        '  - other_statements (1):',
        '    - notes wrong verdict',
      ].join('\n'),
    );
  });
});

describe('#38 grouped-token boundaries — every release a token spans is judged', () => {
  /** A leaf whose only support entry is one browser's statement or statements. */
  const leaf = (browser: string, support: unknown) => ({
    __compat: { support: { [browser]: support } },
  });
  /** A two-key web-features id judged on its feature-level release in safari_ios alone. */
  const featureLevel = (listed: string): WebFeature => ({
    ...makeFeature(['api.Removal', 'api.Throughout']),
    status: { baseline: false, support: { safari_ios: listed } },
  });

  beforeEach(async () => {
    /** BCD's own safari_ios and samsunginternet_android releases, so both endpoints resolve as in production. */
    const { default: bundled } = await import('@mdn/browser-compat-data', {
      with: { type: 'json' },
    });
    const rangeBcd = new bcdModule.BcdService({
      __meta: { version: 'fixture', timestamp: '2020-01-01' },
      browsers: {
        safari_ios: bundled.browsers.safari_ios,
        samsunginternet_android: bundled.browsers.samsunginternet_android,
      },
      api: {
        Removal: leaf('safari_ios', { version_added: '11', version_removed: '15.1' }),
        Reintroduced: leaf('samsunginternet_android', [
          { version_added: '5.4' },
          { version_added: '4.0', version_removed: '5.2' },
        ]),
        Addition: leaf('safari_ios', { version_added: '15.1' }),
        BoundedRemoval: leaf('safari_ios', { version_added: '11', version_removed: '≤15.1' }),
        BoundedReaddition: leaf('safari_ios', [
          { version_added: '≤15.2' },
          { version_added: '11', version_removed: '15.1' },
        ]),
        Throughout: leaf('safari_ios', { version_added: '11' }),
      },
    });
    const rangeBaseline = new baselineModule.BaselineService(
      { listedAt: featureLevel('15.1'), boundedAt: featureLevel('≤15.1') },
      {},
      {},
      { safari_ios: {} },
    );
    vi.spyOn(bcdModule, 'getBcdService').mockResolvedValue(rangeBcd);
    vi.spyOn(baselineModule, 'getBaselineService').mockResolvedValue(rangeBaseline);
  });

  const SPANS_15 = { agent: 'ios_saf', version_token: '15.0-15.1', bcd_browser: 'safari_ios' };
  it.each([
    {
      label: 'an exact removal inside the range fails as removed at the removal',
      feature: 'api.Removal',
      targets: 'ios_saf 15.1',
      verdict: 'fails',
      failing: [
        {
          ...SPANS_15,
          bcd_version: '15.1',
          verdict: 'removed',
          version_added: '11',
          version_removed: '15.1',
        },
      ],
      line: '  - fails on ios_saf 15.0-15.1 → safari_ios 15.1 (removed) · version_added 11 · version_removed 15.1',
    },
    {
      label: 'a removal and reintroduction inside samsung 5.0-5.4 (BCD 5.0, 5.2, 5.4) fails at 5.2',
      feature: 'api.Reintroduced',
      targets: 'samsung 5.4',
      verdict: 'fails',
      failing: [
        {
          agent: 'samsung',
          version_token: '5.0-5.4',
          bcd_browser: 'samsunginternet_android',
          bcd_version: '5.2',
          verdict: 'unsupported',
        },
      ],
      line: '  - fails on samsung 5.0-5.4 → samsunginternet_android 5.2 (unsupported)',
    },
    {
      label: 'an addition partway fails at the lower endpoint, as before',
      feature: 'api.Addition',
      targets: 'ios_saf 15.1',
      verdict: 'fails',
      failing: [{ ...SPANS_15, bcd_version: '15', verdict: 'unsupported' }],
      line: '  - fails on ios_saf 15.0-15.1 → safari_ios 15 (unsupported)',
    },
    {
      label: 'a ≤15.1 removal, unknown at 15, fails as removed at 15.1',
      feature: 'api.BoundedRemoval',
      targets: 'ios_saf 15.1',
      verdict: 'fails',
      failing: [
        {
          ...SPANS_15,
          bcd_version: '15.1',
          verdict: 'removed',
          version_added: '11',
          version_removed: '≤15.1',
        },
      ],
      line: '  - fails on ios_saf 15.0-15.1 → safari_ios 15.1 (removed) · version_added 11 · version_removed ≤15.1',
    },
    {
      label: 'support throughout clears',
      feature: 'api.Throughout',
      targets: 'ios_saf 15.1',
      verdict: 'clears',
      failing: [],
    },
    {
      label: 'feature-level: a release listed inside the range fails at the lower endpoint',
      feature: 'listedAt',
      targets: 'ios_saf 15.1',
      verdict: 'fails',
      failing: [{ ...SPANS_15, bcd_version: '15', verdict: 'before_feature_support' }],
      line: '  - fails on ios_saf 15.0-15.1 → safari_ios 15 (before_feature_support)',
    },
  ])('$label', async ({ feature, targets, verdict, failing, line }) => {
    const result = await runToolContract(browsercompatCompareSupport, {
      features: [feature],
      targets,
    });
    expect(result.isError).not.toBe(true);
    const output = browsercompatCompareSupport.output.parse(result.structuredContent);
    expect(output.results[0]).toMatchObject({ verdict, failing_total: failing.length });
    expect(output.results[0]?.failing_targets).toEqual(failing);
    expect(output.results[0]?.unchecked_targets).toEqual([]);
    expect(output.all_clear).toBe(verdict === 'clears');
    const lines = (result.content[0]?.type === 'text' ? result.content[0].text : '').split('\n');
    expect(lines.filter((text) => text.startsWith('  - fails on '))).toEqual(line ? [line] : []);
  });

  it.each([
    {
      label: 'support at 15, a removal at 15.1, and a ≤15.2 re-addition leave the target unchecked',
      feature: 'api.BoundedReaddition',
      reason: 'no_bcd_data',
    },
    {
      label: 'feature-level: a ≤15.1 release leaves the target unchecked',
      feature: 'boundedAt',
      reason: 'no_feature_level_data',
    },
  ])('$label — inconclusive, never clears', async ({ feature, reason }) => {
    const result = await runToolContract(browsercompatCompareSupport, {
      features: [feature],
      targets: 'ios_saf 15.1',
    });
    expect(result.isError).not.toBe(true);
    const output = browsercompatCompareSupport.output.parse(result.structuredContent);
    const unchecked = { agent: 'ios_saf', version_token: '15.0-15.1', reason };
    expect(output.results[0]).toMatchObject({
      verdict: 'inconclusive',
      failing_total: 0,
      evaluated_total: 0,
      unchecked_total: 1,
      unchecked_targets: [expect.objectContaining(unchecked)],
    });
    expect(output.unchecked_targets).toEqual([expect.objectContaining(unchecked)]);
    expect(output.targets_resolved).toEqual([
      { ...SPANS_15, bcd_version: '15', bcd_release_index: 22, evaluated: false },
    ]);
    expect(output.all_clear).toBe(false);
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain(`  - not evaluated on ios_saf 15.0-15.1 (${reason}, `);
    expect(text).toContain('| ios_saf 15.0-15.1 | safari_ios 15 (index 22) | no |');
  });
});
