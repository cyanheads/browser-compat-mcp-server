---
name: browser-compat-guide
description: Assess concrete web code against a project's browser target policy with browsercompat_* tools. Use for shipping decisions, choosing between feature-level and subfeature evidence, or diagnosing historical browser failures and support qualifiers.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Use this guide when reviewing the browser requirements of code being written or changed. The server supplies bundled compatibility evidence; it does not run the application, test a polyfill, or fetch the prose behind an MDN or specification link. Use the returned links when the decision depends on behavior beyond the compatibility record.

## Identifiers

`browsercompat_search_features` yields BCD keys for individual APIs, attributes, values, and other subfeatures, and web-features ids for broader capabilities. Keep BCD key casing exactly as returned: `api.Crypto` and `api.crypto` are different entries.

Choose the identifier that matches the code's dependency. A feature id such as `grid` answers for the capability as a whole; it does not establish support for every key it owns. Use `browsercompat_get_feature` to inspect its `compat_keys`, then select the key for the actual behavior. Use `browsercompat_list_reference` to resolve browser and group vocabulary rather than translating ids by guesswork.

## Gates

1. Establish the project's browser target policy before making a project shipping claim. Baseline describes general availability across its core browsers; it does not replace the project's explicit targets. If the policy is unknown, report the available evidence and leave the project verdict unresolved.
2. Match the evidence to the code's behavior before accepting a feature-level answer. When a multi-key id cannot answer for the required browser or subfeature, inspect its keys and compare the relevant BCD key. Keep the target policy intact; excluding unchecked browsers to obtain a pass changes the question.
3. Separate lack of evidence from evidence of no support. A miss asks for identifier discovery; `not_mapped` means no Baseline mapping; `no_compat_data` means no per-browser compatibility record; an unchecked target remains unresolved. None alone proves that the browser cannot run the feature. If a filtered search finds nothing, broaden the filters before declaring the feature absent.
4. Assess deprecation and discouragement separately from availability. `all_widely_available` does not account for either advisory, and an omitted status field does not establish that a feature is recommended.
5. For an older target, inspect the statement behind its verdict before recommending a prefix, flag, or fallback. A current-browser support row can select a different statement from the one relevant to that historical release. Preserve partial-support qualifiers and version bounds when describing the result.
6. Complete the requested feature set before giving an aggregate decision: entries in `omitted_features` still need another call. Use whole-query verdicts and failure totals for the decision; page target rows only when their individual evidence is needed.
7. Carry the snapshot date or dataset versions into conclusions about recent browser changes. When the returned snapshot cannot establish a recent release's behavior, verify current primary evidence before giving a definitive answer.

## Core chain

Read the code to identify the exact API, property value, attribute, or subfeature it requires. Search for that behavior, inspect the candidate record, and confirm that its identifier describes the dependency. Compare those identifiers against the project's explicit browser policy. Report supported behavior, demonstrated failures, and unresolved coverage separately, with the returned evidence for each.

## Workflows

### Review a change for shipping

Use `browsercompat_check_baseline` for availability and advisories across the identified features, then `browsercompat_compare_support` for the project's targets. For a failure, use the per-feature `failing_ranges` to identify affected browser versions. Inspect target rows and the full feature record only where needed to decide whether the code requires a fallback, a different feature, or a stated browser restriction. A fallback needs its own compatibility assessment; this server does not prove that the application selects it correctly.

### Diagnose a historical browser failure

Compare the exact failing browser version and the BCD key for the failing behavior. Inspect the failing row's support statement, then use `browsercompat_get_feature` to read the browser's main row and `other_statements`, including notes and links. An earlier prefixed or flagged implementation may be there even when the main row describes clean support in the newest release. If the verdict is unknown, preserve that uncertainty rather than inferring an exact release from a bound.

### Express the target policy

Pass a self-contained browserslist expression. Use explicit browser versions for a reproduction and the project's actual expression for a shipping review. A comma or `or` forms a union (`chrome 100, firefox 100`); `and` intersects selections (`last 2 versions and > 0.5%`). Do not turn a union into an intersection to reduce failures. `defaults` is a browserslist policy, not a way to load the project's configuration.

Resolve configuration packages and custom usage statistics in the project's own environment before calling this server; it cannot read the caller's project configuration. Preserve the resulting browser/version targets when expressing them explicitly. Follow the tool's current query validation and recovery guidance.
