/**
 * @fileoverview Tests for the browserslist-to-BCD agent map.
 * @module tests/data/browserslist-bcd-map.test
 */

import browserslist from 'browserslist';
import { describe, expect, it } from 'vitest';
import {
  BROWSERSLIST_BCD_MAP,
  bcdBrowserForAgent,
  isDeclaredAgent,
} from '@/data/browserslist-bcd-map.js';

describe('BROWSERSLIST_BCD_MAP', () => {
  it('declares all 19 real caniuse agents, mapped or null (D24)', () => {
    const realAgents = Object.keys(browserslist.data);
    expect(realAgents).toHaveLength(19);
    for (const agent of realAgents) {
      expect(Object.hasOwn(BROWSERSLIST_BCD_MAP, agent)).toBe(true);
    }
    // The map declares nothing beyond the real agent set either.
    expect(Object.keys(BROWSERSLIST_BCD_MAP).sort()).toEqual(realAgents.sort());
  });

  it('maps the 12 documented agents to their BCD browser id', () => {
    expect(BROWSERSLIST_BCD_MAP.chrome).toBe('chrome');
    expect(BROWSERSLIST_BCD_MAP.and_chr).toBe('chrome_android');
    expect(BROWSERSLIST_BCD_MAP.edge).toBe('edge');
    expect(BROWSERSLIST_BCD_MAP.firefox).toBe('firefox');
    expect(BROWSERSLIST_BCD_MAP.and_ff).toBe('firefox_android');
    expect(BROWSERSLIST_BCD_MAP.ie).toBe('ie');
    expect(BROWSERSLIST_BCD_MAP.opera).toBe('opera');
    expect(BROWSERSLIST_BCD_MAP.op_mob).toBe('opera_android');
    expect(BROWSERSLIST_BCD_MAP.safari).toBe('safari');
    expect(BROWSERSLIST_BCD_MAP.ios_saf).toBe('safari_ios');
    expect(BROWSERSLIST_BCD_MAP.samsung).toBe('samsunginternet_android');
    expect(BROWSERSLIST_BCD_MAP.android).toBe('webview_android');
  });

  it('maps the 7 undocumented agents to null', () => {
    for (const agent of [
      'op_mini',
      'bb',
      'and_uc',
      'and_qq',
      'baidu',
      'kaios',
      'ie_mob',
    ] as const) {
      expect(BROWSERSLIST_BCD_MAP[agent]).toBeNull();
    }
  });
});

describe('bcdBrowserForAgent', () => {
  it('resolves a mapped agent to its BCD browser id', () => {
    expect(bcdBrowserForAgent('chrome')).toBe('chrome');
    expect(bcdBrowserForAgent('and_chr')).toBe('chrome_android');
  });

  it('returns null for an agent explicitly mapped to null', () => {
    expect(bcdBrowserForAgent('op_mini')).toBeNull();
  });

  it('returns null for an agent absent from the map entirely', () => {
    expect(bcdBrowserForAgent('not_a_real_agent')).toBeNull();
  });
});

describe('isDeclaredAgent', () => {
  it('is true for every declared agent, mapped or not', () => {
    expect(isDeclaredAgent('chrome')).toBe(true);
    expect(isDeclaredAgent('op_mini')).toBe(true);
  });

  it('is false for an agent the map does not declare at all', () => {
    expect(isDeclaredAgent('not_a_real_agent')).toBe(false);
  });
});
