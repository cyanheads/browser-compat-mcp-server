/**
 * @fileoverview Tests for browsercompat_get_feature — resolution outcomes,
 * status/support/limiting_browser presence rules, enrichment, errors, and
 * format() totality, verified against the real bundled datasets.
 * @module tests/tools/browsercompat-get-feature.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatGetFeature } from '@/mcp-server/tools/definitions/browsercompat-get-feature.tool.js';

async function run(input: { feature: string; resolve?: boolean; include_runtimes?: boolean }) {
  const ctx = createMockContext({ errors: browsercompatGetFeature.errors });
  const parsed = browsercompatGetFeature.input.parse(input);
  return { ctx, result: await browsercompatGetFeature.handler(parsed, ctx) };
}

describe('browsercompat_get_feature — happy path (css.selectors.has)', () => {
  it('returns the full worked-example record: found via bcd_key, Baseline, status, limiting_browser, support, links', async () => {
    const { result } = await run({ feature: 'css.selectors.has' });
    expect(result).toMatchObject({
      found: true,
      outcome: 'found',
      resolved_as: {
        input: 'css.selectors.has',
        bcd_key: 'css.selectors.has',
        baseline_id: 'has',
        resolved_via: 'bcd_key',
      },
      name: ':has()',
      baseline: { state: 'widely', since_date: '2023-12-19', high_date: '2026-06-19' },
      status: { deprecated: false, experimental: false, standard_track: true },
      limiting_browser: { browser_id: 'firefox', name: 'Firefox', version: '121' },
      mdn_url: 'https://developer.mozilla.org/docs/Web/CSS/Reference/Selectors/:has',
      spec_urls: ['https://drafts.csswg.org/selectors/#relational'],
    });
    expect(result.support).toHaveLength(13);
    const chrome = result.support?.find((row) => row.browser_id === 'chrome');
    expect(chrome).toMatchObject({ verdict: 'supported', version_added: '105' });
  });

  it('resolving via the web-features id reports resolved_via web_features_id', async () => {
    const { result } = await run({ feature: 'has' });
    expect(result.resolved_as).toMatchObject({ resolved_via: 'web_features_id' });
  });

  it('conforms to the declared output schema', async () => {
    const { result } = await run({ feature: 'css.selectors.has' });
    expect(result).toEqual(expect.schemaMatching(browsercompatGetFeature.output));
  });
});

describe('browsercompat_get_feature — miss (D7: a result, not a throw)', () => {
  it('an unresolvable feature returns found: false with guidance', async () => {
    const { result } = await run({ feature: 'nope-xyz' });
    expect(result).toEqual({
      found: false,
      outcome: 'miss',
      resolved_as: null,
      guidance: expect.stringContaining('nope-xyz'),
    });
  });

  it('a multi-target split entry names every target in guidance', async () => {
    const { result } = await run({ feature: 'text-wrap-style' });
    expect(result.found).toBe(false);
    expect(result.guidance).toContain('text-wrap, text-wrap-balance, text-wrap-pretty');
  });
});

describe('browsercompat_get_feature — no_compat_data (21 compat_features-less features)', () => {
  it('intersection-observer-v2 resolves found: true, outcome no_compat_data, empty compat_keys, and guidance', async () => {
    const { result } = await run({ feature: 'intersection-observer-v2' });
    expect(result).toMatchObject({
      found: true,
      outcome: 'no_compat_data',
      resolved_as: { bcd_key: null, baseline_id: 'intersection-observer-v2' },
      name: 'Intersection observer visibility tracking',
      baseline: { state: 'limited' },
      compat_keys: [],
    });
    expect(result.support).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.guidance).toContain('browsercompat_check_baseline');
  });
});

describe('browsercompat_get_feature — multi-key ambiguity (D26, Core Mechanics §7)', () => {
  it('grid omits leaf-only fields and returns the full compat_keys list instead', async () => {
    const { result } = await run({ feature: 'grid' });
    expect(result).toMatchObject({
      found: true,
      outcome: 'found',
      resolved_as: { bcd_key: null, baseline_id: 'grid' },
      name: 'Grid',
      baseline: { state: 'widely' },
    });
    expect(result.support).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.mdn_url).toBeUndefined();
    expect(result.spec_urls).toBeUndefined();
    expect(result.limiting_browser).toBeUndefined();
    expect(result.compat_keys?.length).toBeGreaterThan(1);
    expect(result.compat_keys).toContain('css.properties.display.grid');
    expect(result.guidance).toBeUndefined();
  });
});

describe('browsercompat_get_feature — resolver redirect (D4/D26)', () => {
  it('display-grid-lanes follows the moved redirect to grid-lanes', async () => {
    const { result } = await run({ feature: 'display-grid-lanes' });
    expect(result).toMatchObject({
      found: true,
      outcome: 'found',
      resolved_as: { bcd_key: null, baseline_id: 'grid-lanes', resolved_via: 'redirect' },
    });
  });
});

describe('browsercompat_get_feature — webextensions leaves (no status, D10)', () => {
  it('status is absent for a webextensions leaf; unknown browsers stay unknown, never unsupported', async () => {
    const { result } = await run({ feature: 'webextensions.api.action.ColorArray' });
    expect(result.found).toBe(true);
    expect(result.status).toBeUndefined();
    expect(result.baseline).toEqual({ state: 'not_mapped' });
    const ieRow = result.support?.find((row) => row.browser_id === 'ie');
    expect(ieRow?.verdict).toBe('unknown');
    const chromeRow = result.support?.find((row) => row.browser_id === 'chrome');
    expect(chromeRow).toMatchObject({ verdict: 'supported', version_added: '88' });
  });
});

describe('browsercompat_get_feature — include_runtimes', () => {
  it('excludes runtime/XR rows and notes them by default', async () => {
    const { ctx, result } = await run({ feature: 'webextensions.api.action.ColorArray' });
    const runtimeRows = result.support?.filter((row) =>
      ['bun', 'deno', 'nodejs', 'oculus'].includes(row.browser_id),
    );
    expect(runtimeRows).toEqual([]);
    expect(result.support).toHaveLength(13);
    expect(getEnrichment(ctx).runtimesExcluded).toBeUndefined();
  });

  it('includes runtime/XR rows when include_runtimes is true', async () => {
    const { result } = await run({ feature: 'css.selectors.has', include_runtimes: true });
    expect(result.support?.length).toBeGreaterThan(13);
    const runtimeIds = result.support?.map((row) => row.browser_id) ?? [];
    expect(runtimeIds).toEqual(expect.arrayContaining(['bun', 'deno', 'nodejs', 'oculus']));
  });

  it('notes runtimesExcluded when a leaf carries runtime data the caller did not ask for', async () => {
    // javascript.builtins.Array.fromAsync records bun/deno/nodejs/oculus
    // support directly, unlike css.selectors.has.
    const { ctx } = await run({ feature: 'javascript.builtins.Array.fromAsync' });
    const notice = getEnrichment(ctx).runtimesExcluded as string | undefined;
    expect(notice).toContain('bun');
    expect(notice).toContain('include_runtimes: true');
  });
});

describe('browsercompat_get_feature — Baseline not_mapped enrichment (D14)', () => {
  it('enriches baselineNotMapped when the resolved key sits outside the web-features mapping', async () => {
    const { ctx } = await run({ feature: 'webextensions.api.action.ColorArray' });
    expect(getEnrichment(ctx).baselineNotMapped).toContain('webextensions.api.action.ColorArray');
  });

  it('does not populate baselineNotMapped for a mapped key', async () => {
    const { ctx } = await run({ feature: 'css.selectors.has' });
    expect(getEnrichment(ctx).baselineNotMapped).toBeUndefined();
  });
});

describe('browsercompat_get_feature — enrichment: data_version', () => {
  it('always echoes data_version, even on a miss', async () => {
    const { ctx } = await run({ feature: 'nope-xyz' });
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.2' });
  });
});

describe('browsercompat_get_feature — resolve: true', () => {
  it('resolves an unambiguous top search hit for a punctuated alias', async () => {
    const { result } = await run({ feature: ':has()', resolve: true });
    expect(result).toMatchObject({ found: true, resolved_as: { resolved_via: 'search' } });
  });

  it('a name shared across a multi-key feature resolves through the feature, with compat_keys', async () => {
    const { result } = await run({ feature: 'Container queries', resolve: true });
    expect(result).toMatchObject({
      found: true,
      outcome: 'found',
      resolved_as: {
        input: 'Container queries',
        bcd_key: null,
        baseline_id: 'container-queries',
        resolved_via: 'search',
      },
      name: 'Container queries',
    });
    expect(result.compat_keys).toHaveLength(12);
    expect(result.support).toBeUndefined();
    const blocks = browsercompatGetFeature.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('via search');
    expect(text).toContain('css.at-rules.container');
  });

  it('a dotted notation resolves to its exact key through the path_suffix tier', async () => {
    const { result } = await run({ feature: 'Element.prototype.animate', resolve: true });
    expect(result).toMatchObject({
      found: true,
      resolved_as: { bcd_key: 'api.Element.animate', resolved_via: 'search' },
    });
    expect(result.support?.length).toBeGreaterThan(0);
  });

  it('a suffix shared by keys of two features stays a miss', async () => {
    const { result } = await run({ feature: 'referrerpolicy.unsafe-url', resolve: true });
    expect(result).toMatchObject({ found: false, outcome: 'miss', resolved_as: null });
  });

  it('is off by default — the same punctuated alias misses without resolve', async () => {
    const { result } = await run({ feature: ':has()' });
    expect(result.found).toBe(false);
  });
});

describe('browsercompat_get_feature — errors (invalid_feature_input)', () => {
  it('rejects a whitespace-only feature string via ctx.fail', async () => {
    const ctx = createMockContext({ errors: browsercompatGetFeature.errors });
    const input = browsercompatGetFeature.input.parse({ feature: ' ' });
    await expect(browsercompatGetFeature.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_feature_input' },
    });
  });

  it('rejects an empty feature string at the schema boundary (min(1))', () => {
    expect(browsercompatGetFeature.input.safeParse({ feature: '' }).success).toBe(false);
  });

  it('rejects a feature string over 200 characters at the schema boundary', () => {
    expect(browsercompatGetFeature.input.safeParse({ feature: 'a'.repeat(201) }).success).toBe(
      false,
    );
    expect(browsercompatGetFeature.input.safeParse({ feature: 'a'.repeat(200) }).success).toBe(
      true,
    );
  });
});

describe('browsercompat_get_feature — format()', () => {
  it('renders the found/outcome line, Baseline, status, limiting browser, support table, and links', async () => {
    const { result } = await run({ feature: 'css.selectors.has' });
    const blocks = browsercompatGetFeature.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('# :has()');
    expect(text).toContain('**found:** true · **outcome:** found');
    expect(text).toContain('**Baseline: widely**');
    expect(text).toContain('**Status:**');
    expect(text).toContain('**Limiting browser:** Firefox (firefox) 121');
    expect(text).toContain('## Support');
    expect(text).toContain(
      'MDN: https://developer.mozilla.org/docs/Web/CSS/Reference/Selectors/:has',
    );
    expect(text).toContain('Spec: https://drafts.csswg.org/selectors/#relational');
  });

  it('renders a status-absent line for a webextensions leaf rather than omitting the section', async () => {
    const { result } = await run({ feature: 'webextensions.api.action.ColorArray' });
    const blocks = browsercompatGetFeature.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('**Status:** not recorded for this key.');
  });

  it('renders a status-absent line naming the multi-key spread for grid', async () => {
    const { result } = await run({ feature: 'grid' });
    const blocks = browsercompatGetFeature.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain(
      '**Status:** not reported — this id spans more than one browser-compat-data key.',
    );
    expect(text).toContain('**compat_keys:**');
  });

  it('renders the empty compat_keys case with an explanatory phrase, not a bare empty list', async () => {
    const { result } = await run({ feature: 'intersection-observer-v2' });
    const blocks = browsercompatGetFeature.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('**compat_keys:** none — this entry owns no browser-compat-data keys');
    expect(text).toContain(result.guidance ?? '');
  });

  it('renders the "No match" heading and guidance on a miss', async () => {
    const { result } = await run({ feature: 'nope-xyz' });
    const blocks = browsercompatGetFeature.format?.(result);
    const text = (blocks?.[0] as { text: string } | undefined)?.text;
    expect(text).toContain('# No match');
    expect(text).toContain('**found:** false · **outcome:** miss');
    expect(text).toContain('nope-xyz');
  });
});
