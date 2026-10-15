/**
 * @fileoverview Tests for browsercompat_get_feature — resolution outcomes,
 * status/support/limiting_browser presence rules, enrichment, errors, and
 * format() totality, verified against the real bundled datasets.
 * @module tests/tools/browsercompat-get-feature.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatGetFeature } from '@/mcp-server/tools/definitions/browsercompat-get-feature.tool.js';
import { formatFeatureSupportRow } from '@/mcp-server/tools/definitions/compat-shapes.js';
import { getBaselineService } from '@/services/baseline/baseline-service.js';

/** Every text block of an assembled result, joined. */
function textOf(result: Awaited<ReturnType<typeof runToolContract>>): string {
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

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

describe('browsercompat_get_feature — multi-key ids (D26 as amended by D53, Core Mechanics §7)', () => {
  it('grid omits per-key fields, keeps compat_keys, and reports web-features’ feature-level support', async () => {
    const { result } = await run({ feature: 'grid' });
    expect(result).toMatchObject({
      found: true,
      outcome: 'found',
      resolved_as: { bcd_key: null, baseline_id: 'grid' },
      name: 'Grid',
      baseline: { state: 'widely' },
      limiting_browser: { browser_id: 'edge', name: 'Edge', version: '16' },
    });
    expect(result.limiting_browser).not.toHaveProperty('version_is_upper_bound');
    const baseline = await getBaselineService();
    expect(result.feature_support).toHaveLength(7);
    expect(result.feature_support).toStrictEqual(baseline.featureSupportRows('grid'));
    expect(result.support).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.mdn_url).toBeUndefined();
    expect(result.spec_urls).toBeUndefined();
    expect(result.compat_keys).toHaveLength(61);
    expect(result.compat_keys_total).toBe(61);
    expect(result).not.toHaveProperty('compat_keys_next_offset');
    expect(result.compat_keys).toContain('css.properties.display.grid');
    expect(result.guidance).toBeUndefined();
  });

  it('single-key and zero-key resolutions carry no feature_support', async () => {
    for (const feature of ['has', 'css.selectors.has', 'http2', 'intersection-observer-v2']) {
      const { result } = await run({ feature });
      expect(result.found).toBe(true);
      expect(result).not.toHaveProperty('feature_support');
    }
    // A zero-key id gets no feature-level limiting browser either, though web-features lists all seven.
    expect((await run({ feature: 'http2' })).result).not.toHaveProperty('limiting_browser');
  });

  it('pins feature_support and the feature-level limiting browser through the production parse, on both surfaces', async () => {
    const result = await runToolContract(browsercompatGetFeature, { feature: 'paint-order' });
    expect(result.isError).not.toBe(true);
    const output = browsercompatGetFeature.output.parse(result.structuredContent);
    const rows = (await getBaselineService()).featureSupportRows('paint-order');
    // paint-order lists ≤ bounds, so the parse must keep version_is_upper_bound.
    expect(rows?.some((row) => row.version_is_upper_bound === true)).toBe(true);
    expect(output.feature_support).toStrictEqual(rows);
    expect(output.limiting_browser).toEqual({ browser_id: 'edge', name: 'Edge', version: '123' });
    const text = textOf(result);
    expect(text).toContain(
      [
        '## Feature-level support (web-features, Baseline core browsers)',
        'web-features’ release for the feature as a whole, not for any one key — a key in compat_keys can differ either way. Call browsercompat_get_feature with one of compat_keys for a key-level answer.',
        ...(rows ?? []).map(formatFeatureSupportRow),
        '',
        '**compat_keys:** ',
      ].join('\n'),
    );
    expect(text.split('\n')).toContain(
      '**Limiting browser:** Edge (edge) 123 — web-features lists every core browser for the feature as a whole',
    );
    // display-contents lists no core browser: rows render, and no limiting browser on either surface.
    const contents = await runToolContract(browsercompatGetFeature, {
      feature: 'display-contents',
    });
    expect(contents.structuredContent).not.toHaveProperty('limiting_browser');
    expect(textOf(contents)).toContain('- **chrome**: supported false\n');
    expect(textOf(contents)).not.toContain('**Limiting browser:**');
  });
});

describe('browsercompat_get_feature — limiting_browser upper bound (#30)', () => {
  it('a key whose limiting release is ≤ keeps the bound on both surfaces', async () => {
    const result = await runToolContract(browsercompatGetFeature, { feature: 'api.FileSystem' });
    const output = browsercompatGetFeature.output.parse(result.structuredContent);
    expect(output.limiting_browser).toEqual({
      browser_id: 'edge',
      name: 'Edge',
      version: '18',
      version_is_upper_bound: true,
    });
    expect(textOf(result)).toContain(
      '**Limiting browser:** Edge (edge) 18 · version_is_upper_bound true — full support in every core browser',
    );
  });

  it('a multi-key id whose feature-level limiting release is ≤ keeps the bound', async () => {
    const result = await runToolContract(browsercompatGetFeature, { feature: 'output' });
    expect(browsercompatGetFeature.output.parse(result.structuredContent).limiting_browser).toEqual(
      { browser_id: 'edge', name: 'Edge', version: '18', version_is_upper_bound: true },
    );
    expect(textOf(result).split('\n')).toContain(
      '**Limiting browser:** Edge (edge) 18 · version_is_upper_bound true — web-features lists every core browser for the feature as a whole',
    );
  });

  it('an exact limiting release carries no flag and renders none', async () => {
    const result = await runToolContract(browsercompatGetFeature, { feature: 'css.selectors.has' });
    expect(
      browsercompatGetFeature.output.parse(result.structuredContent).limiting_browser,
    ).not.toHaveProperty('version_is_upper_bound');
    expect(textOf(result)).not.toContain('version_is_upper_bound');
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
    expect(getEnrichment(ctx).data_version).toMatchObject({ bcd: '8.1.5' });
  });
});

describe('browsercompat_get_feature — resolve: true', () => {
  it('resolves an unambiguous top search hit for a punctuated alias', async () => {
    const { result } = await run({ feature: ':has()', resolve: true });
    expect(result).toMatchObject({ found: true, resolved_as: { resolved_via: 'search' } });
  });

  it('a name shared across a multi-key feature resolves through the feature, with compat_keys', async () => {
    const { result } = await run({ feature: 'Container queries (size)', resolve: true });
    expect(result).toMatchObject({
      found: true,
      outcome: 'found',
      resolved_as: {
        input: 'Container queries (size)',
        bcd_key: null,
        baseline_id: 'container-queries',
        resolved_via: 'search',
      },
      name: 'Container queries (size)',
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
      'MDN: <https://developer.mozilla.org/docs/Web/CSS/Reference/Selectors/:has>',
    );
    expect(text).toContain('Spec: <https://drafts.csswg.org/selectors/#relational>');
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
    expect(result.guidance).toContain('browsercompat_check_baseline');
    expect(text).toContain(result.guidance);
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

describe('browsercompat_get_feature — compat_keys paging (#25)', () => {
  const page = async (feature: string, compat_keys_offset?: number) => {
    const result = await runToolContract(browsercompatGetFeature, {
      feature,
      ...(compat_keys_offset === undefined ? {} : { compat_keys_offset }),
    });
    expect(result.isError).not.toBe(true);
    return {
      result,
      output: browsercompatGetFeature.output.parse(result.structuredContent),
      text: textOf(result),
    };
  };

  it('svg returns the first 100 of 614 keys with a continuation, on both surfaces', async () => {
    const { output, text } = await page('svg');
    expect(output.compat_keys).toEqual(
      (await getBaselineService()).compatKeys('svg').slice(0, 100),
    );
    expect(output.compat_keys_total).toBe(614);
    expect(output.compat_keys_next_offset).toBe(100);
    expect(text).toContain('**compat_keys:** 100 of 614: ');
    expect(text).toContain('compat_keys_next_offset: 100 — re-run with compat_keys_offset: 100.');
  });

  it('compat_keys_offset 600 returns the last 14 svg keys, in declaration order, and ends the list', async () => {
    const tail = (await getBaselineService()).compatKeys('svg').slice(600);
    expect(tail).toHaveLength(14);
    const { output, result, text } = await page('svg', 600);
    expect(output.compat_keys).toEqual(tail);
    expect(output.compat_keys_total).toBe(614);
    expect(result.structuredContent).not.toHaveProperty('compat_keys_next_offset');
    expect(text.split('\n')).toContain(`**compat_keys:** 14 of 614: ${tail.join(', ')}`);
  });

  it('an offset at or past the end returns no keys, the true total, and no continuation', async () => {
    for (const offset of [614, 5000]) {
      const { output, result, text } = await page('svg', offset);
      expect(output.compat_keys).toEqual([]);
      expect(output.compat_keys_total).toBe(614);
      expect(result.structuredContent).not.toHaveProperty('compat_keys_next_offset');
      expect(text).toContain('**compat_keys:** 0 of 614 on this page');
      expect(text).not.toContain('compat_keys_next_offset');
    }
  });

  it('a zero-key id returns an empty list with total 0 at any offset', async () => {
    for (const offset of [undefined, 5]) {
      const { output, result } = await page('http2', offset);
      expect(output.compat_keys).toEqual([]);
      expect(output.compat_keys_total).toBe(0);
      expect(result.structuredContent).not.toHaveProperty('compat_keys_next_offset');
    }
  });

  it('single-key and BCD-key resolutions carry no compat_keys fields, and the offset leaves them unchanged', async () => {
    for (const feature of ['has', 'css.selectors.has']) {
      const plain = await page(feature);
      expect(plain.result.structuredContent).not.toHaveProperty('compat_keys');
      expect(plain.result.structuredContent).not.toHaveProperty('compat_keys_total');
      expect(plain.result.structuredContent).not.toHaveProperty('compat_keys_next_offset');
      const offset = await page(feature, 50);
      expect(offset.result.structuredContent).toEqual(plain.result.structuredContent);
      expect(offset.text).toBe(plain.text);
    }
  });

  it('svg serializes to at most 10,000 bytes', async () => {
    const { result } = await page('svg');
    const bytes = Buffer.byteLength(
      JSON.stringify({ content: result.content, structuredContent: result.structuredContent }),
    );
    expect(bytes).toBeLessThanOrEqual(10_000);
  });

  it('defaults compat_keys_offset to 0 and rejects a negative or non-integer offset', () => {
    expect(browsercompatGetFeature.input.parse({ feature: 'svg' }).compat_keys_offset).toBe(0);
    for (const compat_keys_offset of [-1, 1.5]) {
      expect(
        browsercompatGetFeature.input.safeParse({ feature: 'svg', compat_keys_offset }).success,
      ).toBe(false);
    }
  });
});

describe('browsercompat_get_feature — other_statements (#27)', () => {
  async function contract(feature: string) {
    const result = await runToolContract(browsercompatGetFeature, { feature });
    expect(result.isError).not.toBe(true);
    return {
      result,
      output: browsercompatGetFeature.output.parse(result.structuredContent),
      text: textOf(result),
    };
  }

  it('backdrop-filter: the safari row keeps its fields and lists the -webkit- statement, on both surfaces', async () => {
    const { output, text } = await contract('css.properties.backdrop-filter');
    expect(output.support?.find((row) => row.browser_id === 'safari')).toEqual({
      browser_id: 'safari',
      browser_name: 'Safari',
      verdict: 'supported',
      version_added: '18',
      other_statements: [{ version_added: '9', prefix: '-webkit-' }],
    });
    expect(text).toContain(
      '- **Safari** (safari): supported\n  - version_added: 18\n  - other_statements (1):\n    - version_added 9 · prefix -webkit-',
    );
  });

  it('api.Document.visibilitychange_event, the heaviest list, still parses and renders all 24 statements', async () => {
    const { output, text } = await contract('api.Document.visibilitychange_event');
    const listed = (output.support ?? []).flatMap((row) => row.other_statements ?? []);
    expect(listed).toHaveLength(24);
    expect(text.match(/^ {4}- /gm)).toHaveLength(24);
  });
});
