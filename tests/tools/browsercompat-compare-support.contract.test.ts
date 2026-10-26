/**
 * @fileoverview Assembled-result contract for browsercompat_compare_support:
 * every case runs the real handler, `format()`, and the enrichment trailer
 * through `runToolContract` against the bundled datasets, and asserts on both
 * `structuredContent` and the whole `content[]`.
 * @module tests/tools/browsercompat-compare-support.contract.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';
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
      { agent: 'ie', version_token: '11', reason: 'no_bcd_data', usage_percent: 0.2118 },
    ]);
    expect(output.all_clear).toBe(false);
    expect(text[0]).toContain('| ie 11 | no_bcd_data | 0.2118% |');
    expect(text[0]).not.toContain('fails on ie 11');
    expect(text[1]).toContain('**Not evaluated:**');
  });

  it('a miss and an ambiguous id keep their verdicts and guidance beside a compared feature', async () => {
    const { output, text } = await call({
      features: ['nope-xyz', 'http2', 'css.selectors.has'],
      targets: 'chrome 120',
    });
    expect(output.results.map((item) => item.verdict)).toEqual(['miss', 'ambiguous', 'clears']);
    expect(output.results[0]).toMatchObject({ found: false, resolved_as: null });
    expect(output.results[1]?.compat_keys).toEqual([]);
    expect(output.results[1]).not.toHaveProperty('support_source');
    expect(output.all_clear).toBe(false);
    expect(text[0]).toContain('**miss** nope-xyz');
    expect(text[0]).toContain('**ambiguous** HTTP/2');
    expect(text[0]).toContain(
      [
        '  - compat_keys: none — this entry owns no browser-compat-data keys',
        '  - "http2" is tracked by web-features but owns no browser-compat-data keys, so there is no per-browser support to compare. Call browsercompat_check_baseline for its Baseline state.',
        '**clears** :has()',
      ].join('\n'),
    );
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
    expect(text).toContain(message.replaceAll('`', '\\`'));
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
      label: '101 features',
      input: { features: Array.from({ length: 101 }, () => 'has'), targets: 'defaults' },
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

/**
 * Check every compared result's `failing_ranges` against the failing rows a
 * walk collected page by page: the runs partition those rows in query order,
 * each run is one agent and one verdict over consecutive query targets from
 * `newest` to `oldest`, no two runs that could merge sit side by side, and the
 * counts sum to `failing_total`. A miss or ambiguous result carries no runs.
 */
function expectRangesMatchRows(pages: Awaited<ReturnType<typeof walk>>, tokens: string[]) {
  const first = pages[0]?.output;
  if (!first) throw new Error('a walk returns at least one page');
  let compared = 0;
  first.results.forEach((result, position) => {
    const ranges = result.failing_ranges;
    if (result.failing_total === undefined) {
      expect(result).not.toHaveProperty('failing_ranges');
      return;
    }
    compared += 1;
    if (ranges === undefined) throw new Error(`${result.input} was compared but has no runs`);
    const rows = pages.flatMap((page) => page.output.results[position]?.failing_targets ?? []);
    const indexes = rows.map((row) => tokens.indexOf(tokenOf(row)));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(rows).toHaveLength(result.failing_total);
    expect(ranges.reduce((sum, range) => sum + range.count, 0)).toBe(result.failing_total);

    let cursor = 0;
    let previous: { agent: string; verdict: string; last: number } | undefined;
    for (const range of ranges) {
      expect(range.count).toBeGreaterThan(0);
      const members = rows.slice(cursor, cursor + range.count);
      const at = indexes.slice(cursor, cursor + range.count);
      cursor += range.count;
      for (const member of members) {
        expect(member).toMatchObject({ agent: range.agent, verdict: range.verdict });
      }
      expect(members[0]?.version_token).toBe(range.newest);
      expect(members.at(-1)?.version_token).toBe(range.oldest);
      expect(at).toEqual(at.map((_, step) => (at[0] ?? 0) + step));
      if (previous?.agent === range.agent && previous.verdict === range.verdict) {
        expect(at[0]).toBeGreaterThan(previous.last + 1);
      }
      previous = { agent: range.agent, verdict: range.verdict, last: at.at(-1) ?? -1 };
    }
    expect(cursor).toBe(rows.length);
  });
  expect(compared).toBeGreaterThan(0);
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
      evaluated_total: 31,
      evaluated_coverage_percent: 85.4282,
      unchecked_total: 5,
      unchecked_coverage_percent: 0.6078,
    });
    expect(output.results[1]).toMatchObject({
      verdict: 'inconclusive',
      failing_total: 0,
      evaluated_total: 26,
      evaluated_coverage_percent: 39.8527,
      unchecked_total: 10,
      unchecked_coverage_percent: 46.1833,
    });

    expect(output).toMatchObject({
      comparable_features: 2,
      targets_resolved_total: 31,
      evaluated_targets_total: 26,
      unchecked_targets_total: 10,
      target_coverage_percent: 39.8527,
      unchecked_coverage_percent: 46.1833,
      all_clear: false,
    });
    expect(structured.totalCount).toBe(36);

    // First page of ten: and_chr 156 and android 156 lack data for the extension key only.
    expect(output.results[0]?.unchecked_targets).toEqual([
      { agent: 'and_qq', version_token: '14.9', reason: 'no_bcd_browser', usage_percent: 0.1276 },
      { agent: 'and_uc', version_token: '15.5', reason: 'no_bcd_browser', usage_percent: 0.4802 },
    ]);
    expect(
      output.results[1]?.unchecked_targets?.map((row) => `${tokenOf(row)} ${row.reason}`),
    ).toEqual([
      'and_chr 156 no_bcd_data',
      'and_qq 14.9 no_bcd_browser',
      'and_uc 15.5 no_bcd_browser',
      'android 156 no_bcd_data',
    ]);
    expect(output.unchecked_targets.map((row) => `${tokenOf(row)} ${row.reason}`)).toEqual([
      'and_chr 156 no_bcd_data',
      'and_qq 14.9 no_bcd_browser',
      'and_uc 15.5 no_bcd_browser',
      'android 156 no_bcd_data',
    ]);
    expect(output.targets_resolved.filter((row) => !row.evaluated).map(tokenOf)).toEqual([
      'and_chr 156',
      'android 156',
    ]);

    expect(text[0]).toContain(
      'Evaluated for every compared feature: 26 of 36 target versions (39.8527% of global traffic) · not evaluated: 10 (46.1833%)',
    );
    expect(text[0]).toContain(
      '  - evaluated on 31 of 36 target versions (85.4282% of global traffic) · failing 0 · not evaluated 5 (0.6078%)',
    );
    expect(text[0]).toContain(
      '  - evaluated on 26 of 36 target versions (39.8527% of global traffic) · failing 0 · not evaluated 10 (46.1833%)',
    );
    expect(text[0]).toContain('  - not evaluated on and_chr 156 (no_bcd_data, 42.7908% usage)');
    expect(text[0]).toContain('| and_chr 156 | chrome_android 156 (index');
    expect(text[0]).toContain('| and_chr 156 | no_bcd_data | 42.7908% |');
    expect(text[1]).toContain('**Not evaluated:** 10 of 36 target versions');
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
    expect(pages[0]?.output.results[2]).toMatchObject({ verdict: 'fails', failing_total: 2 });
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
      features: ['nope-xyz', 'http2'],
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

describe('#26 — a multi-key id is judged on web-features’ feature-level support', () => {
  const CORE_ONLY =
    'last 2 chrome versions, last 2 firefox versions, last 2 safari versions, last 2 edge versions';

  /** Every target row of a whole query for one result, gathered across pages. */
  async function wholeRows(features: string[], targets: string, index: number) {
    const pages = await walk(features, targets, 10);
    return {
      first: pages[0] as (typeof pages)[number],
      failing: pages.flatMap((page) => page.output.results[index]?.failing_targets ?? []),
      unchecked: pages.flatMap((page) => page.output.results[index]?.unchecked_targets ?? []),
      aggregate: pages.flatMap((page) => page.output.unchecked_targets),
      text: pages.map((page) => page.text[0]).join('\n'),
    };
  }

  it('grid and flexbox clear a core-browser query on both surfaces', async () => {
    const { output, text } = await call({ features: ['grid', 'flexbox'], targets: CORE_ONLY });
    for (const item of output.results) {
      expect(item).toMatchObject({
        verdict: 'clears',
        support_source: 'web_features_feature',
        failing_total: 0,
        unchecked_total: 0,
        evaluated_total: 8,
      });
      expect(item.compat_keys).toHaveLength(10);
    }
    expect(output.results.map((item) => item.compat_keys_total)).toEqual([61, 99]);
    expect(output).toMatchObject({
      comparable_features: 2,
      evaluated_targets_total: 8,
      unchecked_targets_total: 0,
      all_clear: true,
    });
    expect(text[0]).toContain('# 2 of 2 features clears');
    expect(text[0]).toContain('**clears** Grid');
    expect(text[0]).toContain('**clears** Flexbox');
    expect(text[0]).toContain('  - support_source: web_features_feature');
  });

  it('grid on defaults: inconclusive, 25 evaluated, 11 unchecked (5 no_bcd_browser, 6 no_feature_level_data)', async () => {
    const { first, failing, unchecked } = await wholeRows(['grid'], 'defaults', 0);
    expect(first.output.results[0]).toMatchObject({
      verdict: 'inconclusive',
      support_source: 'web_features_feature',
      failing_total: 0,
      evaluated_total: 25,
      unchecked_total: 11,
    });
    expect(first.output.results[0]).not.toHaveProperty('guidance');
    expect(failing).toEqual([]);
    // Every no_feature_level_data target is a mapped browser outside the Baseline core set.
    expect(unchecked.map((row) => `${tokenOf(row)} ${row.reason}`)).toEqual([
      'and_qq 14.9 no_bcd_browser',
      'and_uc 15.5 no_bcd_browser',
      'android 156 no_feature_level_data',
      'kaios 3.0-3.1 no_bcd_browser',
      'kaios 2.5 no_bcd_browser',
      'op_mini all no_bcd_browser',
      'op_mob 80 no_feature_level_data',
      'opera 135 no_feature_level_data',
      'opera 134 no_feature_level_data',
      'samsung 30 no_feature_level_data',
      'samsung 29 no_feature_level_data',
    ]);
    expect(first.output).toMatchObject({
      comparable_features: 1,
      evaluated_targets_total: 25,
      unchecked_targets_total: 11,
    });
  });

  it('popover on defaults fails on chrome 109 as before_feature_support', async () => {
    const { first, failing, text } = await wholeRows(['popover'], 'defaults', 0);
    expect(first.output.results[0]).toMatchObject({
      verdict: 'fails',
      support_source: 'web_features_feature',
    });
    // A feature-level failing row carries the target and the verdict, never a BCD statement's qualifiers.
    expect(failing).toEqual([
      {
        agent: 'chrome',
        version_token: '109',
        bcd_browser: 'chrome',
        bcd_version: '109',
        verdict: 'before_feature_support',
      },
    ]);
    expect(text).toContain('  - fails on chrome 109 → chrome 109 (before_feature_support)\n');
  });

  it('anchor-positioning fails both chrome targets as no_feature_support beside a key that clears', async () => {
    const { output, text } = await call({
      features: ['anchor-positioning', 'css.properties.anchor-name'],
      targets: 'last 2 chrome versions',
    });
    const [feature, key] = output.results;
    expect(feature).toMatchObject({
      verdict: 'fails',
      support_source: 'web_features_feature',
      failing_total: 2,
      evaluated_total: 2,
    });
    expect(feature?.failing_targets.map((row) => row.verdict)).toEqual([
      'no_feature_support',
      'no_feature_support',
    ]);
    expect(key).toMatchObject({ verdict: 'clears', support_source: 'bcd_key' });
    expect(key).not.toHaveProperty('compat_keys');
    expect(output.all_clear).toBe(false);
    expect(text[0]).toContain('(no_feature_support)');
    expect(text[0]).toContain('  - support_source: bcd_key');
  });

  it('display-contents fails every core target as no_feature_support', async () => {
    const { output } = await call({
      features: ['display-contents'],
      targets:
        'last 1 chrome version, last 1 and_chr version, last 1 edge version, last 1 firefox version, last 1 and_ff version, last 1 safari version, last 1 ios_saf version',
    });
    expect(output.results[0]).toMatchObject({
      verdict: 'fails',
      failing_total: 7,
      evaluated_total: 7,
      unchecked_total: 0,
    });
    expect(new Set(output.results[0]?.failing_targets.map((row) => row.verdict))).toEqual(
      new Set(['no_feature_support']),
    );
  });

  it('paint-order: firefox 60 is before the ≤66 bound and unchecked, firefox 66 clears', async () => {
    const before = await call({ features: ['paint-order'], targets: 'firefox 60' });
    expect(before.output.results[0]).toMatchObject({
      verdict: 'inconclusive',
      failing_total: 0,
      evaluated_total: 0,
      unchecked_total: 1,
    });
    expect(before.output.results[0]?.unchecked_targets).toEqual([
      expect.objectContaining({
        agent: 'firefox',
        version_token: '60',
        reason: 'no_feature_level_data',
      }),
    ]);
    expect(before.output.unchecked_targets).toEqual([
      expect.objectContaining({
        agent: 'firefox',
        version_token: '60',
        reason: 'no_feature_level_data',
      }),
    ]);
    expect(before.output.targets_resolved[0]?.evaluated).toBe(false);
    expect(before.text[0]).toContain('| firefox 60 | no_feature_level_data |');

    const at = await call({ features: ['paint-order'], targets: 'firefox 66' });
    expect(at.output.results[0]).toMatchObject({ verdict: 'clears', evaluated_total: 1 });
    expect(at.output.all_clear).toBe(true);
  });

  it('a mixed call keeps the D50 intersection: :has() and grid on defaults evaluate 25 of 36', async () => {
    const { first, aggregate } = await wholeRows(['css.selectors.has', 'grid'], 'defaults', 1);
    const [has, grid] = first.output.results;
    expect(has).toMatchObject({ verdict: 'inconclusive', evaluated_total: 31, unchecked_total: 5 });
    expect(grid).toMatchObject({
      verdict: 'inconclusive',
      evaluated_total: 25,
      unchecked_total: 11,
    });
    expect(first.output).toMatchObject({
      comparable_features: 2,
      evaluated_targets_total: 25,
      unchecked_targets_total: 11,
      all_clear: false,
    });
    const targets = await getTargetsService();
    const unchecked = aggregate.map(tokenOf);
    const evaluated = targets.queryTokens('defaults').filter((token) => !unchecked.includes(token));
    expect(first.output.target_coverage_percent).toBe(targets.coverage(evaluated));
    expect(first.output.unchecked_coverage_percent).toBe(targets.coverage(unchecked));
    expect(aggregate.filter((row) => row.reason === 'no_feature_level_data')).toHaveLength(6);
    expect(aggregate.filter((row) => row.reason === 'no_bcd_browser')).toHaveLength(5);
  });

  it('a target several features left unchecked takes the earliest compared result’s reason', async () => {
    const reasonOf = async (features: string[]) => {
      const { output } = await call({ features, targets: 'android 156' });
      return output.unchecked_targets.map((row) => `${tokenOf(row)} ${row.reason}`);
    };
    expect(await reasonOf(['grid', 'webextensions.api.action.enable'])).toEqual([
      'android 156 no_feature_level_data',
    ]);
    expect(await reasonOf(['webextensions.api.action.enable', 'grid'])).toEqual([
      'android 156 no_bcd_data',
    ]);
  });
});

describe('#6 — target rows are paged, whole-query answers are not', () => {
  it.each([10, 5, 7])(
    'a walk on defaults at target_limit %i reaches each of the 36 tokens exactly once',
    async (limit) => {
      const tokens = (await getTargetsService()).queryTokens('defaults');
      expect(tokens).toHaveLength(36);
      const pages = await walk(DEFAULTS_FEATURES, 'defaults', limit);

      expect(pages).toHaveLength(Math.ceil(36 / limit));
      const seen: string[] = [];
      for (const page of pages) {
        const expected = tokens.slice(page.offset, page.offset + limit);
        expect([...pageTokens(page.output)].sort()).toEqual([...expected].sort());
        // Each row list keeps query order on its own.
        for (const rows of [page.output.targets_resolved, page.output.unchecked_targets]) {
          const indexes = rows.map((row) => tokens.indexOf(tokenOf(row)));
          expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
        }
        const remaining = page.offset + expected.length < 36;
        expect(page.structured).toMatchObject({
          totalCount: 36,
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
      expect(new Set(seen).size).toBe(36);
    },
  );

  it('whole-query verdicts, coverage, totals, and notices are identical on every page', async () => {
    const pages = await walk(DEFAULTS_FEATURES, 'defaults', 10);
    const first = wholeQuery(pages[0] as (typeof pages)[number]);
    expect(first).toMatchObject({
      all_clear: false,
      target_coverage_percent: 85.4282,
      unchecked_coverage_percent: 0.6078,
      targets_resolved_total: 31,
      unchecked_targets_total: 5,
      evaluated_targets_total: 31,
      comparable_features: 3,
      totalCount: 36,
      cap: 10,
    });
    expect(first.results.map((item) => item.verdict)).toEqual(['inconclusive', 'fails', 'fails']);
    expect(first.results.map((item) => item.failing_total)).toEqual([0, 2, 3]);
    for (const page of pages) expect(wholeQuery(page)).toEqual(first);
    expectRangesMatchRows(pages, (await getTargetsService()).queryTokens('defaults'));
  });

  it('a failure that falls on page 2 still sets the verdict on page 1, on both surfaces', async () => {
    const [first, second, third] = await walk(
      ['javascript.builtins.Array.fromAsync'],
      'defaults',
      10,
    );
    expect(first?.output.results[0]).toMatchObject({
      verdict: 'fails',
      failing_total: 2,
      failing_targets: [],
    });
    expect(first?.output.all_clear).toBe(false);
    expect(first?.text[0]).toContain('**fails** Array.fromAsync()');
    expect(first?.text[0]).toContain('failing 2');
    expect(first?.text[0]).toContain('  - on this page: 0 of 2 failing, 2 of 5 not evaluated');
    expect(first?.text[0]).not.toContain('fails on');

    expect(second?.output.results[0]?.failing_targets.map(tokenOf)).toEqual(['chrome 109']);
    expect(second?.text[0]).toContain('  - fails on chrome 109 → chrome 109 (unsupported)');
    expect(second?.text[0]).toContain('  - on this page: 1 of 2 failing, 0 of 5 not evaluated');
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
      totalCount: 36,
      shown: 10,
      cap: 10,
      truncated: true,
      nextOffset: 20,
    });
    expect(output.targets_resolved).toHaveLength(10);
    expect(output.unchecked_targets).toEqual([]);

    expect(text[0]).toContain(
      'Evaluated for every compared feature: 31 of 36 target versions (85.4282% of global traffic) · not evaluated: 5 (0.6078%)',
    );
    expect(text[0]).toContain(
      'Compared 3 of 3 features · 31 of 36 target versions map to a browser-compat-data release',
    );
    expect(text[0]).toContain('## Targets mapped to a release — 10 of 31 on this page');
    expect(text[0]).toContain('## Not evaluated for every compared feature — 0 of 5 on this page');
    expect(text[0]).toContain('None of the 5 unevaluated target versions is on this page.');
    expect(text[0]).toContain('| chrome 109 | chrome 109 (index 107) | yes |');
    expect(text[0]).not.toContain('## Targets evaluated');

    expect(text[1]).toContain('**Targets in query:** 36');
    expect(text[1]).toContain('**Targets on this page:** 10');
    expect(text[1]).toContain('**Page size (target_limit):** 10');
    expect(text[1]).toContain('**More targets remain:** yes');
    expect(text[1]).toContain('**Next page:** call again with target_offset 20');
    expect(text[1]).toContain(
      '**Not evaluated:** 5 of 36 target versions were not evaluated for every compared feature (and_qq, and_uc, kaios, op_mini), together 0.6078% of global traffic. No feature is reported as clearing them.',
    );
    // The trailer names agents and counts only; it never re-lists target rows.
    expect(text[1]).not.toMatch(/\d+\.\d+-\d/);
    expect(text[1]).not.toContain('kaios 2.5');
  });

  it.each([
    { label: 'target_offset -1', extra: { target_offset: -1 }, field: 'target_offset' },
    { label: 'target_offset 1.5', extra: { target_offset: 1.5 }, field: 'target_offset' },
    { label: 'target_limit 0', extra: { target_limit: 0 }, field: 'target_limit' },
    { label: 'target_limit 1001', extra: { target_limit: 1001 }, field: 'target_limit' },
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
   * Bytes per page, each about a quarter above the largest page any walk below
   * measures on that surface: structured 50,676 (20 features against
   * `since 2000`), text 38,123 and serialized 85,220 (the 20 largest multi-key
   * ids against `since 2000`), trailer 727.
   */
  const CEILINGS = { structured: 64_000, text: 48_000, trailer: 1_000, serialized: 107_000 };

  function expectUnderCeilings(measured: ReturnType<typeof largest>) {
    for (const surface of Object.keys(CEILINGS) as (keyof typeof CEILINGS)[]) {
      expect.soft(measured[surface], surface).toBeLessThanOrEqual(CEILINGS[surface]);
    }
  }

  it('every page of 20 features against since 2000 stays under the pinned ceilings', async () => {
    const tokens = (await getTargetsService()).queryTokens('since 2000');
    expect(tokens).toHaveLength(695);
    expect(BROAD_FEATURES).toHaveLength(20);

    const pages = await walk(BROAD_FEATURES, 'since 2000', 10);
    expect(pages).toHaveLength(70);
    const seen = pages.flatMap((page) => [...new Set(pageTokens(page.output))]);
    expect([...seen].sort()).toEqual([...tokens].sort());
    expect(pages[0]?.structured).toMatchObject({ totalCount: 695, shown: 10, cap: 10 });
    expect(pages[69]?.structured).toMatchObject({ shown: 5, truncated: false });
    expect(pages[0]?.output.comparable_features).toBe(20);
    for (const page of pages) expect(wholeQuery(page)).toEqual(wholeQuery(pages[0] as typeof page));
    expectRangesMatchRows(pages, tokens);

    // Measured on the bundled data: structured 50,676, text 28,973, trailer 689, serialized 79,851.
    const measured = largest(pages);
    expect(measured.structured).toBeGreaterThan(40_000);
    expectUnderCeilings(measured);
  }, 120_000);

  it('20 copies of one feature against defaults stays under the same ceilings', async () => {
    const pages = await walk(
      Array.from({ length: 20 }, () => 'css.selectors.has'),
      'defaults',
      10,
    );
    expect(pages).toHaveLength(4);
    expectRangesMatchRows(pages, (await getTargetsService()).queryTokens('defaults'));
    // Measured on the bundled data: structured 15,777, text 13,282, trailer 666, serialized 29,396.
    expectUnderCeilings(largest(pages));
  });

  /** The 20 web-features ids owning the most compat keys (svg 618 … webdriver-bidi 116). */
  const LARGEST_MULTI_KEY = [
    'svg',
    'anchor-positioning',
    'svg-filters',
    'webgpu',
    'dom',
    'logical-properties',
    'webrtc-stats',
    'temporal',
    'webgl2',
    'webrtc',
    'web-audio',
    'webgl',
    'borders',
    'gap-decorations',
    'dom-geometry',
    'css-typed-om',
    'webcodecs',
    'canvas-2d',
    'indexeddb',
    'webdriver-bidi',
  ];

  it('every page of the 20 largest multi-key ids against since 2000 stays under the same ceilings', async () => {
    const pages = await walk(LARGEST_MULTI_KEY, 'since 2000', 10);
    expect(pages).toHaveLength(70);
    for (const page of pages) {
      for (const item of page.output.results) {
        expect(item.support_source).toBe('web_features_feature');
        expect(item.compat_keys).toHaveLength(10);
        expect(item.compat_keys_total).toBeGreaterThanOrEqual(116);
      }
    }
    expectRangesMatchRows(pages, (await getTargetsService()).queryTokens('since 2000'));
    /**
     * Measured on the bundled data: structured 46,590, text 38,123, trailer 727,
     * serialized 85,220 — the largest text and serialized pages of any walk:
     * the last page, where every feature-level result carries a failing or
     * unevaluated row for each of ten old targets beside its ten compat keys.
     */
    expectUnderCeilings(largest(pages));
  }, 120_000);

  it('every page of 20 × grid against defaults stays under the same ceilings', async () => {
    const pages = await walk(Array(20).fill('grid'), 'defaults', 10);
    expect(pages).toHaveLength(4);
    expectRangesMatchRows(pages, (await getTargetsService()).queryTokens('defaults'));
    // Measured on the bundled data: structured 30,003, text 28,139, trailer 700, serialized 58,562.
    expectUnderCeilings(largest(pages));
  });
});

describe('#25 — compat_keys is bounded per result', () => {
  it('a feature-level result carries its first 10 keys and the total; a zero-key id an empty list', async () => {
    const { output, text } = await call({
      features: ['grid', 'promise', 'http2', 'css.selectors.has'],
      targets: 'chrome 120',
    });
    const [grid, promise, http2, has] = output.results;
    expect(grid).toMatchObject({ support_source: 'web_features_feature', compat_keys_total: 61 });
    expect(grid?.compat_keys).toHaveLength(10);
    expect(promise).toMatchObject({ compat_keys_total: 10 });
    expect(promise?.compat_keys).toHaveLength(10);
    expect(http2).toMatchObject({ verdict: 'ambiguous', compat_keys: [], compat_keys_total: 0 });
    expect(has).not.toHaveProperty('compat_keys');
    expect(has).not.toHaveProperty('compat_keys_total');
    // Only a cut list points to get_feature; the bcd_key result renders no compat_keys line.
    expect(text[0]?.split('\n').filter((line) => line.startsWith('  - compat_keys: '))).toEqual([
      `  - compat_keys: 10 of 61: ${grid?.compat_keys?.join(', ')} — call browsercompat_get_feature with grid for all 61`,
      `  - compat_keys: 10 of 10: ${promise?.compat_keys?.join(', ')}`,
      '  - compat_keys: none — this entry owns no browser-compat-data keys',
    ]);
  });

  it('20 × svg against the last Chrome version stays under 40,000 bytes', async () => {
    const { result, output } = await call({
      features: Array(20).fill('svg'),
      targets: 'last 1 chrome version',
    });
    for (const item of output.results) {
      expect(item.compat_keys).toHaveLength(10);
      expect(item.compat_keys_total).toBe(618);
    }
    const serialized = Buffer.byteLength(
      JSON.stringify({ content: result.content, structuredContent: result.structuredContent }),
    );
    expect(serialized).toBeLessThanOrEqual(40_000);
  });
});

describe('#29 — features and target_limit past the per-call cap', () => {
  const CORE_ONLY =
    'last 2 chrome versions, last 2 firefox versions, last 2 safari versions, last 2 edge versions';

  it('21 entries compare the first 20 and return entry 21 in omitted_features; all_clear is false', async () => {
    const { output, text } = await call({
      features: [...Array(20).fill('grid'), 'flexbox'],
      targets: CORE_ONLY,
    });
    expect(output.results).toHaveLength(20);
    expect(output.results.every((item) => item.verdict === 'clears')).toBe(true);
    expect(output.comparable_features).toBe(20);
    expect(output.omitted_features).toEqual(['flexbox']);
    expect(output.all_clear).toBe(false);
    expect(text[0]?.split('\n')).toContain(
      '**omitted_features:** 1 entry past the first 20 was not evaluated — call again with features set to `["flexbox"]`',
    );
  });

  /** 101 entries are rejected by the characterization schema-bound table above. */
  it('100 entries succeed with 80 omitted in input order and all_clear false; 20 carry none', async () => {
    const features = Array.from(
      { length: 100 },
      (_, index) => `css.selectors.has${index < 20 ? '' : '.x'.repeat(index % 3)}`,
    );
    const { output } = await call({ features, targets: 'chrome 120' });
    expect(output.results).toHaveLength(20);
    expect(output.results.every((item) => item.verdict === 'clears')).toBe(true);
    expect(output.omitted_features).toEqual(features.slice(20));
    expect(output.all_clear).toBe(false);
    const twenty = await call({ features: features.slice(0, 20), targets: 'chrome 120' });
    expect(twenty.structured).not.toHaveProperty('omitted_features');
    expect(twenty.output.all_clear).toBe(true);
  });

  it('a malformed entry past position 20 still rejects the call', async () => {
    const base = Array(30).fill('has');
    expect(
      browsercompatCompareSupport.input.safeParse({
        features: [...base, 'a'.repeat(201)],
        targets: 'chrome 120',
      }).success,
    ).toBe(false);
    const result = await runToolContract(browsercompatCompareSupport, {
      features: [...base, ' '],
      targets: 'chrome 120',
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { data: { reason: 'invalid_feature_input' } } },
    });
  });

  /** target_limit 1001 is rejected by the #6 schema-bound table above. */
  it('target_limit 11 and 1000 serve the same page as 10, with cap 10', async () => {
    const at = async (target_limit: number) =>
      call({ features: DEFAULTS_FEATURES, targets: 'defaults', target_limit });
    const ten = await at(10);
    for (const limit of [11, 1000]) {
      const page = await at(limit);
      expect(page.structured).toEqual(ten.structured);
      expect(page.text).toEqual(ten.text);
      expect(page.structured).toMatchObject({ cap: 10, shown: 10, nextOffset: 10 });
    }
  });
});

describe('#27 — a failing row carries the support statement behind its verdict', () => {
  const FIVE = ['agent', 'bcd_browser', 'bcd_version', 'verdict', 'version_token'];
  /** Every rendered failing-target line, whole. */
  const failingLines = (text = '') =>
    text.split('\n').filter((line) => line.startsWith('  - fails on '));

  it('backdrop-filter on safari 15 names -webkit- since 9; safari 18 is not failing', async () => {
    const { output, text } = await call({
      features: ['css.properties.backdrop-filter'],
      targets: 'safari 15, safari 18',
    });
    expect(output.results[0]?.failing_targets).toEqual([
      {
        agent: 'safari',
        version_token: '15',
        bcd_browser: 'safari',
        bcd_version: '15',
        verdict: 'prefixed',
        version_added: '9',
        prefix: '-webkit-',
      },
    ]);
    expect(failingLines(text[0])).toEqual([
      '  - fails on safari 15 → safari 15 (prefixed) · version_added 9 · prefix -webkit-',
    ]);
  });

  it.each([
    {
      feature: 'api.BarcodeDetector.detect',
      targets: 'chrome 120',
      fields: { verdict: 'partial', version_added: '88', partial: true },
      line: '(partial) · version_added 88 · partial true',
    },
    {
      feature: 'css.properties.font-smooth',
      targets: 'chrome 120',
      fields: {
        verdict: 'prefixed',
        version_added: '5',
        alternative_name: '-webkit-font-smoothing',
      },
      line: '(prefixed) · version_added 5 · alternative_name -webkit-font-smoothing',
    },
    {
      feature: 'api.AudioTrack',
      targets: 'firefox 140',
      fields: {
        verdict: 'flagged',
        version_added: '33',
        flags: [{ name: 'media.track.enabled', type: 'preference', value_to_set: 'true' }],
      },
      line: '(flagged) · version_added 33 · flags preference media.track.enabled value_to_set true',
    },
    {
      feature: 'api.BatteryManager',
      targets: 'firefox 140',
      fields: {
        verdict: 'removed',
        version_added: '43',
        version_removed: '52',
        version_last: '51',
      },
      line: '(removed) · version_added 43 · version_removed 52 · version_last 51',
    },
    {
      feature: 'api.Element.matches',
      targets: 'edge 12',
      fields: {
        verdict: 'prefixed',
        version_added: '12',
        alternative_name: 'webkitMatchesSelector',
      },
      line: '(prefixed) · version_added 12 · alternative_name webkitMatchesSelector',
    },
  ])(
    '$feature on $targets: the row carries exactly its statement’s fields, never its notes',
    async ({ feature, targets, fields, line }) => {
      const { output, text } = await call({ features: [feature], targets });
      const [agent, version] = targets.split(' ');
      expect(output.results[0]?.failing_targets).toEqual([
        { agent, version_token: version, bcd_browser: agent, bcd_version: version, ...fields },
      ]);
      expect(failingLines(text[0])).toEqual([`  - fails on ${targets} → ${targets} ${line}`]);
    },
  );

  it('an unsupported and a preview_only row carry none of the statement fields', async () => {
    const { output, text } = await call({
      features: ['javascript.builtins.Array.fromAsync', 'api.CSS.Hz_static'],
      targets: 'chrome 120, firefox 140',
    });
    const [unsupported, preview] = output.results;
    expect(unsupported?.failing_targets.map((row) => row.verdict)).toEqual(['unsupported']);
    expect(preview?.failing_targets.map((row) => row.verdict)).toEqual(['preview_only']);
    for (const row of [
      ...(unsupported?.failing_targets ?? []),
      ...(preview?.failing_targets ?? []),
    ]) {
      expect(Object.keys(row).sort()).toEqual(FIVE);
    }
    expect(text[0]).toContain('  - fails on firefox 140 → firefox 140 (preview_only)\n');
  });
});

describe('#28 — failing_ranges summarizes every failing target across the whole query', () => {
  it('Array.fromAsync on defaults: every one of the four pages carries the same two runs, on both surfaces', async () => {
    const pages = await walk(['javascript.builtins.Array.fromAsync'], 'defaults', 10);
    expect(pages).toHaveLength(4);
    for (const page of pages) {
      expect(page.output.results[0]?.failing_ranges).toEqual([
        { agent: 'chrome', newest: '109', oldest: '109', count: 1, verdict: 'unsupported' },
        { agent: 'op_mob', newest: '80', oldest: '80', count: 1, verdict: 'unsupported' },
      ]);
      expect(page.text[0]).toContain(
        '  - failing_ranges (whole query): chrome 109: 1 unsupported; op_mob 80: 1 unsupported',
      );
    }
    expectRangesMatchRows(pages, (await getTargetsService()).queryTokens('defaults'));
  });

  it('a compared result with no failing target carries []; a miss and an ambiguous id carry none', async () => {
    const { output, text } = await call({
      features: ['css.selectors.has', 'nope-xyz', 'http2'],
      targets: 'chrome 120',
    });
    const [has, miss, ambiguous] = output.results;
    expect(has?.failing_ranges).toEqual([]);
    expect(miss).not.toHaveProperty('failing_ranges');
    expect(ambiguous).not.toHaveProperty('failing_ranges');
    expect(text[0]).toContain('  - failing_ranges (whole query): none');
    expect(text[0]?.match(/failing_ranges/g)).toHaveLength(1);
  });

  it.each([
    {
      label: 'a run splits on a change of verdict',
      feature: 'api.AudioTrack',
      targets: 'firefox 34, firefox 33, firefox 32, firefox 31',
      ranges: [
        { agent: 'firefox', newest: '34', oldest: '33', count: 2, verdict: 'flagged' },
        { agent: 'firefox', newest: '32', oldest: '31', count: 2, verdict: 'unsupported' },
      ],
      line: 'firefox 34 to 33: 2 flagged; firefox 32 to 31: 2 unsupported',
    },
    {
      label: 'a run splits at targets that passed',
      feature: 'css.properties.line-clamp',
      targets: 'safari 18.4, safari 18.3, safari 18.2, safari 17',
      ranges: [
        { agent: 'safari', newest: '18.4', oldest: '18.4', count: 1, verdict: 'prefixed' },
        { agent: 'safari', newest: '17.0', oldest: '17.0', count: 1, verdict: 'prefixed' },
      ],
      line: 'safari 18.4: 1 prefixed; safari 17.0: 1 prefixed',
    },
    {
      label: 'a run splits on a change of agent',
      feature: 'javascript.builtins.Array.fromAsync',
      targets: 'chrome 120, edge 120',
      ranges: [
        { agent: 'chrome', newest: '120', oldest: '120', count: 1, verdict: 'unsupported' },
        { agent: 'edge', newest: '120', oldest: '120', count: 1, verdict: 'unsupported' },
      ],
      line: 'chrome 120: 1 unsupported; edge 120: 1 unsupported',
    },
    {
      label: 'one agent’s consecutive feature-level failures stay one run',
      feature: 'anchor-positioning',
      targets: 'last 3 chrome versions',
      ranges: [
        { agent: 'chrome', newest: '156', oldest: '154', count: 3, verdict: 'no_feature_support' },
      ],
      line: 'chrome 156 to 154: 3 no_feature_support',
    },
  ])('$label', async ({ feature, targets, ranges, line }) => {
    const pages = await walk([feature], targets, 10);
    expect(pages[0]?.output.results[0]?.failing_ranges).toEqual(ranges);
    expect(pages[0]?.text[0]).toContain(`  - failing_ranges (whole query): ${line}`);
    expectRangesMatchRows(pages, (await getTargetsService()).queryTokens(targets));
  });

  it('a run splits at a target the feature was not evaluated on', async () => {
    const targets = 'chrome 120, chrome 119, chrome 118';
    const features = ['javascript.builtins.Array.fromAsync'];
    const whole = await call({ features, targets });
    expect(whole.output.results[0]?.failing_ranges).toEqual([
      { agent: 'chrome', newest: '120', oldest: '118', count: 3, verdict: 'unsupported' },
    ]);

    /** BCD with no record for chrome 119 alone: the evaluation path the handler runs, one answer changed. */
    const bcd = await getBcdService();
    const chrome119 = bcd.resolveTargetVersion('chrome', '119');
    if (!chrome119.resolved) throw new Error('chrome 119 must resolve');
    const supportAt = bcd.supportAt.bind(bcd);
    const spy = vi
      .spyOn(bcd, 'supportAt')
      .mockImplementation((leaf, browser, index) =>
        browser === 'chrome' && index === chrome119.index
          ? { verdict: 'unknown', detail: {} }
          : supportAt(leaf, browser, index),
      );
    try {
      const { output, text } = await call({ features, targets });
      const [result] = output.results;
      expect(result).toMatchObject({ verdict: 'fails', failing_total: 2, unchecked_total: 1 });
      expect(result?.unchecked_targets).toMatchObject([
        { agent: 'chrome', version_token: '119', reason: 'no_bcd_data' },
      ]);
      expect(result?.failing_ranges).toEqual([
        { agent: 'chrome', newest: '120', oldest: '120', count: 1, verdict: 'unsupported' },
        { agent: 'chrome', newest: '118', oldest: '118', count: 1, verdict: 'unsupported' },
      ]);
      expect(text[0]).toContain(
        '  - failing_ranges (whole query): chrome 120: 1 unsupported; chrome 118: 1 unsupported',
      );
    } finally {
      spy.mockRestore();
    }
  });
});
