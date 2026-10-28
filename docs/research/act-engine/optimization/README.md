# Act Dock integration optimization — implementation and verification

This extends the [original investigation](../README.md), preserving its REA records, pinned source and benchmark fixtures. Official checksum-verified Act **v0.2.89** remains the production engine. No custom workflow interpreter or per-job `act -j` orchestration was introduced. No release or deployment is authorized by this implementation.

## Implemented architecture

Whole workflow invocations pass through the Bun scheduler and `executor/act.ts`. Shared Zod contracts validate requests and responses across desktop, development bridge, CLI and MCP. `get_capabilities` reports API 2 and feature support before newer clients submit managed execution fields. SQLite schema 3 backs up older databases and migrates transactionally, preserving historical states and cursors. A newer schema is refused rather than downgraded. Runner replacement still waits while work is active.

| Module | Responsibility |
| --- | --- |
| `execution-config.ts` | Built-in → global → recognized Act config files → project → run inheritance, non-secret provenance and hashes |
| `images.ts` | Catalog v1, native Docker architecture, platform inspection, addressable image references, shared/cancellable pulls |
| `caches.ts` | Immutable project action snapshots, leases, package-download volumes and inactive LRU maintenance |
| `executor/act.ts` | Executable capabilities/environment, explicit Docker context/TLS endpoint, bounded lightweight checks |
| `secrets.ts` | Vault grants, dotenv import, merge order, private files, ephemeral inputs and HMAC idempotency |
| `log-writer.ts`, `events.ts` | Ordered sanitized file batches, transactional indexes/events and resumable long polling |
| `scheduler.ts`, `ownership.ts` | Admission, endpoint/resource reservations, process groups, proven resource ownership and recovery |

The native Go helper ships beside the runner and official Act. Dependencies and Go toolchain are pinned; each build emits executable checksums, dependency inventory and license notices. Unrelated repository VCS metadata is excluded from helper builds to avoid unnecessary vault identity changes. go-git 5.16.5 acquires shallow action snapshots without requiring user-installed Git. Vault providers use Security/LocalAuthentication, Credential Manager, and Secret Service APIs, separately from action acquisition.

## Effective behavior

- **Images:** medium remains default. Ubuntu 20.04 (legacy), 22.04 and 24.04 resolve independently; `ubuntu-latest` aliases 24.04 through catalog changes. Full and arbitrary custom images are selectable. `auto` follows the Docker daemon; unavailable platforms fail explicitly. `if-missing` checks local compatible content without registry access and passes its immutable reference to Act with `--pull=false`. Refresh and local-only modes are explicit. Docker credentials/context/TLS settings are preserved. A workflow-declared job container keeps its image; conflicting workflow options disable unsafe managed mounts/labels rather than rewriting YAML. Download estimates are compressed transfer estimates when available; installed storage can be larger or unknown.
- **Actions:** pinned commits are reused indefinitely; floating refs refresh after 24 hours. Refresh re-resolves; cached-only rejects missing sources. Literal actions, composite dependencies and reusable-workflow sources receive immutable `--local-repository` mappings. A per-run authenticated host proxy prevents cached-only Act fallback from fetching action hosts, while job-container networking remains unchanged. It is an action-source policy, not a hermetic network sandbox for arbitrary workflow commands. Dynamic/unavailable references delegate to Act in normal modes; cached-only cannot silently fetch them.
- **Packages:** npm, pnpm and Bun profiles are opt-in. Namespaced project/architecture/generation volumes cache downloads, not node_modules or dirty containers. pnpm requires the explicit store command shown in the UI. Leases survive recovery while cleanup is unresolved. Only inactive app-owned resources are eligible for clearing/eviction. Defaults are 5 GiB/project and 20 GiB overall; unknown sizes are reported and cannot establish quota compliance.
- **Logs/events:** one ordered writer flushes at 50 ms, 256 records or 64 KiB, with an 8 MiB high-water mark and stream backpressure. Sanitized JSONL is flushed before index rows and events commit together. Structured metadata is whitelisted before truncation, including both Act step-ID spellings. Restart truncates incomplete/uncommitted tails. A shared desktop subscription, CLI follow mode and MCP consume global durable cursors. Existing `get_run_logs` stays compatible. Terminal events follow final output and owned-resource cleanup.
- **Secrets:** values remain in OS vaults or private file-backed sources, never SQLite/history/argv. File → selected granted project secrets → unsaved overrides determines precedence. Names/grants/revisions are inspectable; saved values are write-only in the UI, and MCP has no value-read tool. Generated files use JSON-compatible YAML so Act preserves tabs, quotes, multiline data and trailing backslashes exactly; input dotenv files keep Act’s parser semantics. Secret files are private and outside the workspace, then deleted on all exits/recovery. Unsaved queued values remain only in memory; restart requires resupply. Installation-key HMACs compare sensitive inputs without persisting them. Background vault access requests no interactive unlock; locked/unavailable providers return recovery guidance. On macOS, a changed helper identity may require authorization or replacement of saved values; the upgrade fixture below reports this limitation rather than claiming transparent access.
- **Preflight:** configuration, images/platform, helper availability, caches, vault metadata, literal missing-secret references and dependencies are inspected together. Arbitrary commands/dynamic references are explicitly unknown. Recoverable missing dependencies stay queued and recheck every five seconds; successful lightweight checks coalesce/cache for five seconds. General health remains available without preventing contextual previews.
- **Concurrency:** off by default; enabling starts at two, configurable 1–8. Oldest eligible work enters, while same worktrees, Act names, writable caches, uncertain resource namespaces and shared tool-cache writers serialize. Default reservations are 2 CPUs/2 GiB, admitted within 75% of reported Docker capacity. Live pressure pauses new admissions. Reservations are not cgroup limits. Cancellation targets only the selected process group/proven resources, with five-second escalation. Unproven resources remain visible, block conflicts and are never removed automatically. Startup interrupts formerly active work, reconciles resources/cache leases and removes stale private files.

Queued preferences are frozen. Actual workflow/configuration hashes, executable identity, Docker endpoint and resolved images are recorded again at admission. Working files remain execution-time inputs; this is not a frozen source checkout.

## Public interfaces

The authoritative request/response schemas are `apps/desktop/src/shared/{contracts,execution}.ts`. Additions include capabilities, effective/inherited execution configuration, partial settings, preflight, runner snapshots, image operations, cache operations, secret metadata/write/delete/import/resupply, events and metrics. New fields extend existing run records with `phase`/`queueReason`; historical run-state enums remain intact.

Desktop exposes global/project execution preferences, cache maintenance, Secrets & environment, run preflight/provenance, preparation/cleanup feedback, metrics and queue reasons. Advanced controls use progressive disclosure within existing shadcn/system-font/grayscale themes.

CLI groups: `images`, `cache`, `secrets`, `doctor`, `events`, `metrics`; existing run/history/log commands remain. Use `run --config execution.json` for execution options. Secret write/import payloads are read through stdin, not values in command arguments. MCP's 23 tools include preflight, image/cache metadata and mutations, secret metadata/references, events and metrics. Mutations are explicitly described. Saved-value retrieval is not exposed.

## Reproducible verification

Run these separately from the user's normal runner; fixtures use disposable data/project directories and unique workflow names:

```sh
bun run check
bun scripts/verify-execution.ts
bun scripts/verify-recovery.ts
python3 scripts/verify-distribution.py
ACT_DOCK_TEST_VAULT=1 bun run test:helper

# Controlled performance runs: cached pinned image, no simultaneous builds/tests.
git worktree add --detach .cache/optimization-baseline b71aad8
bun scripts/benchmark-execution.ts
bun scripts/benchmark-logs.ts
```

An interrupted harness can resume with `ACT_DOCK_BENCH_RESUME_DIR` and `ACT_DOCK_BENCH_RESUME_LOG`; completed sample identities are skipped and a checkpoint is written after each observation. Process warmups are repeated without counting them as measurements. Record interruptions and ambient workload changes separately.

The performance harness expects verified `.cache/engine-research/bin/act` and the baseline worktree. Root/app node_modules symlinks are created automatically. For Linux vault testing, cross-compile `go test -c` with `GOOS=linux GOARCH=amd64 CGO_ENABLED=0`, mount it as `/fixtures/helper.test` in disposable Ubuntu 24.04 with D-Bus, then run `tools/act-dock-helper/verify-linux-vault.sh`. It creates an isolated Secret Service session; it does not alter the host vault. Native Windows testing still requires Windows.

The final workspace check passes 68 tests across 12 files, the helper suite, desktop/web builds and prerender validation. Functional tests cover real v2 database/history/queue migration and backup, API/CLI/MCP compatibility, ten-thousand-line ordered retention, cursor pagination, transactional index failure, partial-tail repair, queued ephemeral-input recovery, locked-vault errors, secret-file cleanup/escaping and multiline-record masking, action-source network guard, image-platform cache behavior and cache leases. Real Docker fixtures verify overlap, cross-project namespace collisions, same-project serialization, selected-run cancellation, cold action acquisition then cached-only execution, warm npm offline downloads, static matrix collisions, service cleanup, reservation release and runner SIGKILL recovery. See [Docker acceptance](docker-acceptance.json) and [recovery acceptance](recovery-acceptance.json).

## Measured performance

Measurements are local macOS ARM64 with Linux AMD64 Docker emulation, official Act 0.2.89 and equal workflow/image inputs. These are integration measurements, not a custom-engine comparison. The original report retains other representative workflow/cold-image observations. These added results isolate persistent-runner behavior from command startup.

| Continuous warm single-command workflow | Baseline median | Optimized median | Samples |
| --- | ---: | ---: | ---: |
| Batch 1, total | 2,419 ms | 1,403 ms | 20/version, interleaved |
| Batch 2, total | 2,587 ms | 1,407 ms | 20/version, interleaved |
| Batch 1, first main step | 2,231 ms | 922 ms | 20/version |
| Batch 2, first main step | 2,384 ms | 983 ms | 20/version |

Full elapsed ranges were 2,048–21,295 ms baseline versus 1,119–1,975 ms optimized in batch 1, and 2,266–3,826 versus 1,219–3,010 ms in batch 2. The baseline outlier is retained. Bun host CPU medians increased from 78/81 ms to 93/92 ms for this small workflow: added admission/ownership checks cost CPU even while avoiding repeated pull/poll latency. Child Act, Docker daemon and container CPU/RSS are not included in this host CPU accounting. No general CPU or memory improvement is inferred from this case.

| Logging / event measurement | Baseline | Optimized | Samples |
| --- | ---: | ---: | ---: |
| Bun CPU, 10,000 retained lines | 516.10 ms | 37.99 ms | 20/version, interleaved |
| Total writer duration | 642.53 ms | 36.06 ms | 20/version |
| Committed event delivery p95 | — | 54.03 ms | 100 events |
| Retained output | 10,000 ordered lines | 10,000 ordered lines | Every burst |

Raw measurements and all ranges: [continuous persistent runs](persistent-benchmark-continuous.json), [logging/events](log-benchmark.json), [aggregated summary](summary.json). Optimized writes include fsync. Event timing includes the 50 ms batching timer and committed file/index visibility. This local p95 meets the 150 ms target, not a cross-platform service guarantee.

The two continuous warm minimal-workflow batches, recorded before the final secret-wire/platform hardening, show no repeatable median regression above max(10%, 200 ms). A [final-core follow-up](persistent-benchmark.json) retains 80 unique observations: interruption occurred after 49, then the remaining 31 resumed while an unrelated Act workflow was active. Those follow-up timings are exploratory and are not pooled into the table or treated as an uninterrupted controlled gate. This does not establish the final release-wide gate across representative workflows. Cold action/package acquisition tests are functional single trials; cold image download trials were not repeated or timed here. No new cold-cache speed ratio, peak-memory improvement, or Windows/Linux-native performance claim is made. All estimates of a custom engine remain unverified.

## Readiness-scheduler study

The [isolated upstream patch](scheduler/README.md) changes readiness dispatch inside Act rather than the app. It is never bundled. The study preserves test fixtures/raw logs and a PR description. Small differential trials show earlier eligible-job starts and lower asymmetric-DAG makespan, but the broad upstream race suite fails in action-cache code on both original and patched trees. Shipping gates are therefore **not satisfied**. Keep official releases; re-evaluate only an official upstream release with verified artifacts and full compatibility/race/performance evidence.

## Release gates and limitations

- macOS native vault round trip (48 KiB/multiline), Linux Secret Service round trip, TypeScript contracts and deterministic tests are verified locally. Linux vault execution uses Docker/emulation; desktop/native Windows vault, DACL and process-tree correctness remain **unverified**.
- [Helper upgrade fixture](vault-upgrade.json) requests a noninteractive macOS context and bounds access to three seconds. A changed binary could not access the previous binary's test item and returned `VAULT_UNAVAILABLE`; replacement/authorization guidance is implemented. No claim of transparent helper-identity migration or absence of all system-owned dialogs is made.
- Private registries use Docker's existing credentials. Registry/helper errors and incompatible-platform paths are handled, but no live private registry account/full-image transfer was provisioned for this verification.
- Crash execution/resource recovery is verified. Separate real process-kill trials at every preparation/cleanup instruction boundary and every OS are not established by the execution crash fixture.
- Controlled performance trials cover warm minimal workflows and log bursts. Broader cold/native-platform/regression batches, native Windows vault/process tests and packaged Windows GUI tests are release evidence still required before a cross-platform release claim.
- Light/dark/compact visual flows and the three UI review fixes are recorded in [UI verification](ui-verification.json). Full native keyboard/reduced-motion runtime matrices remain a release check; retained CSS/focus patterns alone do not establish that matrix.
- No upstream PR was submitted, production deployment performed or release triggered. Local artifacts/commits are prepared for review through the existing publishing pipeline.
