/**
 * @fileoverview Data-version service — the vintage of each bundled dataset,
 * echoed on every tool response so a stale ship/no-ship verdict is visible.
 * @module services/data-version/data-version-service
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { z } from '@cyanheads/mcp-ts-core';
import { getBcdService } from '@/services/bcd/bcd-service.js';

/** Shape of the `data_version` enrichment every tool echoes. */
export const DataVersionSchema = z.object({
  bcd: z.string().describe('Version of the bundled @mdn/browser-compat-data snapshot.'),
  bcd_generated: z
    .string()
    .describe('ISO 8601 timestamp the browser-compat-data snapshot was generated at.'),
  web_features: z.string().describe('Version of the bundled web-features snapshot.'),
  caniuse_lite: z.string().describe('Version of the bundled caniuse-lite snapshot.'),
  browserslist: z.string().describe('Version of the bundled browserslist query resolver.'),
});

/** Version of every bundled dataset, plus the timestamp BCD was generated at. */
export type DataVersion = z.infer<typeof DataVersionSchema>;

/** One-line rendering of the dataset vintage for the `content[]` trailer. */
export function renderDataVersion(version: DataVersion): string {
  return (
    `**Data:** browser-compat-data ${version.bcd} (generated ${version.bcd_generated}) · ` +
    `web-features ${version.web_features} · caniuse-lite ${version.caniuse_lite} · ` +
    `browserslist ${version.browserslist}`
  );
}

/**
 * Read `web-features`' version. Its `exports` map does not expose
 * `./package.json`, so a direct import throws `ERR_PACKAGE_PATH_NOT_EXPORTED`
 * under Node even though it resolves under Bun. Resolve the data file instead
 * and read the sibling manifest.
 */
function readWebFeaturesVersion(): string {
  const require = createRequire(import.meta.url);
  const dataPath = require.resolve('web-features/data.json');
  const manifest = readFileSync(join(dirname(dataPath), 'package.json'), 'utf-8');
  return (JSON.parse(manifest) as { version: string }).version;
}

let versionPromise: Promise<DataVersion> | undefined;

/** Resolve every dataset version once per process. */
async function loadDataVersion(): Promise<DataVersion> {
  const [bcd, caniuseManifest, browserslistManifest] = await Promise.all([
    getBcdService(),
    import('caniuse-lite/package.json', { with: { type: 'json' } }),
    import('browserslist/package.json', { with: { type: 'json' } }),
  ]);
  return {
    bcd: bcd.meta.version,
    bcd_generated: bcd.meta.timestamp,
    web_features: readWebFeaturesVersion(),
    caniuse_lite: (caniuseManifest.default as { version: string }).version,
    browserslist: (browserslistManifest.default as { version: string }).version,
  };
}

/** Promise-memoized accessor — computed once, echoed on every response. */
export function getDataVersion(): Promise<DataVersion> {
  versionPromise ??= loadDataVersion();
  return versionPromise;
}
