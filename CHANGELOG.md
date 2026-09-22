# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-09-22

Search now matches dotted and property-value notation, filters by web-features group and ECMAScript snapshot, and pages by offset; resolve: true correctly handles a name spanning several BCD keys.

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-09-20

The public hosted instance at browser-compat.caseyjhand.com/mcp is now published in server.json remotes and documented in the README.

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-09-19

The Docker image builds again — the production stage's install step had lost its RUN instruction, so docker build failed to parse the Dockerfile and 0.1.1 shipped no image.

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-09-19

Five browsercompat_* tools answering browser support and Baseline questions offline from bundled @mdn/browser-compat-data, web-features, caniuse-lite, and browserslist — no API key, no network, and no verdict claimed for a target browser the data could not evaluate.
