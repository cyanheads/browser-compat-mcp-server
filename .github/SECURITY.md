# Security Policy

## Supported Versions

Security fixes land on the latest release of `browser-compat-mcp-server`. Older
versions are not patched — upgrade to the current release.

## Reporting a Vulnerability

Please do not open a public issue for security reports. Instead:

- Report privately via GitHub: **Security** tab → **Report a vulnerability**, or
- Email **security@caseyjhand.com**

Include a minimal reproduction where possible, with any API keys, tokens, or
credentials redacted — a placeholder is enough to show the shape. You'll
receive an acknowledgment, and credit in the release notes if the report leads
to a fix (unless you prefer otherwise).

## Scope

The server answers every request from four datasets bundled inside the package.
It makes no network call at runtime, holds no credentials, stores no caller
data, and runs no subprocess. Reports about the *contents* of
`@mdn/browser-compat-data`, `web-features`, `caniuse-lite`, or `browserslist`
belong upstream with those projects; reports about how this server reads,
indexes, or reports that data belong here.
