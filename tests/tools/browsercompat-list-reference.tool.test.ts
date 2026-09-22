/**
 * @fileoverview Tests for browsercompat_list_reference — every topic's
 * structuredContent and format() text, verified against the real bundled
 * datasets.
 * @module tests/tools/browsercompat-list-reference.tool.test
 */

import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatListReference } from '@/mcp-server/tools/definitions/browsercompat-list-reference.tool.js';

describe('browsercompat_list_reference — bcd_namespaces', () => {
  it('returns all 12 namespaces with leaf counts', async () => {
    const ctx = createMockContext();
    const input = browsercompatListReference.input.parse({ topic: 'bcd_namespaces' });
    const result = await browsercompatListReference.handler(input, ctx);
    expect(result.topic).toBe('bcd_namespaces');
    expect(result.entries).toHaveLength(12);
    const api = result.entries.find((e) => e.id === 'api');
    expect(api).toMatchObject({ label: 'Web APIs', count: 10_265 });
    expect(api?.detail).toContain('api.');
  });

  it('format() renders a heading per entry with the count line', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'bcd_namespaces' }),
      ctx,
    );
    const blocks = browsercompatListReference.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('## api — Web APIs');
    expect(text).toContain('- count: 10265');
  });
});

describe('browsercompat_list_reference — bcd_browsers', () => {
  it('marks the 13 desktop/mobile browsers reported, the rest not', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'bcd_browsers' }),
      ctx,
    );
    expect(result.entries).toHaveLength(17);
    expect(
      result.entries
        .filter((e) => e.reported)
        .map((e) => e.id)
        .sort(),
    ).toEqual(
      [
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
      ].sort(),
    );
    const bun = result.entries.find((e) => e.id === 'bun');
    expect(bun?.reported).toBe(false);
  });
});

describe('browsercompat_list_reference — browserslist_agents', () => {
  it('reports 19 agents with bcd_browser mapping and usage_percent, and enriches attribution', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'browserslist_agents' }),
      ctx,
    );
    expect(result.entries).toHaveLength(19);
    const opMini = result.entries.find((e) => e.id === 'op_mini');
    expect(opMini).toMatchObject({ bcd_browser: null, usage_percent: 0 });
    const chrome = result.entries.find((e) => e.id === 'chrome');
    expect(chrome?.bcd_browser).toBe('chrome');
    expect(getEnrichment(ctx).attribution).toMatch(/caniuse\.com/);
  });

  it('does not populate attribution for a topic without usage figures', async () => {
    const ctx = createMockContext();
    await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'bcd_namespaces' }),
      ctx,
    );
    expect(getEnrichment(ctx).attribution).toBeUndefined();
  });
});

describe('browsercompat_list_reference — baseline_states (D28)', () => {
  it('reports the per-BCD-key split (not the per-feature split), summing to all 20,543 leaves', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'baseline_states' }),
      ctx,
    );
    expect(result.entries).toHaveLength(4);
    const counts = Object.fromEntries(result.entries.map((e) => [e.id, e.count]));
    expect(counts).toEqual({ widely: 8_746, newly: 1_256, limited: 5_480, not_mapped: 5_061 });
    const total = Object.values(counts).reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
    expect(total).toBe(20_543);
  });

  it('maps_from carries the raw web-features value, null only for not_mapped', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'baseline_states' }),
      ctx,
    );
    const byId = Object.fromEntries(result.entries.map((e) => [e.id, e.maps_from]));
    expect(byId).toEqual({ widely: 'high', newly: 'low', limited: false, not_mapped: null });
  });
});

describe('browsercompat_list_reference — groups and snapshots', () => {
  it('lists 104 groups, sorted by id', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'groups' }),
      ctx,
    );
    expect(result.entries).toHaveLength(104);
    const ids = result.entries.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('lists 11 ECMAScript snapshots with spec_url', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'snapshots' }),
      ctx,
    );
    expect(result.entries).toHaveLength(11);
    for (const entry of result.entries) {
      expect(entry.spec_url).toMatch(/^https:\/\//);
    }
  });

  it('each group detail names the search filter it feeds, on both surfaces', async () => {
    const response = await runToolContract(browsercompatListReference, { topic: 'groups' });
    const entries = (response.structuredContent as { entries: { id: string; detail: string }[] })
      .entries;
    const positioning = entries.find((entry) => entry.id === 'positioning');
    expect(positioning?.detail).toBe(
      'web-features group inside layout. Pass as group to browsercompat_search_features.',
    );
    const css = entries.find((entry) => entry.id === 'css');
    expect(css?.detail).toBe(
      'Top-level web-features group. Pass as group to browsercompat_search_features; nested groups are included.',
    );
    const text = response.content.map((block) => (block as { text: string }).text).join('\n');
    expect(text).toContain('Pass as group to browsercompat_search_features');
  });

  it('each snapshot detail names the search filter it feeds, on both surfaces', async () => {
    const response = await runToolContract(browsercompatListReference, { topic: 'snapshots' });
    const entries = (response.structuredContent as { entries: { detail: string }[] }).entries;
    for (const entry of entries) {
      expect(entry.detail).toBe(
        'ECMAScript snapshot tracked by web-features. Pass as snapshot to browsercompat_search_features.',
      );
    }
    const text = response.content.map((block) => (block as { text: string }).text).join('\n');
    expect(text).toContain('Pass as snapshot to browsercompat_search_features');
  });
});

describe('browsercompat_list_reference — enrichment', () => {
  it('always echoes data_version', async () => {
    const ctx = createMockContext();
    await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'groups' }),
      ctx,
    );
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.2' });
  });
});
