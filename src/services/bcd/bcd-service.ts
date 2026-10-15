/**
 * @fileoverview browser-compat-data service — flat leaf index over the 12 BCD
 * namespaces, per-browser release orderings keyed by `releases[v].index`, the
 * reported browser set derived from `browsers[id].type`, version-token
 * resolution, per-browser support evaluation, the limiting-browser rule, and
 * judging a target against web-features' feature-level `status.support`.
 * @module services/bcd/bcd-service
 */

import type {
  BrowserStatement,
  CompatStatement,
  SimpleSupportStatement,
} from '@mdn/browser-compat-data/types';
import { normalizeBcdText } from './bcd-text.js';
import type {
  FeatureSupportVerdict,
  LimitingBrowser,
  ReleaseEntry,
  SupportDetail,
  SupportFlag,
  SupportRow,
  SupportVerdict,
  VersionResolution,
} from './types.js';

/** Release statuses that have actually shipped, as opposed to beta/nightly/planned. */
const SHIPPED_STATUSES = new Set(['current', 'esr', 'retired']);

/** Prefix BCD uses on `__compat.tags` entries that name a web-features id. */
const WEB_FEATURES_TAG_PREFIX = 'web-features:';

/** Qualifier ranking used to pick the cleanest covering support statement. */
const RANK_CLEAN = 0;
const RANK_PARTIAL = 1;
const RANK_PREFIXED = 2;
const RANK_FLAGGED = 3;

/** Evaluation of one browser's support at a target release index. */
export interface SupportEvaluation {
  detail: SupportDetail;
  verdict: SupportVerdict;
}

/** An evaluation plus the browser's statements, split into the ones behind it and the rest. */
interface StatementEvaluation extends SupportEvaluation {
  /**
   * The statements the verdict and `detail` came from: the cleanest covering
   * statement (the first BCD lists on a tie), the latest removed range, or the
   * `false` or `preview` statements an unsupported or preview-only verdict
   * merges notes from. Empty for `unknown`.
   */
  sources: readonly SimpleSupportStatement[];
  /** Every statement BCD records for the browser, in declaration order. */
  statements: readonly SimpleSupportStatement[];
}

/** Parse a dotted numeric version into a comparable segment tuple. */
function versionTuple(version: string): number[] {
  return version.split('.').map((segment) => Number(segment));
}

/** Compare two version tuples, reading missing trailing segments as zero. */
function compareTuples(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/** Normalize a BCD value that is either a single string or an array of strings. */
function toStringArray(value: string | readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? [value] : [...value];
}

/** Normalize each statement's notes once, preserving BCD's string-or-tuple shape. */
function normalizeStatement(statement: SimpleSupportStatement): SimpleSupportStatement {
  if (statement.notes === undefined) return statement;
  const notes = statement.notes;
  return {
    ...statement,
    notes:
      typeof notes === 'string'
        ? normalizeBcdText(notes)
        : [
            normalizeBcdText(notes[0]),
            normalizeBcdText(notes[1]),
            ...notes.slice(2).map(normalizeBcdText),
          ],
  };
}

/** Rank a statement by its qualifiers — lower is cleaner. */
function statementRank(statement: SimpleSupportStatement): number {
  if (statement.flags && statement.flags.length > 0) return RANK_FLAGGED;
  if (statement.prefix || statement.alternative_name) return RANK_PREFIXED;
  if (statement.partial_implementation) return RANK_PARTIAL;
  return RANK_CLEAN;
}

/** Map a qualifier rank onto the reported verdict for a covering statement. */
function verdictForRank(rank: number): SupportVerdict {
  if (rank === RANK_FLAGGED) return 'flagged';
  if (rank === RANK_PREFIXED) return 'prefixed';
  if (rank === RANK_PARTIAL) return 'partial';
  return 'supported';
}

/** A release value — exact or `≤`-prefixed — resolved onto a browser's ordering. */
interface AddedRelease {
  index: number;
  isUpperBound: boolean;
  version: string;
}

/** One core browser's release requirement, as the limiting-browser rule compares them. */
interface Requirement {
  browserId: string;
  isUpperBound: boolean;
  version: string;
}

/** A covering or near-covering statement plus the indexes it resolved to. */
interface EvaluatedStatement {
  addedIndex: number;
  rank: number;
  removedIndex?: number;
  statement: SimpleSupportStatement;
}

/**
 * Project one statement into the normalized, absence-preserving detail shape.
 * A `≤` on `version_added` moves into `version_added_is_upper_bound`; a
 * `preview` value is kept as written, and `false` leaves the field absent.
 */
function statementDetail(statement: SimpleSupportStatement): SupportDetail {
  const added = statement.version_added;
  const isUpperBound = typeof added === 'string' && added.startsWith('≤');
  const notes = toStringArray(statement.notes);
  const implUrl = toStringArray(statement.impl_url);
  const flags: SupportFlag[] | undefined = statement.flags?.map((flag) => ({
    name: flag.name,
    type: flag.type,
    ...(flag.value_to_set === undefined ? {} : { value_to_set: flag.value_to_set }),
  }));
  return {
    ...(typeof added === 'string' ? { version_added: isUpperBound ? added.slice(1) : added } : {}),
    ...(isUpperBound ? { version_added_is_upper_bound: true } : {}),
    ...(statement.version_removed === undefined
      ? {}
      : { version_removed: statement.version_removed }),
    ...(statement.version_last === undefined ? {} : { version_last: statement.version_last }),
    ...(statement.partial_implementation ? { partial: true } : {}),
    ...(statement.prefix === undefined ? {} : { prefix: statement.prefix }),
    ...(statement.alternative_name === undefined
      ? {}
      : { alternative_name: statement.alternative_name }),
    ...(flags === undefined ? {} : { flags }),
    ...(notes === undefined ? {} : { notes }),
    ...(implUrl === undefined ? {} : { impl_url: implUrl }),
  };
}

/**
 * In-memory index over the bundled browser-compat-data snapshot. Immutable and
 * process-global: nothing here is tenant-scoped or mutated after construction.
 */
export class BcdService {
  readonly meta: { version: string; timestamp: string };
  readonly browsers: Record<string, BrowserStatement>;
  readonly namespaces: readonly string[];
  readonly reportedBrowserIds: readonly string[];
  readonly runtimeBrowserIds: readonly string[];

  private readonly leaves: Map<string, CompatStatement>;
  private readonly children = new Map<string, string[]>();
  private readonly namespaceCounts: Map<string, number>;
  private readonly namespaceExamples: Map<string, string>;
  private readonly releasesByBrowser: Map<string, ReleaseEntry[]>;
  private readonly indexByVersion: Map<string, Map<string, number>>;

  constructor(data: Record<string, unknown>) {
    const meta = data.__meta as { version: string; timestamp: string };
    this.meta = { version: meta.version, timestamp: meta.timestamp };
    this.browsers = data.browsers as Record<string, BrowserStatement>;

    this.namespaces = Object.keys(data)
      .filter((key) => key !== '__meta' && key !== 'browsers')
      .sort();

    this.leaves = new Map();
    this.namespaceCounts = new Map();
    this.namespaceExamples = new Map();
    for (const namespace of this.namespaces) {
      this.collectLeaves(data[namespace] as Record<string, unknown>, namespace);
    }

    this.releasesByBrowser = new Map();
    this.indexByVersion = new Map();
    for (const [id, browser] of Object.entries(this.browsers)) {
      const entries: ReleaseEntry[] = [];
      const versionIndex = new Map<string, number>();
      for (const [version, release] of Object.entries(browser.releases)) {
        entries.push({
          version,
          index: release.index,
          status: release.status,
          ...(release.release_date === undefined ? {} : { release_date: release.release_date }),
          tuple: versionTuple(version),
        });
        versionIndex.set(version, release.index);
      }
      entries.sort((a, b) => a.index - b.index);
      this.releasesByBrowser.set(id, entries);
      this.indexByVersion.set(id, versionIndex);
    }

    const byType = (types: string[]): string[] =>
      Object.entries(this.browsers)
        .filter(([, browser]) => types.includes(browser.type))
        .map(([id]) => id)
        .sort();

    this.reportedBrowserIds = byType(['desktop', 'mobile']);
    this.runtimeBrowserIds = byType(['server', 'xr']);
  }

  /** Walk one namespace subtree, recording every `__compat` leaf by dotted path. */
  private collectLeaves(node: Record<string, unknown>, path: string): void {
    for (const [key, value] of Object.entries(node)) {
      if (key === '__compat') {
        const leaf = value as CompatStatement;
        this.leaves.set(path, {
          ...leaf,
          ...(leaf.description === undefined
            ? {}
            : { description: normalizeBcdText(leaf.description) }),
          support: Object.fromEntries(
            Object.entries(leaf.support).map(([browser, entry]) => [
              browser,
              Array.isArray(entry) ? entry.map(normalizeStatement) : normalizeStatement(entry),
            ]),
          ),
        });
        const parent = path.slice(0, path.lastIndexOf('.'));
        const children = this.children.get(parent);
        if (children) children.push(path);
        else this.children.set(parent, [path]);
        const namespace = path.slice(0, path.indexOf('.')) || path;
        this.namespaceCounts.set(namespace, (this.namespaceCounts.get(namespace) ?? 0) + 1);
        if (!this.namespaceExamples.has(namespace)) this.namespaceExamples.set(namespace, path);
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.collectLeaves(value as Record<string, unknown>, `${path}.${key}`);
      }
    }
  }

  /** The compat leaf at a dotted BCD key, or `undefined` when the key is not a leaf. */
  leaf(key: string): CompatStatement | undefined {
    return this.leaves.get(key);
  }

  /** Direct callable children in BCD traversal order; structural nodes and grandchildren are excluded. */
  directChildren(key: string): readonly string[] {
    return this.children.get(key) ?? [];
  }

  /** Every leaf keyed by its dotted BCD path, in namespace-walk order. */
  entries(): IterableIterator<[string, CompatStatement]> {
    return this.leaves.entries();
  }

  /** Total number of `__compat` leaves across all namespaces. */
  get leafCount(): number {
    return this.leaves.size;
  }

  /** Leaf count for one top-level namespace. */
  namespaceLeafCount(namespace: string): number {
    return this.namespaceCounts.get(namespace) ?? 0;
  }

  /** A representative leaf key inside one namespace, for orientation. */
  namespaceExample(namespace: string): string | undefined {
    return this.namespaceExamples.get(namespace);
  }

  /** Human-readable browser name, falling back to the id for unknown browsers. */
  browserName(id: string): string {
    return this.browsers[id]?.name ?? id;
  }

  /** Number of releases BCD records for a browser. */
  releaseCount(id: string): number {
    return this.releasesByBrowser.get(id)?.length ?? 0;
  }

  /** The newest release that has actually shipped (not beta, nightly, or planned). */
  latestShippedRelease(id: string): ReleaseEntry | undefined {
    const releases = this.releasesByBrowser.get(id);
    if (!releases) return undefined;
    let best: ReleaseEntry | undefined;
    for (const release of releases) {
      if (!SHIPPED_STATUSES.has(release.status)) continue;
      if (!best || release.index > best.index) best = release;
    }
    return best;
  }

  /** Release date of the release a version resolves to, when BCD records one. */
  releaseDate(id: string, version: string): string | undefined {
    const resolved = this.resolveTargetVersion(id, version);
    if (!resolved.resolved || resolved.index < 0) return undefined;
    return this.releasesByBrowser.get(id)?.find((r) => r.index === resolved.index)?.release_date;
  }

  /** web-features ids named by a leaf's `tags`, in declaration order. */
  webFeatureTags(leaf: CompatStatement): string[] {
    const tags = leaf.tags;
    if (!tags) return [];
    return tags
      .filter((tag) => tag.startsWith(WEB_FEATURES_TAG_PREFIX))
      .map((tag) => tag.slice(WEB_FEATURES_TAG_PREFIX.length));
  }

  /**
   * Map a version token onto a browser's release ordering. Handles the literal
   * `all`, `a-b` ranges (lower bound wins), trailing-zero drift between caniuse
   * and BCD in both directions, and nearest-at-or-below for tokens BCD never
   * published. Returns index `-1` when the token predates every release.
   */
  resolveTargetVersion(browserId: string, token: string): VersionResolution {
    const releases = this.releasesByBrowser.get(browserId);
    const versionIndex = this.indexByVersion.get(browserId);
    if (!releases || !versionIndex || releases.length === 0) {
      return { resolved: false, reason: 'unknown_version' };
    }

    let candidate = token.trim();
    if (candidate === 'all') {
      const oldest = releases[0];
      if (!oldest) return { resolved: false, reason: 'unknown_version' };
      return { resolved: true, index: oldest.index, version: oldest.version };
    }
    const dash = candidate.indexOf('-');
    if (dash > 0) candidate = candidate.slice(0, dash);
    if (!/^\d+(\.\d+)*$/.test(candidate)) return { resolved: false, reason: 'unknown_version' };

    const exact = versionIndex.get(candidate);
    if (exact !== undefined) return { resolved: true, index: exact, version: candidate };

    const alternate = candidate.endsWith('.0') ? candidate.slice(0, -2) : `${candidate}.0`;
    const alternateIndex = versionIndex.get(alternate);
    if (alternateIndex !== undefined) {
      return { resolved: true, index: alternateIndex, version: alternate };
    }

    const target = versionTuple(candidate);
    let best: ReleaseEntry | undefined;
    for (const release of releases) {
      if (compareTuples(release.tuple, target) > 0) continue;
      if (!best) {
        best = release;
        continue;
      }
      const comparison = compareTuples(release.tuple, best.tuple);
      if (comparison > 0 || (comparison === 0 && release.index > best.index)) best = release;
    }
    if (!best) return { resolved: true, index: -1, version: null };
    return { resolved: true, index: best.index, version: best.version };
  }

  /**
   * Resolve a release value as BCD and web-features write it — exact, or
   * `≤`-prefixed for "at or before" — through the same token resolution as a
   * target. `undefined` when the release does not resolve.
   */
  private resolveAdded(browserId: string, value: string): AddedRelease | undefined {
    const isUpperBound = value.startsWith('≤');
    const version = isUpperBound ? value.slice(1) : value;
    const resolved = this.resolveTargetVersion(browserId, version);
    return resolved.resolved ? { index: resolved.index, isUpperBound, version } : undefined;
  }

  /**
   * Evaluate a leaf's support for one browser at a target release index. A
   * browser absent from `support` is `unknown`, never unsupported; so is a `≤X`
   * statement evaluated before X, because BCD is saying it does not know.
   */
  supportAt(leaf: CompatStatement, browserId: string, targetIndex: number): SupportEvaluation {
    const { verdict, detail } = this.evaluate(leaf, browserId, targetIndex);
    return { verdict, detail };
  }

  /** `supportAt`, keeping which of the browser's statements produced the answer. */
  private evaluate(
    leaf: CompatStatement,
    browserId: string,
    targetIndex: number,
  ): StatementEvaluation {
    const entry = leaf.support[browserId as keyof typeof leaf.support];
    if (entry === undefined) return { verdict: 'unknown', detail: {}, sources: [], statements: [] };

    const statements: readonly SimpleSupportStatement[] = Array.isArray(entry) ? entry : [entry];

    const covering: EvaluatedStatement[] = [];
    const removedBefore: EvaluatedStatement[] = [];
    let appliedCount = 0;
    let sawPreview = false;
    let sawUnknown = false;

    for (const statement of statements) {
      const added = statement.version_added;
      if (added === false) continue;
      if (added === 'preview') {
        sawPreview = true;
        continue;
      }

      const release = this.resolveAdded(browserId, added);
      if (!release || (release.isUpperBound && targetIndex < release.index)) {
        sawUnknown = true;
        continue;
      }
      const addedIndex = release.isUpperBound ? -1 : release.index;

      let removedIndex: number | undefined;
      const removed = statement.version_removed;
      if (typeof removed === 'string') {
        const bare = removed.startsWith('≤') ? removed.slice(1) : removed;
        const resolvedRemove = this.resolveTargetVersion(browserId, bare);
        if (resolvedRemove.resolved) removedIndex = resolvedRemove.index;
      }

      appliedCount += 1;
      const evaluated: EvaluatedStatement = {
        statement,
        addedIndex,
        ...(removedIndex === undefined ? {} : { removedIndex }),
        rank: statementRank(statement),
      };

      if (targetIndex >= addedIndex && (removedIndex === undefined || targetIndex < removedIndex)) {
        covering.push(evaluated);
      } else if (removedIndex !== undefined && targetIndex >= removedIndex) {
        removedBefore.push(evaluated);
      }
    }

    if (covering.length > 0) {
      /** Strictly cleaner wins, so a tie keeps the statement BCD lists first. */
      let best = covering[0] as EvaluatedStatement;
      for (const candidate of covering) {
        if (candidate.rank < best.rank) best = candidate;
      }
      return {
        verdict: verdictForRank(best.rank),
        detail: statementDetail(best.statement),
        sources: [best.statement],
        statements,
      };
    }

    if (appliedCount > 0 && removedBefore.length === appliedCount) {
      let latest = removedBefore[0] as EvaluatedStatement;
      for (const candidate of removedBefore) {
        if ((candidate.removedIndex ?? -1) > (latest.removedIndex ?? -1)) latest = candidate;
      }
      return {
        verdict: 'removed',
        detail: statementDetail(latest.statement),
        sources: [latest.statement],
        statements,
      };
    }

    if (sawUnknown) return { verdict: 'unknown', detail: {}, sources: [], statements };
    const preview = sawPreview && appliedCount === 0;
    const matching = statements.filter(
      (statement) => statement.version_added === (preview ? 'preview' : false),
    );
    const notes = [
      ...new Set(matching.flatMap((statement) => toStringArray(statement.notes) ?? [])),
    ];
    const urls = [
      ...new Set(matching.flatMap((statement) => toStringArray(statement.impl_url) ?? [])),
    ];
    return {
      verdict: preview ? 'preview_only' : 'unsupported',
      detail: {
        ...(notes.length === 0 ? {} : { notes }),
        ...(urls.length === 0 ? {} : { impl_url: urls }),
      },
      sources: matching,
      statements,
    };
  }

  /**
   * Evaluate a leaf against each browser's newest shipped release — the "current
   * support" view `browsercompat_get_feature` and the search summary report.
   * Every statement the row was not built from rides along in `other_statements`.
   */
  supportRows(leaf: CompatStatement, browserIds: readonly string[]): SupportRow[] {
    return browserIds.map((id) => {
      const latest = this.latestShippedRelease(id);
      const { verdict, detail, sources, statements } = this.evaluate(leaf, id, latest?.index ?? -1);
      const others = statements.filter((statement) => !sources.includes(statement));
      return {
        browser_id: id,
        browser_name: this.browserName(id),
        verdict,
        ...detail,
        ...(others.length === 0 ? {} : { other_statements: others.map(statementDetail) }),
      };
    });
  }

  /**
   * The Baseline core browser requiring the newest release for one leaf.
   * Undefined until every core browser has full support at a resolvable version, since
   * "the newest version required" has no answer while one browser has none.
   */
  limitingBrowser(
    leaf: CompatStatement,
    coreBrowserIds: readonly string[],
  ): LimitingBrowser | undefined {
    const requirements: Requirement[] = [];
    for (const id of coreBrowserIds) {
      const latest = this.latestShippedRelease(id);
      if (!latest) return undefined;
      const evaluation = this.supportAt(leaf, id, latest.index);
      if (evaluation.verdict !== 'supported') return undefined;
      const version = evaluation.detail.version_added;
      if (version === undefined) return undefined;
      requirements.push({
        browserId: id,
        version,
        isUpperBound: evaluation.detail.version_added_is_upper_bound === true,
      });
    }
    return this.newestRequirement(requirements);
  }

  /**
   * The core browser requiring the newest release in web-features'
   * feature-level `status.support`, by the same rule as `limitingBrowser`.
   * Undefined until every core browser is listed at a resolvable release.
   */
  featureLimitingBrowser(
    support: Readonly<Record<string, string>>,
    coreBrowserIds: readonly string[],
  ): LimitingBrowser | undefined {
    const requirements: Requirement[] = [];
    for (const id of coreBrowserIds) {
      const listed = support[id];
      if (listed === undefined) return undefined;
      const release = this.resolveAdded(id, listed);
      if (!release) return undefined;
      requirements.push({
        browserId: id,
        version: release.version,
        isUpperBound: release.isUpperBound,
      });
    }
    return this.newestRequirement(requirements);
  }

  /**
   * Judge one target on web-features' feature-level `status.support`. Only the
   * core browsers are published there, so any other browser is `unknown`, as is
   * a target before a `≤` bound; a core browser with no listed release fails.
   */
  featureSupportAt(
    support: Readonly<Record<string, string>>,
    coreBrowserIds: readonly string[],
    browserId: string,
    targetIndex: number,
  ): FeatureSupportVerdict {
    if (!coreBrowserIds.includes(browserId)) return 'unknown';
    const listed = support[browserId];
    if (listed === undefined) return 'no_feature_support';
    const release = this.resolveAdded(browserId, listed);
    if (!release) return 'unknown';
    if (targetIndex >= release.index) return 'supported';
    return release.isUpperBound ? 'unknown' : 'before_feature_support';
  }

  /** The requirement whose release has the newest date; a tie keeps the earlier browser. */
  private newestRequirement(requirements: readonly Requirement[]): LimitingBrowser | undefined {
    let best: LimitingBrowser | undefined;
    let bestDate = '';
    for (const requirement of requirements) {
      const date = this.releaseDate(requirement.browserId, requirement.version) ?? '';
      if (!best || date > bestDate) {
        best = {
          browser_id: requirement.browserId,
          name: this.browserName(requirement.browserId),
          version: requirement.version,
          ...(requirement.isUpperBound ? { version_is_upper_bound: true } : {}),
        };
        bestDate = date;
      }
    }
    return best;
  }
}

let servicePromise: Promise<BcdService> | undefined;

/** Load and index the bundled browser-compat-data snapshot exactly once per process. */
async function loadBcdService(): Promise<BcdService> {
  const imported = await import('@mdn/browser-compat-data', { with: { type: 'json' } });
  return new BcdService(imported.default as unknown as Record<string, unknown>);
}

/** Promise-memoized accessor — the first caller pays the load, everyone else awaits it. */
export function getBcdService(): Promise<BcdService> {
  servicePromise ??= loadBcdService();
  return servicePromise;
}
