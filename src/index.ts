#!/usr/bin/env node
/**
 * @fileoverview browser-compat-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { browsercompatCheckBaseline } from './mcp-server/tools/definitions/browsercompat-check-baseline.tool.js';
import { browsercompatCompareSupport } from './mcp-server/tools/definitions/browsercompat-compare-support.tool.js';
import { browsercompatGetFeature } from './mcp-server/tools/definitions/browsercompat-get-feature.tool.js';
import { browsercompatListReference } from './mcp-server/tools/definitions/browsercompat-list-reference.tool.js';
import { browsercompatSearchFeatures } from './mcp-server/tools/definitions/browsercompat-search-features.tool.js';
import { getBaselineService } from './services/baseline/baseline-service.js';
import { getBcdService } from './services/bcd/bcd-service.js';
import { getDataVersion } from './services/data-version/data-version-service.js';
import { getSearchService } from './services/search/search-service.js';
import { getTargetsService } from './services/targets/targets-service.js';

await createApp({
  name: 'browser-compat-mcp-server',
  title: 'browser-compat-mcp-server',
  cacheHints: {
    'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' },
    'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' },
  },
  tools: [
    browsercompatListReference,
    browsercompatGetFeature,
    browsercompatCheckBaseline,
    browsercompatSearchFeatures,
    browsercompatCompareSupport,
  ],
  resources: [],
  prompts: [],
  instructions:
    'Browser support and Baseline status for web platform features, served from bundled MDN browser-compat-data, web-features, and caniuse data — offline, no API key, no rate limit. Start at browsercompat_search_features when the feature key is unknown; browsercompat_get_feature returns the per-feature record and browsercompat_check_baseline answers ship-or-not across up to 20 features at once. Every tool takes one feature string that is either a BCD key (css.selectors.has) or a web-features id (has), and echoes resolved_as saying which namespace it matched; an unresolved feature comes back as found: false with guidance, never an error. browsercompat_compare_support requires an explicit browserslist query and reports unchecked_targets for target browsers with no compatibility data — a pass is never claimed for a browser that was not evaluated. browsercompat_list_reference enumerates the namespaces, browser ids, browserslist agents, Baseline states, groups, and snapshots the other tools expect. Every response echoes data_version; the data is a package snapshot, so a feature that shipped in the last few weeks may lag.',
  // Keyless public reference data — serve the full inventory without an auth gate.
  landing: { requireAuth: false },

  setup(core) {
    // Start the dataset loads without awaiting, so a hosted container warms
    // during boot while stdio startup stays instant. The first tool call awaits
    // the same promises.
    Promise.all([
      getBcdService(),
      getBaselineService(),
      getTargetsService(),
      getSearchService(),
      getDataVersion(),
    ]).catch((error: unknown) => {
      core.logger.error(
        'Dataset warm-up failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  },
});
