/**
 * @fileoverview Ambient declarations for `caniuse-lite`, which ships no types.
 * Only the members this server reads are declared: the agent table, the packed
 * feature map, and the `feature()` unpacker.
 * @module types/caniuse-lite
 */

declare module 'caniuse-lite' {
  /** One browserslist agent: its display name, versions, and usage share by version. */
  export interface CaniuseAgent {
    browser: string;
    prefix: string;
    release_date: Record<string, number | null>;
    usage_global: Record<string, number>;
    versions: (string | null)[];
  }

  /** An unpacked caniuse feature: support letters per agent and version. */
  export interface CaniuseFeature {
    shown: boolean;
    stats: Record<string, Record<string, string> | undefined>;
    status: string;
    title: string;
  }

  export const agents: Record<string, CaniuseAgent | undefined>;
  export const features: Record<string, unknown>;
  export function feature(packed: unknown): CaniuseFeature;
}
