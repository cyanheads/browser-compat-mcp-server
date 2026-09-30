/**
 * @fileoverview Assembled support, lookup, and rendering regressions against the bundled data.
 * @module tests/tools/support-contracts.test
 */

import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatCheckBaseline } from '@/mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { browsercompatGetFeature } from '@/mcp-server/tools/definitions/browsercompat-get-feature.tool.js';
import { browsercompatSearchFeatures } from '@/mcp-server/tools/definitions/browsercompat-search-features.tool.js';
import { getBaselineService } from '@/services/baseline/baseline-service.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';

describe('support contract regressions', () => {
  it('#8 retains feature discouragement without inventing multi-key status', async () => {
    const result = await runToolContract(browsercompatGetFeature, { feature: 'webvr' });
    expect(result.isError).not.toBe(true);
    const advisory = (await getBaselineService()).discouraged('webvr');
    expect(advisory).toBeDefined();
    expect(result.structuredContent).toHaveProperty('discouraged', advisory);
    expect(result.structuredContent).not.toHaveProperty('status');
    const text = result.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    expect(text.match(/\*\*Discouraged:\*\*/g)).toHaveLength(1);
    for (const url of advisory?.according_to ?? []) expect(text).toContain(url);
  });

  it('#11 retains unavailable support metadata on both consumption paths', async () => {
    const result = await runToolContract(browsercompatGetFeature, {
      feature: 'api.AudioParam.automationRate',
    });
    const output = browsercompatGetFeature.output.parse(result.structuredContent);
    const row = output.support?.find((item) => item.browser_id === 'firefox');
    expect(row).toMatchObject({ verdict: 'unsupported', impl_url: ['https://bugzil.la/1504984'] });
    expect(row).not.toHaveProperty('version_added');
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('https://bugzil.la/1504984') }),
      ]),
    );
  });

  it('#13 omits parent usage from a child key and keeps sole-key/feature usage', async () => {
    const child = await runToolContract(browsercompatCheckBaseline, {
      features: ['api.AudioContext.setSinkId'],
    });
    const output = browsercompatCheckBaseline.output.parse(child.structuredContent);
    expect(output.results[0]).not.toHaveProperty('usage_percent_excluded');
    expect(output.results[0]).not.toHaveProperty('usage_source');
    expect(child.structuredContent).not.toHaveProperty('attribution');
    expect(JSON.stringify(child.content)).not.toContain('usage_percent_excluded');
    const other = await runToolContract(browsercompatCheckBaseline, {
      features: ['has', 'css.selectors.has', 'web-audio', 'intersection-observer-v2'],
    });
    const rows = browsercompatCheckBaseline.output.parse(other.structuredContent).results;
    expect(rows[0]?.usage_percent_excluded).toBe(rows[1]?.usage_percent_excluded);
    for (const row of rows) expect(row.usage_percent_excluded).toBeTypeOf('number');
    expect(other.structuredContent).toHaveProperty('attribution');
  });

  it.each(['api.CanvasRenderingContext2D.filter', 'api.Navigator.share'])(
    '#14 omits a misleading requirement for %s in both tools',
    async (feature) => {
      for (const result of [
        await runToolContract(browsercompatGetFeature, { feature }),
        await runToolContract(browsercompatCheckBaseline, { features: [feature] }),
      ]) {
        expect(result.isError).not.toBe(true);
        expect(JSON.stringify(result.structuredContent)).not.toContain('limiting_browser');
        expect(JSON.stringify(result.content)).not.toContain('Limiting browser');
      }
    },
  );

  it('#16 pages every direct callable child once, excluding grandchildren', async () => {
    const bcd = await getBcdService();
    const expected = [...bcd.entries()]
      .map(([key]) => key)
      .filter((key) => key.startsWith('api.Element.') && key.split('.').length === 3);
    expect(expected.length).toBeGreaterThan(200);
    const keys: string[] = [];
    for (let offset = 0; offset < expected.length; offset += 100) {
      const result = await runToolContract(browsercompatGetFeature, {
        feature: 'api.Element',
        subkeys_offset: offset,
      });
      const page = browsercompatGetFeature.output.parse(result.structuredContent).subkeys;
      expect(page).toBeDefined();
      if (!page) throw new Error('api.Element must expose direct children');
      expect(page.total).toBe(expected.length);
      expect(page.keys).toEqual(expected.slice(offset, offset + 100));
      expect(page.truncated).toBe(offset + 100 < expected.length);
      expect(page.next_offset).toBe(offset + 100 < expected.length ? offset + 100 : undefined);
      const text = result.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      expect(text).toContain('browsercompat_check_baseline');
      for (const key of page.keys) {
        expect(bcd.leaf(key)).toBeDefined();
        expect(text).toContain(key);
      }
      keys.push(...page.keys);
    }
    expect(keys).toEqual(expected);
  });

  it('#9 keeps literal element names plain in structured output and visible in Markdown', async () => {
    const results = [
      await runToolContract(browsercompatGetFeature, { feature: 'dialog' }),
      await runToolContract(browsercompatCheckBaseline, { features: ['dialog'] }),
      await runToolContract(browsercompatCompareSupport, {
        features: ['dialog'],
        targets: 'chrome 100',
      }),
      await runToolContract(browsercompatSearchFeatures, { query: '<dialog>', limit: 1 }),
    ];
    for (const result of results) {
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.structuredContent)).toContain('<dialog>');
      const text = result.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      expect(text).not.toContain('<dialog>');
      expect(text).toContain('&lt;dialog&gt;');
    }
  });

  it('#9 normalizes actual BCD note markup and preserves link destinations', async () => {
    const result = await runToolContract(browsercompatGetFeature, {
      feature: 'api.Animation.playState',
    });
    const output = browsercompatGetFeature.output.parse(result.structuredContent);
    const notes = output.support?.find((row) => row.browser_id === 'firefox')?.notes?.join(' ');
    expect(notes).toBeDefined();
    expect(notes).not.toMatch(/<\/?(?:code|a)\b/);
    expect(notes).toContain('https://developer.mozilla.org/docs/Web/API/Animation/pending');
    expect(JSON.stringify(result.content)).toContain(
      'https://developer.mozilla.org/docs/Web/API/Animation/pending',
    );
  });
});
