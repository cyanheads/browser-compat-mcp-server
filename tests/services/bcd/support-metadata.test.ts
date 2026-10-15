/**
 * @fileoverview Synthetic BCD support metadata and limiting-browser regression coverage.
 * @module tests/services/bcd/support-metadata.test
 */

import type {
  CompatStatement,
  SimpleSupportStatement,
  SupportStatement,
} from '@mdn/browser-compat-data/types';
import { describe, expect, it } from 'vitest';
import { BcdService } from '@/services/bcd/bcd-service.js';

const releases = {
  '1': { index: 0, status: 'retired', release_date: '2020-01-01' },
  '2': { index: 1, status: 'current', release_date: '2021-01-01' },
  '3': { index: 2, status: 'planned', release_date: '2027-01-01' },
};
const service = new BcdService({
  __meta: { version: 'fixture', timestamp: '2020-01-01' },
  browsers: {
    chrome: { name: 'Chrome', type: 'desktop', releases },
    firefox: { name: 'Firefox', type: 'desktop', releases },
    safari: { name: 'Safari', type: 'desktop', releases: {} },
  },
});
const leaf = (entry: SupportStatement): CompatStatement => ({
  source_file: 'api/Fixture.json',
  support: { chrome: { version_added: '1' }, firefox: entry },
});

describe('selection characterization', () => {
  it('chooses clean coverage ahead of partial/prefixed/flagged entries without merging their metadata', () => {
    const result = service.supportAt(
      leaf([
        { version_added: '1', flags: [{ type: 'preference', name: 'flag' }], notes: 'flagged' },
        { version_added: '1', prefix: 'moz', notes: 'prefixed' },
        { version_added: '1', partial_implementation: true, notes: 'partial' },
        { version_added: '2', notes: 'clean', impl_url: 'https://example.test/clean' },
      ]),
      'firefox',
      1,
    );
    expect(result).toEqual({
      verdict: 'supported',
      detail: { version_added: '2', notes: ['clean'], impl_url: ['https://example.test/clean'] },
    });
  });

  it('chooses the latest removed interval and preserves its qualifiers and version_last', () => {
    expect(
      service.supportAt(
        leaf([
          {
            version_added: '1',
            version_removed: '2',
            version_last: '1',
            prefix: 'moz',
            notes: 'removed',
          },
          { version_added: false, notes: 'not implemented' },
        ]),
        'firefox',
        1,
      ),
    ).toEqual({
      verdict: 'removed',
      detail: {
        version_added: '1',
        version_removed: '2',
        version_last: '1',
        prefix: 'moz',
        notes: ['removed'],
      },
    });
  });

  it('keeps unknown before an upper bound and does not borrow future metadata', () => {
    expect(
      service.supportAt(leaf({ version_added: '≤2', notes: 'unknown history' }), 'firefox', 0),
    ).toEqual({ verdict: 'unknown', detail: {} });
    expect(
      service.supportAt(
        leaf({ version_added: '3', notes: 'future', impl_url: 'https://example.test/future' }),
        'firefox',
        1,
      ),
    ).toEqual({ verdict: 'unsupported', detail: {} });
  });
});

describe('#11 unavailable metadata', () => {
  it.each([false, 'preview'] as const)(
    'merges only %s statements in declaration order with stable deduplication',
    (version_added) => {
      const opposite = version_added === false ? 'preview' : false;
      const statements: [
        SimpleSupportStatement,
        SimpleSupportStatement,
        ...SimpleSupportStatement[],
      ] = [
        { version_added, notes: 'one', impl_url: 'https://example.test/one' },
        {
          version_added,
          notes: ['two', 'one'],
          impl_url: ['https://example.test/two', 'https://example.test/one'],
        },
        ...(version_added === 'preview'
          ? [{ version_added: opposite, notes: 'other verdict' } as SimpleSupportStatement]
          : []),
      ];
      expect(service.supportAt(leaf(statements), 'firefox', 1)).toEqual({
        verdict: version_added === false ? 'unsupported' : 'preview_only',
        detail: {
          notes: ['one', 'two'],
          impl_url: ['https://example.test/one', 'https://example.test/two'],
        },
      });
    },
  );

  it('uses only false metadata when a numeric statement is still in the future', () => {
    expect(
      service.supportAt(
        leaf([
          { version_added: '3', notes: 'future' },
          { version_added: false, notes: 'not yet' },
          { version_added: 'preview', notes: 'preview' },
        ]),
        'firefox',
        1,
      ),
    ).toEqual({ verdict: 'unsupported', detail: { notes: ['not yet'] } });
  });

  it('preserves absent metadata and unknown outcomes', () => {
    expect(service.supportAt(leaf({ version_added: false }), 'firefox', 1)).toEqual({
      verdict: 'unsupported',
      detail: {},
    });
    expect(
      service.supportAt(
        leaf([{ version_added: '≤3' }, { version_added: false, notes: 'no' }]),
        'firefox',
        1,
      ),
    ).toEqual({ verdict: 'unknown', detail: {} });
  });
});

describe('#27 other_statements beside a support row', () => {
  /** supportRows reads each browser at its newest shipped release: '2', index 1. */
  const row = (entry: SupportStatement) => service.supportRows(leaf(entry), ['firefox'])[0];

  it('lists every statement but the cleanest covering one, in declaration order, with notes and links', () => {
    expect(
      row([
        { version_added: '1', flags: [{ type: 'preference', name: 'flag' }], notes: 'flagged' },
        { version_added: '1', prefix: 'moz', notes: 'prefixed' },
        { version_added: '1', partial_implementation: true, impl_url: 'https://example.test/p' },
        { version_added: '2', notes: 'clean' },
      ]),
    ).toEqual({
      browser_id: 'firefox',
      browser_name: 'Firefox',
      verdict: 'supported',
      version_added: '2',
      notes: ['clean'],
      other_statements: [
        {
          version_added: '1',
          flags: [{ name: 'flag', type: 'preference' }],
          notes: ['flagged'],
        },
        { version_added: '1', prefix: 'moz', notes: ['prefixed'] },
        { version_added: '1', partial: true, impl_url: ['https://example.test/p'] },
      ],
    });
  });

  it('a tie between equally clean statements keeps the first as the row and lists the second', () => {
    expect(
      row([
        { version_added: '1', alternative_name: 'first' },
        { version_added: '1', alternative_name: 'second', version_removed: '3' },
      ]),
    ).toEqual({
      browser_id: 'firefox',
      browser_name: 'Firefox',
      verdict: 'prefixed',
      version_added: '1',
      alternative_name: 'first',
      other_statements: [{ version_added: '1', alternative_name: 'second', version_removed: '3' }],
    });
  });

  it('a removed row is the latest range, though BCD lists it second; the earlier range is listed with its ≤ bound split out', () => {
    expect(
      row([
        { version_added: '≤1', version_removed: '1', prefix: 'moz' },
        { version_added: '1', version_removed: '2', version_last: '1' },
      ]),
    ).toEqual({
      browser_id: 'firefox',
      browser_name: 'Firefox',
      verdict: 'removed',
      version_added: '1',
      version_removed: '2',
      version_last: '1',
      other_statements: [
        {
          version_added: '1',
          version_added_is_upper_bound: true,
          version_removed: '1',
          prefix: 'moz',
        },
      ],
    });
  });

  it('unsupported merges every false statement into the row and lists only the rest', () => {
    expect(
      row([
        { version_added: '3', notes: 'future' },
        { version_added: false, notes: 'not yet' },
        { version_added: 'preview', notes: 'preview' },
      ]),
    ).toEqual({
      browser_id: 'firefox',
      browser_name: 'Firefox',
      verdict: 'unsupported',
      notes: ['not yet'],
      other_statements: [
        { version_added: '3', notes: ['future'] },
        { version_added: 'preview', notes: ['preview'] },
      ],
    });
  });

  it('preview_only merges every preview statement and lists none of them', () => {
    expect(
      row([
        { version_added: 'preview', notes: 'one' },
        { version_added: 'preview', notes: 'two' },
      ]),
    ).toEqual({
      browser_id: 'firefox',
      browser_name: 'Firefox',
      verdict: 'preview_only',
      notes: ['one', 'two'],
    });
  });

  it('an unknown row is built from no statement, so every statement is listed', () => {
    expect(row([{ version_added: '≤3' }, { version_added: false, notes: 'no' }])).toEqual({
      browser_id: 'firefox',
      browser_name: 'Firefox',
      verdict: 'unknown',
      other_statements: [
        { version_added: '3', version_added_is_upper_bound: true },
        { notes: ['no'] },
      ],
    });
  });

  it('one statement, and a browser absent from the leaf, carry no other_statements', () => {
    expect(row({ version_added: '1', prefix: 'moz' })).toStrictEqual({
      browser_id: 'firefox',
      browser_name: 'Firefox',
      verdict: 'prefixed',
      version_added: '1',
      prefix: 'moz',
    });
    expect(service.supportRows(leaf({ version_added: '1' }), ['safari'])[0]).toEqual({
      browser_id: 'safari',
      browser_name: 'Safari',
      verdict: 'unknown',
    });
  });
});

describe('#14 full-support requirement', () => {
  it.each<SimpleSupportStatement>([
    { version_added: '1', partial_implementation: true },
    { version_added: '1', prefix: 'moz' },
    { version_added: '1', alternative_name: 'other' },
    { version_added: '1', flags: [{ type: 'preference', name: 'flag' }] },
    { version_added: 'preview' },
    { version_added: '1', version_removed: '2', version_last: '1' },
    { version_added: false },
    { version_added: '≤3' },
  ])('omits a requirement for a restricted core browser: %j', (statement) => {
    expect(service.limitingBrowser(leaf(statement), ['chrome', 'firefox'])).toBeUndefined();
  });
  it('omits a requirement when a core browser has no shipped release or support record', () => {
    expect(
      service.limitingBrowser(leaf({ version_added: '2' }), ['chrome', 'safari']),
    ).toBeUndefined();
  });
  it('keeps a full-support requirement and release-date ordering', () => {
    expect(service.limitingBrowser(leaf({ version_added: '2' }), ['chrome', 'firefox'])).toEqual({
      browser_id: 'firefox',
      name: 'Firefox',
      version: '2',
    });
  });
  it('breaks a release-date tie toward the first browser in core order', () => {
    expect(service.limitingBrowser(leaf({ version_added: '1' }), ['chrome', 'firefox'])).toEqual({
      browser_id: 'chrome',
      name: 'Chrome',
      version: '1',
    });
    expect(service.limitingBrowser(leaf({ version_added: '1' }), ['firefox', 'chrome'])).toEqual({
      browser_id: 'firefox',
      name: 'Firefox',
      version: '1',
    });
  });
});

describe('#30 limiting_browser keeps a ≤ bound visible', () => {
  it('flags a ≤ added release as an upper bound and keeps version as the release', () => {
    expect(service.limitingBrowser(leaf({ version_added: '≤2' }), ['chrome', 'firefox'])).toEqual({
      browser_id: 'firefox',
      name: 'Firefox',
      version: '2',
      version_is_upper_bound: true,
    });
  });
  it('omits the flag when the limiting browser is exact, even beside a ≤ bound elsewhere', () => {
    const mixed: CompatStatement = {
      source_file: 'api/Fixture.json',
      support: { chrome: { version_added: '≤1' }, firefox: { version_added: '2' } },
    };
    const result = service.limitingBrowser(mixed, ['chrome', 'firefox']);
    expect(result).toEqual({ browser_id: 'firefox', name: 'Firefox', version: '2' });
    expect(result).not.toHaveProperty('version_is_upper_bound');
  });
});
