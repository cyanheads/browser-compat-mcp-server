/**
 * @fileoverview Smoke test: the tool array registered with `createApp()` in
 * `src/index.ts` — the literal set the MCP `tools/list` response is built
 * from — carries exactly the five `browsercompat_*` tools with the declared
 * annotations, and the repo declares zero resource or prompt definitions.
 *
 * `src/index.ts` is never imported here: it calls `createApp()` at module top
 * level with a top-level `await`, which starts a real transport (stdio) —
 * exactly what a test process must not trigger. Importing the same five
 * definitions it registers, in the same order, is a faithful check of what
 * `tools/list` advertises without paying that cost.
 * @module tests/smoke/tools-list.smoke.test
 */

import { readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { browsercompatCheckBaseline } from '@/mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { browsercompatGetFeature } from '@/mcp-server/tools/definitions/browsercompat-get-feature.tool.js';
import { browsercompatListReference } from '@/mcp-server/tools/definitions/browsercompat-list-reference.tool.js';
import { browsercompatSearchFeatures } from '@/mcp-server/tools/definitions/browsercompat-search-features.tool.js';

// Mirrors the `tools:` array passed to `createApp()` in src/index.ts verbatim.
const REGISTERED_TOOLS = [
  browsercompatListReference,
  browsercompatGetFeature,
  browsercompatCheckBaseline,
  browsercompatSearchFeatures,
  browsercompatCompareSupport,
];

describe('tools/list surface', () => {
  it('advertises direct-child paging with a default zero offset and rejects invalid offsets', () => {
    expect(browsercompatGetFeature.input.parse({ feature: 'api.Element' }).subkeys_offset).toBe(0);
    expect(
      browsercompatGetFeature.input.safeParse({ feature: 'api.Element', subkeys_offset: -1 })
        .success,
    ).toBe(false);
    expect(browsercompatGetFeature.output.shape.subkeys).toBeDefined();
    expect(browsercompatGetFeature.output.shape.discouraged).toBeDefined();
  });

  it('advertises target paging with a zero offset and a ten-target page, and rejects values outside the bounds', () => {
    const base = { features: ['has'], targets: 'defaults' };
    expect(browsercompatCompareSupport.input.parse(base)).toMatchObject({
      target_offset: 0,
      target_limit: 10,
    });
    expect(
      browsercompatCompareSupport.input.parse({ ...base, target_offset: 30, target_limit: 1 }),
    ).toMatchObject({ target_offset: 30, target_limit: 1 });
    for (const paging of [
      { target_offset: -1 },
      { target_offset: 0.5 },
      { target_offset: '10' },
      { target_limit: 0 },
      { target_limit: 11 },
      { target_limit: 2.5 },
    ]) {
      expect(browsercompatCompareSupport.input.safeParse({ ...base, ...paging }).success).toBe(
        false,
      );
    }
    for (const field of [
      'comparable_features',
      'targets_resolved_total',
      'evaluated_targets_total',
      'unchecked_targets_total',
    ] as const) {
      expect(browsercompatCompareSupport.output.shape[field]).toBeDefined();
    }
    expect(Object.keys(browsercompatCompareSupport.enrichment ?? {}).sort()).toEqual(
      [
        'attribution',
        'cap',
        'data_version',
        'nextOffset',
        'offsetNotice',
        'shown',
        'totalCount',
        'truncated',
        'uncheckedNotice',
      ].sort(),
    );
  });
  it('exposes exactly the five browsercompat_* tools', () => {
    expect(REGISTERED_TOOLS).toHaveLength(5);
    expect(REGISTERED_TOOLS.map((tool) => tool.name).sort()).toEqual([
      'browsercompat_check_baseline',
      'browsercompat_compare_support',
      'browsercompat_get_feature',
      'browsercompat_list_reference',
      'browsercompat_search_features',
    ]);
  });

  it('every tool declares readOnlyHint, idempotentHint, and openWorldHint: false', () => {
    for (const tool of REGISTERED_TOOLS) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('declares an errors[] contract only where the design specifies one', () => {
    const withContracts = REGISTERED_TOOLS.filter((tool) => tool.errors !== undefined).map(
      (tool) => tool.name,
    );
    expect(withContracts.sort()).toEqual(
      [
        'browsercompat_get_feature',
        'browsercompat_check_baseline',
        'browsercompat_search_features',
        'browsercompat_compare_support',
      ].sort(),
    );
    expect(browsercompatListReference.errors).toBeUndefined();
  });
});

describe('resources and prompts — none (D17/D18)', () => {
  it('contains no resource or prompt definition files', () => {
    const srcRoot = fileURLToPath(new URL('../../src/mcp-server', import.meta.url));
    const definitions = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' }).filter(
      (entry) =>
        entry.startsWith(`resources${sep}definitions${sep}`) ||
        entry.startsWith(`prompts${sep}definitions${sep}`),
    );
    expect(definitions).toEqual([]);
  });

  it('the tools/definitions directory contains only the five known tool files plus the shared shapes module', () => {
    const definitionsDir = fileURLToPath(
      new URL('../../src/mcp-server/tools/definitions', import.meta.url),
    );
    const files = readdirSync(definitionsDir).sort();
    expect(files).toEqual(
      [
        'browsercompat-check-baseline.tool.ts',
        'browsercompat-compare-support.tool.ts',
        'browsercompat-get-feature.tool.ts',
        'browsercompat-list-reference.tool.ts',
        'browsercompat-search-features.tool.ts',
        'compat-shapes.ts',
      ].sort(),
    );
  });
});
