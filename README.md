<div align="center">
  <h1>@cyanheads/browser-compat-mcp-server</h1>
  <p><b>Browser compatibility and Baseline status for any web feature — offline, from MDN's browser-compat-data, web-features, and caniuse. STDIO or Streamable HTTP.</b>
  <div>5 Tools</div>
  </p>
</div>

<div align="center">

[![npm](https://img.shields.io/npm/v/@cyanheads/browser-compat-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/browser-compat-mcp-server) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/browser-compat-mcp-server/releases/latest/download/browser-compat-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=browser-compat-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvYnJvd3Nlci1jb21wYXQtbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22browser-compat-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fbrowser-compat-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://browser-compat.caseyjhand.com/mcp](https://browser-compat.caseyjhand.com/mcp)

</div>

---

## Overview

Web platform compatibility for frontend work: per-browser support from MDN's `@mdn/browser-compat-data`, Baseline state and dates from `web-features`, and browserslist target resolution weighted by `caniuse-lite` usage figures. Every dataset ships inside the package, so there are no runtime network calls, no API key, no rate limit, and no upstream to be down — the same answers come back air-gapped. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `browsercompat_list_reference` | Enumerate the reference vocabulary the other tools expect — BCD namespaces and browser ids, browserslist agents, Baseline states, groups, and ECMAScript snapshots. |
| `browsercompat_get_feature` | Full compatibility record for one feature: Baseline state, standards status, per-browser versions with flags and prefixes, MDN and specification links. |
| `browsercompat_check_baseline` | Ship-or-not across up to 20 features: Baseline state and date, the limiting browser, deprecation flags, and the traffic share requiring it would exclude. |
| `browsercompat_search_features` | Find features by plain name or keyword when the canonical key is unknown, ranked with the field that matched. |
| `browsercompat_compare_support` | Check features against an explicit browserslist target query, reporting the failing target per feature and every target that could not be evaluated. |

---

## Capability reference

### `browsercompat_list_reference` <sub>tool</sub>

- One required `topic`: `bcd_namespaces` (12), `bcd_browsers` (17), `browserslist_agents` (19), `baseline_states` (4), `groups` (103), `snapshots` (11)
- Entries carry `id`, `label`, and `detail`, plus `count`, `reported`, `bcd_browser`, `usage_percent`, `maps_from`, or `spec_url` where the topic has them
- `browserslist_agents` gives each agent's browser-compat-data counterpart or `null` — the `null` ones can never be evaluated and always land in `unchecked_targets`

---

### `browsercompat_get_feature` <sub>tool</sub>

- One `feature` string, 1–200 characters: a BCD key (`css.selectors.has`) or a web-features id (`has`); `resolved_as` echoes which one matched and how
- `resolve: true` accepts the search index's single unambiguous top hit; off by default, so a typo returns a miss rather than a confident answer about the wrong feature
- `include_runtimes: true` adds `bun`, `deno`, `nodejs`, and `oculus` rows to the 13 reported desktop and mobile browsers
- `outcome` is `found` | `no_compat_data` | `miss` — a miss is `found: false` with `guidance`, never an error
- A web-features id spanning more than one BCD key omits the per-key fields (`support`, `status`, `limiting_browser`, `mdn_url`, `spec_urls`) and returns `compat_keys` to re-call with
- Typed failure: `invalid_feature_input` (whitespace-only `feature`)

---

### `browsercompat_check_baseline` <sub>tool</sub>

- Up to 20 BCD keys or web-features ids per call, 1–200 characters each; one result per entry, in input order
- Each result carries Baseline state and dates, `limiting_browser`, `deprecated` / `experimental` / `discouraged`, and `usage_percent_excluded` alongside the `usage_source` it is a share of
- `usage_percent_excluded` is absent — never zero — when the feature reaches no caniuse id
- `all_widely_available` answers the Baseline question alone: every entry resolved at `widely`, one miss forces it false, and deprecation does not enter it
- Typed failure: `invalid_feature_input` (a whitespace-only entry)

---

### `browsercompat_search_features` <sub>tool</sub>

- `query` 1–100 characters, with optional `namespace` (one of the 12 BCD namespaces) and `baseline` (`widely` | `newly` | `limited` | `not_mapped`) filters; `limit` 1–50, default 10
- Every hit carries `matched_on`, the field that matched, so the six-tier ranking is inspectable rather than a score
- `support_summary` is one line across the seven Baseline core browsers, with `—` for unsupported and `?` for unknown
- Zero hits are a successful empty result plus a notice naming which filter to drop; `totalCount` and `truncated` report matches beyond `limit`
- Typed failure: `invalid_query` (a query that normalizes to zero tokens)

---

### `browsercompat_compare_support` <sub>tool</sub>

- Up to 20 features against a required `targets` browserslist query (`defaults`, `> 0.5%, last 2 versions`) — required so browserslist never falls back to config in the server's working directory
- `verdict` per feature: `clears` | `fails` | `inconclusive` | `miss` | `ambiguous`; `failing_targets` names each failing target with the verdict behind it (`partial`, `prefixed`, `flagged`, `removed`, `unsupported`, `preview_only`)
- `unchecked_targets` lists every target the server declined to judge, with `no_bcd_browser` | `unknown_version` | `no_bcd_data`; `all_clear` requires that list to be empty
- `target_coverage_percent` and `unchecked_coverage_percent` give the caniuse-derived traffic share of the evaluated and unevaluated tokens
- Typed failures: `invalid_target_query`, `no_targets_resolved`, `invalid_feature_input`

---

## Data sources

| Package | Version | License | Supplies |
|:---|:---|:---|:---|
| [`@mdn/browser-compat-data`](https://github.com/mdn/browser-compat-data) | `^8.1.1` | CC0-1.0 | Per-browser support, standards status, MDN and specification links |
| [`web-features`](https://github.com/web-platform-dx/web-features) | `^3.38.0` | Apache-2.0 | Baseline state and dates, discouraged flags, groups, ECMAScript snapshots |
| [`caniuse-lite`](https://github.com/browserslist/caniuse-lite) | `^1.0.30001810` | CC-BY-4.0 | Usage weighting, plus feature titles for the search index |
| [`browserslist`](https://github.com/browserslist/browserslist) | `^4.29.0` | MIT | Target query resolution and coverage figures |

CC BY 4.0 requires attribution wherever the caniuse data travels, so every response carrying a usage figure carries this string: `Usage data from caniuse.com, © Can I Use contributors, CC BY 4.0. Figures are a share of the ~96.7% of global traffic caniuse tracks.` Full license texts and notices are in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

---

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Browser-compat-specific:

- All four datasets are bundled and loaded in process — no runtime network calls, no API key, no rate limit, and nothing to configure
- Baseline is read per browser-compat-data key from `status.by_compat_key`, never rolled up from the feature level, because keys under one feature legitimately disagree
- One shared resolver behind every tool: exact BCD key, then web-features id, then a `moved` redirect, and only under `resolve: true` the search index's single unambiguous hit
- Target versions are ordered by browser-compat-data's release index rather than parsed version strings, with the caniuse spellings normalized both directions (`safari 16.0` ↔ `16`, `samsung 20` ↔ `20.0`)

Agent-friendly output:

- Every response echoes `data_version` — the version of each bundled dataset behind the answer, since a pinned snapshot goes stale on exactly the newest features
- A verdict is never claimed for a browser that was not evaluated: unknown support moves the target into `unchecked_targets` and the feature to `inconclusive`
- Misses are results, not failures — `found: false` with `guidance` naming the next call, and typed error reasons carrying recovery hints for the input a caller has to fix
- Usage figures state the population they are a share of, and carry the caniuse attribution on every response that reports one

---

## Getting started

### Public Hosted Instance

A public instance is available at `https://browser-compat.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "browser-compat-mcp-server": {
      "type": "streamable-http",
      "url": "https://browser-compat.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

Add the following to your MCP client configuration file:

```json
{
  "mcpServers": {
    "browser-compat-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/browser-compat-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "browser-compat-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/browser-compat-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "browser-compat-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "ghcr.io/cyanheads/browser-compat-mcp-server:latest"
      ]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- No API keys, accounts, or network access required — every dataset ships with the package.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/browser-compat-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd browser-compat-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment (optional):**

```sh
cp .env.example .env
# edit .env if you want to override transport or logging defaults
```

---

## Configuration

There are no server-specific environment variables: no API keys, no base URLs, and deliberately no browserslist configuration variable — the target query is always a tool input rather than ambient state. Only the framework transport settings apply.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for the HTTP server. | `3010` |

See [`.env.example`](./.env.example) for the full list of optional framework overrides.

---

## Running the server

### Local development

```sh
# One-time build
bun run rebuild

# Run the built server
bun run start:stdio
# or
bun run start:http
```

```sh
bun run devcheck   # Lint, format, typecheck, security
bun run test       # Vitest test suite
bun run lint:mcp   # Validate MCP definitions against spec
```

### Docker

```sh
docker build -t browser-compat-mcp-server .
docker run --rm -p 3010:3010 browser-compat-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/browser-compat-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

---

## Project structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | `createApp()` entry point — registers the tools and warms the datasets. |
| `src/data/` | The browserslist agent to browser-compat-data browser map. |
| `src/mcp-server/tools/` | Tool definitions (`*.tool.ts`) and the output shapes they share. |
| `src/services/` | bcd, baseline, targets, search, and data-version services over the bundled datasets. |
| `src/types/` | Ambient module declaration for `caniuse-lite`, which ships no types. |
| `tests/` | Vitest suites mirroring `src/`. |
| `docs/` | `design.md` — the surface, the data shapes behind it, and the decisions log. |
| `changelog/` | Per-version changelog files. |

The generated file tree is [`docs/tree.md`](./docs/tree.md).

---

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools directly in `src/index.ts`
- Data integrity: read the bundled datasets as they are and preserve their uncertainty; never fabricate a support fact the data does not carry

---

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

---

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
