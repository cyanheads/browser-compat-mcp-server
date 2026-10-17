<div align="center">
  <h1>@cyanheads/browser-compat-mcp-server</h1>
  <p><b>Browser compatibility and Baseline status for any web feature — offline, from MDN's browser-compat-data, web-features, and caniuse. STDIO or Streamable HTTP.</b>
  <div>5 Tools</div>
  </p>
</div>

<div align="center">

[![npm](https://img.shields.io/npm/v/@cyanheads/browser-compat-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/browser-compat-mcp-server) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.3.1-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![Bun](https://img.shields.io/badge/Bun-v1.4.3%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

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

Browser support and Baseline status for any web platform feature, from MDN's `@mdn/browser-compat-data`, `web-features`, and `caniuse-lite` usage data. Check whether a feature is safe to ship against your browserslist targets. All data ships in the package: no network calls, no API key, no rate limit.

### Tools

| Tool | Description |
|:---|:---|
| `browsercompat_list_reference` | Enumerate the reference vocabulary the other tools expect — BCD namespaces and browser ids, browserslist agents, Baseline states, groups, and ECMAScript snapshots. |
| `browsercompat_get_feature` | Full compatibility record for one feature: Baseline state, standards status, per-browser versions with flags and prefixes, MDN and specification links. |
| `browsercompat_check_baseline` | Ship-or-not across up to 20 features per call: Baseline state and date, the limiting browser, deprecation flags, and the traffic share requiring it would exclude. |
| `browsercompat_search_features` | Find features by plain name, keyword, or code notation when the canonical key is unknown, ranked with the field that matched, filterable by group or ECMAScript snapshot, and pageable. |
| `browsercompat_compare_support` | Check features against an explicit browserslist target query: a whole-query verdict, evaluated coverage, and failing version runs per feature. |

---

## Capability reference

### `browsercompat_list_reference` <sub>tool</sub>

- Required `topic`: `bcd_namespaces` (12), `bcd_browsers` (17), `browserslist_agents` (19), `baseline_states` (4), `groups` (104), or `snapshots` (11). Group and snapshot ids feed the search filters.
- Entries carry `id`, `label`, and `detail`, plus `count`, `reported`, `bcd_browser`, `usage_percent`, `maps_from`, or `spec_url` where applicable. An agent's `bcd_browser: null` means support comparisons cannot evaluate it and report it in `unchecked_targets`.

---

### `browsercompat_get_feature` <sub>tool</sub>

- One `feature`, 1–200 characters: a BCD key (`css.selectors.has`) or web-features id (`has`). `resolve: true` (off by default) also accepts a name or notation when it matches exactly one feature. `include_runtimes: true` adds `bun`, `deno`, `nodejs`, and `oculus` support rows.
- `outcome` is `found`, `no_compat_data`, or `miss`; a miss returns `found: false` with `guidance`, and whitespace-only input returns `invalid_feature_input`. Each `support` row gives the newest release's statement, with the other BCD statements for that browser in `other_statements`.
- A multi-key id such as `grid` returns `feature_support` (one row per Baseline core browser) instead of `support`, `status`, `mdn_url`, and `spec_urls`; call one of its `compat_keys` for a key-level answer. `compat_keys` and `subkeys` page 100 at a time with `compat_keys_offset` and `subkeys_offset` (default 0). `limiting_browser` is the Baseline core browser with the newest required release.

---

### `browsercompat_check_baseline` <sub>tool</sub>

- BCD keys or web-features ids, 1–200 characters each. Up to 100 are accepted and the first 20 are evaluated in input order; the rest come back verbatim in `omitted_features`. More than 100 is rejected, and a whitespace-only entry returns `invalid_feature_input`.
- Results carry Baseline state and dates, `limiting_browser`, `deprecated`, `experimental`, and `discouraged`, plus `usage_percent_excluded` and `usage_source` where caniuse covers the feature. Usage is left out when unavailable, never reported as zero.
- `all_widely_available` is true only when every entry resolves at `widely` and none was omitted; it does not assess deprecation.

---

### `browsercompat_search_features` <sub>tool</sub>

- `query`, 1–100 characters, accepts names, keywords, or notation such as `Array.prototype.at`, `display: grid`, or `<dialog>`. Combine `namespace` (12 BCD namespaces), `baseline` (`widely`, `newly`, `limited`, `not_mapped`), `group` (including nested groups), and `snapshot` (such as `ecmascript-2023`).
- `matched_on` says why a result ranked where it did, and `support_summary` covers the seven Baseline core browsers (`—` unsupported, `?` unknown). Typed failures: `invalid_query` (zero searchable tokens), `unknown_group`, `unknown_snapshot`.
- Page with `limit` (default 10, at most 50; larger values are served as 50 and reported in `cap`) and `offset` (default 0); `totalCount` and `nextOffset` drive paging. Zero hits succeed with a notice naming a filter to drop.

---

### `browsercompat_compare_support` <sub>tool</sub>

- Up to 20 features per call against a required `targets` browserslist query, such as `defaults` or `> 0.5%, last 2 versions`; local browserslist config is never used. Up to 100 features are accepted and the rest come back in `omitted_features`, which makes `all_clear` false. Typed failures: `invalid_target_query`, `no_targets_resolved`, `invalid_feature_input`.
- Each `verdict` is `clears`, `fails`, `inconclusive`, `miss`, or `ambiguous`. A feature clears only when every target in the query was evaluated and supports it, so a query that includes a browser with no compatibility data, as `defaults` does, never clears. `all_clear` is true only when every feature clears.
- Results report `support_source`, `failing_ranges`, `failing_total`, and evaluated and unchecked totals with coverage percentages. Target rows page with `target_offset` (default 0) and `target_limit` (default 10, at most 10; larger values are served as 10 and reported in `cap`); verdicts and totals are the same on every page, and `totalCount` and `nextOffset` drive paging.

---

## Data sources

| Package | Version | License | Supplies |
|:---|:---|:---|:---|
| [`@mdn/browser-compat-data`](https://github.com/mdn/browser-compat-data) | `^8.1.5` | CC0-1.0 | Per-browser support, standards status, MDN and specification links |
| [`web-features`](https://github.com/web-platform-dx/web-features) | `^3.42.0` | Apache-2.0 | Baseline state and dates, feature-level core-browser support, discouraged flags, groups, ECMAScript snapshots |
| [`caniuse-lite`](https://github.com/browserslist/caniuse-lite) | `^1.0.30001815` | CC-BY-4.0 | Usage weighting, plus feature titles for the search index |
| [`browserslist`](https://github.com/browserslist/browserslist) | `^4.29.3` | MIT | Target query resolution and coverage figures |

CC BY 4.0 requires attribution wherever the caniuse data travels, so every response carrying a usage figure carries this string: `Usage data from caniuse.com, © Can I Use contributors, CC BY 4.0. Figures are a share of the ~97.3% of global traffic caniuse tracks.` Full license texts and notices are in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

---

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Browser-compat-specific:

- All four datasets are bundled and loaded in process — no runtime network calls, no API key, no rate limit, and nothing to configure
- Baseline is read per browser-compat-data key from `status.by_compat_key`, never rolled up from the feature level, because keys under one feature legitimately disagree
- Every tool resolves a feature the same way: exact BCD key, then web-features id, then a `moved` redirect
- Target versions follow browser-compat-data's release order, with caniuse spellings normalized (`safari 16.0` ↔ `16`)

Agent-friendly output:

- Every response echoes `data_version`, the version of each bundled dataset behind the answer
- A pass is never claimed for a browser that was not evaluated; targets without data land in `unchecked_targets` and make the verdict `inconclusive`
- Misses are results, not failures: `found: false` with `guidance` naming the next call, and typed errors with recovery hints
- Usage figures state the population they are a share of and carry the caniuse attribution

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

There are no server-specific environment variables: no API keys, no base URLs, and deliberately no browserslist configuration variable — the target query is always a tool input rather than ambient state. Framework transport, logging, and telemetry settings remain configurable.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for the HTTP server. | `3010` |
| `MCP_SESSION_MODE` | HTTP session mode. | `stateless` |
| `OTEL_ENABLED` | Enable OpenTelemetry. | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL for traces and metrics. | Unset |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | OTLP log endpoint. | Unset |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log failed-call arguments and results. Redaction matches key names only; free-form values can retain secrets. | `false` |
| `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` | UTF-8 byte cap per logged payload. | `16384` |

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
