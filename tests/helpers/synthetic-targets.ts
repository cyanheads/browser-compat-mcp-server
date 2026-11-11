/**
 * @fileoverview Test helper: a `TargetsService` over one synthetic caniuse agent.
 * @module tests/helpers/synthetic-targets
 */

import browserslist from 'browserslist';
import type { CaniuseAgent, CaniuseFeature } from 'caniuse-lite';
import { TargetsService } from '@/services/targets/targets-service.js';

/**
 * A service over one synthetic agent `fx`: `usage` maps each of its versions to a usage share,
 * `stats` maps each caniuse id to its stat string per version (a version left out has no stat).
 */
export function syntheticUsage(
  usage: Record<string, number>,
  stats: Record<string, Record<string, string>>,
): TargetsService {
  const agent: CaniuseAgent = {
    browser: 'Fixture',
    prefix: 'webkit',
    release_date: {},
    usage_global: usage,
    versions: Object.keys(usage),
  };
  const features = Object.fromEntries(
    Object.entries(stats).map(([id, byVersion]): [string, CaniuseFeature] => [
      id,
      { shown: true, status: 'other', title: id, stats: { fx: byVersion } },
    ]),
  );
  return new TargetsService(
    browserslist,
    { fx: agent },
    features,
    (packed) => packed as CaniuseFeature,
  );
}
