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

it('keeps target pages, continuations, and whole-query answers coherent across generated offsets and limits', async () => {
  /** A compared key with gaps, a failing key, a clean key, and an entry that is not comparable. */
  const call = async (paging: { target_offset?: number; target_limit?: number }) => {
    const result = await runToolContract(browsercompatCompareSupport, {
      features: [
        'css.selectors.has',
        'javascript.builtins.Array.fromAsync',
        'webextensions.api.action.enable',
        'grid',
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
      fc.integer({ min: 1, max: 10 }),
      async (target_offset, target_limit) => {
        const { structured, output, wholeQuery } = await call({ target_offset, target_limit });
        const shown = Math.min(target_limit, Math.max(0, total - target_offset));
        const remaining = target_offset + shown < total;

        expect(structured).toMatchObject({
          totalCount: total,
          shown,
          cap: target_limit,
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
