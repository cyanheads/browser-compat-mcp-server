/**
 * @fileoverview Tests for the data-version service: the resolved vintage of
 * every bundled dataset, and its one-line `content[]` rendering.
 * @module tests/services/data-version/data-version-service.test
 */

import { describe, expect, it } from 'vitest';
import {
  DataVersionSchema,
  getDataVersion,
  renderDataVersion,
} from '@/services/data-version/data-version-service.js';

describe('getDataVersion', () => {
  it('resolves every bundled dataset version, matching the installed packages', async () => {
    const version = await getDataVersion();
    expect(version).toEqual({
      bcd: '8.1.1',
      bcd_generated: '2026-09-10T16:02:02.250Z',
      web_features: '3.38.0',
      caniuse_lite: '1.0.30001810',
      browserslist: '4.29.0',
    });
  });

  it('conforms to DataVersionSchema', async () => {
    const version = await getDataVersion();
    expect(() => DataVersionSchema.parse(version)).not.toThrow();
  });

  it('is memoized — repeated calls return the same resolved object', async () => {
    const first = await getDataVersion();
    const second = await getDataVersion();
    expect(first).toBe(second);
  });
});

describe('renderDataVersion', () => {
  it('renders every field on one line, dot-separated', () => {
    const rendered = renderDataVersion({
      bcd: '8.1.1',
      bcd_generated: '2026-09-10T16:02:02.250Z',
      web_features: '3.38.0',
      caniuse_lite: '1.0.30001810',
      browserslist: '4.29.0',
    });
    expect(rendered).toBe(
      '**Data:** browser-compat-data 8.1.1 (generated 2026-09-10T16:02:02.250Z) · ' +
        'web-features 3.38.0 · caniuse-lite 1.0.30001810 · browserslist 4.29.0',
    );
  });
});
