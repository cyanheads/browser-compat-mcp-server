/**
 * @fileoverview Assembled-result contract for browsercompat_compare_support:
 * every case runs the real handler, `format()`, and the enrichment trailer
 * through `runToolContract` against the bundled datasets, and asserts on both
 * `structuredContent` and the whole `content[]`.
 * @module tests/tools/browsercompat-compare-support.contract.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { getTargetsService } from '@/services/targets/targets-service.js';

type CompareInput = Parameters<typeof runToolContract<typeof browsercompatCompareSupport>>[1];

/** Every text block of a result, in order: `format()` first, the trailer last. */
function texts(result: Awaited<ReturnType<typeof runToolContract>>): string[] {
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
}

const tokenOf = (row: { agent: string; version_token: string }) =>
  `${row.agent} ${row.version_token}`;

async function call(input: CompareInput) {
  const result = await runToolContract(browsercompatCompareSupport, input);
  expect(result.isError).not.toBe(true);
  return {
    result,
    output: browsercompatCompareSupport.output.parse(result.structuredContent),
    structured: result.structuredContent as Record<string, unknown>,
    text: texts(result),
  };
}

describe('characterization — behavior the paging and coverage changes must preserve', () => {
  it('a query that fits one page returns every target row on both surfaces, in query order', async () => {
    const { output, text } = await call({
      features: ['css.selectors.has', 'javascript.builtins.Array.fromAsync'],
      targets: 'chrome 120, chrome 109, firefox 140',
    });

    expect(output.query_echo).toBe('chrome 120, chrome 109, firefox 140');
    expect(output.targets_resolved.map(tokenOf)).toEqual([
      'chrome 120',
      'chrome 109',
      'firefox 140',
    ]);
    expect(output.targets_resolved[2]).toMatchObject({
      agent: 'firefox',
      version_token: '140',
      bcd_browser: 'firefox',
      bcd_version: '140',
      bcd_release_index: 142,
    });
    expect(output.unchecked_targets).toEqual([]);
    expect(output.results.map((item) => item.verdict)).toEqual(['clears', 'fails']);
    expect(output.results[1]?.failing_targets).toEqual([
      {
        agent: 'chrome',
        version_token: '120',
        bcd_browser: 'chrome',
        bcd_version: '120',
        verdict: 'unsupported',
      },
      {
        agent: 'chrome',
        version_token: '109',
        bcd_browser: 'chrome',
        bcd_version: '109',
        verdict: 'unsupported',
      },
    ]);
    expect(output.all_clear).toBe(false);

    const targets = await getTargetsService();
    expect(output.target_coverage_percent).toBe(
      targets.coverage(['chrome 120', 'chrome 109', 'firefox 140']),
    );
    expect(output.unchecked_coverage_percent).toBe(0);

    expect(text).toHaveLength(2);
    expect(text[0]).toContain('**clears** :has() (input css.selectors.has, found true)');
    expect(text[0]).toContain('  - fails on chrome 120 → chrome 120 (unsupported)');
    expect(text[0]).toContain('  - fails on chrome 109 → chrome 109 (unsupported)');
    expect(text[0]).toContain('| firefox 140 | firefox 140 (index 142) |');
    expect(text[1]).toContain('**Data:** browser-compat-data');
    expect(text[1]).toContain('**Usage data:** Usage data from caniuse.com');
    expect(text[1]).not.toContain('**Not evaluated:**');
  });

  it('returns one result per entry in input order, duplicates kept, and clears only a fully evaluated query', async () => {
    const { output } = await call({
      features: Array.from({ length: 20 }, () => 'css.selectors.has'),
      targets: 'chrome 120',
    });
    expect(output.results).toHaveLength(20);
    expect(new Set(output.results.map((item) => item.verdict))).toEqual(new Set(['clears']));
    expect(output.all_clear).toBe(true);
  });

  it('echoes a padded entry as sent, resolves it trimmed, and trims the query echo', async () => {
    const { output } = await call({ features: [' css.selectors.has '], targets: ' chrome 120 ' });
    expect(output.query_echo).toBe('chrome 120');
    expect(output.results[0]).toMatchObject({
      input: ' css.selectors.has ',
      found: true,
      verdict: 'clears',
      resolved_as: { bcd_key: 'css.selectors.has' },
    });
  });

  it('a browser the leaf records nothing for is reported as unchecked on both surfaces, never as a failure', async () => {
    const { output, text } = await call({
      features: ['webextensions.api.action.ColorArray'],
      targets: 'ie 11, chrome 88',
    });
    expect(output.results[0]).toMatchObject({ verdict: 'inconclusive', failing_targets: [] });
    expect(output.unchecked_targets).toEqual([
      { agent: 'ie', version_token: '11', reason: 'no_bcd_data', usage_percent: 0.2358 },
    ]);
    expect(output.all_clear).toBe(false);
    expect(text[0]).toContain('| ie 11 | no_bcd_data | 0.2358% |');
    expect(text[0]).not.toContain('fails on ie 11');
    expect(text[1]).toContain('**Not evaluated:**');
  });

  it('a miss and an ambiguous id keep their verdicts and guidance beside a compared feature', async () => {
    const { output, text } = await call({
      features: ['nope-xyz', 'grid', 'css.selectors.has'],
      targets: 'chrome 120',
    });
    expect(output.results.map((item) => item.verdict)).toEqual(['miss', 'ambiguous', 'clears']);
    expect(output.results[0]).toMatchObject({ found: false, resolved_as: null });
    expect(output.results[1]?.compat_keys?.length).toBeGreaterThan(1);
    expect(output.all_clear).toBe(false);
    expect(text[0]).toContain('**miss** nope-xyz');
    expect(text[0]).toContain('**ambiguous** Grid');
    expect(text[0]).toContain('compat_keys: ');
  });
});

describe('characterization — declared errors and schema bounds through the assembled result', () => {
  it.each([
    {
      name: 'invalid_target_query',
      input: { features: ['has'], targets: 'Xyz 1' },
      message: 'Unknown browser Xyz',
      hint: 'browsercompat_list_reference with topic browserslist_agents',
    },
    {
      name: 'invalid_target_query',
      input: { features: ['has'], targets: 'not dead' },
      message: 'before `not dead`',
      hint: '"defaults, not dead" rather than "not dead"',
    },
    {
      name: 'no_targets_resolved',
      input: { features: ['has'], targets: '> 100%' },
      message: '"> 100%" matched no browser versions at all.',
      hint: 'Widen the targets query',
    },
    {
      name: 'no_targets_resolved',
      input: { features: ['has'], targets: 'op_mini all' },
      message: 'no browser-compat-data counterpart: op_mini',
      hint: 'Widen the targets query',
    },
    {
      name: 'invalid_feature_input',
      input: { features: ['has', ' '], targets: 'chrome 120' },
      message: 'whitespace-only',
      hint: 'Replace the whitespace-only entry',
    },
  ])('$name: $input.targets', async ({ name, input, message, hint }) => {
    const result = await runToolContract(browsercompatCompareSupport, input);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.ValidationError,
        message: expect.stringContaining(message),
        data: { reason: name, recovery: { hint: expect.stringContaining(hint) } },
      },
    });
    const text = texts(result).join('\n');
    expect(text).toContain(message);
    expect(text).toContain(hint);
    expect(text).toContain(`(reason ${name})`);
  });

  it.each([
    {
      label: 'an empty targets string',
      input: { features: ['has'], targets: '' },
      field: 'targets',
    },
    {
      label: 'a 501-character targets string',
      input: { features: ['has'], targets: 'a'.repeat(501) },
      field: 'targets',
    },
    {
      label: 'an empty features array',
      input: { features: [], targets: 'defaults' },
      field: 'features',
    },
    {
      label: '21 features',
      input: { features: Array.from({ length: 21 }, () => 'has'), targets: 'defaults' },
      field: 'features',
    },
    {
      label: 'a 201-character entry',
      input: { features: ['a'.repeat(201)], targets: 'defaults' },
      field: 'features',
    },
  ])('rejects $label against the input schema, naming the field', async ({ input, field }) => {
    const result = await runToolContract(browsercompatCompareSupport, input);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams },
    });
    expect(texts(result).join('\n')).toContain(field);
  });
});

const FOUR_TOKENS = 'chrome 120, chrome 109, firefox 140, op_mini all';
const DEFAULTS_FEATURES = [
  'css.selectors.has',
  'javascript.builtins.Array.fromAsync',
  'css.properties.anchor-name',
];

/** The query tokens one page carries, recovered from its two whole-query row lists. */
function pageTokens(output: Awaited<ReturnType<typeof call>>['output']): string[] {
  return [...output.targets_resolved.map(tokenOf), ...output.unchecked_targets.map(tokenOf)];
}

/** Everything that must not change from one page of a query to the next. */
function wholeQuery({ output, structured }: Awaited<ReturnType<typeof call>>) {
  return {
    query_echo: output.query_echo,
    all_clear: output.all_clear,
    target_coverage_percent: output.target_coverage_percent,
    unchecked_coverage_percent: output.unchecked_coverage_percent,
    targets_resolved_total: output.targets_resolved_total,
    unchecked_targets_total: output.unchecked_targets_total,
    evaluated_targets_total: output.evaluated_targets_total,
    comparable_features: output.comparable_features,
    results: output.results.map(
      ({ failing_targets: _failing, unchecked_targets: _unchecked, ...rest }) => rest,
    ),
    totalCount: structured.totalCount,
    cap: structured.cap,
    uncheckedNotice: structured.uncheckedNotice,
    data_version: structured.data_version,
    attribution: structured.attribution,
  };
}

/** Follow `nextOffset` from the first page to the last, re-parsing every continuation. */
async function walk(features: string[], targets: string, target_limit: number) {
  const pages: (Awaited<ReturnType<typeof call>> & { offset: number })[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const input = browsercompatCompareSupport.input.parse({
      features,
      targets,
      target_offset: offset,
      target_limit,
    });
    expect(input.target_offset).toBe(offset);
    const page = await call(input);
    pages.push({ ...page, offset });
    expect(pages.length).toBeLessThanOrEqual(100);
    offset = page.structured.nextOffset as number | undefined;
  }
  return pages;
}

describe('#7 — coverage counts only the targets that were evaluated', () => {
  it('mixed results keep their own coverage and reasons, and the headline is their intersection', async () => {
    const { output, structured, text } = await call({
      features: ['css.selectors.has', 'webextensions.api.action.enable'],
      targets: 'defaults',
    });

    expect(output.results[0]).toMatchObject({
      verdict: 'inconclusive',
      failing_total: 0,
      evaluated_total: 30,
      evaluated_coverage_percent: 84.1977,
      unchecked_total: 5,
      unchecked_coverage_percent: 0.7324,
    });
    expect(output.results[1]).toMatchObject({
      verdict: 'inconclusive',
      failing_total: 0,
      evaluated_total: 25,
      evaluated_coverage_percent: 38.0171,
      unchecked_total: 10,
      unchecked_coverage_percent: 46.913,
    });

    expect(output).toMatchObject({
      comparable_features: 2,
      targets_resolved_total: 30,
      evaluated_targets_total: 25,
      unchecked_targets_total: 10,
      target_coverage_percent: 38.0171,
      unchecked_coverage_percent: 46.913,
      all_clear: false,
    });
    expect(structured.totalCount).toBe(35);

    // First page of ten: and_chr 152 and android 152 lack data for the extension key only.
    expect(output.results[0]?.unchecked_targets).toEqual([
      { agent: 'and_qq', version_token: '14.9', reason: 'no_bcd_browser', usage_percent: 0.0915 },
      { agent: 'and_uc', version_token: '15.5', reason: 'no_bcd_browser', usage_percent: 0.6358 },
    ]);
    expect(
      output.results[1]?.unchecked_targets?.map((row) => `${tokenOf(row)} ${row.reason}`),
    ).toEqual([
      'and_chr 152 no_bcd_data',
      'and_qq 14.9 no_bcd_browser',
      'and_uc 15.5 no_bcd_browser',
      'android 152 no_bcd_data',
    ]);
    expect(output.unchecked_targets.map((row) => `${tokenOf(row)} ${row.reason}`)).toEqual([
      'and_chr 152 no_bcd_data',
      'and_qq 14.9 no_bcd_browser',
      'and_uc 15.5 no_bcd_browser',
      'android 152 no_bcd_data',
    ]);
    expect(output.targets_resolved.filter((row) => !row.evaluated).map(tokenOf)).toEqual([
      'and_chr 152',
      'android 152',
    ]);

    expect(text[0]).toContain(
      'Evaluated for every compared feature: 25 of 35 target versions (38.0171% of tracked traffic) · not evaluated: 10 (46.913%)',
    );
    expect(text[0]).toContain(
      '  - evaluated on 30 of 35 target versions (84.1977% of tracked traffic) · failing 0 · not evaluated 5 (0.7324%)',
    );
    expect(text[0]).toContain(
      '  - evaluated on 25 of 35 target versions (38.0171% of tracked traffic) · failing 0 · not evaluated 10 (46.913%)',
    );
    expect(text[0]).toContain('  - not evaluated on and_chr 152 (no_bcd_data, 44.0186% usage)');
    expect(text[0]).toContain('| and_chr 152 | chrome_android 152 (index');
    expect(text[0]).toContain('| and_chr 152 | no_bcd_data | 44.0186% |');
    expect(text[1]).toContain('**Not evaluated:** 10 of 35 target versions');
  });

  it('token sets are deduplicated and disjoint per result and in the aggregate, on every page', async () => {
    const targets = await getTargetsService();
    const tokens = targets.queryTokens('defaults');
    const pages = await walk(
      [
        'css.selectors.has',
        'webextensions.api.action.enable',
        'javascript.builtins.Array.fromAsync',
      ],
      'defaults',
      10,
    );

    const evaluated = pages.flatMap((page) =>
      page.output.targets_resolved.filter((row) => row.evaluated).map(tokenOf),
    );
    const unchecked = pages.flatMap((page) => page.output.unchecked_targets.map(tokenOf));
    expect(new Set(evaluated).size).toBe(evaluated.length);
    expect(new Set(unchecked).size).toBe(unchecked.length);
    expect(evaluated.filter((token) => unchecked.includes(token))).toEqual([]);
    expect([...evaluated, ...unchecked].sort()).toEqual([...tokens].sort());
    expect(evaluated).toHaveLength(pages[0]?.output.evaluated_targets_total ?? -1);
    expect(unchecked).toHaveLength(pages[0]?.output.unchecked_targets_total ?? -1);

    for (const index of [0, 1, 2]) {
      const failing = pages.flatMap(
        (page) => page.output.results[index]?.failing_targets.map(tokenOf) ?? [],
      );
      const skipped = pages.flatMap(
        (page) => page.output.results[index]?.unchecked_targets?.map(tokenOf) ?? [],
      );
      const summary = pages[0]?.output.results[index];
      expect(new Set(failing).size).toBe(failing.length);
      expect(new Set(skipped).size).toBe(skipped.length);
      expect(failing.filter((token) => skipped.includes(token))).toEqual([]);
      expect(failing).toHaveLength(summary?.failing_total ?? -1);
      expect(skipped).toHaveLength(summary?.unchecked_total ?? -1);
      expect((summary?.evaluated_total ?? 0) + (summary?.unchecked_total ?? 0)).toBe(tokens.length);
      // A mapped target with no data for this feature never enters its evaluated coverage.
      expect(summary?.evaluated_coverage_percent).toBe(
        targets.coverage(tokens.filter((token) => !skipped.includes(token))),
      );
    }
    expect(pages[0]?.output.results[2]).toMatchObject({ verdict: 'fails', failing_total: 3 });
  });

  it('an unevaluated target beside a supported one is inconclusive, never clears', async () => {
    const { output, text } = await call({
      features: ['css.selectors.has'],
      targets: 'chrome 120, safari TP',
    });
    expect(output.results[0]).toMatchObject({
      verdict: 'inconclusive',
      failing_targets: [],
      failing_total: 0,
      evaluated_total: 1,
      unchecked_total: 1,
    });
    expect(output.results[0]?.unchecked_targets).toEqual([
      expect.objectContaining({ agent: 'safari', version_token: 'TP', reason: 'unknown_version' }),
    ]);
    expect(output.all_clear).toBe(false);
    expect(output.target_coverage_percent).toBe(
      (await getTargetsService()).coverage(['chrome 120']),
    );
    expect(text[0]).toContain('# 0 of 1 features clears `chrome 120, safari TP`');
    expect(text[0]).toContain('**inconclusive** :has()');
    expect(text[0]).toContain('| safari TP | unknown_version |');
    expect(text[0]).toContain('  - not evaluated on safari TP (unknown_version, ');
  });

  it('safari TP alone stays an ordinary response with nothing evaluated', async () => {
    const { output, structured } = await call({ features: ['has'], targets: 'safari TP' });
    expect(output).toMatchObject({
      comparable_features: 1,
      targets_resolved: [],
      targets_resolved_total: 0,
      evaluated_targets_total: 0,
      unchecked_targets_total: 1,
      target_coverage_percent: 0,
      all_clear: false,
    });
    expect(output.results[0]).toMatchObject({ verdict: 'inconclusive', evaluated_total: 0 });
    expect(structured).toMatchObject({ totalCount: 1, shown: 1, cap: 10, truncated: false });
  });

  it('with no comparable feature nothing is evaluated, and both surfaces say so', async () => {
    const targets = await getTargetsService();
    const { output, structured, text } = await call({
      features: ['nope-xyz', 'grid'],
      targets: 'chrome 120, firefox 140',
    });
    expect(output.results.map((item) => item.verdict)).toEqual(['miss', 'ambiguous']);
    for (const item of output.results) {
      expect(item.failing_targets).toEqual([]);
      expect(item).not.toHaveProperty('evaluated_total');
      expect(item).not.toHaveProperty('unchecked_targets');
    }
    expect(output).toMatchObject({
      comparable_features: 0,
      targets_resolved_total: 2,
      evaluated_targets_total: 0,
      unchecked_targets_total: 2,
      target_coverage_percent: 0,
      unchecked_coverage_percent: targets.coverage(['chrome 120', 'firefox 140']),
      all_clear: false,
    });
    expect(output.targets_resolved.map((row) => row.evaluated)).toEqual([false, false]);
    expect(output.unchecked_targets.map((row) => `${tokenOf(row)} ${row.reason}`)).toEqual([
      'chrome 120 no_comparable_feature',
      'firefox 140 no_comparable_feature',
    ]);
    expect(text[0]).toContain('No feature was comparable, so no target version was evaluated.');
    expect(text[0]).toContain('| chrome 120 | no_comparable_feature |');
    expect(text[0]).toContain('| chrome 120 | chrome 120 (index 118) | no |');
    expect(structured.uncheckedNotice).toContain('No feature was comparable');
    expect(text[1]).toContain('**Not evaluated:** No feature was comparable');
  });
});

describe('#6 — target rows are paged, whole-query answers are not', () => {
  it.each([10, 5, 7])(
    'a walk on defaults at target_limit %i reaches each of the 35 tokens exactly once',
    async (limit) => {
      const tokens = (await getTargetsService()).queryTokens('defaults');
      expect(tokens).toHaveLength(35);
      const pages = await walk(DEFAULTS_FEATURES, 'defaults', limit);

      expect(pages).toHaveLength(Math.ceil(35 / limit));
      const seen: string[] = [];
      for (const page of pages) {
        const expected = tokens.slice(page.offset, page.offset + limit);
        expect([...pageTokens(page.output)].sort()).toEqual([...expected].sort());
        // Each row list keeps query order on its own.
        for (const rows of [page.output.targets_resolved, page.output.unchecked_targets]) {
          const indexes = rows.map((row) => tokens.indexOf(tokenOf(row)));
          expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
        }
        const remaining = page.offset + expected.length < 35;
        expect(page.structured).toMatchObject({
          totalCount: 35,
          shown: expected.length,
          cap: limit,
          truncated: remaining,
        });
        expect(page.structured.nextOffset).toBe(
          remaining ? page.offset + expected.length : undefined,
        );
        seen.push(...pageTokens(page.output));
      }
      expect([...seen].sort()).toEqual([...tokens].sort());
      expect(new Set(seen).size).toBe(35);
    },
  );

  it('whole-query verdicts, coverage, totals, and notices are identical on every page', async () => {
    const pages = await walk(DEFAULTS_FEATURES, 'defaults', 10);
    const first = wholeQuery(pages[0] as (typeof pages)[number]);
    expect(first).toMatchObject({
      all_clear: false,
      target_coverage_percent: 84.1977,
      unchecked_coverage_percent: 0.7324,
      targets_resolved_total: 30,
      unchecked_targets_total: 5,
      evaluated_targets_total: 30,
      comparable_features: 3,
      totalCount: 35,
      cap: 10,
    });
    expect(first.results.map((item) => item.verdict)).toEqual(['inconclusive', 'fails', 'fails']);
    expect(first.results.map((item) => item.failing_total)).toEqual([0, 3, 5]);
    for (const page of pages) expect(wholeQuery(page)).toEqual(first);
  });

  it('a failure that falls on page 2 still sets the verdict on page 1, on both surfaces', async () => {
    const [first, second, third] = await walk(
      ['javascript.builtins.Array.fromAsync'],
      'defaults',
      10,
    );
    expect(first?.output.results[0]).toMatchObject({
      verdict: 'fails',
      failing_total: 3,
      failing_targets: [],
    });
    expect(first?.output.all_clear).toBe(false);
    expect(first?.text[0]).toContain('**fails** Array.fromAsync()');
    expect(first?.text[0]).toContain('failing 3');
    expect(first?.text[0]).toContain('  - on this page: 0 of 3 failing, 2 of 5 not evaluated');
    expect(first?.text[0]).not.toContain('fails on');

    expect(second?.output.results[0]?.failing_targets.map(tokenOf)).toEqual([
      'chrome 120',
      'chrome 109',
    ]);
    expect(second?.text[0]).toContain('  - fails on chrome 120 → chrome 120 (unsupported)');
    expect(second?.text[0]).toContain('  - on this page: 2 of 3 failing, 0 of 5 not evaluated');
    expect(third?.output.results[0]?.failing_targets.map(tokenOf)).toEqual(['op_mob 80']);
    expect(third?.text[0]).toContain('  - fails on op_mob 80 → opera_android 80 (unsupported)');
  });

  it('an exactly-full final page ends the walk without a continuation', async () => {
    const pages = await walk(['css.selectors.has'], FOUR_TOKENS, 2);
    expect(pages.map((page) => pageTokens(page.output))).toEqual([
      ['chrome 120', 'chrome 109'],
      ['firefox 140', 'op_mini all'],
    ]);
    expect(pages[0]?.structured).toMatchObject({
      shown: 2,
      cap: 2,
      truncated: true,
      nextOffset: 2,
    });
    expect(pages[1]?.structured).toMatchObject({
      totalCount: 4,
      shown: 2,
      cap: 2,
      truncated: false,
    });
    expect(pages[1]?.structured).not.toHaveProperty('nextOffset');
    expect(pages[1]?.structured).not.toHaveProperty('offsetNotice');
    expect(pages[1]?.text[1]).not.toContain('**Next page:**');
    expect(pages[1]?.text[1]).toContain('**More targets remain:** no');
  });

  it('a short final page reports its own row count', async () => {
    const pages = await walk(['css.selectors.has'], FOUR_TOKENS, 3);
    expect(pages.map((page) => pageTokens(page.output))).toEqual([
      ['chrome 120', 'chrome 109', 'firefox 140'],
      ['op_mini all'],
    ]);
    expect(pages[1]?.structured).toMatchObject({
      totalCount: 4,
      shown: 1,
      cap: 3,
      truncated: false,
    });
    expect(pages[1]?.output.targets_resolved).toEqual([]);
    expect(pages[1]?.output).toMatchObject({
      targets_resolved_total: 3,
      unchecked_targets_total: 1,
    });
    expect(pages[1]?.text[0]).toContain('None of the 3 mapped target versions is on this page.');
    expect(pages[1]?.text[0]).toContain('| op_mini all | no_bcd_browser | 0% |');
  });

  it.each([4, 5, 1000])(
    'target_offset %i past the end is an ordinary response with whole-query summaries and paging guidance',
    async (target_offset) => {
      const baseline = await call({ features: ['css.selectors.has'], targets: FOUR_TOKENS });
      const page = await call({
        features: ['css.selectors.has'],
        targets: FOUR_TOKENS,
        target_offset,
      });

      expect(page.output.targets_resolved).toEqual([]);
      expect(page.output.unchecked_targets).toEqual([]);
      expect(page.output.results[0]).toMatchObject({
        verdict: 'inconclusive',
        failing_targets: [],
        unchecked_targets: [],
        evaluated_total: 3,
        unchecked_total: 1,
      });
      expect(wholeQuery(page)).toEqual(wholeQuery(baseline));
      expect(page.structured).toMatchObject({ totalCount: 4, shown: 0, cap: 10, truncated: false });
      expect(page.structured).not.toHaveProperty('nextOffset');
      expect(page.structured.offsetNotice).toBe(
        `target_offset ${target_offset} is at or past the 4 targets in the query. Call again with a target_offset below 4, or omit it for the first page.`,
      );
      expect(page.text[1]).toContain(`**Empty page:** ${page.structured.offsetNotice}`);
      expect(page.text[0]).toContain('None of the 3 mapped target versions is on this page.');
      expect(page.text[0]).toContain('None of the 1 unevaluated target versions is on this page.');
      expect(baseline.structured).not.toHaveProperty('offsetNotice');
    },
  );

  it('the trailer agrees with format() about totals, the page, and the continuation', async () => {
    const { output, structured, text } = await call({
      features: DEFAULTS_FEATURES,
      targets: 'defaults',
      target_offset: 10,
      target_limit: 10,
    });
    expect(structured).toMatchObject({
      totalCount: 35,
      shown: 10,
      cap: 10,
      truncated: true,
      nextOffset: 20,
    });
    expect(output.targets_resolved).toHaveLength(10);
    expect(output.unchecked_targets).toEqual([]);

    expect(text[0]).toContain(
      'Evaluated for every compared feature: 30 of 35 target versions (84.1977% of tracked traffic) · not evaluated: 5 (0.7324%)',
    );
    expect(text[0]).toContain(
      'Compared 3 of 3 features · 30 of 35 target versions map to a browser-compat-data release',
    );
    expect(text[0]).toContain('## Targets mapped to a release — 10 of 30 on this page');
    expect(text[0]).toContain('## Not evaluated for every compared feature — 0 of 5 on this page');
    expect(text[0]).toContain('None of the 5 unevaluated target versions is on this page.');
    expect(text[0]).toContain('| chrome 120 | chrome 120 (index 118) | yes |');
    expect(text[0]).not.toContain('## Targets evaluated');

    expect(text[1]).toContain('**Targets in query:** 35');
    expect(text[1]).toContain('**Targets on this page:** 10');
    expect(text[1]).toContain('**Page size (target_limit):** 10');
    expect(text[1]).toContain('**More targets remain:** yes');
    expect(text[1]).toContain('**Next page:** call again with target_offset 20');
    expect(text[1]).toContain(
      '**Not evaluated:** 5 of 35 target versions were not evaluated for every compared feature (and_qq, and_uc, kaios, op_mini), together 0.7324% of tracked traffic. No feature is reported as clearing them.',
    );
    // The trailer names agents and counts only; it never re-lists target rows.
    expect(text[1]).not.toMatch(/\d+\.\d+-\d/);
    expect(text[1]).not.toContain('kaios 2.5');
  });

  it.each([
    { label: 'target_offset -1', extra: { target_offset: -1 }, field: 'target_offset' },
    { label: 'target_offset 1.5', extra: { target_offset: 1.5 }, field: 'target_offset' },
    { label: 'target_limit 0', extra: { target_limit: 0 }, field: 'target_limit' },
    { label: 'target_limit 11', extra: { target_limit: 11 }, field: 'target_limit' },
  ])('rejects $label against the input schema, naming the field', async ({ extra, field }) => {
    const result = await runToolContract(browsercompatCompareSupport, {
      features: ['has'],
      targets: 'defaults',
      ...extra,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams },
    });
    expect(texts(result).join('\n')).toContain(field);
  });

  it('defaults to the first ten targets', () => {
    expect(
      browsercompatCompareSupport.input.parse({ features: ['has'], targets: 'defaults' }),
    ).toMatchObject({
      target_offset: 0,
      target_limit: 10,
    });
  });
});

describe('#6 — a broad query stays bounded on both surfaces', () => {
  const BROAD_FEATURES = [
    'css.selectors.has',
    'javascript.builtins.Array.fromAsync',
    'css.properties.anchor-name',
    'css.properties.display.grid',
    'css.properties.display.contents',
    'css.properties.container-type',
    'api.Navigator.share',
    'api.CanvasRenderingContext2D.filter',
    'api.AudioContext.setSinkId',
    'api.Animation.playState',
    'api.Document.execCommand',
    'api.AudioParam.automationRate',
    'api.AudioListener.forwardX',
    'api.Element.animate',
    'javascript.builtins.Array.at',
    'javascript.builtins.String.replaceAll',
    'css.properties.position.sticky',
    'html.elements.dialog',
    'api.ResizeObserver',
    'css.properties.view-transition-name',
  ];
  const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

  /** Largest page of a walk, per surface and for the serialized result as a whole. */
  function largest(pages: Awaited<ReturnType<typeof walk>>) {
    const max = (measure: (page: (typeof pages)[number]) => number) =>
      Math.max(...pages.map(measure));
    return {
      structured: max((page) => bytes(JSON.stringify(page.result.structuredContent))),
      text: max((page) => bytes(page.text.join('\n'))),
      trailer: max((page) => bytes(page.text[1] ?? '')),
      serialized: max((page) =>
        bytes(
          JSON.stringify({
            content: page.result.content,
            structuredContent: page.result.structuredContent,
          }),
        ),
      ),
    };
  }

  /**
   * Bytes per page, each about a quarter above the largest page measured for
   * 20 features against `since 2000`, the broadest query in this suite.
   */
  const CEILINGS = { structured: 40_000, text: 28_000, trailer: 1_000, serialized: 68_000 };

  function expectUnderCeilings(measured: ReturnType<typeof largest>) {
    for (const surface of Object.keys(CEILINGS) as (keyof typeof CEILINGS)[]) {
      expect.soft(measured[surface], surface).toBeLessThanOrEqual(CEILINGS[surface]);
    }
  }

  it('every page of 20 features against since 2000 stays under the pinned ceilings', async () => {
    const tokens = (await getTargetsService()).queryTokens('since 2000');
    expect(tokens).toHaveLength(688);
    expect(BROAD_FEATURES).toHaveLength(20);

    const pages = await walk(BROAD_FEATURES, 'since 2000', 10);
    expect(pages).toHaveLength(69);
    const seen = pages.flatMap((page) => [...new Set(pageTokens(page.output))]);
    expect([...seen].sort()).toEqual([...tokens].sort());
    expect(pages[0]?.structured).toMatchObject({ totalCount: 688, shown: 10, cap: 10 });
    expect(pages[68]?.structured).toMatchObject({ shown: 8, truncated: false });
    expect(pages[0]?.output.comparable_features).toBe(20);
    for (const page of pages) expect(wholeQuery(page)).toEqual(wholeQuery(pages[0] as typeof page));

    // Measured on the bundled data: structured 32,068, text 21,022, trailer 693, serialized 53,131.
    const measured = largest(pages);
    expect(measured.structured).toBeGreaterThan(10_000);
    expectUnderCeilings(measured);
  }, 120_000);

  it('20 copies of one feature against defaults stays under the same ceilings', async () => {
    const pages = await walk(
      Array.from({ length: 20 }, () => 'css.selectors.has'),
      'defaults',
      10,
    );
    expect(pages).toHaveLength(4);
    // Measured on the bundled data: structured 14,837, text 11,976, trailer 669, serialized 27,144.
    expectUnderCeilings(largest(pages));
  });
});
