/**
 * @fileoverview Output shapes and renderers shared by the compatibility tools —
 * the resolution echo, the Baseline block, a per-browser support row, and the
 * limiting browser. Defined once because the design specifies one shape for
 * each, reported identically wherever it appears.
 * @module mcp-server/tools/definitions/compat-shapes
 */

import { z } from '@cyanheads/mcp-ts-core';

/** How a caller's feature string was matched, echoed on every response. */
export const ResolvedAsSchema = z.object({
  input: z.string().describe('The feature string as the caller sent it, trimmed.'),
  bcd_key: z
    .string()
    .nullable()
    .describe(
      'The single browser-compat-data key this resolved to, or null when the web-features id spans more than one key.',
    ),
  baseline_id: z
    .string()
    .nullable()
    .describe(
      'The web-features id this resolved to, or null when no web-features entry covers the key.',
    ),
  resolved_via: z
    .enum(['bcd_key', 'web_features_id', 'web_features_id_normalized', 'redirect', 'search'])
    .describe(
      'Which step of the resolution order matched: bcd_key or web_features_id for an exact match, web_features_id_normalized when it matched only after lowercasing, redirect when the input pointed to a browser-compat-data entry that has moved or split, or search when resolve was true and the search index accepted a single unambiguous top hit — treat a search match as a best guess, not a confirmed key.',
    ),
});

/** Baseline state plus the dates it crossed. */
export const BaselineSchema = z.object({
  state: z
    .enum(['widely', 'newly', 'limited', 'not_mapped'])
    .describe(
      'widely and newly are Baseline availability, limited means not yet in every core browser, not_mapped means the key sits outside the web-features mapping.',
    ),
  since_date: z
    .string()
    .optional()
    .describe(
      'Date the feature became newly available, verbatim from web-features — may carry a ≤ prefix.',
    ),
  high_date: z
    .string()
    .optional()
    .describe(
      'Date the feature became widely available, verbatim from web-features — may carry a ≤ prefix.',
    ),
  date_is_upper_bound: z
    .boolean()
    .optional()
    .describe('True when a date above is ≤-prefixed, so it is an upper bound rather than exact.'),
});

/** Why web-features discourages a feature. */
export const DiscouragedSchema = z.object({
  reason: z.string().describe('Why the feature is discouraged, as web-features states it.'),
  according_to: z.array(z.string()).describe('URLs of the bodies that discourage the feature.'),
});

/** A preference or runtime flag gating support. */
export const SupportFlagSchema = z.object({
  name: z.string().describe('Name of the flag or preference to configure.'),
  type: z
    .enum(['preference', 'runtime_flag'])
    .describe('Whether the gate is a user preference or a runtime flag.'),
  value_to_set: z.string().optional().describe('Value the flag must be set to.'),
});

/** One reported browser's support for a compat key. */
export const SupportRowSchema = z.object({
  browser_id: z.string().describe('browser-compat-data browser id.'),
  browser_name: z.string().describe('Human-readable browser name.'),
  verdict: z
    .enum([
      'supported',
      'partial',
      'prefixed',
      'flagged',
      'removed',
      'unsupported',
      'preview_only',
      'unknown',
    ])
    .describe(
      'supported means full support with no flags, prefix, or partial implementation; partial means the implementation does not meet the mandatory specified behavior; prefixed means it ships under a vendor prefix or an entirely different name; flagged means it only works behind a preference or runtime flag; removed means it shipped and was later removed; unsupported means it was never added; preview_only means it only works in a preview channel; unknown means the browser is absent from the data or support predates a ≤ bound — unknown never means unsupported.',
    ),
  version_added: z.string().optional().describe('Release that added support.'),
  version_added_is_upper_bound: z
    .boolean()
    .optional()
    .describe(
      'True when the data says support arrived at or before version_added, not exactly at it.',
    ),
  version_removed: z.string().optional().describe('Release that removed support.'),
  version_last: z.string().optional().describe('Last release that still supported the feature.'),
  partial: z
    .boolean()
    .optional()
    .describe('True when the implementation does not meet the mandatory specified behavior.'),
  prefix: z.string().optional().describe('Vendor prefix the feature ships under.'),
  alternative_name: z
    .string()
    .optional()
    .describe('Entirely different name the feature is implemented under.'),
  flags: z
    .array(SupportFlagSchema.describe('A flag that must be configured for support.'))
    .optional()
    .describe('Flags gating support in this browser.'),
  notes: z
    .array(z.string())
    .optional()
    .describe('Notes from browser-compat-data about this support, always an array.'),
  impl_url: z
    .array(z.string())
    .optional()
    .describe('Links to bugs or issues tracking the implementation, always an array.'),
});

/** The core-set browser requiring the newest release. */
export const LimitingBrowserSchema = z.object({
  browser_id: z.string().describe('browser-compat-data browser id.'),
  name: z.string().describe('Human-readable browser name.'),
  version: z.string().describe('Release of that browser the feature requires.'),
});

/** The Baseline block as it appears in tool output. */
export type BaselineOutput = z.infer<typeof BaselineSchema>;

/** A support row as it appears in tool output. */
export type SupportRowOutput = z.infer<typeof SupportRowSchema>;

/** Render the Baseline block as one line, including every field present. */
export function formatBaselineLine(baseline: BaselineOutput): string {
  const parts = [`**Baseline: ${baseline.state}**`];
  if (baseline.since_date !== undefined) parts.push(`since_date ${baseline.since_date}`);
  if (baseline.high_date !== undefined) parts.push(`high_date ${baseline.high_date}`);
  if (baseline.date_is_upper_bound !== undefined) {
    parts.push(`date_is_upper_bound ${baseline.date_is_upper_bound}`);
  }
  return parts.join(' · ');
}

/** Render one support row, emitting only the fields the data actually carries. */
export function formatSupportRow(row: SupportRowOutput): string[] {
  const lines = [`- **${row.browser_name}** (${row.browser_id}): ${row.verdict}`];
  if (row.version_added !== undefined) lines.push(`  - version_added: ${row.version_added}`);
  if (row.version_added_is_upper_bound !== undefined) {
    lines.push(`  - version_added_is_upper_bound: ${row.version_added_is_upper_bound}`);
  }
  if (row.version_removed !== undefined) lines.push(`  - version_removed: ${row.version_removed}`);
  if (row.version_last !== undefined) lines.push(`  - version_last: ${row.version_last}`);
  if (row.partial !== undefined) lines.push(`  - partial: ${row.partial}`);
  if (row.prefix !== undefined) lines.push(`  - prefix: ${row.prefix}`);
  if (row.alternative_name !== undefined) {
    lines.push(`  - alternative_name: ${row.alternative_name}`);
  }
  if (row.flags !== undefined) {
    for (const flag of row.flags) {
      const value = flag.value_to_set === undefined ? '' : ` value_to_set ${flag.value_to_set}`;
      lines.push(`  - flags: ${flag.type} ${flag.name}${value}`);
    }
  }
  if (row.notes !== undefined) lines.push(`  - notes: ${row.notes.join(' | ')}`);
  if (row.impl_url !== undefined) lines.push(`  - impl_url: ${row.impl_url.join(' ')}`);
  return lines;
}

/** One-line support summary over a browser set, for search results. */
export function formatSupportSummary(rows: SupportRowOutput[]): string {
  return rows
    .map((row) => {
      if (row.verdict === 'unknown') return `${row.browser_name} ?`;
      if (
        row.verdict === 'unsupported' ||
        row.verdict === 'removed' ||
        row.verdict === 'preview_only'
      ) {
        return `${row.browser_name} —`;
      }
      return `${row.browser_name} ${row.version_added ?? '—'}`;
    })
    .join(', ');
}
