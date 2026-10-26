/**
 * @fileoverview Keeps executable SDK skill modules in MCPB bundles while removing package-root agent documentation.
 * @module tests/scripts/clean-mcpb.test
 */
import { describe, expect, it } from 'vitest';
import { filterAgentDocEntries } from '../../scripts/clean-mcpb.js';

// URL import keeps the linter's framework-repository fallback outside the consumer typecheck.
const packaging: { AGENT_DOC_ENTRY: RegExp } = await import(
  new URL('../../scripts/lint-packaging.ts', import.meta.url).href
);

const retained = [
  'skills/browser-compat-guide/SKILL.md',
  'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.mjs',
  'node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
  'node_modules/outer/node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
  'node_modules/plain/dist/skills/index.js',
  'node_modules/@scope/outer/node_modules/plain/dist/skills/index.js',
];

const removed = [
  'node_modules/plain/skills/guide/SKILL.md',
  'node_modules/@scope/pkg/skills/guide/SKILL.md',
  'node_modules/outer/node_modules/plain/framework-skills/add-tool/SKILL.md',
  'node_modules/@scope/outer/node_modules/@scope/inner/.claude/skills/guide/SKILL.md',
  'node_modules/plain/.agents/config.json',
  'node_modules/@scope/pkg/SKILL.md',
];

describe('MCPB package-root agent documentation', () => {
  it.each(retained)('retains executable or server-owned content: %s', (entry) => {
    expect(filterAgentDocEntries([entry])).toEqual([]);
    expect(packaging.AGENT_DOC_ENTRY.test(entry)).toBe(false);
  });

  it.each(removed)('strips dependency-root agent content: %s', (entry) => {
    expect(filterAgentDocEntries([entry])).toEqual([entry]);
    expect(packaging.AGENT_DOC_ENTRY.test(entry)).toBe(true);
  });
});
