/**
 * @fileoverview Fuzz coverage for the five browsercompat tools — valid,
 * adversarial, and wrong-type inputs against every handler, asserting no crash
 * past the framework, no stack trace or filesystem path in an error message, and
 * no prototype pollution.
 * @module tests/fuzz/tools.fuzz.test
 */

import type { AnyToolDefinition } from '@cyanheads/mcp-ts-core';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { fuzzTool } from '@cyanheads/mcp-ts-core/testing/fuzz';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { browsercompatCheckBaseline } from '@/mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { browsercompatGetFeature } from '@/mcp-server/tools/definitions/browsercompat-get-feature.tool.js';
import { browsercompatListReference } from '@/mcp-server/tools/definitions/browsercompat-list-reference.tool.js';
import { browsercompatSearchFeatures } from '@/mcp-server/tools/definitions/browsercompat-search-features.tool.js';
import { resolveFeature } from '@/services/baseline/feature-resolver.js';
import { getTargetsService } from '@/services/targets/targets-service.js';

/**
 * Every tool indexes the same four bundled datasets on first touch, so the runs
 * are serialized in one file to pay that load once. A fixed seed keeps a failure
 * reproducible from the report alone.
 */
const TOOLS: AnyToolDefinition[] = [
  browsercompatListReference,
  browsercompatGetFeature,
  browsercompatCheckBaseline,
  browsercompatSearchFeatures,
  browsercompatCompareSupport,
];

describe.each(TOOLS.map((def) => [def.name, def] as const))('%s — fuzz', (_name, def) => {
  it('survives valid, adversarial, and wrong-type inputs without crashing or leaking', async () => {
    const report = await fuzzTool(def, { numRuns: 25, numAdversarial: 20, seed: 20260919 });

    expect(report.crashes).toEqual([]);
    expect(report.leaks).toEqual([]);
    expect(report.prototypePollution).toBe(false);
    expect(report.totalRuns).toBeGreaterThan(0);
  });
});

it('keeps direct-child page totals and continuations coherent across generated offsets', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 1000 }), async (subkeys_offset) => {
      const result = await runToolContract(browsercompatGetFeature, {
        feature: 'api.Element',
        subkeys_offset,
      });
      expect(result.isError).not.toBe(true);
      const page = browsercompatGetFeature.output.parse(result.structuredContent).subkeys;
      expect(page).toBeDefined();
      if (!page) throw new Error('api.Element must have direct children');
      expect(page.keys.length).toBe(Math.min(100, Math.max(0, page.total - subkeys_offset)));
      expect(page.truncated).toBe(subkeys_offset + page.keys.length < page.total);
      expect(page.next_offset).toBe(page.truncated ? subkeys_offset + page.keys.length : undefined);
    }),
    { numRuns: 12, seed: 20260930 },
  );
});

it('keeps compat_keys pages, totals, and continuations coherent across generated offsets', async () => {
  /** Each id's keys in declaration order, as the resolver hands them to the tool. */
  const FEATURES = ['svg', 'grid', 'promise', 'http2'];
  const owned = new Map<string, string[]>();
  for (const feature of FEATURES) {
    const resolution = await resolveFeature(feature, {
      resolve: false,
      toolName: 'browsercompat_get_feature',
    });
    if (!resolution.found) throw new Error(`${feature} must resolve`);
    owned.set(feature, [...(resolution.compat_keys ?? [])]);
  }
  expect([...owned.values()].map((keys) => keys.length)).toEqual([618, 61, 10, 0]);

  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...FEATURES),
      fc.integer({ min: 0, max: 1000 }),
      async (feature, compat_keys_offset) => {
        const keys = owned.get(feature) ?? [];
        const result = await runToolContract(browsercompatGetFeature, {
          feature,
          compat_keys_offset,
        });
        expect(result.isError).not.toBe(true);
        const output = browsercompatGetFeature.output.parse(result.structuredContent);
        const page = keys.slice(compat_keys_offset, compat_keys_offset + 100);
        expect(output.compat_keys).toEqual(page);
        expect(output.compat_keys_total).toBe(keys.length);
        const next = compat_keys_offset + page.length;
        expect(output.compat_keys_next_offset).toBe(next < keys.length ? next : undefined);
      },
    ),
    { numRuns: 20, seed: 20261015 },
  );
});

it('keeps target pages, continuations, and whole-query answers coherent across generated offsets and limits', async () => {
  /**
   * A compared key with gaps, a failing key, a clean key, a feature-level
   * failure (popover) beside a feature-level gap (grid's non-core targets), and
   * an entry that is not comparable.
   */
  const call = async (paging: { target_offset?: number; target_limit?: number }) => {
    const result = await runToolContract(browsercompatCompareSupport, {
      features: [
        'css.selectors.has',
        'javascript.builtins.Array.fromAsync',
        'webextensions.api.action.enable',
        'grid',
        'popover',
        'http2',
      ],
      targets: 'defaults',
      ...paging,
    });
    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    const output = browsercompatCompareSupport.output.parse(structured);
    const { targets_resolved, unchecked_targets, results, ...totals } = output;
    return {
      structured,
      output,
      wholeQuery: {
        ...totals,
        results: results.map(
          ({ failing_targets: _failing, unchecked_targets: _unchecked, ...rest }) => rest,
        ),
        uncheckedNotice: structured.uncheckedNotice,
      },
    };
  };
  const token = (row: { agent: string; version_token: string }) =>
    `${row.agent} ${row.version_token}`;

  const reference = await call({});
  const total = reference.structured.totalCount as number;
  expect(total).toBe(
    reference.output.evaluated_targets_total + reference.output.unchecked_targets_total,
  );

  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: total + 20 }),
      fc.oneof(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 11, max: 1000 })),
      async (target_offset, target_limit) => {
        const { structured, output, wholeQuery } = await call({ target_offset, target_limit });
        const cap = Math.min(target_limit, 10);
        const shown = Math.min(cap, Math.max(0, total - target_offset));
        const remaining = target_offset + shown < total;

        expect(structured).toMatchObject({
          totalCount: total,
          shown,
          cap,
          truncated: remaining,
        });
        expect(structured.nextOffset).toBe(remaining ? target_offset + shown : undefined);
        expect(structured.offsetNotice === undefined).toBe(shown > 0);
        if (remaining) {
          expect(
            browsercompatCompareSupport.input.parse({
              features: ['has'],
              targets: 'defaults',
              target_offset: structured.nextOffset,
              target_limit,
            }).target_offset,
          ).toBe(target_offset + shown);
        }

        const page = new Set([
          ...output.targets_resolved.map(token),
          ...output.unchecked_targets.map(token),
        ]);
        expect(page.size).toBe(shown);
        for (const item of output.results) {
          for (const row of [...item.failing_targets, ...(item.unchecked_targets ?? [])]) {
            expect(page.has(token(row))).toBe(true);
          }
          expect(item.failing_targets.length).toBeLessThanOrEqual(item.failing_total ?? 0);
        }
        expect(wholeQuery).toEqual(reference.wholeQuery);
      },
    ),
    { numRuns: 25, seed: 20260930 },
  );
});

it('keeps failing_ranges identical on every page and equal to the failing rows a walk collects', async () => {
  const token = (row: { agent: string; version_token: string }) =>
    `${row.agent} ${row.version_token}`;
  /**
   * Keys whose failures change verdict, resume after a passing release, or
   * carry statement fields; multi-key ids judged at feature level; a key with
   * gaps; and entries that are not comparable.
   */
  const POOL = [
    'css.selectors.has',
    'javascript.builtins.Array.fromAsync',
    'api.AudioTrack',
    'css.properties.line-clamp',
    'css.properties.backdrop-filter',
    'api.Element.matches',
    'api.Document.visibilitychange_event',
    'webextensions.api.action.enable',
    'grid',
    'popover',
    'anchor-positioning',
    'http2',
    'nope-xyz',
  ];
  const QUERIES = ['defaults', 'last 2 versions', 'since 2019', 'firefox > 30, safari > 8, ie 11'];
  let runsSeen = 0;

  await fc.assert(
    fc.asyncProperty(
      fc.subarray(POOL, { minLength: 1, maxLength: 4 }),
      fc.constantFrom(...QUERIES),
      fc.integer({ min: 3, max: 10 }),
      async (features, targets, target_limit) => {
        const pages: ReturnType<typeof browsercompatCompareSupport.output.parse>[] = [];
        let target_offset: number | undefined = 0;
        while (target_offset !== undefined) {
          const result: Awaited<ReturnType<typeof runToolContract>> = await runToolContract(
            browsercompatCompareSupport,
            { features, targets, target_offset, target_limit },
          );
          expect(result.isError).not.toBe(true);
          pages.push(browsercompatCompareSupport.output.parse(result.structuredContent));
          target_offset = (result.structuredContent as { nextOffset?: number }).nextOffset;
        }
        const first = pages[0];
        if (!first) throw new Error('a walk returns at least one page');
        /** Every page's rows in page order rebuild the query's token order. */
        const tokens = pages.flatMap((page) =>
          [...page.targets_resolved, ...page.unchecked_targets]
            .map(token)
            .filter((value, index, all) => all.indexOf(value) === index),
        );
        const queryOrder = (await getTargetsService()).queryTokens(targets);
        expect([...tokens].sort()).toEqual([...queryOrder].sort());

        first.results.forEach((result, position) => {
          for (const page of pages) {
            expect(page.results[position]?.failing_ranges).toEqual(result.failing_ranges);
          }
          if (result.failing_total === undefined) {
            expect(result.failing_ranges).toBeUndefined();
            return;
          }
          const rows = pages.flatMap((page) => page.results[position]?.failing_targets ?? []);
          /** Expanding each run over the query must reproduce the failing rows, in order. */
          const expanded: { agent: string; verdict: string; index: number }[] = [];
          for (const range of result.failing_ranges ?? []) {
            const start = queryOrder.indexOf(`${range.agent} ${range.newest}`);
            expect(start).toBeGreaterThanOrEqual(0);
            expect(queryOrder[start + range.count - 1]).toBe(`${range.agent} ${range.oldest}`);
            for (let step = 0; step < range.count; step++) {
              expanded.push({ agent: range.agent, verdict: range.verdict, index: start + step });
            }
          }
          expect(expanded).toEqual(
            rows.map((row) => ({
              agent: row.agent,
              verdict: row.verdict,
              index: queryOrder.indexOf(token(row)),
            })),
          );
          expect(expanded).toHaveLength(result.failing_total);
          /** Runs are maximal: two that touch never share agent and verdict. */
          const ranges = result.failing_ranges ?? [];
          runsSeen += ranges.length;
          for (let i = 1; i < ranges.length; i++) {
            const before = ranges[i - 1];
            const after = ranges[i];
            const touching =
              queryOrder.indexOf(`${after?.agent} ${after?.newest}`) ===
              queryOrder.indexOf(`${before?.agent} ${before?.oldest}`) + 1;
            if (touching) {
              expect(before?.agent === after?.agent && before?.verdict === after?.verdict).toBe(
                false,
              );
            }
          }
        });
      },
    ),
    { numRuns: 15, seed: 20261015 },
  );
  expect(runsSeen).toBeGreaterThan(50);
}, 120_000);
