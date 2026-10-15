/**
 * @fileoverview Literal text and link fidelity through every tool's assembled Markdown path.
 * @module tests/tools/literal-rendering.test
 */

import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { browsercompatCheckBaseline } from '@/mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';
import { browsercompatCompareSupport } from '@/mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { browsercompatGetFeature } from '@/mcp-server/tools/definitions/browsercompat-get-feature.tool.js';
import { browsercompatListReference } from '@/mcp-server/tools/definitions/browsercompat-list-reference.tool.js';
import { browsercompatSearchFeatures } from '@/mcp-server/tools/definitions/browsercompat-search-features.tool.js';
import { formatSupportRow } from '@/mcp-server/tools/definitions/compat-shapes.js';
import { getDataVersion } from '@/services/data-version/data-version-service.js';
import { markdownText } from '@/utils/markdown-text.js';

const literal = '<dialog> **literal** [label](https://example.test/a_b?q=1&x=2) `tick` | &lt;';
const escaped = '&lt;dialog&gt; \\*\\*literal\\*\\* \\[label\\]';

describe('#9 literal rendering', () => {
  it('escapes all reference fields and the attribution trailer while keeping structured values unchanged', async () => {
    const result = await runToolContract(
      {
        ...browsercompatListReference,
        handler: async (_input, ctx) => {
          ctx.enrich({ data_version: await getDataVersion(), attribution: literal });
          return {
            topic: literal,
            entries: [
              {
                id: literal,
                label: literal,
                detail: literal,
                bcd_browser: literal,
                spec_url: 'https://example.test/a_b?q=1&x=2',
              },
            ],
          };
        },
      },
      { topic: 'groups' },
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty('attribution', literal);
    const texts = result.content.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text).toContain(escaped);
      expect(text).not.toContain('<dialog>');
    }
    expect(texts[0]).toContain('<https://example.test/a_b?q=1&amp;x=2>');
  });

  it('escapes get-feature descriptions, resolution echoes, guidance, and notices', async () => {
    const result = await runToolContract(
      {
        ...browsercompatGetFeature,
        handler: async (_input, ctx) => {
          ctx.enrich({
            data_version: await getDataVersion(),
            baselineNotMapped: literal,
            runtimesExcluded: literal,
          });
          return {
            found: true,
            outcome: 'found' as const,
            resolved_as: {
              input: literal,
              bcd_key: literal,
              baseline_id: null,
              resolved_via: 'bcd_key' as const,
            },
            name: literal,
            description: literal,
            guidance: literal,
          };
        },
      },
      { feature: 'has' },
    );
    const texts = result.content.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text).toContain(escaped);
      expect(text).not.toContain('<dialog>');
    }
    expect(result.structuredContent).toHaveProperty('description', literal);
  });

  it('escapes check-baseline miss guidance and the complete unresolved trailer', async () => {
    const result = await runToolContract(browsercompatCheckBaseline, { features: [literal] });
    const texts = result.content.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text).toContain(escaped);
      expect(text).not.toContain('<dialog>');
    }
    expect(JSON.stringify(result.structuredContent)).toContain('<dialog>');
  });

  it('renders omitted_features as one code span holding the entries verbatim (#29)', async () => {
    const omitted = [literal, 'line\nbreak'];
    const features = [...Array(20).fill('has'), ...omitted];
    for (const result of [
      await runToolContract(browsercompatCheckBaseline, { features }),
      await runToolContract(browsercompatCompareSupport, { features, targets: 'chrome 120' }),
    ]) {
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty('omitted_features', omitted);
      const text = result.content.filter((b) => b.type === 'text')[0]?.text ?? '';
      const line = text.split('\n').find((row) => row.startsWith('**omitted_features:**'));
      expect(line).toBe(
        `**omitted_features:** 2 entries past the first 20 were not evaluated — call again with features set to \`\`${JSON.stringify(omitted)}\`\``,
      );
    }
  });

  it('escapes search filters, empty-result notices, and result descriptions', async () => {
    const result = await runToolContract(
      {
        ...browsercompatSearchFeatures,
        handler: async (_input, ctx) => {
          ctx.enrich({
            data_version: await getDataVersion(),
            totalCount: 1,
            appliedFilters: { group: literal },
            noMatchNotice: literal,
            offsetNotice: literal,
          });
          return {
            results: [
              {
                bcd_key: literal,
                baseline_id: literal,
                name: literal,
                description: literal,
                baseline_state: 'limited' as const,
                matched_on: 'name' as const,
                support_summary: literal,
              },
            ],
          };
        },
      },
      { query: 'dialog' },
    );
    const texts = result.content.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text).toContain(escaped);
      expect(text).not.toContain('<dialog>');
    }
  });

  it('escapes compare names, guidance, target table cells, and notices', async () => {
    const result = await runToolContract(
      {
        ...browsercompatCompareSupport,
        handler: async (_input, ctx) => {
          ctx.enrich({
            data_version: await getDataVersion(),
            totalCount: 2,
            shown: 2,
            cap: 10,
            truncated: false,
            attribution: literal,
            uncheckedNotice: literal,
          });
          const unchecked = {
            agent: literal,
            version_token: literal,
            reason: 'no_bcd_data' as const,
            usage_percent: 1,
          };
          return {
            query_echo: 'chrome `100`',
            comparable_features: 1,
            targets_resolved: [
              {
                agent: literal,
                version_token: literal,
                bcd_browser: literal,
                bcd_version: literal,
                bcd_release_index: 1,
                evaluated: true,
              },
            ],
            targets_resolved_total: 1,
            evaluated_targets_total: 1,
            unchecked_targets: [unchecked],
            unchecked_targets_total: 1,
            target_coverage_percent: 1,
            unchecked_coverage_percent: 1,
            all_clear: false,
            results: [
              {
                input: literal,
                found: false,
                resolved_as: null,
                name: literal,
                verdict: 'miss' as const,
                failing_targets: [],
                guidance: literal,
              },
              {
                input: literal,
                found: true,
                resolved_as: {
                  input: literal,
                  bcd_key: literal,
                  baseline_id: literal,
                  resolved_via: 'bcd_key' as const,
                },
                name: literal,
                verdict: 'fails' as const,
                failing_targets: [
                  {
                    agent: literal,
                    version_token: literal,
                    bcd_browser: literal,
                    bcd_version: literal,
                    verdict: 'prefixed' as const,
                    version_added: literal,
                    prefix: literal,
                    alternative_name: literal,
                    flags: [{ name: literal, type: 'preference' as const, value_to_set: literal }],
                  },
                ],
                failing_total: 1,
                failing_ranges: [
                  {
                    agent: literal,
                    newest: literal,
                    oldest: `${literal} old`,
                    count: 1,
                    verdict: 'prefixed' as const,
                  },
                ],
                evaluated_total: 1,
                evaluated_coverage_percent: 1,
                unchecked_total: 1,
                unchecked_coverage_percent: 1,
                unchecked_targets: [unchecked],
              },
            ],
          };
        },
      },
      { features: ['has'], targets: 'chrome 100' },
    );
    const texts = result.content.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text).toContain(escaped);
      expect(text).not.toContain('<dialog>');
    }
    expect(texts[0]).toContain('`` chrome `100` ``');
    // Every row kind carries the literal: mapping, unchecked, failing, per-result unchecked.
    expect(texts[0]).toContain(`| ${escaped}`);
    expect(texts[0]).toContain(`  - fails on ${escaped}`);
    expect(texts[0]).toContain(`  - not evaluated on ${escaped}`);
    // #27 statement fields and #28 runs render every literal escaped, each exactly once.
    const full = markdownText(literal);
    const lines = texts[0]?.split('\n') ?? [];
    expect(lines).toContain(
      `  - fails on ${full} ${full} → ${full} ${full} (prefixed) · version_added ${full} · prefix ${full} · alternative_name ${full} · flags preference ${full} value_to_set ${full}`,
    );
    expect(lines).toContain(
      `  - failing_ranges (whole query): ${full} ${full} to ${markdownText(`${literal} old`)}: 1 prefixed`,
    );
    expect(texts[0]?.split('<dialog>')).toHaveLength(1);
  });

  it('escapes support notes/flags and keeps literal double-encoded text', () => {
    const text = formatSupportRow({
      browser_id: 'firefox',
      browser_name: literal,
      verdict: 'flagged',
      flags: [{ name: literal, type: 'preference', value_to_set: literal }],
      notes: [literal],
      other_statements: [{ version_added: literal, prefix: literal, notes: [literal] }],
    }).join('\n');
    const full = markdownText(literal);
    expect(text).toContain(
      `  - other_statements (1):\n    - version_added ${full} · prefix ${full} · notes ${full}`,
    );
    expect(text).toContain(escaped);
    expect(text).not.toContain('<dialog>');
    expect(text).toContain('&amp;lt;');
    expect(text).toContain('<https://example.test/a_b?q=1&amp;x=2>');
  });
});
