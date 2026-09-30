/**
 * @fileoverview Synthetic dataset boundaries through real services, resolver, and tool assembly.
 * @module tests/tools/support-boundaries.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browsercompatCheckBaseline } from '@/mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';
import { browsercompatGetFeature } from '@/mcp-server/tools/definitions/browsercompat-get-feature.tool.js';
import * as baselineModule from '@/services/baseline/baseline-service.js';
import type { WebFeature } from '@/services/baseline/types.js';
import * as bcdModule from '@/services/bcd/bcd-service.js';

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
      expect(row).not.toHaveProperty('usage_source');
    }
    for (const row of rows.slice(2)) {
      expect(row.usage_percent_excluded).toBeTypeOf('number');
      expect(row.usage_source).toContain('Feature-level');
    }
    expect(result.structuredContent).toHaveProperty('attribution');
    const noUsage = await runToolContract(browsercompatCheckBaseline, {
      features: ['api.Tagged', 'missing'],
    });
    expect(noUsage.structuredContent).not.toHaveProperty('attribution');
    expect(JSON.stringify(noUsage.content)).not.toContain('usage_percent_excluded');
    expect(
      browsercompatCheckBaseline.output.parse(result.structuredContent).all_widely_available,
    ).toBe(false);
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
  it.each([-1, 0.5, '100', null])(
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
  it('renders only preview metadata with no invented release fields', async () => {
    const result = await runToolContract(browsercompatGetFeature, { feature: 'api.Preview' });
    const output = browsercompatGetFeature.output.parse(result.structuredContent);
    expect(output.support?.[0]).toEqual({
      browser_id: 'chrome',
      browser_name: 'Chrome',
      verdict: 'preview_only',
      notes: ['<input>'],
      impl_url: ['https://example.test/preview'],
    });
    expect(JSON.stringify(result.content)).toContain('&lt;input&gt;');
    expect(JSON.stringify(result.content)).toContain('https://example.test/preview');
    expect(JSON.stringify(result.content)).not.toContain('wrong verdict');
  });
});
