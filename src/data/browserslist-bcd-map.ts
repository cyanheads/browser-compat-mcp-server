/**
 * @fileoverview Hand-maintained mapping from browserslist/caniuse agent ids to
 * browser-compat-data browser ids. Declares all 19 agents explicitly — mapped or
 * `null` — so an agent added to caniuse-lite surfaces as an unchecked target
 * rather than disappearing from the comparison.
 * @module data/browserslist-bcd-map
 */

/**
 * Every caniuse agent id, mapped to its browser-compat-data counterpart or to
 * `null` where no counterpart exists. `webview_ios` is the one reported BCD
 * browser with no agent, so it never appears as a target.
 */
export const BROWSERSLIST_BCD_MAP = {
  chrome: 'chrome',
  and_chr: 'chrome_android',
  edge: 'edge',
  firefox: 'firefox',
  and_ff: 'firefox_android',
  ie: 'ie',
  opera: 'opera',
  op_mob: 'opera_android',
  safari: 'safari',
  ios_saf: 'safari_ios',
  samsung: 'samsunginternet_android',
  android: 'webview_android',
  op_mini: null,
  bb: null,
  and_uc: null,
  and_qq: null,
  baidu: null,
  kaios: null,
  ie_mob: null,
} as const satisfies Record<string, string | null>;

/** A caniuse agent id declared in {@link BROWSERSLIST_BCD_MAP}. */
export type BrowserslistAgentId = keyof typeof BROWSERSLIST_BCD_MAP;

/** Resolve a caniuse agent id to a BCD browser id, or `null` when none exists. */
export function bcdBrowserForAgent(agent: string): string | null {
  return (BROWSERSLIST_BCD_MAP as Record<string, string | null | undefined>)[agent] ?? null;
}

/** True when the agent id is declared in the map, mapped or not. */
export function isDeclaredAgent(agent: string): agent is BrowserslistAgentId {
  return Object.hasOwn(BROWSERSLIST_BCD_MAP, agent);
}
