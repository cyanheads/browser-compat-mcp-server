# browser-compat-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `browsercompat_list_reference` | Enumerate the vocabulary the other tools expect: BCD namespaces, BCD browser ids, browserslist agent ids and their BCD counterparts, Baseline states, web-features groups, and ECMAScript snapshots. | `topic: 'bcd_namespaces' \| 'bcd_browsers' \| 'browserslist_agents' \| 'baseline_states' \| 'groups' \| 'snapshots'` | `readOnlyHint`, `idempotentHint`, `openWorldHint: false` |
| `browsercompat_get_feature` | Get the full compatibility record for one web feature: Baseline state and date, deprecation and standards status, per-browser version-added/removed with flags, prefixes and partial-implementation notes, and MDN/spec links. | `feature: string`, `resolve?: boolean`, `include_runtimes?: boolean`, `subkeys_offset?: number` | `readOnlyHint`, `idempotentHint`, `openWorldHint: false` |
| `browsercompat_check_baseline` | Check whether one or more features are safe to ship: Baseline state and date, the limiting browser and version, deprecated/discouraged flags, and the share of tracked global traffic that would be excluded. | `features: string[]`, `resolve?: boolean` | `readOnlyHint`, `idempotentHint`, `openWorldHint: false` |
| `browsercompat_search_features` | Find web features by plain name or keyword when the canonical key is unknown, across CSS, JavaScript, HTML, Web APIs, SVG, MathML, WebAssembly, and HTTP headers. | `query: string`, `namespace?: string`, `baseline?: string`, `group?: string`, `snapshot?: string`, `limit?: number`, `offset?: number` | `readOnlyHint`, `idempotentHint`, `openWorldHint: false` |
| `browsercompat_compare_support` | Compute whether a set of features clears an explicit browserslist target query: a whole-query verdict and evaluated coverage per feature on every call, with the failing and unevaluated target rows paged ten query targets at a time. | `features: string[]`, `targets: string`, `resolve?: boolean`, `target_offset?: number`, `target_limit?: number` | `readOnlyHint`, `idempotentHint`, `openWorldHint: false` |

### Resources

None. See [D17](#decisions-log).

### Prompts

None. See [D18](#decisions-log).

---

## Overview

Offline reference server for web platform compatibility. It answers the question a coding agent actually has while writing frontend code: *can I use this feature, in which browsers, is it safe to ship, and should I?*

All data ships inside the package — three bundled datasets plus the browserslist query resolver. No network calls at runtime, no API key, no rate limit, no upstream to be down. MDN's `@mdn/browser-compat-data` (BCD) is the authority for per-browser support; the W3C WebDX `web-features` set is the authority for Baseline status; `browserslist` plus its `caniuse-lite` dependency resolve target queries and supply usage weighting.

Audience: any agent writing or reviewing frontend code. This one gets called during ordinary web work, not for a niche domain lookup.

### Identity

| Surface | Value |
|:--------|:------|
| npm package `name` | `@cyanheads/browser-compat-mcp-server` |
| MCP registry (`server.json`, `mcpName`) | `io.github.cyanheads/browser-compat-mcp-server` |
| `createApp()` `name` and `title` | `browser-compat-mcp-server` |
| `manifest.json` `name`, `.claude-plugin` / `.codex-plugin` display name | `browser-compat-mcp-server` |
| Docker image, `.mcpb` filename | `browser-compat-mcp-server` |
| Tool prefix | `browsercompat_` |

The display and machine identity is the bare hyphenated repo name on every surface except the npm package name and the registry identity. Never Title Case it.

No tool declares a `title`. Every natural per-tool title (`Get Feature`, `Check Baseline`) is Title Case, which the identity rule forbids — see D32.

---

## Requirements

- No network calls at runtime. No API keys, no auth, no rate limits, no upstream ToS to clear for hosting.
- No native binaries, no helper processes, no OS permissions — the whole server is JSON reads and in-memory indexing, so nothing in the packaging or hosting path needs a capability grant.
- Every response echoes the data vintage (`data_version`), because a pinned dependency silently returns a stale ship/no-ship verdict on precisely the newest features.
- A feature the server cannot resolve is a result (`found: false` plus `guidance`), never a thrown error.
- A support verdict is never claimed for a browser the server did not evaluate.
- Baseline state is reported per BCD key, not per feature rollup.
- Cold start under 1 s; measured total load of all four datasets is ~116 ms.
- Works offline and air-gapped. Transports: stdio and Streamable HTTP.

## User Goals

1. "Can I use CSS `:has()` / `Array.fromAsync` / `<dialog>`, and in which browsers?" — `browsercompat_get_feature`
2. "Is this feature Baseline, and since when?" — `browsercompat_get_feature`, `browsercompat_check_baseline`
3. "Is this feature deprecated or discouraged?" — `browsercompat_check_baseline`
4. "Is this set of features safe for my browserslist targets?" — `browsercompat_compare_support`
5. "What is the canonical key for the feature I am thinking of?" — `browsercompat_search_features`
6. "Give me the MDN and spec link without a web fetch." — `browsercompat_get_feature`
7. "What browsers / namespaces / Baseline states does this server speak?" — `browsercompat_list_reference`

---

## Data Sources — verified shapes

Counts, fields, and sizes probed 2026-09-22 against the installed tree; cold-load times and resident memory are from the 2026-09-19 probe of the prior data snapshot. Every count and field below was read out of the actual data, not the package docs.

| Package | Version | License | On disk | Gzipped | Cold load |
|:--------|:--------|:--------|:--------|:--------|:----------|
| `@mdn/browser-compat-data` | 8.1.2 | CC0-1.0 | 19 MB (`data.json` 20,226,380 B) | 935,372 B | 52 ms |
| `web-features` | 3.39.0 | Apache-2.0 | 4.6 MB (`data.json` 4,755,440 B) | 400,834 B | 20 ms |
| `caniuse-lite` | 1.0.30001810 | CC-BY-4.0 | 4.2 MB (1,459,992 B across 583 feature files) | 368,640 B (whole dir, tar.gz) | 34 ms (with browserslist) |
| `browserslist` | 4.29.0 | MIT | 104 KB | — | (above) |

Total `node_modules` for the four: **28 MB on disk, ~1.7 MB compressed**. Resident memory after loading all four and building a flat leaf index: **141.8 MB RSS** (12.6 MB baseline).

### BCD (`@mdn/browser-compat-data` 8.1.2)

```
__meta: { "timestamp": "2026-09-17T12:01:51.601Z", "version": "8.1.2" }
```

`__meta` carries exactly two fields — a version and a generation timestamp. There is no separate release-date field.

**12 top-level namespaces**, 20,543 `__compat` leaves:

| Namespace | Leaves | Namespace | Leaves |
|:---|---:|:---|---:|
| `api` | 10,265 | `svg` | 443 |
| `css` | 4,071 | `http` | 414 |
| `webextensions` | 2,075 | `webassembly` | 333 |
| `javascript` | 1,400 | `mathml` | 137 |
| `html` | 824 | `manifests` | 38 |
| `webdriver` | 526 | `mediatypes` | 17 |

**`__compat` leaf fields** (frequency out of 20,543):

| Field | Count | Notes |
|:------|------:|:------|
| `support` | 20,543 | always present |
| `source_file` | 20,543 | internal to BCD; not surfaced |
| `status` | 18,468 | **absent on all 2,075 `webextensions` leaves** |
| `spec_url` | 17,240 (83.9%) | string, or an array of strings (604 leaves) |
| `tags` | 15,566 (75.8%) | 16,344 refs, all `web-features:<id>`, 1,181 distinct ids; 777 leaves carry more than one |
| `mdn_url` | 12,509 (60.9%) | |
| `description` | 5,070 (24.7%) | HTML-bearing, e.g. `<code>AbortController()</code> constructor` |

`status` is always `{ deprecated, experimental, standard_track }`, all three always present when `status` is. Counts: 1,181 deprecated, 3,020 experimental, 1,215 not standard-track.

**`browsers`** — 17 entries, each `{ name, type, releases, accepts_flags, accepts_webextensions?, pref_url?, preview_name?, upstream? }`:

| id | type | upstream | preview_name |
|:---|:---|:---|:---|
| `chrome` | desktop | — | Canary |
| `edge` | desktop | chrome | — |
| `firefox` | desktop | — | Nightly |
| `ie` | desktop | — | — |
| `opera` | desktop | chrome | — |
| `safari` | desktop | — | TP |
| `chrome_android` | mobile | chrome | — |
| `firefox_android` | mobile | firefox | — |
| `opera_android` | mobile | chrome_android | — |
| `safari_ios` | mobile | safari | — |
| `samsunginternet_android` | mobile | chrome_android | — |
| `webview_android` | mobile | chrome_android | — |
| `webview_ios` | mobile | safari_ios | — |
| `bun` | server | — | — |
| `deno` | server | — | — |
| `nodejs` | server | — | — |
| `oculus` | xr | chrome_android | — |

Each release entry is `{ index, status, release_date?, release_notes?, engine?, engine_version? }`. `status` ∈ `retired | current | beta | nightly | planned | esr`. **`index` is a unique integer 0..n−1 per browser, in release order** — verified unique for all 17 browsers. `Object.keys(releases)` is *not* ordered: `safari` yields `… 17, 18, 26, 27, 1.1, 1.2, … 3.1, 5.1, 9.1`.

**Support statements** (289,419 statements across 280,571 browser entries):

| Shape | Count |
|:------|------:|
| entry is a single statement object | 272,425 |
| entry is an array of statements | 8,146 (max length 6) |

Statement field frequency: `version_added` 289,419 · `notes` 13,219 · `version_removed` 7,529 · `version_last` 7,529 · `partial_implementation` 5,643 · `impl_url` 3,664 · `prefix` 2,801 · `flags` 2,102 · `alternative_name` 1,708.

`version_added` forms — **four, and only four**: numeric string (224,284), `false` (58,449), `≤`-prefixed (5,776; e.g. `≤12.1`, `≤80`), and the literal `"preview"` (910). No `true`, no `null`. `version_removed` takes the same forms minus `false`. `version_last` always co-occurs with `version_removed` and is the last release that still supported the feature.

`notes` is a string (11,839) or an array of strings (1,380). `flags` entries are `{ name, type, value_to_set? }` with `type` ∈ `preference` (1,860) | `runtime_flag` (275). `prefix` values are heterogeneous: `-webkit-`, `webkit`, `WebKit`, `WEBKIT_`, `moz`, `Moz`, `-moz-`, `MOZ_`, `ms`, `-ms-`, `MS`, `o`, `O`, `-o-`, `-khtml-`, `-webkit-input-`, `-ms-input-`, `X-`.

Array statements are **not reliably ordered**: 7,859 of 8,146 (96.5%) are non-increasing by `version_added` (compared segment by segment as numbers, `≤` stripped, `false` and `"preview"` skipped), the rest are not — e.g. `api.DOMMatrix [firefox] ["33","49","1.5"]`.

A browser can be **absent** from a leaf's `support` map, which is distinct from `version_added: false`. Per-browser entry counts: `chrome`/`edge`/`firefox`/`firefox_android`/`opera`/`safari`/`safari_ios` 20,543 · `chrome_android`/`ie`/`opera_android`/`samsunginternet_android`/`webview_android`/`webview_ios` 18,468 · `oculus` 18,415 · `deno` 3,173 · `nodejs` 2,324 · `bun` 2,050.

### web-features 3.39.0

Module exports `{ features, groups, snapshots, browsers }`. 1,210 entries in `features` (1,198 of them real features, 12 redirects), 104 groups, 11 snapshots. `browsers` names the 7-browser Baseline core set: `chrome`, `chrome_android`, `edge`, `firefox`, `firefox_android`, `safari`, `safari_ios`.

`kind`: `feature` 1,198 · `moved` 10 · `split` 2. The 12 non-`feature` entries have no `status` and carry `redirect_target` (10) or `redirect_targets` (2) instead.

Field frequency: `kind` 1,210 · `description` / `description_html` / `name` / `spec` / `status` 1,198 · `compat_features` 1,177 · `group` 939 · `caniuse` 339 · `discouraged` 56 · `snapshot` 45.

`status` is `{ baseline, baseline_low_date?, baseline_high_date?, by_compat_key?, support }`.

**`status.baseline` raw values are `"high"` (646), `"low"` (123), and `false` (429)** — not the display words. `baseline_low_date` present on 769, `baseline_high_date` on 646. Two `baseline_low_date` values are `≤`-prefixed (`≤2020-03-24`, `≤2018-10-02`).

`status.by_compat_key` is present on 1,177 features and covers **15,482 distinct BCD keys**, each owned by exactly one feature. Every one of those keys is a real BCD leaf (0 orphans). Each value is `{ baseline, baseline_low_date?, baseline_high_date?, support }` — the same shape as the rollup, computed per key. Verified divergence: `grid` rolls up to `high` / 2020-04-17 while its 62 per-key entries carry several distinct states.

`compat_features` totals 15,482 refs across 1,177 features — the same set `by_compat_key` covers.

`discouraged` is `{ according_to: string[], reason: string, reason_html: string }`, on 56 features.

`group`, `snapshot`, `spec`, and `caniuse` are all **arrays of strings**. Groups are `{ name, parent? }`: 53 of the 104 declare a `parent`, nested at most two levels below a top-level group (`positioning` → `layout` → `css`), and top-level groups hold few features directly (`css` 101 direct, 355 with descendants; `html` 16 and 147). Snapshots are `{ name, spec }` and are the 11 ECMAScript editions (`ecmascript-1`, `ecmascript-5`, `ecmascript-2015` … `ecmascript-2023`).

### caniuse-lite 1.0.30001810 and browserslist 4.29.0

`caniuse-lite` exports `{ agents, features, feature, region }`. **19 agents**: `ie, edge, firefox, chrome, safari, opera, ios_saf, op_mini, android, bb, op_mob, and_chr, and_ff, ie_mob, and_uc, samsung, and_qq, baidu, kaios`. Each agent is `{ browser, prefix, versions, release_date, usage_global }`; `usage_global` maps version → percent.

**583 features.** `feature(features[id])` returns `{ status, title, shown, stats }` — there is **no `keywords` and no `categories` field**; those exist only in the full `caniuse-db`, which is not bundled. `stats[agent][version]` is a letter code (`y` 251,281 · `n` 115,630 · `a` 26,869 · `p` 2,866 · `u` 2,006), optionally suffixed with note or prefix flags.

Total `usage_global` across all agents sums to **96.688%**, not 100 — every usage figure is a share of tracked traffic, and must be labelled as such.

Per-agent total usage: `and_chr` 46.325 · `chrome` 22.170 · `ios_saf` 13.728 · `edge` 5.088 · `firefox` 2.893 · `safari` 2.470 · `samsung` 1.341 · `op_mob` 0.979 · `and_uc` 0.681 · `and_ff` 0.362 · `ie` 0.266 · `opera` 0.248 · `and_qq` 0.097 · `android` 0.032 · `kaios` 0.005 · `op_mini` / `bb` / `ie_mob` / `baidu` 0.000.

`browserslist` returns `"<agent> <version>"` tokens. Verified version-token forms: bare major (`chrome 151`), dotted (`op_mob 11.1`, `and_qq 14.9`), range (`ios_saf 18.5-18.7`, `samsung 5.0-5.4`, `kaios 3.0-3.1`), and the literal `all` (`op_mini all`). `safari TP` appears when a query reaches Safari Technology Preview.

Against the bundled browserslist 4.29.1 and caniuse-lite 1.0.30001812, `browserslist('defaults')` resolves to **35 tokens across 15 agents**: `and_chr 152`, `and_ff 156`, `and_qq 14.9`, `and_uc 15.5`, `android 152`, `chrome 154/153/151/150/149/145/120/109`, `edge 152/151/150`, `firefox 156/155/153/140`, `ios_saf 27.0/26.6/26.5/18.5-18.7`, `kaios 3.0-3.1/2.5`, `op_mini all`, `op_mob 80`, `opera 135/134`, `safari 27/26.6/26.5`, `samsung 30/29`. Four of those agents (`and_qq`, `and_uc`, `kaios`, `op_mini`) — 5 of the 35 tokens — have no BCD counterpart, so the default query populates `unchecked_targets` — this is the common case, not an edge case.

Useful members: `browserslist.coverage(tokens[, region])` returns the real caniuse-derived usage share of a token list (on the same snapshot, `coverage(defaults)` = 84.9301% and `coverage(['ie 11'])` = 0.2358%). `browserslist.aliases`, `browserslist.versionAliases`, and `browserslist.desktopNames` are the friendly-name and range-alias maps.

Errors are plain `Error` objects with `err.browserslist === true`. Verified messages: `Unknown browser Xyz`, and ``Write any browsers query (for instance, `defaults`) before `not dead` `` for a negation-only query.

**Config discovery, verified:** with an explicit query string, browserslist does *not* read `.browserslistrc`, `package.json`, or the `BROWSERSLIST` env var. In a temp directory holding `.browserslistrc` = `ie 11` and with `BROWSERSLIST=firefox 50` exported, `browserslist('chrome 100')` returned `chrome 100`; only `browserslist()` with no query returned `ie 11` / `firefox 50`.

### Reading dependency versions at runtime

| Package | How | Node 24 |
|:--------|:----|:--------|
| BCD | `data.__meta.version` and `data.__meta.timestamp` | in-data, always works |
| `caniuse-lite` | `import('caniuse-lite/package.json', { with: { type: 'json' } })` | works (no `exports` map) |
| `browserslist` | same | works (no `exports` map) |
| `web-features` | `createRequire(...).resolve('web-features/data.json')`, then read `package.json` from that directory | works |

**Trap:** `require('web-features/package.json')` and `require('@mdn/browser-compat-data/package.json')` resolve under Bun but throw `ERR_PACKAGE_PATH_NOT_EXPORTED` under Node 24, because neither `exports` map exposes `./package.json`. Production runs `node dist/index.js`, so the direct read would pass in development and crash in production. Use the resolution above.

The resulting `data_version` value, computed once and echoed on every tool response:

```ts
data_version: {
  bcd: string,            // "8.1.2"       — bcd.__meta.version
  bcd_generated: string,  // "2026-09-17T12:01:51.601Z" — bcd.__meta.timestamp
  web_features: string,   // "3.39.0"
  caniuse_lite: string,   // "1.0.30001810"
  browserslist: string,   // "4.29.0"
}
```

---

## Core Mechanics

These seven rules are shared by every tool. Implement them once in the service layer.

### 1. Feature resolution

Every tool takes the same `feature` string and resolves it in a fixed order. BCD keys always contain a dot and web-features ids never do (verified: 0 of 1,210 ids contain a dot, 0 BCD leaf paths are a single segment, and no leaf path equals an id), so the namespaces cannot collide.

1. Trim. The bound is enforced before the resolver runs, split across two surfaces: the input schema rejects an empty or over-200-character string by name, and a whitespace-only string — the one case a length validator cannot express — reaches the handler as `invalid_feature_input`. Enforcing either bound in both places would leave the contract entry unreachable while still reading as covered.
2. **Exact BCD key**, case-sensitive, against the 20,543-key leaf index.
3. **Exact web-features id**, case-sensitive, against the 1,210 ids.
4. **Lowercased retry of step 3 only.** All web-features ids match `^[a-z0-9-]+$`, so lowercasing is unambiguous there. It is *not* applied to BCD keys: four pairs collide case-insensitively — `api.Crypto`/`api.crypto`, `api.Origin`/`api.origin`, `api.Performance`/`api.performance`, `api.Scheduler`/`api.scheduler`.
5. **Redirect follow.** A hit whose `kind` is `moved` or `split` has no `status`. With a single `redirect_target`, follow it once and report `resolved_via: 'redirect'`. With `redirect_targets` — 2 `split` entries in the current data, one with 2 targets and one with 3 (`text-wrap-style` → `text-wrap`, `text-wrap-balance`, `text-wrap-pretty`) — return a miss whose `guidance` names every target, not a fixed count of them.
6. **`resolve: true` only** — run the search ranking and take every row in the top tier, which must be tier 1 or 2. When that tier holds exact-label rows (key, id, `name`, or `caniuse_title`) alongside `path_suffix` rows, only the exact-label rows count. Group those rows by entity: their `baseline_id`, or their `bcd_key` for a row no feature covers. One group of one row resolves to that row's key (or, for a feature with no keys, its id). One group of several rows resolves through the feature id, as step 3 would (`bcd_key: null` plus `compat_keys`). Two or more groups, or a top tier above 2, is a miss. Report `resolved_via: 'search'`. The grouping matters because the index joins a feature's `name` onto every key it owns: an exact name on a multi-key feature fills tier 2 with one row per key. Counting rows instead of entities resolved 230 of the 899 feature names that reached this step in web-features 3.38.0; counting entities, together with the `path_suffix` tier and tag-shaped names in §6, resolves all 907 that reach it in 3.39.0. The exact-label precedence is what keeps three of those: `window.external`, `import defer`, and `navigator.install()` are feature names whose `path_suffix` reading also lands on a key the feature does not own (`api.Window.external`, the two `import.defer` keys, `api.Navigator.install`), which would otherwise make a second entity.
7. Miss → `{ found: false, resolved_as: null, guidance }`.

Current exact-name example: `Container queries (size)` with `resolve: true` resolves to `container-queries` and its `compat_keys`. The dated name-resolution measurements above retain their original dataset versions.

Every response echoes:

```ts
resolved_as: {
  input: string,
  bcd_key: string | null,
  baseline_id: string | null,
  resolved_via: 'bcd_key' | 'web_features_id' | 'web_features_id_normalized' | 'redirect' | 'search',
} | null
```

- Resolved as a BCD key: `bcd_key` is that key; `baseline_id` is the owning feature from `by_compat_key`, else the first `web-features:` tag on the leaf, else `null`.
- Resolved as a web-features id: `baseline_id` is that id; `bcd_key` is the single entry of `compat_features` when there is exactly one, otherwise `null` (the feature, not one key, is the unit — `grid` spans 62 keys).

### 2. Version comparison

`resolveTargetVersion(bcdBrowserId, token)`:

1. Build the ordered release list for the browser by sorting `releases` entries on `releases[v].index` ascending. **Never sort by parsing the version string and never trust key order.**
2. Normalize the token:
   - `all` → the browser's oldest release, index 0 (the lower bound is the only safe reading).
   - `a-b` range → take the lower bound `a`. A range is only "supported" if its oldest member is.
   - Anything non-numeric after that (`TP`) → `{ unresolvable: 'unknown_version' }`.
3. Exact key match → that release's `index`.
4. **Trailing-zero normalization, both directions.** caniuse writes `samsung 20` where BCD writes `20.0`; caniuse writes `safari 16.0` where BCD writes `16`. Strip or append a `.0` and retry. Verified needed on `safari` (`16.0`/`17.0`/`18.0`/`26.0` → BCD `16`/`17`/`18`/`26`), `ios_saf` (the same four), and `samsung` (`4` and `20`–`25` → BCD `4.0` and `20.0`–`25.0`).
5. Otherwise take the highest release whose numeric segment tuple is ≤ the target tuple (missing segments read as 0) and use its `index`. If the target predates every BCD release, return index `-1`. Tokens that neither match nor normalize land here: `safari 3.2`/`6.1`/`7.1`, `ios_saf 13.2`/`13.3`, `samsung 10.1`, `op_mob 10`.
6. Still nothing → `{ unresolvable: 'unknown_version' }`.

`supportAt(leaf, bcdBrowserId, targetIndex)`:

1. `support[bcdBrowserId]` absent → `unknown`. **Absence is not `false`** — six browsers carry entries on only 18,468 of 20,543 leaves.
2. Normalize the entry to an array. Evaluate every statement; do not assume the first is current.
3. Per statement:
   - `version_added: false` → never applies.
   - `version_added: 'preview'` → applies only in a preview channel. Treat as not shipped, and remember it for the `preview_only` verdict.
   - `≤X` → added at or before X. For a target at or after X this is a plain yes. For a target *before* X the answer is `unknown`, never `no` — BCD is explicitly saying it does not know how far back.
   - Plain version string → `addedIndex = resolveTargetVersion(...)`.
   - `version_removed` present → `removedIndex = resolveTargetVersion(...)`; the statement covers `[addedIndex, removedIndex)`. Render `version_last` as the last supporting release.
4. A statement covers the target when `targetIndex >= addedIndex` and (`removedIndex` is absent or `targetIndex < removedIndex`).
5. Among covering statements pick the cleanest, ranked: no qualifiers > `partial_implementation` > `prefix` or `alternative_name` > `flags`.

| Verdict | Condition |
|:--------|:----------|
| `supported` | a covering statement with no flags, prefix, alternative name, or partial flag |
| `partial` | best covering statement has `partial_implementation: true` |
| `prefixed` | best covering statement has `prefix` or `alternative_name` |
| `flagged` | the only covering statements are flag-gated |
| `removed` | every statement that ever applied has a `version_removed` at or before the target |
| `unsupported` | `version_added: false`, or no statement covers the target |
| `preview_only` | the only applicable statement is `version_added: 'preview'` |
| `unknown` | browser absent from `support`; or `≤X` with the target before X; or the target version was unresolvable |

For `unsupported`, preserve only notes and implementation URLs from `version_added: false` statements; for `preview_only`, use only `version_added: "preview"` statements. Merge matching metadata in declaration order with deduplication. Numeric future statements never lend metadata to an older unsupported target, and these rows carry no invented version fields. Covering/removed selection and unknown outcomes stay unchanged.

**Pass rule for `compare_support`:** a feature clears the targets only when every target in the query was evaluated and returns `supported`. The rule is applied over the whole query, never over one page of target rows. `partial`, `prefixed`, `flagged`, `preview_only`, `removed`, and `unsupported` all fail, and one failing target anywhere in the query makes the verdict `fails`. `unknown` neither passes nor fails — the target is unchecked for that feature with reason `no_bcd_data`. A target whose agent has no BCD counterpart (`no_bcd_browser`) or whose version maps to no release (`unknown_version`) is unchecked for every feature. With no failure, a feature is `inconclusive` while any query target is unchecked for it, which includes a query that evaluates no target at all: reporting `clears` there would claim a verdict the server never computed.

### 3. Reported browser set

Report the **13 BCD browsers whose `browsers[id].type` is `desktop` or `mobile`**: `chrome`, `chrome_android`, `edge`, `firefox`, `firefox_android`, `ie`, `opera`, `opera_android`, `safari`, `safari_ios`, `samsunginternet_android`, `webview_android`, `webview_ios`.

Excluded by default and added by `include_runtimes: true`: `bun`, `deno`, `nodejs` (`type: server`) and `oculus` (`type: xr`). A frontend ship/no-ship answer must not list a JS runtime as a gating browser.

Derive the set from `type` at load time, never from a hardcoded list — a browser BCD adds later then lands in the right bucket without a code change.

### 4. browserslist agent → BCD browser

Hand-maintained table in `src/data/browserslist-bcd-map.ts`. Verified against the 19 real agent ids in the installed `caniuse-lite`.

| browserslist agent | caniuse name | BCD browser | Version alignment |
|:---|:---|:---|:---|
| `chrome` | Chrome | `chrome` | 150/150 tokens are exact BCD release keys |
| `and_chr` | Chrome for Android | `chrome_android` | 1/1 (caniuse carries only the newest) |
| `edge` | Edge | `edge` | 79/79 exact |
| `firefox` | Firefox | `firefox` | 158/158 exact |
| `and_ff` | Firefox for Android | `firefox_android` | 1/1 |
| `ie` | IE | `ie` | 7/7 exact |
| `opera` | Opera | `opera` | 121/123 exact, 2 range tokens |
| `op_mob` | Opera Mobile | `opera_android` | 6/7; `op_mob 10` has no BCD release (oldest is `10.1`) → nearest-at-or-below |
| `safari` | Safari | `safari` | 47/57 exact; `16.0`/`17.0`/`18.0`/`26.0` need trailing-zero normalization; `TP` unresolvable |
| `ios_saf` | Safari on iOS | `safari_ios` | 26/54 exact, 22 range tokens |
| `samsung` | Samsung Internet | `samsunginternet_android` | 10/27 exact; caniuse `20`–`25` vs BCD `20.0`–`25.0` |
| `android` | Android Browser | `webview_android` | caniuse folds modern Android Browser into Chrome majors (newest `151`); BCD `webview_android` carries `151` |
| `op_mini` | Opera Mini | — | proxy renderer, no BCD counterpart |
| `bb` | Blackberry Browser | — | |
| `and_uc` | UC Browser for Android | — | |
| `and_qq` | QQ Browser | — | |
| `baidu` | Baidu Browser | — | |
| `kaios` | KaiOS Browser | — | |
| `ie_mob` | IE Mobile | — | |

12 mapped, 7 unmapped. Combined `usage_global` of the seven: **0.7324%** (`and_uc` 0.6358, `and_qq` 0.0915, `kaios` 0.0051, the other four 0.0000). Report it per call via `browserslist.coverage(uncheckedTokens)`, never a hardcoded constant.

`webview_ios` is the one reported BCD browser with no browserslist agent; it never appears as a target.

The map declares all 19 agents explicitly, mapped or `null`. A unit test asserts that every key of `browserslist.data` appears in the map, so a new caniuse agent breaks the test suite instead of silently vanishing from `unchecked_targets`.

### 5. Baseline

Read from `status.by_compat_key[bcdKey]` when resolving a BCD key, and from the feature-level `status` when resolving a web-features id. Never substitute the rollup for a key.

| Reported state | Source |
|:---------------|:-------|
| `widely` | `status.baseline === 'high'` |
| `newly` | `status.baseline === 'low'` |
| `limited` | `status.baseline === false` |
| `not_mapped` | the BCD key appears in no `by_compat_key` — 5,061 leaves (24.6%) |

`not_mapped` is an explicit state with an explicit reason, never an absent field.

Dates: `since_date` from `baseline_low_date` (when the feature became newly available), `high_date` from `baseline_high_date` (when it became widely available). Pass `≤`-prefixed dates through verbatim with `date_is_upper_bound: true` rather than parsing them.

288 leaves carry a `web-features:` tag but have no `by_compat_key` entry (e.g. `api.Animation.commitStyles.endpoint_inclusive_commitStyles` tagged `web-features:web-animations`). Those report `baseline: not_mapped` while still populating `resolved_as.baseline_id` from the tag. 777 leaves carry more than one tag. The tag is a hint for the feature id; `by_compat_key` is the authority for Baseline.

21 `kind: feature` entries have no `compat_features` at all — `ad-selection`, `canvas-html`, `color-contrast`, `declarative-webmcp`, `document-modelcontext`, `focusgroup`, `http2`, `http3`, `image-function`, `import-defer`, `install`, `intersection-observer-v2`, `manifest-localization`, `mixin`, `navigator-install`, `notifications-apps`, `opaquerange`, `portal`, `rhythmic-sizing`, `target-within`, `usermedia`. Resolving one is `found: true` with an empty `support` array and `outcome: 'no_compat_data'`.

### 6. Search index

One row per searchable entity: 20,543 BCD leaves plus the 21 `compat_features`-less features = **20,564 rows**. Of the 12 `moved`/`split` entries, only the 10 `moved` entries — which carry a single `redirect_target` — are indexed as alias rows pointing at it. The 2 `split` entries carry `redirect_targets` (plural, 2–3 targets) and have no single target to alias to; a split id resolves instead through the feature resolver's split-miss guidance (§1 step 5), independent of the search index.

| Row field | Source | Coverage |
|:----------|:-------|:---------|
| `bcd_key` | leaf path | 20,543 |
| `baseline_id` | `by_compat_key` ownership, else the first `web-features:` tag | 15,770 leaves reach an id (15,482 by ownership, plus 288 more by tag only — 204 `by_compat_key` leaves carry no tag at all, so tag coverage alone (15,566) undercounts) |
| `name` | web-features `name`, joined onto every leaf its feature owns | 1,198 distinct names, 0 duplicates |
| `description` | web-features plain-text `description`, else BCD `description` normalized once at ingestion with anchor labels/URLs preserved and entities decoded | 1,198 / 5,070 |
| `caniuse_title` | `caniuse-lite` `feature(id).title` via the feature's `caniuse[]` array | 339 features → 7,850 leaves |
| `path_tokens` | leaf path split on `.` and camelCase boundaries | 20,543 |
| `groups` | the feature's `group` ids plus every ancestor group, via `baseline_id` | 15,791 rows reach a feature; the 4,773 with no `baseline_id` carry none |
| `snapshots` | the feature's `snapshot` ids, via `baseline_id` | 45 features |

caniuse contributes titles only — 583 of them. There are no keywords or categories in `caniuse-lite`.

Normalization for both index and query: lowercase, strip punctuation except `-`, split on whitespace, `.`, and camelCase boundaries. `<` and `>` are punctuation like any other, so the query `<dialog>` tokenizes to `dialog` and matches the web-features name `<dialog>`: 106 names are a bare tag and 123 contain a `<...>` fragment in the dated snapshot above. Actual BCD descriptions and notes are normalized once during BCD ingestion; search consumes that plain text. Web-features names/descriptions are already plain text and never pass through markup stripping.

For the `path_suffix` tier the query is also split into path segments: lowercase, drop a trailing `()`, split on `.`, `:`, and whitespace, and drop a `prototype` segment that sits between two others. `Array.prototype.at()` reads as `array.at`, `display: grid` as `display.grid`. A camelCase word is never split here, so `isPrototypeOf` stays one segment.

Ranking is tiered and deterministic. No composite score.

| Tier | Match |
|:-----|:------|
| 1 | query equals a BCD key or a web-features id, case-sensitive |
| 2 | query equals a `name` or `caniuse_title`, case-insensitive; or (`path_suffix`) a BCD key's trailing segments equal the query's two or more segments, in order, case-insensitive |
| 3 | every query token appears in `name` |
| 4 | every query token appears in the last path segment |
| 5 | every query token appears in `description` or `caniuse_title` |
| 6 | every query token appears somewhere in `path_tokens` |

Within a tier, order by: shorter BCD key path first (a feature's own entry before its sub-keys), then namespace priority `api, css, javascript, html, http, svg, mathml, webassembly, manifests, mediatypes, webdriver, webextensions`, then Baseline `widely > newly > limited > not_mapped`, then BCD key lexicographic. Every result carries `matched_on` naming the field that matched, so the ranking is inspectable rather than asserted.

### 7. Multi-key resolution and limiting browser

A web-features id can own more than one BCD key, and this is the common case, not the edge case: **882 of the 1,198 features (74%) own more than one key** (`grid` alone owns 62; `compat_features` totals 15,482 refs across 1,177 features). Fields that only exist at BCD-leaf granularity — `support`, `status` (`deprecated`/`experimental`/`standard_track`), `limiting_browser`, `mdn_url`, `spec_urls` — have no single correct value across multiple keys and are never averaged or rolled up across them: keys under one feature can disagree (the `grid` Baseline divergence in §5 is exactly this, and it is a per-key fact, not a rounding error).

When `resolved_as.bcd_key` is `null` (the id resolved to more than one key), a tool omits those leaf-only fields entirely rather than guessing which key they should represent, and instead returns `compat_keys` — the feature's full `compat_features` list — so the agent can re-call with one specific key for the per-browser answer. `browsercompat_compare_support` cannot compute a `clears`/`fails` verdict without a single key's support data either, so it reports this case as verdict `ambiguous`. `baseline` is exempt from this rule: it is legitimately reported at the feature level (the web-features rollup) when resolved via a web-features id — that is a real, intended value, not a stand-in for a missing per-key answer.

`limiting_browser` is populated only when every browser in the Baseline core set currently reports full `supported` support and a resolvable `version_added`. Partial, prefixed, alternative-name, flagged, preview-only, removed, unsupported, and unknown support all omit it. Naming one newest release would otherwise conceal restrictions in a different core browser; `support` retains the complete qualifiers.

`discouraged` is a feature-level advisory and remains independent of optional BCD status, including multi-key and zero-key features. `get_feature` retains the equal `status.discouraged` compatibility alias where status exists and renders the advisory once.

---

## Tools — detail

### `browsercompat_list_reference`

The vocabulary tool, and the standing routing target for every recovery string, zero-hit notice, and resolver `guidance` on this server. Build it first: it has no dependency on the resolver and it grounds field-testing for everything else.

**Description:** `Enumerate the reference vocabulary this server uses: BCD namespaces, BCD browser ids, browserslist agent ids and their BCD counterparts, Baseline states, web-features groups, and ECMAScript snapshots. Use it to build valid inputs for the other tools and to see which target browsers can be evaluated.`

**Input**

| Param | Type | Notes |
|:------|:-----|:------|
| `topic` | enum, required | `bcd_namespaces` \| `bcd_browsers` \| `browserslist_agents` \| `baseline_states` \| `groups` \| `snapshots` |

**Output** — `{ topic, entries[] }` where each entry is `{ id, label, detail, count?, bcd_browser?, reported?, usage_percent?, maps_from?, spec_url? }`. `data_version` rides enrichment on every tool (D19), never `output`.

| topic | entries | per-entry extras |
|:------|:--------|:-----------------|
| `bcd_namespaces` | 12 | `count` = leaf count; `detail` = one line plus an example key |
| `bcd_browsers` | 17 | `reported` (type is desktop or mobile), `detail` = type, upstream, release count, newest released version |
| `browserslist_agents` | 19 | `bcd_browser` (or null), `usage_percent` = agent total `usage_global` |
| `baseline_states` | 4 | `maps_from` = the raw `status.baseline` value (`null` for `not_mapped`, which has none); `count` = BCD leaves in that state — 8,746 `widely` / 1,256 `newly` / 5,480 `limited` / 5,061 `not_mapped`, summing to all 20,543 leaves. This is per-key, not the feature-level split (646/123/429 features) in Data Sources — see D28. |
| `groups` | 104 | web-features group id and name; `detail` names the parent and says to pass the id as `group` to `browsercompat_search_features` (nested groups included) |
| `snapshots` | 11 | `spec_url`; `detail` says to pass the id as `snapshot` to `browsercompat_search_features` |

**Errors:** none declared. `topic` is a Zod enum, so an invalid value is rejected as `InvalidParams` before the handler runs.

**Enrichment:** `data_version` (`echo` kind), `attribution` — populated only for `browserslist_agents`, which surfaces caniuse usage figures.

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`.

---

### `browsercompat_get_feature`

The 80% tool.

**Description:** `Get the compatibility record for one web feature: Baseline state and the date it crossed, deprecation and standards status, per-browser version added and removed with flags, vendor prefixes and partial-implementation notes, and the MDN and specification links. Accepts a BCD key such as css.selectors.has or a web-features id such as has; the response echoes which one it matched. An unresolved feature returns found: false with guidance rather than an error.`

**Input**

| Param | Type | Maps to | Notes |
|:------|:-----|:--------|:------|
| `feature` | `string` (1–200), required | resolver | BCD key or web-features id. The length bound is a schema constraint, so an empty or over-long string is rejected by name (Core Mechanics §1). |
| `resolve` | `boolean`, default `false` | resolver step 6 | Enables the search fallback, which accepts the top search tier only when it names one feature or key. Off by default so a typo returns a miss the agent can correct rather than a confidently wrong feature. |
| `include_runtimes` | `boolean`, default `false` | reported browser set | Adds `bun`, `deno`, `nodejs`, `oculus`. Leave off for browser ship decisions. |
| `subkeys_offset` | `number` (integer ≥0), default `0` | direct-child index | Skip this many direct callable children; pass `subkeys.next_offset` to continue. |

**Output**

| Field | Type | Notes |
|:------|:-----|:------|
| `found` | `boolean` | |
| `outcome` | enum | `found` \| `no_compat_data` \| `miss` |
| `resolved_as` | object \| null | see Core Mechanics §1 |
| `name` | string, optional | web-features `name` |
| `description` | string, optional | web-features `description`, else BCD `description` with tags stripped and HTML entities decoded |
| `baseline` | object, optional | `{ state, since_date?, high_date?, date_is_upper_bound? }` |
| `status` | object, optional | `{ deprecated, experimental, standard_track, discouraged? }`. Absent for all `webextensions` leaves — render "not recorded", never `false`. Also absent when `resolved_as.bcd_key` is `null` (Core Mechanics §7). |
| `discouraged` | object, optional | `{ reason, according_to[] }`, independent of leaf status. Equal to `status.discouraged` wherever the compatibility alias is populated. |
| `limiting_browser` | object, optional | Among the 7-browser Baseline core set, the one requiring the newest version. `{ browser_id, name, version }`. Populated only under the conditions in Core Mechanics §7. |
| `support` | array, optional | one row per reported browser. Absent when `resolved_as.bcd_key` is `null` (§7). |
| `mdn_url` | string, optional | 60.9% of leaves. Absent when `resolved_as.bcd_key` is `null` (§7). |
| `spec_urls` | string[], optional | always normalized to an array. Absent when `resolved_as.bcd_key` is `null` (§7). |
| `compat_keys` | string[], optional | Present only when `resolved_as.bcd_key` is `null` — the feature's full `compat_features` list (see Core Mechanics §7). Call again with one of these for the per-browser fields above. |
| `subkeys` | object, optional | `{ total, keys, truncated, next_offset? }`. Direct callable child records in BCD traversal order, at most 100 per page. Omitted for childless keys, misses, and resolutions without a single key. |
| `guidance` | string, optional | present on a miss and on `no_compat_data` |

Each `support` row: `{ browser_id, browser_name, verdict, version_added?, version_added_is_upper_bound?, version_removed?, version_last?, partial?, prefix?, alternative_name?, flags?, notes?, impl_url? }`. Absent upstream fields stay absent — never coerced to `false`, `0`, or `""`.

Direct children are indexed once during BCD traversal; grandchildren and non-compat structural nodes are excluded. At/past-end offsets return empty `keys`, the true `total`, `truncated: false`, and no `next_offset`. Both surfaces expose page metadata and route to `browsercompat_check_baseline` for checking up to 20 children together.

**`format()`** leads with the decision and renders every output field. It reports each field by name rather than in loose prose, since a support row can carry any combination of `partial` / `prefix` / `alternative_name` / `flags` that a fixed-column table can't accommodate — worked example, computed against BCD 8.1.2:

```
# :has()
**found:** true · **outcome:** found
**Resolved:** "css.selectors.has" → bcd_key css.selectors.has · baseline_id has · via bcd_key
**Baseline: widely** · since_date 2023-12-19 · high_date 2026-06-19
**Status:** standard_track true · deprecated false · experimental false
**Limiting browser:** Firefox (firefox) 121

The :has() CSS functional pseudo-class matches an element if any of the selectors passed
as parameters would match at least one element.

## Support
- **Chrome** (chrome): supported
  - version_added: 105
- **Firefox** (firefox): supported
  - version_added: 121
- **Safari** (safari): supported
  - version_added: 15.4
…

MDN: <url>
Spec: <url>
```

**Errors**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `invalid_feature_input` | `ValidationError` | `feature` is whitespace-only. An empty or over-200-character string is rejected against the input schema instead | `Pass a BCD key such as css.selectors.has or a web-features id such as has, then call browsercompat_search_features if you do not know the key.` |

A resolver miss is a result, not an error. Its `guidance`: `No BCD key or web-features id matched "<input>". Call browsercompat_search_features with a plain-language name, or browsercompat_list_reference with topic bcd_namespaces to see the 12 top-level namespaces.`

For an ambiguous `redirect_targets` hit: `"<input>" was split into <targets, comma-separated>. Call <calling tool> again with one of them.` — list every target, since one of the two current `split` entries has 3. The resolver is shared across all five tools, so `<calling tool>` names whichever tool the caller actually invoked, not always `browsercompat_get_feature`.

For `no_compat_data`: `"<id>" is a tracked web-features entry with no browser-compat-data keys yet, so there is no per-browser support to report. Call browsercompat_check_baseline for its Baseline state.`

**Enrichment**

| Key | Kind | Populated when |
|:----|:-----|:---------------|
| `data_version` | `echo` | always |
| `baselineNotMapped` | `notice` | `baseline.state === 'not_mapped'` — says the key is outside the web-features mapping and names `browsercompat_search_features` to find a mapped sibling |
| `runtimesExcluded` | `notice` | `include_runtimes` is false and the leaf carries `bun`/`deno`/`nodejs`/`oculus` data |

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`.

---

### `browsercompat_check_baseline`

The cheap ship/no-ship entry point across several features at once. `browsercompat_compare_support` is the explicit-targets variant of the same question.

**Description:** `Check whether web features are safe to ship: Baseline state and the date it crossed, the browser and version that limits support, whether the feature is deprecated or discouraged, and the share of tracked global traffic that requiring it would exclude. Accepts up to 20 BCD keys or web-features ids in one call.`

**Input**

| Param | Type | Notes |
|:------|:-----|:------|
| `features` | `string[]` (1–20), required | Each entry a BCD key or web-features id, 1–200 characters. Both caps are schema constraints, so a longer list and an empty or over-long entry are rejected by name rather than silently truncated. |
| `resolve` | `boolean`, default `false` | as above |

**Output** — `{ results[], all_widely_available }`.

`all_widely_available` is a boolean over the whole call: true only when every result has `outcome` in `{ found, no_compat_data }` **and** `baseline.state === 'widely'`. A single `miss` result forces it false — an unresolved input is never treated as safe. `deprecated`, `experimental`, and `discouraged` do not affect it: the field answers the Baseline question only, and those flags are reported per result so the agent weighs them separately (D30).

Each result: `{ input, found, outcome, resolved_as, name?, baseline?, limiting_browser?, deprecated?, experimental?, discouraged?, usage_percent_excluded?, usage_source?, compat_keys?, guidance? }`. `outcome` is the same `found | no_compat_data | miss` enum as `browsercompat_get_feature`. `limiting_browser`, `deprecated`, and `experimental` are absent under the same conditions as that tool (Core Mechanics §7 — undefined until the core set is fully resolved, and never available for a multi-key feature); `compat_keys` appears in their place when `resolved_as.bcd_key` is `null`. `baseline` and `discouraged` are feature-level fields and stay populated regardless — including for the 21 features with no `compat_features` at all, which resolve `found: true`, `outcome: 'no_compat_data'`, `baseline` present, `deprecated`/`experimental`/`limiting_browser` absent.

Partial success is native: a per-item `found` flag, no separate `failed[]`, because a miss is a result and not a failure.

`discouraged` is `{ reason, according_to[] }` straight from web-features (56 features).

**`usage_percent_excluded`** is a feature-level figure: the feature must reach available `caniuse-lite` data through its web-features `caniuse[]`. A resolved BCD key receives the figure only when `compat_features` is exactly that sole key; tag-only attribution does not establish equivalence. Multi-key and zero-key feature resolutions retain their genuine feature figure. The value sums `agents[a].usage_global[v]` over agent/version pairs whose stat letter is not `y` for every mapped caniuse feature. Partial support (`a`) counts as excluded. `usage_source` states both feature scope and the tracked-traffic population. Scope mismatch or missing data omits both usage fields, never substituting zero or treating unknown BCD support as proven exclusion.

**Errors**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `invalid_feature_input` | `ValidationError` | any array entry is whitespace-only. An empty or over-200-character entry is rejected against the input schema instead | `Replace the whitespace-only entry with a BCD key such as css.selectors.has or a web-features id such as has; use browsercompat_search_features to find one.` |

**Enrichment**

| Key | Kind | Populated when |
|:----|:-----|:---------------|
| `data_version` | `echo` | always |
| `totalCount` | `total` | always — the number of results returned |
| `attribution` | escaped text, labelled `Usage data` | any result carries `usage_percent_excluded` |
| `unresolvedNotice` | `notice` | one or more inputs missed — names `browsercompat_search_features` |

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`.

---

### `browsercompat_search_features`

The discovery entry point.

**Description:** `Find web features by plain name or keyword when the canonical key is unknown, across CSS, JavaScript, HTML, Web APIs, SVG, MathML, WebAssembly, and HTTP headers. Returns ranked matches with the BCD key, the web-features id, the Baseline state, a one-line support summary, and which field matched. Feed a result key into browsercompat_get_feature for the full record.`

**Input**

| Param | Type | Notes |
|:------|:-----|:------|
| `query` | `string` (1–100), required | plain-language name, keyword, or code notation (`Array.prototype.at`, `display: grid`, `<dialog>`) |
| `namespace` | enum, optional | one of the 12 BCD namespaces; restricts results to that subtree |
| `baseline` | enum, optional | `widely` \| `newly` \| `limited` \| `not_mapped` |
| `group` | `string` (1–100), optional | a web-features group id; matches features in that group or any group nested under it. Checked against the bundled vocabulary, not a Zod enum, since the set moves with each `web-features` bump |
| `snapshot` | `string` (1–100), optional | an ECMAScript snapshot id, checked the same way |
| `limit` | `number` (1–50), default 10 | page size |
| `offset` | `number` (integer ≥ 0), default 0 | matches to skip; slices the same ranked, filtered list `limit` caps |

All four filters combine as an intersection and apply before ranking. A row matches `group` / `snapshot` through its `baseline_id`'s feature, so the 4,773 rows without one never match either. On current data `{ query: "has", group: "selectors", baseline: "limited" }` returns 3 rows and `{ query: "array", snapshot: "ecmascript-2023" }` returns 11 rows from 2 features.

The ranking is a total order over a static snapshot, so a plain offset is stable across pages: paging `display` in `css` with `limit: 50` at offsets 0, 50, … 300 returns all 341 matches exactly once, in rank order.

**Output** — `{ results[] }` where each result is `{ bcd_key?, baseline_id?, name?, description?, baseline_state, matched_on, support_summary, mdn_url? }`. `matched_on` ∈ `bcd_key` \| `baseline_id` \| `name` \| `caniuse_title` \| `path_suffix` \| `path_segment` \| `description` \| `path_tokens`.

`support_summary` is a single line over all 7 Baseline core browsers, including the mobile twins, e.g. `Chrome 105, Chrome Android 105, Edge 105, Firefox 121, Firefox for Android 121, Safari 15.4, Safari on iOS 15.4`, with `—` for unsupported and `?` for unknown.

**Errors**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `invalid_query` | `ValidationError` | `query` is whitespace-only after normalization, or normalizes to zero tokens | `Pass at least one word, e.g. "container query" or "fromAsync". Call browsercompat_list_reference with topic bcd_namespaces to browse by area instead.` |
| `unknown_group` | `ValidationError` | `group` names no web-features group in the bundled data (a feature id such as `popover` included) | `Call browsercompat_list_reference with topic groups for the valid group ids, then retry with one of them or without group.` |
| `unknown_snapshot` | `ValidationError` | `snapshot` names no ECMAScript snapshot in the bundled data (`es2023` included; the id is `ecmascript-2023`) | `Call browsercompat_list_reference with topic snapshots for the valid snapshot ids, then retry with one of them or without snapshot.` |

Zero hits are a successful empty result, not an error.

**Zero-hit notice fragments** (condition → fragment, each routing to a concrete next call). When several filters are set, only the first in the order of this table is named; a snapshot goes first because all 11 together cover 45 features:

| Condition | Fragment |
|:----------|:---------|
| `snapshot` filter was set | `No match in the <snapshot> snapshot. Re-run without snapshot, or call browsercompat_list_reference with topic snapshots to pick a different edition.` |
| `group` filter was set | `No match in the <group> group or the groups nested under it. Re-run without group, or call browsercompat_list_reference with topic groups to pick a different group.` |
| `namespace` filter was set | `No match in the <ns> namespace. Re-run without namespace, or call browsercompat_list_reference with topic bcd_namespaces to pick a different area.` |
| `baseline` filter was set | `No match at Baseline <state>. Re-run without the baseline filter — <share>% of BCD keys are not_mapped and are excluded by any other baseline value.` — `<share>` is computed at call time from the live not_mapped count, not a hardcoded figure (24.6% today) |
| no filters set | `No feature matched "<query>". Try the CSS property, JS method, or HTML element name on its own, or call browsercompat_list_reference with topic bcd_namespaces to browse by area.` |

**Enrichment**

| Key | Kind | Populated when |
|:----|:-----|:---------------|
| `data_version` | `echo` | always |
| `totalCount` | `total` | always — every match, before `offset` and `limit` apply |
| `truncated` | via `ctx.enrich.truncated({ shown, cap })` | matches remain past this page; `shown` and `cap` describe this page |
| `nextOffset` | plain | matches remain past this page — the `offset` for the next call |
| `appliedFilters` | plain, with an `enrichmentTrailer.render` | any of `namespace` / `baseline` / `group` / `snapshot` was set; the trailer marks `group` as including nested groups |
| `noMatchNotice` | `notice` | zero hits |
| `offsetNotice` | escaped text, labelled `Past the end` | the search matched, but `offset` is at or past `totalCount`; names both and points back to a valid offset |

`format()` renders only the returned `results`; the match total, page size, and next offset travel via `enrichment` (`totalCount`, `truncated`, `shown`, `cap`, `nextOffset`) per D19, not as a "…and N more" line in `format()`.

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`.

---

### `browsercompat_compare_support`

**Description:** `Compute whether a set of web features clears an explicit browserslist target query. Every call evaluates the whole query: each feature gets a verdict, the count of failing targets, and its own evaluated and unevaluated target counts with the share of tracked traffic each covers. The target rows behind those numbers — which release each target maps to, which targets were not evaluated and why, and the failing and unevaluated targets of each feature — cover at most ten query targets per call; page through them with target_offset and target_limit, and the verdicts, coverage, and totals stay identical on every page. A target counts as evaluated only where compatibility data was read for it, so a feature clears only when every target in the query was evaluated and supports it, and is inconclusive otherwise — a query that includes a browser with no compatibility data, as "defaults" does, never clears.`

**Input**

| Param | Type | Notes |
|:------|:-----|:------|
| `features` | `string[]` (1–20), required | BCD keys or web-features ids, 1–200 characters per entry. Both caps are schema constraints, as on `browsercompat_check_baseline`. |
| `targets` | `string`, required | A browserslist query, e.g. `defaults` or `> 0.5%, last 2 versions`. Required rather than defaulted: browserslist reads `.browserslistrc`, `package.json`, and `BROWSERSLIST` from the process working directory when no query is passed, which in a container is the image and not the caller's project. |
| `resolve` | `boolean`, default `false` | as above |
| `target_offset` | `integer` ≥ 0, default `0` | Zero-based position in the query's ordered target list where the page of target rows starts. Pass the previous response's `nextOffset` to continue. An offset at or past the end is an ordinary response with no target rows. |
| `target_limit` | `integer` 1–10, default `10` | Number of query targets the page covers. It bounds every list of target rows and never the evaluation. |

A negative or non-integer `target_offset`, and a `target_limit` of 0 or 11, are rejected against the input schema.

**Call flow** — no upstream calls; the sequence matters for where each failure surfaces.

| # | Step | On failure |
|:--|:-----|:-----------|
| 1 | `browserslist(targets, { path: false })` | `BrowserslistError` → `invalid_target_query` |
| 2 | Split tokens by agent, map through the browserslist↔BCD table | unmapped agent → unchecked, reason `no_bcd_browser` |
| 3 | `resolveTargetVersion` per mapped token | unresolvable → unchecked, reason `unknown_version` |
| 4 | If no token resolved **and** no token was a mapped agent carrying an unresolvable version → `no_targets_resolved` | error |
| 5 | Resolve each feature; `supportAt` against every mapped target in the query, once per distinct key | `unknown` verdict → unchecked for that feature, reason `no_bcd_data` |
| 6 | Intersect the per-feature evaluated sets into the aggregate; everything else in the query is unchecked | no comparable feature → every mapped target unchecked, reason `no_comparable_feature` |
| 7 | `browserslist.coverage()` over each evaluated and unchecked token set, per feature and in aggregate | — |
| 8 | Project every list of target rows onto the tokens in `[target_offset, target_offset + target_limit)` | an empty page adds `offsetNotice` |

**Output** — whole-query fields are identical on every page; page rows cover only the query targets on the page.

| Field | Type | Scope | Notes |
|:------|:-----|:------|:------|
| `query_echo` | string | query | the targets string as parsed |
| `comparable_features` | integer | query | entries in `features` that were compared; a `miss` or `ambiguous` entry is not comparable, and a repeated entry counts each time |
| `targets_resolved` | array | page | the mapping inventory: `{ agent, version_token, bcd_browser, bcd_version, bcd_release_index, evaluated }` for each page target that maps onto a release. `evaluated` is true when every compared feature has data for the target |
| `targets_resolved_total` | integer | query | targets that map onto a release |
| `evaluated_targets_total` | integer | query | targets evaluated for every compared feature |
| `unchecked_targets` | array | page | `{ agent, version_token, reason, usage_percent }` with `reason` ∈ `no_bcd_browser` \| `unknown_version` \| `no_bcd_data` \| `no_comparable_feature` |
| `unchecked_targets_total` | integer | query | the rest of the query; `evaluated_targets_total + unchecked_targets_total` is the number of targets in the query |
| `target_coverage_percent` | number | query | `browserslist.coverage()` of the targets counted in `evaluated_targets_total`; 0 when `comparable_features` is 0 |
| `unchecked_coverage_percent` | number | query | `browserslist.coverage()` of the targets counted in `unchecked_targets_total` |
| `results` | array | mixed | `{ input, found, resolved_as, name?, verdict, failing_targets[], failing_total?, evaluated_total?, evaluated_coverage_percent?, unchecked_total?, unchecked_coverage_percent?, unchecked_targets[]?, compat_keys?, guidance? }` |
| `all_clear` | boolean | query | true only when every result is `clears` |

A compared result carries `failing_total`, `evaluated_total`, `evaluated_coverage_percent`, `unchecked_total`, and `unchecked_coverage_percent` over the whole query, plus its own `failing_targets` and `unchecked_targets` rows for the page; `evaluated_total + unchecked_total` is the number of targets in the query. A `miss` or `ambiguous` result carries none of the six and an empty `failing_targets`. A mapped target that lacks data for some compared feature appears in both top-level lists: in `targets_resolved` with `evaluated: false`, and in `unchecked_targets` with `no_bcd_data`.

`targets_resolved` can legitimately be empty for the whole query — a query whose every token is a mapped agent with an unresolvable version (`safari TP`) is an ordinary response, not an error: every token lands in `unchecked_targets` with its own reason, every feature is `inconclusive`, both coverage figures follow from the token split, and `all_clear` is false. `format()` renders `No target version maps to a browser-compat-data release.` under **Targets mapped to a release** rather than an empty table, so the per-token reasons under **Not evaluated for every compared feature** are what the reader is left with.

`verdict` ∈ `clears` \| `fails` \| `inconclusive` \| `miss` \| `ambiguous`, judged over the whole query (Core Mechanics §2). Each `failing_targets` entry is `{ agent, version_token, bcd_browser, bcd_version, verdict }` with the `supportAt` verdict that caused the failure, so `partial` and `flagged` failures are distinguishable from plain `unsupported`. `ambiguous` fires when a feature resolves to a web-features id spanning more than one BCD key (`resolved_as.bcd_key` is `null`) — `supportAt` needs one specific key, so no single verdict is computed; `compat_keys` lists the feature's `compat_features` and `guidance` asks the agent to re-call with one of them (Core Mechanics §7). `all_clear` requires every result to be `clears`, so a single `ambiguous` result blocks it same as a `fails`.

**Errors**

| reason | code | when | recovery |
|:-------|:-----|:-----|:---------|
| `invalid_target_query` | `ValidationError` | browserslist rejected the query (`err.browserslist === true`) | `Fix the query and retry — call browsercompat_list_reference with topic browserslist_agents for the 19 valid agent ids. A negation-only query needs a base, e.g. "defaults, not dead" rather than "not dead".` |
| `no_targets_resolved` | `ValidationError` | the query matched no browser versions at all, or only agents with no BCD counterpart | `Widen the targets query so it selects at least one browser that has compatibility data — call browsercompat_list_reference with topic browserslist_agents to see which of the 19 agents do.` |
| `invalid_feature_input` | `ValidationError` | any `features` entry is whitespace-only. An empty or over-200-character entry is rejected against the input schema instead | `Replace the whitespace-only entry with a BCD key such as css.selectors.has or a web-features id such as has; use browsercompat_search_features to find one.` |

The browserslist error message is forwarded verbatim in the thrown message — it names the offending token (`Unknown browser Xyz`) better than any rewrite would.

`no_targets_resolved` covers the two ways a query can leave nothing to evaluate, and its message says which: `"> 100%" matched no browser versions at all.` when browserslist returned zero tokens, and `"op_mini all" resolved only to agents with no browser-compat-data counterpart: op_mini.` when every token belongs to an unmapped agent, naming them. An unresolvable version on a mapped agent is not one of them.

**Enrichment**

| Key | Kind | Populated when |
|:----|:-----|:---------------|
| `data_version` | `echo` | always |
| `attribution` | escaped text, labelled `Usage data` | always — both coverage figures are caniuse-derived |
| `uncheckedNotice` | `notice` | `unchecked_targets_total` is above zero; counts the unchecked targets, names their agents and combined usage share. A second wording covers a call in which no feature was comparable |
| `totalCount` | `total` | always — the number of targets in the query, across every page |
| `shown` | number, labelled `Targets on this page` | always — `min(target_limit, max(0, totalCount − target_offset))` |
| `cap` | number, labelled `Page size (target_limit)` | always — the `target_limit` applied |
| `truncated` | boolean, labelled `More targets remain` | always — `target_offset + shown < totalCount` |
| `nextOffset` | number, labelled `Next page` | only while `truncated` is true — `target_offset + shown` |
| `offsetNotice` | notice, labelled `Empty page` | only on a page that covers no query target; names the offsets that do |

The trailer names agents and counts; it never repeats target rows.

**`format()`** leads with the whole-query summary, then each feature's verdict with its totals and its rows for the page, then the two target tables. Neither table is ever omitted: a page with no rows says how many exist elsewhere, since an absent unchecked block is what would let a clean pass be misread. Percentages are the structured values, unrounded.

Worked example — page 1 of `features: ["css.selectors.has", "javascript.builtins.Array.fromAsync", "css.properties.anchor-name"]` against `targets: "defaults"`, computed against BCD 8.1.3, browserslist 4.29.1, and caniuse-lite 1.0.30001812 (35 tokens, 30 of them mapped to a release):

```
# 0 of 3 features clears `defaults`
Evaluated for every compared feature: 30 of 35 target versions (84.1977% of tracked traffic) · not evaluated: 5 (0.7324%)
Compared 3 of 3 features · 30 of 35 target versions map to a browser-compat-data release
**all_clear:** false

**inconclusive** :has() (input css.selectors.has, found true)
  - resolved: "css.selectors.has" → bcd_key css.selectors.has · baseline_id has · via bcd_key
  - evaluated on 30 of 35 target versions (84.1977% of tracked traffic) · failing 0 · not evaluated 5 (0.7324%)
  - on this page: 0 of 0 failing, 2 of 5 not evaluated
  - not evaluated on and_qq 14.9 (no_bcd_browser, 0.0915% usage)
  - not evaluated on and_uc 15.5 (no_bcd_browser, 0.6358% usage)
**fails** Array.fromAsync() (input javascript.builtins.Array.fromAsync, found true)
  - resolved: "javascript.builtins.Array.fromAsync" → bcd_key javascript.builtins.Array.fromAsync · baseline_id array-fromasync · via bcd_key
  - evaluated on 30 of 35 target versions (84.1977% of tracked traffic) · failing 3 · not evaluated 5 (0.7324%)
  - on this page: 0 of 3 failing, 2 of 5 not evaluated
  - not evaluated on and_qq 14.9 (no_bcd_browser, 0.0915% usage)
  - not evaluated on and_uc 15.5 (no_bcd_browser, 0.6358% usage)
**fails** Anchor positioning (input css.properties.anchor-name, found true)
  - resolved: "css.properties.anchor-name" → bcd_key css.properties.anchor-name · baseline_id anchor-positioning · via bcd_key
  - evaluated on 30 of 35 target versions (84.1977% of tracked traffic) · failing 5 · not evaluated 5 (0.7324%)
  - on this page: 0 of 5 failing, 2 of 5 not evaluated
  - not evaluated on and_qq 14.9 (no_bcd_browser, 0.0915% usage)
  - not evaluated on and_uc 15.5 (no_bcd_browser, 0.6358% usage)

## Targets mapped to a release — 8 of 30 on this page
| Target | browser-compat-data | Evaluated for every compared feature |
|:--|:--|:--|
| and_chr 152 | chrome_android 152 (index 127) | yes |
| and_ff 156 | firefox_android 156 (index 139) | yes |
| android 152 | webview_android 152 (index 122) | yes |
| chrome 154 | chrome 154 (index 152) | yes |
| chrome 153 | chrome 153 (index 151) | yes |
| chrome 151 | chrome 151 (index 149) | yes |
| chrome 150 | chrome 150 (index 148) | yes |
| chrome 149 | chrome 149 (index 147) | yes |

## Not evaluated for every compared feature — 2 of 5 on this page
| Target | Reason | Usage |
|:--|:--|:--|
| and_qq 14.9 | no_bcd_browser | 0.0915% |
| and_uc 15.5 | no_bcd_browser | 0.6358% |
```

The trailer, a second text block, carries the page position beside the data vintage and attribution:

```
**Targets in query:** 35
**Targets on this page:** 10
**Page size (target_limit):** 10
**More targets remain:** yes
**Next page:** call again with target_offset 10
**Not evaluated:** 5 of 35 target versions were not evaluated for every compared feature (and_qq, and_uc, kaios, op_mini), together 0.7324% of tracked traffic. No feature is reported as clearing them.
```

Both `fails` verdicts on this page rest on targets further into the query: the page shows `0 of 3 failing` and `0 of 5 failing` while the totals already count them. The walk takes four pages. Page 2 (`target_offset: 10`) lists `chrome 120` and `chrome 109` for `Array.fromAsync`, and those two plus `firefox 140` for `anchor-name`; page 3 adds `op_mob 80` for both and `ios_saf 18.5-18.7` for `anchor-name`; page 4 covers the last 5 targets and carries no `nextOffset`. The three verdicts, `all_clear`, and every total and percentage above are the same on all four.

`:has()` is supported on all 30 targets that have compatibility data and is still `inconclusive`, because 5 of the 35 belong to agents with none (D51). `firefox 140` is the Firefox ESR entry `defaults` pulls in, and `anchor-name` arrived in Firefox 147 — the kind of failure a "last 2 versions" reading misses entirely.

Coverage diverges per feature when the compared keys do not record the same browsers. `css.selectors.has` with `webextensions.api.action.enable` on `defaults`: `has` is evaluated on 30 targets (84.1977%) with 5 unchecked (0.7324%); the extension key records nothing for `and_chr 152`, `android 152`, `op_mob 80`, `samsung 30`, and `samsung 29`, so it is evaluated on 25 (38.0171%) with 10 unchecked (46.913%). The top level reports the intersection — `evaluated_targets_total` 25, `target_coverage_percent` 38.0171, `unchecked_coverage_percent` 46.913 — and both verdicts are `inconclusive`.

Measured on the largest page of a walk: 20 features against `since 2000` (688 targets, 69 pages) returns 32,068 bytes of `structuredContent` and 21,022 bytes of text; 20 copies of `css.selectors.has` against `defaults` returns 14,837 and 11,976. The contract tests pin ceilings of 40,000 bytes structured, 28,000 text, and 1,000 for the trailer.

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `bcd-service` | `@mdn/browser-compat-data` — flat leaf index (20,543 keys), per-browser release-index maps, reported-browser set, `resolveTargetVersion`, `supportAt` | all five tools |
| `baseline-service` | `web-features` — feature map, `by_compat_key` index, redirect map, groups, snapshots | `get_feature`, `check_baseline`, `search_features`, `compare_support`, `list_reference` |
| `targets-service` | `browserslist` + `caniuse-lite` — query resolution, the agent↔BCD map, `coverage()`, per-agent `usage_global`, the excluded-usage computation | `compare_support`, `check_baseline`, `list_reference` |
| `search-service` | the 20,564-row in-memory index built from the three above | `search_features`, and resolver step 6 |
| `data-version-service` | the four package versions (see *Reading dependency versions at runtime*) | all five tools |

The shared feature resolver (Core Mechanics §1) lives beside `baseline-service` in its own module, `src/services/baseline/feature-resolver.ts`, rather than as a method on the `BaselineService` class: it imports the BCD, baseline, and search services, and nothing imports it back, which keeps `baseline-service` and `search-service` from importing each other — Biome's `noImportCycles` (error-level) forbids that cycle, which resolving through search from inside `baseline-service` would otherwise create.

No resilience table applies — there is no upstream to retry, time out, or pace.

`caniuse-lite` is declared as a direct dependency even though `browserslist` already depends on it: `targets-service` imports `agents` and `feature()` from it directly. It is not a redundant entry to prune. It ships no types, so `src/types/caniuse-lite.d.ts` declares an ambient module covering only the members `targets-service` reads (`agents`, `features`, `feature()`).

The output shapes shared across tools — `resolved_as`, the Baseline block, a support row, and the limiting browser — are defined once in `src/mcp-server/tools/definitions/compat-shapes.ts`, alongside their renderers, since the design specifies each identically wherever it appears. Error contracts stay inline per tool, per the framework's locality convention.

**State lifecycle.** Every dataset is process-global and immutable. Nothing is tenant-scoped, nothing goes in `ctx.state`, nothing has a TTL, and nothing needs to survive a restart. Each service is a promise-memoized lazy accessor over a dynamic `import()`. `setup(core)` kicks the loads off **without awaiting** (with a `.catch` that logs, so a rejection is not unhandled) and the first tool call awaits the same promises — a hosted container warms during startup while stdio start stays instant.

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `MCP_TRANSPORT_TYPE` | No | `stdio` (default) or `http`. Framework standard. |
| `MCP_HTTP_PORT` | No | HTTP port when `MCP_TRANSPORT_TYPE=http`. Framework standard. |

No server-specific env vars: no API keys, no base URLs, and deliberately no browserslist configuration variable — the target query is always a tool input, never ambient state.

No auth scopes. Every tool is read-only over bundled public data with no tenant-scoped state and no upstream quota to protect, so a scope would gate nothing.

`createApp()` also sets `cacheHints` for `tools/list` and `server/discover` (1-hour TTL, public scope) and `landing: { requireAuth: false }`. The tool catalog is fixed at boot — all five tools are registered up front and nothing changes it at runtime — so caching the list response costs nothing; and the landing page serves the full inventory without an auth gate, consistent with D25's no-scopes stance.

## Licensing surfaces

| Source | License | Obligation | How it is met |
|:-------|:--------|:-----------|:--------------|
| `@mdn/browser-compat-data` | CC0-1.0 | none | credited in `THIRD_PARTY_NOTICES.md` as courtesy |
| `web-features` | Apache-2.0 | ship the license text and state attribution; the package ships `LICENSE.txt` and no `NOTICE`, so §4(d) adds nothing | full Apache-2.0 text plus attribution in `THIRD_PARTY_NOTICES.md` |
| `caniuse-lite` | CC-BY-4.0 | attribution wherever the data is conveyed | `THIRD_PARTY_NOTICES.md`, **plus** a per-response `attribution` enrichment field on every response that carries a usage figure |
| `browserslist` | MIT | ship the license text | `THIRD_PARTY_NOTICES.md` |

`THIRD_PARTY_NOTICES.md` lives at the repo root and is added to `package.json` `files[]` so it ships in the npm tarball, the Docker image, and the `.mcpb`.

The per-response attribution string, used verbatim wherever a usage percentage appears:

> `Usage data from caniuse.com, © Can I Use contributors, CC BY 4.0. Figures are a share of the ~97.3% of global traffic caniuse tracks.`

The figure is the `CANIUSE_TRACKED_PERCENT` constant: `usage_global` summed across every agent of the bundled caniuse-lite, to one decimal. A test pins it to the bundled data, so a caniuse-lite bump that moves it fails until the constant and the documents quoting the string are updated.

It rides `enrichment.attribution`, which reaches both `structuredContent` and `content[]` without a `format()` entry. Tools that never emit a usage figure (`get_feature`, `search_features`) do not populate it.

## Server Instructions

Draft `instructions` for `createApp()`:

> Browser support and Baseline status for web platform features, served from bundled MDN browser-compat-data, web-features, and caniuse data — offline, no API key, no rate limit. Start at browsercompat_search_features when the feature key is unknown; browsercompat_get_feature returns the per-feature record and browsercompat_check_baseline answers ship-or-not across up to 20 features at once. Every tool takes one feature string that is either a BCD key (css.selectors.has) or a web-features id (has), and echoes resolved_as saying which namespace it matched; an unresolved feature comes back as found: false with guidance, never an error. browsercompat_compare_support requires an explicit browserslist query and evaluates all of it on every call: verdicts, coverage, and totals describe the whole query, while the target rows cover at most 10 query targets per call — pass nextOffset as target_offset for the next page. A feature clears only when every target in the query was evaluated and supports it; a target with no compatibility data is counted as unchecked and makes the verdict inconclusive, so a pass is never claimed for a browser that was not evaluated. browsercompat_list_reference enumerates the namespaces, browser ids, browserslist agents, Baseline states, groups, and snapshots the other tools expect. Every response echoes data_version; the data is a package snapshot, so a feature that shipped in the last few weeks may lag.

## Implementation Order

1. **Data deps and version reading** — `@mdn/browser-compat-data`, `web-features`, `browserslist`, `caniuse-lite` as runtime dependencies; `data-version-service` with the Node-safe resolution for each.
2. **`browsercompat_list_reference`** — no resolver dependency; grounds field-testing for everything after it.
3. **`bcd-service`** — leaf index, release-index maps, reported browser set, `resolveTargetVersion`, `supportAt`. Unit-test the version comparison against the recorded edge cases: `≤12.1`, `version_added: 'preview'`, array statements, `api.DOMMatrix [firefox] ["33","49","1.5"]` ordering, `samsung 20` ↔ `20.0`, `safari 16.0` ↔ `16`, `ios_saf 18.5-18.7`, `op_mini all`, `safari TP`, a browser absent from `support`.
4. **`baseline-service`** and the resolver — including the four case-colliding BCD keys, the 12 redirect entries, the 288 tagged-but-unmapped leaves, and the 21 features with no `compat_features`.
5. **`browsercompat_get_feature`**.
6. **`browsercompat_check_baseline`** — adds the excluded-usage computation and the attribution string.
7. **`search-service`** and **`browsercompat_search_features`**.
8. **`targets-service`** and **`browsercompat_compare_support`** — including the agent-map completeness test against `browserslist.data`.
9. **`THIRD_PARTY_NOTICES.md`**, `files[]`, `server.json` / `manifest.json` parity, `.claude-plugin` / `.codex-plugin`.
10. **`devcheck` + tests + field test.**

Each step is independently testable. Steps 3 and 4 are the load-bearing ones; everything after is presentation over verified primitives.

---

## Decisions Log

**D1 — Load the raw packages lazily; no build-time trimmed index.** Measured: 28 MB on disk but **~1.7 MB compressed** (BCD 935 KB gz, web-features 398 KB gz, caniuse-lite 369 KB tar.gz), and the `.mcpb` is a zip, so packaging cost is small. Cold load of all four is ~116 ms, well inside the 1 s budget. A generated index would save roughly 1 MB compressed at the cost of a build step that can silently drift from the installed dependency versions.

**D2 — Size the hosted container for ~150 MB RSS.** Resident memory goes from 12.6 MB to 141.8 MB once all four datasets and the flat leaf index are loaded. That is the real cost of D1 and it is a container-sizing note, not a packaging one. No native binaries, no helper processes, no OS permission grants are involved anywhere in the server.

**D3 — Warm the datasets from `setup()` without awaiting.** Keeps stdio startup instant while a hosted container pays the ~116 ms during boot rather than on the first request.

**D4 — Resolver order is BCD key → web-features id → lowercased id → redirect → optional search, and the namespaces cannot collide.** Verified: no web-features id contains a dot, no BCD leaf path is a single segment, and no leaf path equals an id.

**D5 — BCD key matching is case-sensitive only.** Four pairs collide case-insensitively (`api.Crypto`/`api.crypto`, `api.Origin`/`api.origin`, `api.Performance`/`api.performance`, `api.Scheduler`/`api.scheduler`), so a case-folding fallback would pick arbitrarily between two real features.

**D6 — `resolve: true` is opt-in and off by default.** A search fallback that fires by default turns a typo into a confident answer about the wrong feature. Off, a typo returns a miss the agent can correct in one turn. When on, it accepts only a top tier that names one entity (D40).

**D7 — A resolver miss is `{ found: false, guidance }` in `output`, not a throw.** Resolution is the tool's whole job, so a no-match is an expected outcome the agent reasons about. Throws are reserved for malformed input and rejected browserslist queries. This matches the framework split: a search's empty result rides `enrichment`, a resolver's miss is the primary result.

**D8 — The reported browser set is 13, derived from `browsers[id].type`.** BCD 8.1.2 has 6 `desktop` and 7 `mobile` browsers. (The idea doc says "12" but enumerates 13 ids; the data agrees with the list, not the count.) Deriving from `type` rather than hardcoding means a browser BCD adds later lands in the right bucket with no code change.

**D9 — Order versions by `releases[v].index`, never by parsing version strings or trusting key order.** `index` is a unique 0..n−1 release ordinal, verified for all 17 browsers. `Object.keys(releases)` is not sorted — `safari` yields `… 17, 18, 26, 27, 1.1, 1.2, … 3.1, 5.1, 9.1`.

**D10 — `≤X` before the target, and a browser absent from `support`, both resolve to `unknown`, never to unsupported.** BCD uses `≤X` precisely to say it does not know how far back support goes, and six browsers carry entries on only 18,468 of 20,543 leaves. Reading either as "no" would manufacture a false negative.

**D11 — `version_added: 'preview'` is not shipped.** 910 statements use it, and only Chrome, Firefox, and Safari have a preview channel at all. It gets its own `preview_only` verdict so the distinction from `unsupported` is visible.

**D12 — `unknown` neither passes nor fails a target; it moves to `unchecked_targets` and makes the feature `inconclusive`.** This is the rule that keeps a clean pass from being reported for a browser that was never evaluated. `browserslist('defaults')` yields 5 unmappable tokens across 4 agents, so the path is exercised on the most common query in the ecosystem.

**D13 — Baseline comes from `status.by_compat_key[bcdKey]`, and the BCD tag is only a hint.** `by_compat_key` covers 15,482 keys with clean 1:1 ownership; BCD tags cover 15,566 leaves with 777 multi-tag leaves and 288 leaves whose tag has no matching `by_compat_key` entry. Verified divergence between rollup and key: `grid` rolls up to `high`/2020-04-17 while its 62 keys carry several distinct states.

**D14 — `not_mapped` is a fourth explicit Baseline state covering 5,061 leaves (24.6%).** The raw values are `"high"`, `"low"`, and `false`; the reported words are `widely`, `newly`, `limited`, `not_mapped`. An absent field would read as "no data loaded"; an explicit state reads as "this key is outside the web-features mapping," which is the actual fact.

**D15 — Search ranks in six named tiers with a `matched_on` echo, not a composite score.** A weighted score over name, description, and path hits would look authoritative while being arbitrary. Tiers are inspectable and the agent can see why a row ranked where it did.

**D16 — caniuse contributes titles and usage only, never support facts.** `caniuse-lite` exposes `{ status, title, shown, stats }` per feature — no keywords, no categories. Its `stats` letters are a second, coarser support opinion that would contradict BCD on edge cases, so BCD stays the single support authority and caniuse supplies 583 titles for the search index plus `usage_global` and `coverage()` for weighting.

**D17 — No resources.** Every datum is reachable through the tool surface. A `browsercompat://feature/{key}` resource would need URI-encoding of dotted keys and would duplicate `get_feature` on a second surface that many clients never expose, for no capability the tools lack.

**D18 — No prompts.** The server answers point lookups and one comparison; there is no recurring multi-step interaction pattern worth a template.

**D19 — `data_version` rides `enrichment`, not `output`.** It is context about the result rather than domain payload, and enrichment reaches `structuredContent` and `content[]` automatically without a `format()` entry on all five tools. It lands on misses too, since a miss is a successful call.

**D20 — The caniuse attribution is a per-response `enrichment.attribution` field, populated only when a usage figure is present.** CC-BY-4.0 requires attribution wherever the data is conveyed; a static `THIRD_PARTY_NOTICES.md` alone would not travel with a tool response that quotes a percentage. Tools that emit no usage figure do not carry the string, so it is signal rather than boilerplate.

**D21 — `THIRD_PARTY_NOTICES.md` in `files[]` carries the full Apache-2.0 and MIT license texts, and a CC BY 4.0 notice.** `web-features` ships `LICENSE.txt` and no `NOTICE`, so Apache-2.0 §4(d) adds no further obligation beyond carrying the license and stating attribution — met with the full Apache-2.0 text. `browserslist`'s MIT license is likewise reproduced in full, since MIT requires the license text be included in copies of the software. CC BY 4.0 is different: it requires attribution and a link to the license, not the reproduction of its legal code, so the file carries the license notice, the required attribution string, and the canonical legalcode URL rather than the full CC BY 4.0 text — satisfying the obligation without the added bulk.

**D22 — `targets` is required on `compare_support`.** With no query, browserslist reads `.browserslistrc`, `package.json`, and `BROWSERSLIST` from the process working directory, which in a container is the image rather than the caller's project. Verified: an explicit query bypasses all three. Requiring it means config discovery is never reached.

**D23 — Read `web-features`' version via `require.resolve('web-features/data.json')` and an `fs` read of the sibling `package.json`.** `require('web-features/package.json')` and the same call for BCD resolve under Bun but throw `ERR_PACKAGE_PATH_NOT_EXPORTED` under Node 24, and production runs `node dist/index.js` — the direct read would pass in development and crash in production. BCD needs no such trick: `__meta.version` is in the data.

**D24 — The browserslist↔BCD map declares all 19 agents explicitly and is guarded by a test against `browserslist.data`.** A map with only the 12 mapped agents would let a newly added caniuse agent silently disappear from `unchecked_targets`, which is exactly the failure `unchecked_targets` exists to prevent.

**D25 — No auth scopes, no server-specific env vars.** Read-only bundled public data, no tenant state, no upstream quota. A scope or a config knob here would be surface with nothing behind it.

**D26 — A multi-key web-features id (`resolved_as.bcd_key === null`) omits leaf-only fields and returns `compat_keys` instead of aggregating across keys.** Verified 882 of 1,198 features (74%) own more than one BCD key, so this is the common case, not a corner case. `support`, `status`, `limiting_browser`, `mdn_url`, and `spec_urls` are per-leaf facts with no single correct value across keys that can disagree (D13's `grid` divergence). `browsercompat_compare_support` reports the same situation as verdict `ambiguous` rather than guessing which key's support data to check against the targets.

**D27 — `limiting_browser` requires full support in every core browser.** Every current core-browser verdict must be `supported` with a resolvable added release. Otherwise a single newest-release claim hides a restriction elsewhere in the core set; the full support rows carry those restrictions.

**D28 — `browsercompat_list_reference`'s `baseline_states` counts are per-BCD-key, not per-feature.** Verified: the feature-level split (646 `high` / 123 `low` / 429 `false` among 1,198 features, plus 12 redirect entries with no status) and the per-key split via `by_compat_key` (8,746 `high` / 1,256 `low` / 5,480 `false`, plus 5,061 keys in no `by_compat_key` entry at all, summing to all 20,543 leaves) are different populations. Since the server reports Baseline per BCD key everywhere else (Requirements, D13), the reference tool's counts follow that same unit rather than the feature-level numbers that happen to appear earlier in this doc's data verification.

**D29 — Dropped `limiting_target` from `browsercompat_compare_support`'s `results` schema.** It named a single "limiting" target with no defined selection rule and no use in the worked example, and `failing_targets[]` already itemizes every failing target with its own verdict — a second field naming one of them adds an unspecified tie-break with no offsetting value.

**D30 — `all_widely_available` is strictly the Baseline predicate: every result resolved (`found` or `no_compat_data`) with `baseline.state === 'widely'`; a `miss` forces false; deprecation and discouragement do not enter.** The field's name is a Baseline term, and folding advisability into it would make a `widely` deprecated feature read as "not widely available", which is false. The per-result `deprecated` / `discouraged` fields carry that half of the ship decision, mirroring how `all_clear` on `browsercompat_compare_support` is strict about `unchecked_targets` rather than blending them in.

**D31 — Every tool declares `idempotentHint: true` alongside `readOnlyHint` and `openWorldHint: false`.** All five tools are pure functions over immutable in-process data: the same input against the same `data_version` always produces the same output, and no call has a side effect a repeat could compound.

**D32 — No tool declares a `title`.** Every natural per-tool title (`Get Feature`, `Check Baseline`) is Title Case, which the identity rule forbids on every display surface. Rather than force a title that either violates the rule or reads oddly as a bare lowercase-hyphenated string, tools omit `title` and fall back to their `name`.

**D33 — `createApp()` sets `cacheHints` for `tools/list` / `server/discover` and `landing: { requireAuth: false }`.** The tool catalog is fixed at boot with no dynamic registration, so caching the list response is free correctness; the landing page serves the full inventory without an auth gate for the same reason D25 sets no scopes — there is nothing behind it that needs one.

**D34 — `src/types/caniuse-lite.d.ts` is a local ambient module declaration.** `caniuse-lite` ships no types of its own; the file declares only the members `targets-service` actually reads (`agents`, `features`, `feature()`).

**D35 — Normalize BCD HTML once at ingestion; escape literal text at Markdown rendering.** The BCD normalizer strips markup, preserves anchor labels and destinations, and decodes one entity layer in descriptions and notes. Escaped element names therefore survive as text, and `&amp;lt;` stays `&lt;`. Web-features prose bypasses normalization. All five formatters and their trailers escape literal markup and preserve HTTP(S) links; structured output remains plain text. An underscore between two letters or digits is left alone, since it cannot delimit emphasis, so browserslist tokens (`and_chr`), BCD keys, and tool names in guidance stay copyable from text. A bounded forward scan handles malformed openers without repeatedly searching their suffixes. Unknown named entities stay literal; invalid Unicode numeric scalars become the replacement character.

**D36 — Shared output shapes (`resolved_as`, the Baseline block, a support row, the limiting browser) are defined once in `compat-shapes.ts`, alongside their renderers.** The design specifies each shape identically wherever it appears, so centralizing it avoids five near-identical Zod definitions drifting apart. Error contracts are the deliberate exception and stay inline per tool, per the framework's locality convention (`api-errors` skill) — the contract is part of each tool's own documented public surface.

**D37 — The shared feature resolver lives in its own module, `services/baseline/feature-resolver.ts`, beside rather than inside `baseline-service.ts`.** It imports the BCD, baseline, and search services, and nothing imports it back. Resolving through search from inside `BaselineService` itself would create a `baseline-service ↔ search-service` import cycle, which Biome's `noImportCycles` rule treats as an error.

**D38 — A query whose every token is a mapped agent with an unresolvable version is an ordinary `compare_support` response, not an error.** `unchecked_targets` already carries a per-token reason that says exactly what happened, and the same token produces exactly that alongside a token that did resolve (`chrome 100, safari TP`) — erroring on it alone made the single-token case answer a different question from the multi-token one. `no_targets_resolved` is reserved for a query with no per-token reason worth returning: zero tokens, or only unmapped agents, with the message naming which and listing the agents. The cost is that a caller who queries only `safari TP` gets a successful response with nothing evaluated, which the `inconclusive` verdicts and the `Evaluated for every compared feature: 0 of 1 target versions` line state plainly.

**D39 — The 1–200 character bound lives on the input schema; `invalid_feature_input` covers whitespace-only.** `get_feature` declared the empty and over-length cases in its error contract while its own schema already rejected them, leaving that half of the contract unreachable behind a generic schema rejection; the two array tools bounded their entries neither way. The length bound now sits on the schema for all three, where it is rejected by field name and advertised in `inputSchema`, and whitespace-only — the one case a length validator cannot express — is what the handler-level contract covers, identically across `get_feature`, `check_baseline`, and `compare_support`.

**D40 — Resolver step 6 counts entities in the top tier, not rows.** A feature's name is joined onto every key it owns, so "one row in the tier" rejected an exact name on any multi-key feature (882 of 1,198), which is most of what `resolve: true` is for. Grouping by `baseline_id` (by `bcd_key` for an unmapped row) keeps the original guard, since two features sharing the top tier are still a miss, and a multi-key hit resolves exactly as its feature id would under step 3. Exact-label rows take precedence over `path_suffix` rows in the same tier: a feature's exact name is stronger evidence than a key that merely ends in the same words, and without the precedence the feature named `window.external` would be a miss because `api.Window.external` also ends that way.

**D41 — The `path_suffix` match sits in tier 2 and needs at least two segments.** Dotted and property-value notation (`element.animate`, `display: grid`) is how developers name a key. Left to tier 6 `path_tokens` it ranked below every description hit (`element.animate` 242nd of 250). Two segments pick one key almost every time: 18,616 of the 18,899 two-segment suffixes of keys three or more segments deep name exactly one key. A single segment is shared across 13,265 keys. A suffix shared by several keys (`referrerpolicy.unsafe-url`, 13 keys across `referrer-policy` and `svg`) lists them all and leaves the choice to D40's grouping, where an exact name in the same tier outranks it. `prototype` is dropped only between two segments, so MDN's `Array.prototype.at` form matches while the bare word `prototype` and `isPrototypeOf` still search as before.

**D42 — The `group` filter includes descendant groups, and `group` / `snapshot` are validated against the bundled vocabulary rather than a Zod enum.** Top-level groups hold few features directly (`css` 101 direct, 355 with its 29 descendant groups), so an exact-group filter would miss most of what a caller means. webstatus.dev's `group:` operator uses the same semantics. Both vocabularies move with each `web-features` bump, so a hardcoded enum would go stale. An unknown value fails with `unknown_group` / `unknown_snapshot` and routes to `browsercompat_list_reference`.

**D43 — `<` and `>` are punctuation in queries and indexed names.** Queries and web-features names are plain text; stripping their tag-shaped names would erase `<dialog>`. Only actual BCD descriptions and notes undergo HTML normalization, once at ingestion (D35).

**D44 — `search_features` pages with a plain `offset` and a `nextOffset` enrichment field, not a cursor.** The ranking is a total order over an immutable bundled snapshot, so the same offset always returns the same rows. A cursor would add state without making paging any more stable.

**D45 — Feature advisories are independent of leaf status.** `get_feature.discouraged` survives multi-key, zero-key, and status-less resolutions. The nested `status.discouraged` alias remains for existing callers; equal advisories render once.

**D46 — Usage requires feature-scope equivalence.** A BCD child key cannot borrow its broader parent feature's exclusion percentage. Only an exact sole-key mapping shares that figure; actual feature resolutions retain it. Omission preserves uncertainty without inventing a second key-level weighting model.

**D47 — Direct-child navigation has a continuation.** BCD traversal builds the child index once; get-feature slices at `subkeys_offset` with a fixed 100-key page. A hard cap alone would make larger child sets unreachable, while aggregating multi-key features would confuse structural children with feature membership.

**D48 — Unavailable support retains verdict-appropriate metadata.** Merge notes and implementation URLs only from false statements for `unsupported`, and preview statements for `preview_only`, in declaration order with deduplication. A future numeric statement is not evidence about an older target.

**D49 — `compare_support` pages its target rows by ordered browserslist token and keeps every verdict and total whole-query.** A broad query is valid input, and its rows grow with it: 20 features against `since 2000` (688 targets) serialized to 1,487,622 bytes in one response. The page is a window over the query's token order, and every list of target rows — `targets_resolved`, `unchecked_targets`, and each result's `failing_targets` and `unchecked_targets` — is projected onto that one window, so a page answers "what about these targets" consistently across lists. Verdicts, `all_clear`, coverage, and totals are computed before the projection and repeat on every page. Paging the evaluation itself would let a failure outside the page go unreported on the page a caller happened to read. `totalCount` counts query targets, the unit being paged. The order is fixed for a given query and snapshot, so a plain offset is stable, as in D44.

**D50 — "Evaluated" means compatibility data was read for the target, per feature; the aggregate is the intersection.** Mapping a token onto a BCD release is not evaluation: a key can record nothing for that browser, and which browsers a key records varies by key. Each compared result carries its own evaluated and unchecked counts and coverage. The top-level `target_coverage_percent` covers only the targets every compared feature has data for, and `unchecked_coverage_percent` is its complement within the query, so no token is counted on both sides. `targets_resolved` stays the mapping inventory, with an `evaluated` flag per row. With no comparable feature nothing was evaluated: coverage is 0 and every mapped target is unchecked as `no_comparable_feature`.

**D51 — A query containing any unevaluated target cannot return `clears`, which makes `defaults` `inconclusive` today.** `clears` asserts support on every target in the query. With one target unchecked, the most the data supports is "no failure found", which is `inconclusive`. `defaults` includes four agents with no BCD counterpart (5 of its 35 tokens, 0.7324% of tracked traffic), so a feature supported on all 30 evaluated targets still reads `inconclusive`. A `clears` that silently skipped them is what D12 exists to prevent. The per-result `failing_total`, `evaluated_total`, and `unchecked_coverage_percent` let a caller decide whether the unchecked share matters to them. A query limited to browsers with compatibility data can still clear.

**D52 — `target_limit` tops out at 10.** Every page target can contribute a row to each of up to 20 results as well as to the two top-level lists, so the response grows with features × page targets. At 10 the largest measured page — 20 features against `since 2000` — is 32,068 bytes of `structuredContent` and 21,022 bytes of text. A larger cap would put a 20-feature call past the budget the paging exists to hold.

---

## Known Limitations

- **Staleness is the operating risk.** Baseline dates move — `:has()` crossed to widely available on 2026-06-19 — and a pinned dependency returns a stale ship/no-ship verdict on precisely the newest features. Two mitigations: `data_version` on every response, and a dependency bump at least monthly tracking BCD releases.
- **24.6% of BCD keys have no Baseline mapping.** 5,061 leaves report `not_mapped`. Filtering search by any Baseline value excludes all of them, which the zero-hit notice says explicitly.
- **Usage figures are a share of tracked traffic, not of all traffic.** caniuse `usage_global` sums to 97.2674% across all 19 agents in the bundled caniuse-lite 1.0.30001812. The attribution string states this on every response that carries a percentage.
- **Seven browserslist agents have no compatibility data** — `op_mini`, `bb`, `and_uc`, `and_qq`, `baidu`, `kaios`, `ie_mob`, together 0.7324% of tracked usage. They always land in `unchecked_targets`; the server reports the gap rather than guessing.
- **`defaults` never returns `clears`.** Four of those agents are in it, and a query with any unevaluated target is `inconclusive` at best (D51). The per-feature totals say how much of the query was evaluated; a query restricted to browsers with compatibility data can clear.
- **`compat_keys` on an `ambiguous` result is not bounded by target paging.** An ambiguous web-features id returns every compat key it owns (`grid` owns 62), and `target_offset` / `target_limit` do not touch that list, so a call with many ambiguous ids carries all of them on every page.
- **21 web-features entries have no BCD keys** and return `no_compat_data` — Baseline state is available for them, per-browser support is not.
- **`webextensions` leaves carry no `status`.** All 2,075 of them render "not recorded" for deprecated/experimental/standard-track rather than a fabricated `false`.
- **caniuse and BCD version spaces diverge per browser.** Exact for Chrome, Edge, Firefox, and IE; 26 of 54 tokens for `ios_saf`; 10 of 27 for `samsung`. The normalization plus nearest-at-or-below rule closes the gap, and `safari TP` remains unresolvable by design.
- **No live MDN prose.** The server returns `mdn_url` and `spec_url`; fetching the page is a browser or fetch server's job.
- **Deferred option, not v1:** if the ~130 MB resident footprint becomes a hosting constraint, the mitigation is a build-time trimmed BCD index (drop `source_file`, split the runtime browsers into a lazily loaded second file). Not built — D1 holds until the footprint is actually a problem.
