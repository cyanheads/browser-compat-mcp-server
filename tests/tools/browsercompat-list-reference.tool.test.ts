/**
 * @fileoverview Tests for browsercompat_list_reference — every topic's
 * structuredContent and format() text, verified against the real bundled
 * datasets.
 * @module tests/tools/browsercompat-list-reference.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
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
    expect(api).toMatchObject({ label: 'Web APIs', count: 10_251 });
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
    expect(text).toContain('- count: 10251');
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
  it('reports the per-BCD-key split (not the per-feature split), summing to all 20,517 leaves', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'baseline_states' }),
      ctx,
    );
    expect(result.entries).toHaveLength(4);
    const counts = Object.fromEntries(result.entries.map((e) => [e.id, e.count]));
    expect(counts).toEqual({ widely: 8_739, newly: 1_244, limited: 5_309, not_mapped: 5_225 });
    const total = Object.values(counts).reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
    expect(total).toBe(20_517);
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
  it('lists 103 groups, sorted by id', async () => {
    const ctx = createMockContext();
    const result = await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'groups' }),
      ctx,
    );
    expect(result.entries).toHaveLength(103);
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
});

describe('browsercompat_list_reference — enrichment', () => {
  it('always echoes data_version', async () => {
    const ctx = createMockContext();
    await browsercompatListReference.handler(
      browsercompatListReference.input.parse({ topic: 'groups' }),
      ctx,
    );
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.1' });
  });
});
