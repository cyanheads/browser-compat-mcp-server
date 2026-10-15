/**
 * @fileoverview Output shapes and renderers shared by the compatibility tools —
 * the resolution echo, the Baseline block, a support statement's fields, a
 * per-browser support row, a feature-level support row, the limiting browser,
 * and the per-call bounds on compat keys and feature batches. Defined once
 * because the design specifies one shape for each, reported identically
 * wherever it appears.
 * @module mcp-server/tools/definitions/compat-shapes
 */

import { z } from '@cyanheads/mcp-ts-core';
import { markdown } from '@cyanheads/mcp-ts-core/utils';
import { markdownText } from '@/utils/markdown-text.js';

/** How a caller's feature string was matched, echoed on every response. */
export const ResolvedAsSchema = z.object({
  input: z.string().describe('The feature string as the caller sent it, trimmed.'),
  bcd_key: z
    .string()
    .nullable()
    .describe(
      'The single browser-compat-data key this resolved to, or null when the web-features id spans more than one key or owns none.',
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
      'Which step of the resolution order matched: bcd_key or web_features_id for an exact match, web_features_id_normalized when it matched only after lowercasing, redirect when the input pointed to a browser-compat-data entry that has moved or split, or search when resolve was true and the best exact matches in the search index all named one feature or key — treat a search match as a best guess, not a confirmed key.',
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

/**
 * The qualifiers of one browser-compat-data support statement, each present
 * only when the statement carries it. One shape for a support row, the
 * statements beside it, and a failing compare_support target.
 */
export const STATEMENT_FIELDS = {
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
};

const NOTE_FIELDS = {
  notes: z
    .array(z.string())
    .optional()
    .describe('Notes from browser-compat-data about this support, always an array.'),
  impl_url: z
    .array(z.string())
    .optional()
    .describe('Links to bugs or issues tracking the implementation, always an array.'),
};

/** A support statement BCD records for a browser beside the one a row reports. */
export const OtherStatementSchema = z.object({
  ...STATEMENT_FIELDS,
  version_added: z
    .string()
    .optional()
    .describe(
      'Release that added support under this statement, or preview when it only works in a preview channel.',
    ),
  ...NOTE_FIELDS,
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
  ...STATEMENT_FIELDS,
  ...NOTE_FIELDS,
  other_statements: z
    .array(OtherStatementSchema.describe('One other support statement for this browser.'))
    .optional()
    .describe(
      'Every other support statement browser-compat-data records for this browser, in its declaration order: prefixed, alternative-name, flagged, partial, preview, and removed ranges. A statement the row fields above came from is never repeated here. Absent when there are none.',
    ),
});

/** The Baseline core browser whose required release is newest, once every core browser supports the feature. */
export const LimitingBrowserSchema = z.object({
  browser_id: z.string().describe('browser-compat-data browser id.'),
  name: z.string().describe('Human-readable browser name.'),
  version: z
    .string()
    .describe(
      'Release of that browser the feature requires, without any ≤ prefix — see version_is_upper_bound.',
    ),
  version_is_upper_bound: z
    .boolean()
    .optional()
    .describe(
      'True when the data says support arrived at or before version, not exactly at it. Absent when version is exact.',
    ),
});

/** One Baseline core browser in web-features' feature-level support for a multi-key id. */
export const FeatureSupportRowSchema = z.object({
  browser_id: z.string().describe('browser-compat-data browser id of a Baseline core browser.'),
  supported: z
    .boolean()
    .describe(
      'True when web-features lists a release for this browser for the feature as a whole; false when it lists none.',
    ),
  version: z
    .string()
    .optional()
    .describe(
      'Release web-features lists for the feature, without any ≤ prefix. Absent when supported is false.',
    ),
  version_is_upper_bound: z
    .boolean()
    .optional()
    .describe(
      'True when web-features lists the release as ≤, so support arrived at or before version, not exactly at it.',
    ),
});

/** The Baseline block as it appears in tool output. */
export type BaselineOutput = z.infer<typeof BaselineSchema>;

/** A support row as it appears in tool output. */
export type SupportRowOutput = z.infer<typeof SupportRowSchema>;

/** A statement beside a support row as it appears in tool output. */
export type OtherStatementOutput = z.infer<typeof OtherStatementSchema>;

/** The limiting browser as it appears in tool output. */
export type LimitingBrowserOutput = z.infer<typeof LimitingBrowserSchema>;

/** A feature-level support row as it appears in tool output. */
export type FeatureSupportRowOutput = z.infer<typeof FeatureSupportRowSchema>;

/**
 * Render the limiting browser as one line. `scope` says what the requirement was
 * read from: one key's full support, or web-features' feature-level listing.
 */
export function formatLimitingBrowser(
  limiting: LimitingBrowserOutput,
  scope: 'key' | 'feature',
): string {
  const bound =
    limiting.version_is_upper_bound === undefined
      ? ''
      : ` · version_is_upper_bound ${limiting.version_is_upper_bound}`;
  const basis =
    scope === 'key'
      ? 'full support in every core browser'
      : 'web-features lists every core browser for the feature as a whole';
  return `**Limiting browser:** ${markdownText(limiting.name)} (${markdownText(limiting.browser_id)}) ${markdownText(limiting.version)}${bound} — ${basis}`;
}

/** Render one feature-level support row, emitting only the fields present. */
export function formatFeatureSupportRow(row: FeatureSupportRowOutput): string {
  const parts = [`- **${markdownText(row.browser_id)}**: supported ${row.supported}`];
  if (row.version !== undefined) parts.push(`version ${markdownText(row.version)}`);
  if (row.version_is_upper_bound !== undefined) {
    parts.push(`version_is_upper_bound ${row.version_is_upper_bound}`);
  }
  return parts.join(' · ');
}

/** Render the Baseline block as one line, including every field present. */
export function formatBaselineLine(baseline: BaselineOutput): string {
  const parts = [`**Baseline: ${baseline.state}**`];
  if (baseline.since_date !== undefined)
    parts.push(`since_date ${markdownText(baseline.since_date)}`);
  if (baseline.high_date !== undefined) parts.push(`high_date ${markdownText(baseline.high_date)}`);
  if (baseline.date_is_upper_bound !== undefined) {
    parts.push(`date_is_upper_bound ${baseline.date_is_upper_bound}`);
  }
  return parts.join(' · ');
}

/** Render one support row, emitting only the fields the data actually carries. */
export function formatSupportRow(row: SupportRowOutput): string[] {
  const lines = [
    `- **${markdownText(row.browser_name)}** (${markdownText(row.browser_id)}): ${row.verdict}`,
  ];
  if (row.version_added !== undefined)
    lines.push(`  - version_added: ${markdownText(row.version_added)}`);
  if (row.version_added_is_upper_bound !== undefined) {
    lines.push(`  - version_added_is_upper_bound: ${row.version_added_is_upper_bound}`);
  }
  if (row.version_removed !== undefined)
    lines.push(`  - version_removed: ${markdownText(row.version_removed)}`);
  if (row.version_last !== undefined)
    lines.push(`  - version_last: ${markdownText(row.version_last)}`);
  if (row.partial !== undefined) lines.push(`  - partial: ${row.partial}`);
  if (row.prefix !== undefined) lines.push(`  - prefix: ${markdownText(row.prefix)}`);
  if (row.alternative_name !== undefined) {
    lines.push(`  - alternative_name: ${markdownText(row.alternative_name)}`);
  }
  if (row.flags !== undefined) {
    for (const flag of row.flags) {
      const value =
        flag.value_to_set === undefined ? '' : ` value_to_set ${markdownText(flag.value_to_set)}`;
      lines.push(`  - flags: ${flag.type} ${markdownText(flag.name)}${value}`);
    }
  }
  if (row.notes !== undefined) lines.push(`  - notes: ${row.notes.map(markdownText).join(' | ')}`);
  if (row.impl_url !== undefined)
    lines.push(`  - impl_url: ${row.impl_url.map(markdownText).join(' ')}`);
  if (row.other_statements !== undefined) {
    lines.push(`  - other_statements (${row.other_statements.length}):`);
    for (const statement of row.other_statements) {
      lines.push(`    - ${formatStatementParts(statement).join(' · ') || 'no qualifiers'}`);
    }
  }
  return lines;
}

/** A statement's fields as `name value` parts, in schema order, only those present. */
export function formatStatementParts(statement: OtherStatementOutput): string[] {
  const parts: string[] = [];
  if (statement.version_added !== undefined) {
    parts.push(`version_added ${markdownText(statement.version_added)}`);
  }
  if (statement.version_added_is_upper_bound !== undefined) {
    parts.push(`version_added_is_upper_bound ${statement.version_added_is_upper_bound}`);
  }
  if (statement.version_removed !== undefined) {
    parts.push(`version_removed ${markdownText(statement.version_removed)}`);
  }
  if (statement.version_last !== undefined) {
    parts.push(`version_last ${markdownText(statement.version_last)}`);
  }
  if (statement.partial !== undefined) parts.push(`partial ${statement.partial}`);
  if (statement.prefix !== undefined) parts.push(`prefix ${markdownText(statement.prefix)}`);
  if (statement.alternative_name !== undefined) {
    parts.push(`alternative_name ${markdownText(statement.alternative_name)}`);
  }
  for (const flag of statement.flags ?? []) {
    const value =
      flag.value_to_set === undefined ? '' : ` value_to_set ${markdownText(flag.value_to_set)}`;
    parts.push(`flags ${flag.type} ${markdownText(flag.name)}${value}`);
  }
  if (statement.notes !== undefined) {
    parts.push(`notes ${statement.notes.map(markdownText).join(' | ')}`);
  }
  if (statement.impl_url !== undefined) {
    parts.push(`impl_url ${statement.impl_url.map(markdownText).join(' ')}`);
  }
  return parts;
}

/** Most compat keys one `browsercompat_get_feature` page carries. */
export const COMPAT_KEYS_PAGE_SIZE = 100;

/** Compat keys each result of a batch tool carries; the rest are one get_feature call away. */
export const COMPAT_KEYS_PER_RESULT = 10;

/** Entries of `features` a batch tool evaluates per call. */
export const FEATURES_PER_CALL = 20;

/** Hard ceiling on `features` entries; entries past FEATURES_PER_CALL come back unevaluated. */
export const FEATURES_MAX = 100;

/** One window over the compat keys a web-features id owns. */
interface CompatKeysSlice {
  compat_keys: string[];
  compat_keys_total: number;
  /** Offset of the next window; absent at or past the end. */
  nextOffset?: number;
}

/** Slice an id's compat keys, in declaration order, the way `subkeys` pages (D47). */
export function sliceCompatKeys(
  keys: readonly string[],
  offset: number,
  size: number,
): CompatKeysSlice {
  const page = keys.slice(offset, offset + size);
  const next = offset + page.length;
  return {
    compat_keys: page,
    compat_keys_total: keys.length,
    ...(next < keys.length ? { nextOffset: next } : {}),
  };
}

/** The compat-key fields one batch-tool result carries: the first keys and the total. */
export function batchCompatKeys(keys: readonly string[]): Omit<CompatKeysSlice, 'nextOffset'> {
  const { compat_keys, compat_keys_total } = sliceCompatKeys(keys, 0, COMPAT_KEYS_PER_RESULT);
  return { compat_keys, compat_keys_total };
}

/** Render a compat-key window as "N of T: keys", or why it is empty. */
export function formatCompatKeys(keys: readonly string[], total: number): string {
  if (total === 0) return 'none — this entry owns no browser-compat-data keys';
  if (keys.length === 0) return `0 of ${total} on this page`;
  return `${keys.length} of ${total}: ${keys.map(markdownText).join(', ')}`;
}

/** A batch result's compat keys, pointing to get_feature when the list was cut. */
export function formatBatchCompatKeys(keys: readonly string[], total: number, id: string): string {
  const rest =
    keys.length < total
      ? ` — call browsercompat_get_feature with ${markdownText(id)} for all ${total}${total > COMPAT_KEYS_PAGE_SIZE ? `, ${COMPAT_KEYS_PAGE_SIZE} per page through compat_keys_offset` : ''}`
      : '';
  return `${formatCompatKeys(keys, total)}${rest}`;
}

/** Render the entries past the per-call cap as copyable input for the next call. */
export function formatOmittedFeatures(omitted: readonly string[]): string {
  const count =
    omitted.length === 1
      ? `1 entry past the first ${FEATURES_PER_CALL} was`
      : `${omitted.length} entries past the first ${FEATURES_PER_CALL} were`;
  return `**omitted_features:** ${count} not evaluated — call again with features set to ${markdown().inlineCode(JSON.stringify(omitted)).build()}`;
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
