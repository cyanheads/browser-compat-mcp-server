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
});
