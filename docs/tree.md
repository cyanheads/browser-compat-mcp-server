# browser-compat-mcp-server - Directory Structure

Generated on: 2026-09-20 03:50:28

```text
browser-compat-mcp-server/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   ├── mcp.json
│   └── plugin.json
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── config.yml
│   │   └── feature_request.yml
│   ├── workflows/
│   │   └── codeql.yml
│   ├── CODE_OF_CONDUCT.md
│   ├── CONTRIBUTING.md
│   ├── FUNDING.yml
│   └── SECURITY.md
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── changelog/
│   ├── 0.1.x/
│   └── template.md
├── docs/
│   └── design.md
├── framework-skills/
│   ├── add-app-tool/
│   │   └── SKILL.md
│   ├── add-prompt/
│   │   └── SKILL.md
│   ├── add-resource/
│   │   └── SKILL.md
│   ├── add-service/
│   │   └── SKILL.md
│   ├── add-test/
│   │   └── SKILL.md
│   ├── add-tool/
│   │   └── SKILL.md
│   ├── api-auth/
│   │   └── SKILL.md
│   ├── api-canvas/
│   │   └── SKILL.md
│   ├── api-config/
│   │   └── SKILL.md
│   ├── api-context/
│   │   └── SKILL.md
│   ├── api-errors/
│   │   └── SKILL.md
│   ├── api-linter/
│   │   └── SKILL.md
│   ├── api-mirror/
│   │   └── SKILL.md
│   ├── api-services/
│   │   ├── references/
│   │   │   ├── graph.md
│   │   │   ├── llm.md
│   │   │   └── speech.md
│   │   └── SKILL.md
│   ├── api-telemetry/
│   │   └── SKILL.md
│   ├── api-testing/
│   │   └── SKILL.md
│   ├── api-utils/
│   │   ├── references/
│   │   │   ├── formatting.md
│   │   │   ├── parsing.md
│   │   │   └── security.md
│   │   └── SKILL.md
│   ├── api-workers/
│   │   └── SKILL.md
│   ├── code-simplifier/
│   │   └── SKILL.md
│   ├── design-mcp-server/
│   │   └── SKILL.md
│   ├── field-test/
│   │   └── SKILL.md
│   ├── git-wrapup/
│   │   └── SKILL.md
│   ├── maintenance/
│   │   └── SKILL.md
│   ├── orchestrations/
│   │   ├── workflows/
│   │   │   ├── field-test-fix.md
│   │   │   ├── fix-wrapup-release.md
│   │   │   ├── greenfield-build.md
│   │   │   └── maintenance-release.md
│   │   └── SKILL.md
│   ├── polish-docs-meta/
│   │   ├── references/
│   │   │   ├── agent-protocol.md
│   │   │   ├── package-meta.md
│   │   │   ├── readme.md
│   │   │   └── server-json.md
│   │   └── SKILL.md
│   ├── release-and-publish/
│   │   └── SKILL.md
│   ├── release-pr-review/
│   │   └── SKILL.md
│   ├── report-issue-framework/
│   │   └── SKILL.md
│   ├── report-issue-local/
│   │   └── SKILL.md
│   ├── security-pass/
│   │   └── SKILL.md
│   ├── setup/
│   │   └── SKILL.md
│   ├── techniques/
│   │   ├── references/
│   │   │   └── outline-on-overflow.md
│   │   └── SKILL.md
│   └── tool-defs-analysis/
│       └── SKILL.md
├── scripts/
│   ├── build-changelog.ts
│   ├── build.ts
│   ├── check-dependency-specifiers.ts
│   ├── check-docs-sync.ts
│   ├── check-framework-antipatterns.ts
│   ├── check-skill-versions.ts
│   ├── check-skills-sync.ts
│   ├── clean-mcpb.ts
│   ├── clean.ts
│   ├── devcheck.ts
│   ├── lint-mcp.ts
│   ├── lint-packaging.ts
│   ├── list-skills.ts
│   ├── release-github.ts
│   └── tree.ts
├── src/
│   ├── data/
│   │   └── browserslist-bcd-map.ts
│   ├── mcp-server/
│   │   ├── prompts/
│   │   │   └── definitions/
│   │   ├── resources/
│   │   │   └── definitions/
│   │   └── tools/
│   │       └── definitions/
│   │           ├── browsercompat-check-baseline.tool.ts
│   │           ├── browsercompat-compare-support.tool.ts
│   │           ├── browsercompat-get-feature.tool.ts
│   │           ├── browsercompat-list-reference.tool.ts
│   │           ├── browsercompat-search-features.tool.ts
│   │           └── compat-shapes.ts
│   ├── services/
│   │   ├── baseline/
│   │   │   ├── baseline-service.ts
│   │   │   ├── feature-resolver.ts
│   │   │   └── types.ts
│   │   ├── bcd/
│   │   │   ├── bcd-service.ts
│   │   │   └── types.ts
│   │   ├── data-version/
│   │   │   └── data-version-service.ts
│   │   ├── search/
│   │   │   ├── search-service.ts
│   │   │   └── types.ts
│   │   └── targets/
│   │       ├── targets-service.ts
│   │       └── types.ts
│   ├── types/
│   │   └── caniuse-lite.d.ts
│   └── index.ts
├── tests/
│   ├── data/
│   │   └── browserslist-bcd-map.test.ts
│   ├── fuzz/
│   │   └── tools.fuzz.test.ts
│   ├── integration/
│   ├── prompts/
│   ├── resources/
│   ├── services/
│   │   ├── baseline/
│   │   │   ├── baseline-service.test.ts
│   │   │   └── feature-resolver.test.ts
│   │   ├── bcd/
│   │   │   └── bcd-service.test.ts
│   │   ├── data-version/
│   │   │   └── data-version-service.test.ts
│   │   ├── search/
│   │   │   └── search-service.test.ts
│   │   └── targets/
│   │       └── targets-service.test.ts
│   ├── smoke/
│   │   └── tools-list.smoke.test.ts
│   └── tools/
│       ├── browsercompat-check-baseline.tool.test.ts
│       ├── browsercompat-compare-support.tool.test.ts
│       ├── browsercompat-get-feature.tool.test.ts
│       ├── browsercompat-list-reference.tool.test.ts
│       ├── browsercompat-search-features.tool.test.ts
│       └── compat-shapes.test.ts
├── .dockerignore
├── .env.example
├── .gitattributes
├── .gitignore
├── .mcpbignore
├── AGENTS.md
├── biome.json
├── bun.lock
├── bunfig.toml
├── CHANGELOG.md
├── CLAUDE.md
├── devcheck.config.json
├── Dockerfile
├── LICENSE
├── manifest.json
├── package.json
├── README.md
├── server.json
├── THIRD_PARTY_NOTICES.md
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

_Note: This tree excludes files and directories matched by .gitignore and default patterns._
