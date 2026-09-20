/**
 * @fileoverview Fuzz coverage for the five browsercompat tools — valid,
 * adversarial, and wrong-type inputs against every handler, asserting no crash
 * past the framework, no stack trace or filesystem path in an error message, and
 * no prototype pollution.
 * @module tests/fuzz/tools.fuzz.test
 */

import type { AnyToolDefinition } from '@cyanheads/mcp-ts-core';
import { fuzzTool } from '@cyanheads/mcp-ts-core/testing/fuzz';
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
