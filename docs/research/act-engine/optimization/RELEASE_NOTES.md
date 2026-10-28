# Unreleased — Act Dock execution optimizations

Local review candidate. Version stamping and publication remain owned by the existing release pipeline; no version was published or deployed during this work.

## Changes

- Choose medium, full or custom Linux images, with independent Ubuntu labels, platform-aware local reuse and explicit refresh policies. Medium remains default; Ubuntu latest maps to 24.04.
- Reuse immutable project action sources, select cached-only mode, and opt into npm/pnpm/Bun download caches with safe leases and scoped maintenance.
- Stream durable run/job/step events and batched retained logs through desktop, CLI and MCP. Closing a client keeps execution running.
- Save write-only project secrets in the system vault, preview dotenv imports, select granted names and supply unsaved per-run overrides. Generated private YAML preserves exact values, and multiline output receives line-level masking.
- Preview effective configuration, provenance and contextual readiness before queuing. Temporary dependencies keep a run waiting and recover automatically.
- Enable up to eight admitted workflows, with a default of one and initial opt-in limit of two. Conflicting workspaces, namespaces and cache writers still serialize. CPU/RAM reservations govern admission, rather than hard container limits.
- Recover interrupted work, reconcile proven resources and retain visible cleanup conflicts. Ambiguous Docker resources are never removed automatically.
- Negotiate API capabilities and preserve old run/log/history interfaces. Database schema 3 creates an upgrade backup and retains existing history/queued work.

## Maintainer verification

Type checks, 68 tests, helper tests, desktop/web builds and site prerender validation pass. Real Docker fixtures cover overlap, conflicts, cancellation, caches, exact secret values, daemon-native Auto architecture, service/matrix resources, reservations and execution-crash recovery. Native macOS and Linux Secret Service vault round trips pass; Linux testing is under Docker/emulation.

All five installer formats build. The macOS DMG passes deep signature verification and signed-helper checksum/executable checks. DEB/RPM/AppImage and Windows installer payloads contain the runner, official Act, helper, dependency inventory and notices, with matching helper checksums. The extracted Linux package passes compiled CLI/MCP integration. AppImage payload verification extracts SquashFS directly because this Mac's Rosetta cannot execute the static PIE AppImage runtime.

The [implementation report](README.md) includes reproducible methods, sample counts, raw measurements, ranges and explicit limitations. The [experimental upstream readiness patch](scheduler/README.md) is separate and **not bundled**. Official Act 0.2.89 remains the engine.

## Gates before a cross-platform release claim

- Native Windows vault/chunking, restricted DACL, process identity/tree cancellation and installed GUI tests.
- Native keyboard and reduced-motion runtime matrices; current captures verify light/dark/compact visual flows and the three reviewed UI fixes.
- Broader representative-workflow/cold-cache controlled regression trials, beyond the measured warm minimal-workflow and logging cases.
- Additional real kill-boundary trials during preparation/cleanup and live private-registry/full-image scenarios.
- Helper identity changes can require vault authorization or secret replacement; background access returns guidance rather than requesting an unlock prompt. VCS-only app changes no longer alter helper build identity.

The separate Act patch also needs its broad race failures resolved and expanded cancellation/fail-fast compatibility evidence before upstream acceptance or any future official engine upgrade. Those findings do not change the bundled engine here.
