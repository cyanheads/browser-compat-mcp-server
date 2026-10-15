/**
 * @fileoverview Tests for the shared output shapes and format() renderers
 * used across the compatibility tools.
 * @module tests/tools/compat-shapes.test
 */

import { describe, expect, it } from 'vitest';
import {
  batchCompatKeys,
  COMPAT_KEYS_PAGE_SIZE,
  COMPAT_KEYS_PER_RESULT,
  FEATURES_MAX,
  FEATURES_PER_CALL,
  FeatureSupportRowSchema,
  formatBaselineLine,
  formatBatchCompatKeys,
  formatCompatKeys,
  formatFeatureSupportRow,
  formatLimitingBrowser,
  formatOmittedFeatures,
  formatStatementParts,
  formatSupportRow,
  formatSupportSummary,
  LimitingBrowserSchema,
  OtherStatementSchema,
  SupportRowSchema,
  sliceCompatKeys,
} from '@/mcp-server/tools/definitions/compat-shapes.js';

describe('formatLimitingBrowser (#30)', () => {
  it('renders an exact release without the upper-bound flag', () => {
    expect(
      formatLimitingBrowser({ browser_id: 'firefox', name: 'Firefox', version: '121' }, 'key'),
    ).toBe('**Limiting browser:** Firefox (firefox) 121 — full support in every core browser');
  });

  it('renders a ≤ bound as the release plus version_is_upper_bound', () => {
    expect(
      formatLimitingBrowser(
        { browser_id: 'edge', name: 'Edge', version: '18', version_is_upper_bound: true },
        'key',
      ),
    ).toBe(
      '**Limiting browser:** Edge (edge) 18 · version_is_upper_bound true — full support in every core browser',
    );
  });

  it('names the feature-level basis for a requirement read from web-features', () => {
    expect(
      formatLimitingBrowser({ browser_id: 'edge', name: 'Edge', version: '16' }, 'feature'),
    ).toBe(
      '**Limiting browser:** Edge (edge) 16 — web-features lists every core browser for the feature as a whole',
    );
  });

  it('escapes literal markup in the name, id, and version, and keeps the schema field optional', () => {
    expect(
      formatLimitingBrowser({ browser_id: '*b*', name: '<b>*x*</b>', version: '1|2' }, 'key'),
    ).toBe(
      '**Limiting browser:** &lt;b&gt;\\*x\\*&lt;/b&gt; (\\*b\\*) 1\\|2 — full support in every core browser',
    );
    expect(
      LimitingBrowserSchema.safeParse({ browser_id: 'a', name: 'A', version: '1' }).success,
    ).toBe(true);
    expect(
      LimitingBrowserSchema.safeParse({
        browser_id: 'a',
        name: 'A',
        version: '1',
        version_is_upper_bound: 'yes',
      }).success,
    ).toBe(false);
  });
});

describe('formatFeatureSupportRow (#26)', () => {
  it('renders a listed release, a ≤ bound, and an unlisted browser', () => {
    expect(formatFeatureSupportRow({ browser_id: 'chrome', supported: true, version: '57' })).toBe(
      '- **chrome**: supported true · version 57',
    );
    expect(
      formatFeatureSupportRow({
        browser_id: 'firefox',
        supported: true,
        version: '66',
        version_is_upper_bound: true,
      }),
    ).toBe('- **firefox**: supported true · version 66 · version_is_upper_bound true');
    expect(formatFeatureSupportRow({ browser_id: 'chrome', supported: false })).toBe(
      '- **chrome**: supported false',
    );
  });

  it('requires supported and accepts a row without a version', () => {
    expect(FeatureSupportRowSchema.safeParse({ browser_id: 'chrome' }).success).toBe(false);
    expect(
      FeatureSupportRowSchema.safeParse({ browser_id: 'chrome', supported: false }).success,
    ).toBe(true);
  });
});

describe('formatBaselineLine', () => {
  it('renders only the state when no dates are present', () => {
    expect(formatBaselineLine({ state: 'not_mapped' })).toBe('**Baseline: not_mapped**');
  });

  it('renders every present field, in order', () => {
    expect(
      formatBaselineLine({
        state: 'widely',
        since_date: '2023-12-19',
        high_date: '2026-06-19',
        date_is_upper_bound: true,
      }),
    ).toBe(
      '**Baseline: widely** · since_date 2023-12-19 · high_date 2026-06-19 · date_is_upper_bound true',
    );
  });
});

describe('formatSupportRow', () => {
  it('renders only the verdict line for a bare unsupported row', () => {
    expect(
      formatSupportRow({
        browser_id: 'ie',
        browser_name: 'Internet Explorer',
        verdict: 'unsupported',
      }),
    ).toEqual(['- **Internet Explorer** (ie): unsupported']);
  });

  it('renders every optional field present, each on its own line', () => {
    const lines = formatSupportRow({
      browser_id: 'firefox',
      browser_name: 'Firefox',
      verdict: 'removed',
      version_added: '43',
      version_added_is_upper_bound: true,
      version_removed: '52',
      version_last: '51',
      partial: true,
      prefix: 'moz',
      alternative_name: 'MozBattery',
      flags: [{ name: 'dom.battery', type: 'preference', value_to_set: 'true' }],
      notes: ['Note one', 'Note two'],
      impl_url: ['https://bugzil.la/1', 'https://bugzil.la/2'],
    });
    expect(lines).toEqual([
      '- **Firefox** (firefox): removed',
      '  - version_added: 43',
      '  - version_added_is_upper_bound: true',
      '  - version_removed: 52',
      '  - version_last: 51',
      '  - partial: true',
      '  - prefix: moz',
      '  - alternative_name: MozBattery',
      '  - flags: preference dom.battery value_to_set true',
      '  - notes: Note one | Note two',
      '  - impl_url: <https://bugzil.la/1> <https://bugzil.la/2>',
    ]);
  });

  it('renders a flag with no value_to_set without the trailing fragment', () => {
    const lines = formatSupportRow({
      browser_id: 'chrome',
      browser_name: 'Chrome',
      verdict: 'flagged',
      flags: [{ name: 'enable-experimental', type: 'runtime_flag' }],
    });
    expect(lines).toContain('  - flags: runtime_flag enable-experimental');
  });

  it('#27: renders other_statements after the row, one line each, in order', () => {
    const lines = formatSupportRow({
      browser_id: 'safari',
      browser_name: 'Safari',
      verdict: 'prefixed',
      version_added: '3',
      prefix: '-webkit-',
      other_statements: [
        { version_added: 'preview' },
        { version_added: '2', version_removed: '3', version_last: '2', prefix: '-khtml-' },
        { notes: ['Only notes'] },
      ],
    });
    expect(lines).toEqual([
      '- **Safari** (safari): prefixed',
      '  - version_added: 3',
      '  - prefix: -webkit-',
      '  - other_statements (3):',
      '    - version_added preview',
      '    - version_added 2 · version_removed 3 · version_last 2 · prefix -khtml-',
      '    - notes Only notes',
    ]);
  });

  it('#27: a row without other_statements renders no list line', () => {
    expect(
      formatSupportRow({ browser_id: 'chrome', browser_name: 'Chrome', verdict: 'supported' }),
    ).toEqual(['- **Chrome** (chrome): supported']);
  });
});

describe('formatStatementParts (#27)', () => {
  it('renders every field present, in schema order, escaping literal markup', () => {
    expect(
      formatStatementParts({
        version_added: '9',
        version_added_is_upper_bound: true,
        version_removed: '20',
        version_last: '19',
        partial: true,
        prefix: '-webkit-',
        alternative_name: '<b>alt</b>',
        flags: [
          { name: 'a.flag', type: 'preference', value_to_set: 'true' },
          { name: 'b', type: 'runtime_flag' },
        ],
        notes: ['one', 'two'],
        impl_url: ['https://example.test/1'],
      }),
    ).toEqual([
      'version_added 9',
      'version_added_is_upper_bound true',
      'version_removed 20',
      'version_last 19',
      'partial true',
      'prefix -webkit-',
      'alternative_name &lt;b&gt;alt&lt;/b&gt;',
      'flags preference a.flag value_to_set true',
      'flags runtime_flag b',
      'notes one | two',
      'impl_url <https://example.test/1>',
    ]);
  });

  it('returns no parts for a statement with no fields, and the row says so', () => {
    expect(formatStatementParts({})).toEqual([]);
    expect(
      formatSupportRow({
        browser_id: 'firefox',
        browser_name: 'Firefox',
        verdict: 'unknown',
        other_statements: [{}],
      }),
    ).toContain('    - no qualifiers');
  });

  it('the support-row schema accepts other_statements and rejects a malformed entry', () => {
    const base = { browser_id: 'safari', browser_name: 'Safari', verdict: 'supported' };
    expect(
      SupportRowSchema.safeParse({ ...base, other_statements: [{ version_added: 'preview' }] })
        .success,
    ).toBe(true);
    expect(
      SupportRowSchema.safeParse({ ...base, other_statements: [{ partial: 'yes' }] }).success,
    ).toBe(false);
    expect(OtherStatementSchema.safeParse({ prefix: '-webkit-', notes: ['n'] }).success).toBe(true);
  });
});

describe('formatSupportSummary', () => {
  it('renders a version for a supported row, — for unsupported/removed/preview_only, ? for unknown', () => {
    const summary = formatSupportSummary([
      { browser_id: 'chrome', browser_name: 'Chrome', verdict: 'supported', version_added: '105' },
      { browser_id: 'ie', browser_name: 'Internet Explorer', verdict: 'unsupported' },
      { browser_id: 'firefox', browser_name: 'Firefox', verdict: 'removed', version_added: '43' },
      { browser_id: 'safari', browser_name: 'Safari', verdict: 'preview_only' },
      { browser_id: 'opera', browser_name: 'Opera', verdict: 'unknown' },
    ]);
    expect(summary).toBe('Chrome 105, Internet Explorer —, Firefox —, Safari —, Opera ?');
  });

  it('falls back to — for a supported-family verdict with no version_added recorded', () => {
    // Defensive case: a partial/flagged/prefixed row always carries
    // version_added in practice, but the renderer must not crash if it didn't.
    const summary = formatSupportSummary([
      { browser_id: 'chrome', browser_name: 'Chrome', verdict: 'partial' },
    ]);
    expect(summary).toBe('Chrome —');
  });
});

describe('sliceCompatKeys (#25)', () => {
  const keys = Array.from({ length: 614 }, (_, index) => `k${index}`);

  it('pins the page sizes: 100 per get_feature page, 10 per batch result', () => {
    expect(COMPAT_KEYS_PAGE_SIZE).toBe(100);
    expect(COMPAT_KEYS_PER_RESULT).toBe(10);
  });

  it.each([
    { offset: 0, size: 100, length: 100, first: 'k0', next: 100 },
    { offset: 500, size: 100, length: 100, first: 'k500', next: 600 },
    { offset: 600, size: 100, length: 14, first: 'k600', next: undefined },
    { offset: 613, size: 100, length: 1, first: 'k613', next: undefined },
    { offset: 614, size: 100, length: 0, first: undefined, next: undefined },
    { offset: 9000, size: 100, length: 0, first: undefined, next: undefined },
    { offset: 0, size: 10, length: 10, first: 'k0', next: 10 },
  ])(
    'offset $offset, size $size → $length keys, next $next',
    ({ offset, size, length, first, next }) => {
      const slice = sliceCompatKeys(keys, offset, size);
      expect(slice.compat_keys).toHaveLength(length);
      expect(slice.compat_keys[0]).toBe(first);
      expect(slice.compat_keys_total).toBe(614);
      expect(slice.nextOffset).toBe(next);
    },
  );

  it('a list that fits, or is empty, carries no continuation', () => {
    expect(sliceCompatKeys(keys.slice(0, 10), 0, 10)).toEqual({
      compat_keys: keys.slice(0, 10),
      compat_keys_total: 10,
    });
    expect(sliceCompatKeys([], 0, 10)).toEqual({ compat_keys: [], compat_keys_total: 0 });
  });

  it('pages walk every key once, in order', () => {
    const walked: string[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined) {
      const slice = sliceCompatKeys(keys, offset, 100);
      walked.push(...slice.compat_keys);
      offset = slice.nextOffset;
    }
    expect(walked).toEqual(keys);
  });
});

describe('formatCompatKeys (#25)', () => {
  it('states N of T with the keys, an empty page past the end, and a zero-key entry', () => {
    expect(formatCompatKeys(['a.b', 'a_c'], 61)).toBe('2 of 61: a.b, a_c');
    expect(formatCompatKeys([], 614)).toBe('0 of 614 on this page');
    expect(formatCompatKeys([], 0)).toBe('none — this entry owns no browser-compat-data keys');
    expect(formatCompatKeys(['<x>'], 1)).toBe('1 of 1: &lt;x&gt;');
  });

  it('batch results keep the first 10 keys and point to get_feature only when keys were left out', () => {
    const keys = Array.from({ length: 61 }, (_, index) => `k${index}`);
    expect(batchCompatKeys(keys)).toEqual({
      compat_keys: keys.slice(0, 10),
      compat_keys_total: 61,
    });
    expect(batchCompatKeys(keys.slice(0, 10))).toEqual({
      compat_keys: keys.slice(0, 10),
      compat_keys_total: 10,
    });
    expect(batchCompatKeys([])).toEqual({ compat_keys: [], compat_keys_total: 0 });
    expect(formatBatchCompatKeys(keys.slice(0, 2), 61, 'grid')).toBe(
      '2 of 61: k0, k1 — call browsercompat_get_feature with grid for all 61',
    );
    expect(formatBatchCompatKeys(keys.slice(0, 2), 101, 'svg')).toBe(
      '2 of 101: k0, k1 — call browsercompat_get_feature with svg for all 101, 100 per page through compat_keys_offset',
    );
    expect(formatBatchCompatKeys(keys.slice(0, 2), 100, 'svg')).toBe(
      '2 of 100: k0, k1 — call browsercompat_get_feature with svg for all 100',
    );
    expect(formatBatchCompatKeys(keys.slice(0, 2), 2, 'grid')).toBe('2 of 2: k0, k1');
    expect(formatBatchCompatKeys([], 0, 'http2')).toBe(
      'none — this entry owns no browser-compat-data keys',
    );
  });
});

describe('formatOmittedFeatures (#29)', () => {
  it('pins the per-call cap and the ceiling', () => {
    expect(FEATURES_PER_CALL).toBe(20);
    expect(FEATURES_MAX).toBe(100);
  });

  it('names the count and the entries as copyable next-call input, verbatim', () => {
    expect(formatOmittedFeatures(['grid'])).toBe(
      '**omitted_features:** 1 entry past the first 20 was not evaluated — call again with features set to `["grid"]`',
    );
    expect(formatOmittedFeatures([' has', 'a`b'])).toBe(
      '**omitted_features:** 2 entries past the first 20 were not evaluated — call again with features set to ``[" has","a`b"]``',
    );
  });
});
