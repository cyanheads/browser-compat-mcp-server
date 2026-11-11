/**
 * @fileoverview Targets service — resolves browserslist queries to tokens, maps
 * caniuse agents onto BCD browsers, and supplies the caniuse-derived usage
 * figures: per-agent totals, query coverage, and the global traffic share a
 * feature would exclude.
 * @module services/targets/targets-service
 */

import { validationError } from '@cyanheads/mcp-ts-core/errors';
import type { CaniuseAgent, CaniuseFeature } from 'caniuse-lite';
import { agents as bundledAgents } from 'caniuse-lite';
import { bcdBrowserForAgent } from '@/data/browserslist-bcd-map.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';
import type { ResolvedTarget, TargetResolution, UncheckedTarget } from './types.js';

/**
 * Share of global traffic caniuse tracks: `usage_global` summed across every
 * agent of the bundled caniuse-lite, to one decimal, derived on dataset load.
 */
export const CANIUSE_TRACKED_PERCENT = Number(
  Object.values(bundledAgents)
    .reduce(
      (sum, agent) =>
        sum + Object.values(agent?.usage_global ?? {}).reduce((total, usage) => total + usage, 0),
      0,
    )
    .toFixed(1),
);

/**
 * CC BY 4.0 attribution carried on every response that quotes a usage figure,
 * used verbatim. Raw usage_global values are percentage points of global traffic.
 */
export const CANIUSE_ATTRIBUTION = `Usage data from caniuse.com, © Can I Use contributors, CC BY 4.0. Figures are percentage points of global traffic. The bundled data tracks ~${CANIUSE_TRACKED_PERCENT}% of global traffic; the remainder is untracked and unknown.`;

/** Round a percentage to a stable precision so repeated calls agree byte for byte. */
function percent(value: number): number {
  return Number(value.toFixed(4));
}

/** True when the thrown value is a browserslist query rejection. */
function isBrowserslistError(error: unknown): error is Error & { browserslist: true } {
  return (
    error instanceof Error && (error as Error & { browserslist?: unknown }).browserslist === true
  );
}

type BrowserslistFn = typeof import('browserslist');

/** Global traffic a feature excludes, and the part of it a vendor prefix recovers. */
export interface ExcludedUsage {
  /** Percentage points of global traffic without default, unprefixed, enabled support. */
  excludedPercent: number;
  /** Of `excludedPercent`, the points where the feature works only with a vendor prefix. */
  prefixedPercent: number;
}

/** Whether a caniuse cell works by default, only with a vendor prefix, or not at all. */
type StatSupport = 'default' | 'prefixed' | 'none';

/**
 * How one caniuse stat answers "does it work by default?". Stats lead with the
 * support letter, then flags (`x` prefix required, `d` disabled by default),
 * then `#n` note markers, which do not affect support.
 */
function statSupport(stat: string | undefined): StatSupport {
  if (stat === undefined) return 'none';
  const [letter, ...flags] = stat.split(' ');
  if (letter !== 'y' || flags.includes('d')) return 'none';
  return flags.includes('x') ? 'prefixed' : 'default';
}

/** Query resolution and usage weighting over browserslist plus caniuse-lite. */
export class TargetsService {
  readonly agents: Record<string, CaniuseAgent | undefined>;

  private readonly browserslist: BrowserslistFn;
  private readonly packedFeatures: Record<string, unknown>;
  private readonly unpack: (packed: unknown) => CaniuseFeature;
  private readonly unpacked = new Map<string, CaniuseFeature | undefined>();
  private readonly usageTotals = new Map<string, number>();

  constructor(
    browserslistFn: BrowserslistFn,
    agents: Record<string, CaniuseAgent | undefined>,
    packedFeatures: Record<string, unknown>,
    unpack: (packed: unknown) => CaniuseFeature,
  ) {
    this.browserslist = browserslistFn;
    this.agents = agents;
    this.packedFeatures = packedFeatures;
    this.unpack = unpack;
  }

  /** Every caniuse agent id the installed data declares. */
  agentIds(): string[] {
    return Object.keys(this.agents);
  }

  /** Percentage points of global traffic attributed to one agent across all its versions. */
  agentUsageTotal(agentId: string): number {
    const cached = this.usageTotals.get(agentId);
    if (cached !== undefined) return cached;
    const agent = this.agents[agentId];
    const total = agent
      ? Object.values(agent.usage_global).reduce((sum, value) => sum + value, 0)
      : 0;
    const rounded = percent(total);
    this.usageTotals.set(agentId, rounded);
    return rounded;
  }

  /** The unpacked caniuse feature for an id, or `undefined` when the id is unknown. */
  caniuseFeature(caniuseId: string): CaniuseFeature | undefined {
    if (this.unpacked.has(caniuseId)) return this.unpacked.get(caniuseId);
    const packed = this.packedFeatures[caniuseId];
    const feature = packed === undefined ? undefined : this.unpack(packed);
    this.unpacked.set(caniuseId, feature);
    return feature;
  }

  /** The caniuse display title for an id, used by the search index. */
  caniuseTitle(caniuseId: string): string | undefined {
    return this.caniuseFeature(caniuseId)?.title;
  }

  /**
   * Run a browserslist query with config discovery disabled, so the result
   * depends on the query alone and never on the process working directory.
   */
  queryTokens(query: string): string[] {
    try {
      for (const node of this.browserslist.parse(query, { path: false })) {
        if (
          node.type === 'extends' ||
          node.type === 'popularity_in_config_stats' ||
          node.type === 'cover_config' ||
          node.type === 'browserslist_config'
        ) {
          throw validationError(
            'Config packages and custom configuration are unsupported. Use a self-contained browserslist query.',
            { reason: 'invalid_target_query' },
          );
        }
      }
      return this.browserslist(query, { path: false });
    } catch (error) {
      if (!isBrowserslistError(error)) throw error;
      throw validationError(error.message, { reason: 'invalid_target_query' }, { cause: error });
    }
  }

  /** Real caniuse-derived market coverage of a token list. */
  coverage(tokens: string[]): number {
    if (tokens.length === 0) return 0;
    return percent(this.browserslist.coverage(tokens));
  }

  /**
   * Split browserslist tokens into targets that map onto a concrete BCD release
   * and targets the server declines to evaluate, with the reason for each. A
   * grouped token such as `ios_saf 15.0-15.1` maps each endpoint as a single
   * token would, and spans every BCD release from the lower one's through the
   * upper one's.
   */
  async resolveTargets(tokens: string[]): Promise<TargetResolution> {
    const bcd = await getBcdService();
    const resolved: ResolvedTarget[] = [];
    const unchecked: UncheckedTarget[] = [];

    for (const token of tokens) {
      const separator = token.indexOf(' ');
      const agent = separator === -1 ? token : token.slice(0, separator);
      const versionToken = separator === -1 ? '' : token.slice(separator + 1);
      const bcdBrowser = bcdBrowserForAgent(agent);
      if (bcdBrowser === null) {
        unchecked.push({
          agent,
          version_token: versionToken,
          reason: 'no_bcd_browser',
          usage_percent: this.coverage([token]),
        });
        continue;
      }
      const version = bcd.resolveTargetVersion(bcdBrowser, versionToken);
      const dash = versionToken.indexOf('-');
      const upper =
        dash > 0 ? bcd.resolveTargetVersion(bcdBrowser, versionToken.slice(dash + 1)) : version;
      if (!version.resolved || !upper.resolved) {
        unchecked.push({
          agent,
          version_token: versionToken,
          reason: 'unknown_version',
          usage_percent: this.coverage([token]),
        });
        continue;
      }
      const later = bcd
        .releasesBetween(bcdBrowser, version.index, upper.index)
        .map((release) => ({ index: release.index, version: release.version }));
      resolved.push({
        agent,
        version_token: versionToken,
        bcd_browser: bcdBrowser,
        bcd_version: version.version,
        bcd_release_index: version.index,
        span: [{ index: version.index, version: version.version }, ...later],
      });
    }

    return { resolved, unchecked };
  }

  /**
   * Percentage points of global traffic that requiring a feature would exclude:
   * every agent/version pair where some mapped caniuse stat is not `y`, or
   * carries `x` (prefix required) or `d` (disabled by default). Partial,
   * polyfilled, unknown, and missing stats all exclude. `prefixedPercent` is
   * the excluded share where every stat is `y` without `d` and at least one
   * needs the prefix. `spelledWithPrefix` marks a feature whose own name carries
   * the prefix, so `x` describes it as written and counts as supported. Returns
   * `undefined` when the feature reaches no caniuse id — never zero.
   */
  excludedUsage(
    caniuseIds: string[],
    { spelledWithPrefix = false }: { spelledWithPrefix?: boolean } = {},
  ): ExcludedUsage | undefined {
    const features = caniuseIds
      .map((id) => this.caniuseFeature(id))
      .filter((feature): feature is CaniuseFeature => feature !== undefined);
    if (features.length === 0) return undefined;

    let excluded = 0;
    let prefixed = 0;
    for (const [agentId, agent] of Object.entries(this.agents)) {
      if (!agent) continue;
      for (const [version, usage] of Object.entries(agent.usage_global)) {
        if (usage === 0) continue;
        let cell: StatSupport = 'default';
        for (const feature of features) {
          const support = statSupport(feature.stats[agentId]?.[version]);
          if (support === 'none') {
            cell = 'none';
            break;
          }
          if (support === 'prefixed' && !spelledWithPrefix) cell = 'prefixed';
        }
        if (cell === 'default') continue;
        excluded += usage;
        if (cell === 'prefixed') prefixed += usage;
      }
    }
    return { excludedPercent: percent(excluded), prefixedPercent: percent(prefixed) };
  }
}

let servicePromise: Promise<TargetsService> | undefined;

/** Load browserslist and caniuse-lite exactly once per process. */
async function loadTargetsService(): Promise<TargetsService> {
  const [browserslistModule, caniuse] = await Promise.all([
    import('browserslist'),
    import('caniuse-lite'),
  ]);
  return new TargetsService(
    browserslistModule.default,
    caniuse.agents,
    caniuse.features,
    caniuse.feature,
  );
}

/** Promise-memoized accessor — the first caller pays the load, everyone else awaits it. */
export function getTargetsService(): Promise<TargetsService> {
  servicePromise ??= loadTargetsService();
  return servicePromise;
}
