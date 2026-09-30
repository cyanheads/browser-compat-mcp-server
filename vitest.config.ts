/**
 * @fileoverview Vitest config for the consumer server. Uses Vitest `projects`
 * so you can split suites (unit/smoke/integration/fuzz) and run each with
 * `--project <name>` as the surface grows. Extends the framework's base config
 * for shared `resolve`, `ssr`, and coverage settings.
 *
 * @module vitest.config
 */

import coreConfig from '@cyanheads/mcp-ts-core/vitest.config';
import { defineConfig, mergeConfig } from 'vitest/config';

const alias = { '@/': new URL('./src/', import.meta.url).pathname };

export default mergeConfig(
  coreConfig,
  defineConfig({
    resolve: { alias },
    // Parse dataset snapshots as JSON instead of transforming their nested objects.
    json: { stringify: true, namedExports: false },
    test: {
      // Each isolated fork loads the bundled datasets; bound concurrent copies.
      maxWorkers: 2,
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
            exclude: ['tests/smoke/**', 'tests/integration/**', 'tests/fuzz/**'],
            // Isolated files each load and index the bundled snapshots;
            // retain headroom for concurrent work on the development host.
            testTimeout: 45_000,
          },
        },
        {
          extends: true,
          test: {
            name: 'smoke',
            include: ['tests/smoke/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'integration',
            include: ['tests/integration/**/*.test.ts'],
            maxWorkers: 1,
            testTimeout: 30_000,
            // No live-HTTP integration suite exists yet — this server has no
            // upstream to integration-test against (Core Mechanics: no
            // network calls at runtime). Not a failure until one is added.
            passWithNoTests: true,
          },
        },
        {
          extends: true,
          test: {
            name: 'fuzz',
            include: ['tests/fuzz/**/*.test.ts'],
            // Tens of handler invocations per tool, on top of the same cold
            // dataset load a unit file pays — and this project runs alongside
            // the unit forks, so it inherits their contention. Same 45s for
            // the same reason.
            testTimeout: 45_000,
          },
        },
      ],
    },
  }),
);
