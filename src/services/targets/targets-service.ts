/**
 * @fileoverview Targets service — resolves browserslist queries to tokens, maps
 * caniuse agents onto BCD browsers, and supplies the caniuse-derived usage
 * figures: per-agent totals, query coverage, and the share of tracked traffic a
 * feature would exclude.
 * @module services/targets/targets-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { validationError } from '@cyanheads/mcp-ts-core/errors';
import type { CaniuseAgent, CaniuseFeature } from 'caniuse-lite';
import { bcdBrowserForAgent } from '@/data/browserslist-bcd-map.js';
import { getBcdService } from '@/services/bcd/bcd-service.js';
import type { ResolvedTarget, TargetResolution, UncheckedTarget } from './types.js';

/**
 * CC BY 4.0 attribution carried on every response that quotes a usage figure,
 * used verbatim. caniuse tracks roughly 96.7% of global traffic, so every
 * percentage here is a share of that tracked population rather than of all
 * traffic.
 */
export const CANIUSE_ATTRIBUTION =
  'Usage data from caniuse.com, © Can I Use contributors, CC BY 4.0. ' +
  'Figures are a share of the ~96.7% of global traffic caniuse tracks.';

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

  /** Total tracked-traffic share attributed to one agent across all its versions. */
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
  queryTokens(query: string, ctx: Context): string[] {
    try {
      return this.browserslist(query, { path: false });
    } catch (error) {
      if (!isBrowserslistError(error)) throw error;
      throw validationError(
        error.message,
        { reason: 'invalid_target_query', ...ctx.recoveryFor('invalid_target_query') },
        { cause: error },
      );
    }
  }

  /** Real caniuse-derived market coverage of a token list. */
  coverage(tokens: string[]): number {
    if (tokens.length === 0) return 0;
    return percent(this.browserslist.coverage(tokens));
  }

  /**
   * Split browserslist tokens into targets that map onto a concrete BCD release
   * and targets the server declines to evaluate, with the reason for each.
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
      if (!version.resolved) {
        unchecked.push({
          agent,
          version_token: versionToken,
          reason: 'unknown_version',
          usage_percent: this.coverage([token]),
        });
        continue;
      }
      resolved.push({
        agent,
        version_token: versionToken,
        bcd_browser: bcdBrowser,
        bcd_version: version.version,
        bcd_release_index: version.index,
      });
    }

    return { resolved, unchecked };
  }

  /**
   * Share of tracked global traffic that requiring a feature would exclude:
   * every agent/version pair whose caniuse stat letter is not `y`. Returns
   * `undefined` when the feature reaches no caniuse id — never zero.
   */
  excludedUsage(caniuseIds: string[]): number | undefined {
    const features = caniuseIds
      .map((id) => this.caniuseFeature(id))
      .filter((feature): feature is CaniuseFeature => feature !== undefined);
    if (features.length === 0) return undefined;

    let excluded = 0;
    for (const [agentId, agent] of Object.entries(this.agents)) {
      if (!agent) continue;
      for (const [version, usage] of Object.entries(agent.usage_global)) {
        if (usage === 0) continue;
        const supported = features.every((feature) => {
          const stat = feature.stats[agentId]?.[version];
          return stat !== undefined && stat.split(' ')[0] === 'y';
        });
        if (!supported) excluded += usage;
      }
    }
    return percent(excluded);
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
