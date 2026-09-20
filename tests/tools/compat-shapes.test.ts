/**
 * @fileoverview Tests for the shared output shapes and format() renderers
 * used across the compatibility tools.
 * @module tests/tools/compat-shapes.test
 */

import { describe, expect, it } from 'vitest';
import {
  formatBaselineLine,
  formatSupportRow,
  formatSupportSummary,
} from '@/mcp-server/tools/definitions/compat-shapes.js';

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
      '  - impl_url: https://bugzil.la/1 https://bugzil.la/2',
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
