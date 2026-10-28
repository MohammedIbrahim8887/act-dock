# Upstream readiness-dispatch patch study

**Result: reviewable experimental patch; do not ship.** Act Dock continues bundling official Act v0.2.89. Broad race gates are not satisfied, and an upstream merge/release is external.

Base: nektos/act v0.2.89, commit `4f411281417e88660bea1c1a1749aa71ae0bd60f` (MIT). The isolated worktree `.cache/engine-research/act-readiness` changes only `pkg/runner/runner.go` and adds `readiness.go`/`readiness_test.go`. [readiness.patch](readiness.patch) retains the changes; no production import or packaging script references the experimental binary.

## Mechanism

The original plan executes complete topological stages in sequence. A slow unrelated job delays a ready dependent in the next stage. The patch flattens the plan into workflow/job identities, starts jobs once their known `needs` executors have returned, and bounds active job executors by the existing configured limit. Completion publishes only after the entire executor, including matrix aggregation and post cleanup, returns, establishing output visibility before a dependent starts. Existing expression evaluation, default success/always behavior, matrices, action execution and reusable workflow code remain in Act.

This does not replace the parser/planner or split workflows into independent Act invocations. Matrix internals retain the existing per-job implementation; no new claim is made that combined matrix/job limits become a universal container cap.

## Reproduce

```sh
git clone https://github.com/nektos/act .cache/engine-research/act
cd .cache/engine-research/act
git checkout 4f411281417e88660bea1c1a1749aa71ae0bd60f
git worktree add --detach ../act-readiness HEAD
cd ../act-readiness
git apply ../../../docs/research/act-engine/optimization/scheduler/readiness.patch
go test -short ./...
go test -race ./pkg/runner -run '^TestReadiness' -count=20
go test -race -short ./pkg/runner
```

Build the original and patched source into `.cache/engine-research/bin/act` and `act-readiness`, respectively, then run `python3 docs/research/act-engine/optimization/scheduler/verify.py` from Act Dock. Docker must have the pinned AMD64 image recorded in the script. Fixtures use disposable directories, unique workflow names and run labels. They compare exit codes, output markers, job statuses and absence of fixture containers, writing raw JSONL alongside the summary.

## Evidence

- Entire upstream `go test -short ./...` passes on the patch.
- Focused readiness race tests pass for 20 repetitions, including readiness before unrelated completion, output visibility, concurrency bounds and waiting for active cleanup.
- Differential Docker fixtures pass: asymmetric, linear, ordinary parallel, failure/default skip/always, explicit skip/always, matrix outputs, local reusable workflows and JavaScript post actions. There are 28 executions total: three pairs each for asymmetric/linear/parallel and one pair each for the other five cases.
- Broad `go test -race -short ./pkg/runner` fails in `TestActionCache` for both original and patched source. The original reports two race warnings and patched three in the archive-copy/action-cache path. Preserve [official log](official-race.txt.gz) and [patched log](readiness-race.txt.gz). The counts are observations, not proof that the patch adds or removes a race. This gate is red.

| Workflow | Official median (range), s | Patched median (range), s | Samples per version |
| --- | ---: | ---: | ---: |
| Asymmetric, meaningful downstream work | 6.814 (5.922–8.866) | 4.914 (4.222–5.109) | 3 |
| Linear | 2.815 (2.689–3.245) | 2.798 (2.623–2.862) | 3 |
| Ordinary parallel | 1.247 (1.160–1.776) | 1.182 (1.054–1.586) | 3 |

Host: macOS ARM64 with Linux AMD64 Docker emulation. Same pinned image/content and workflow inputs; order alternates by repetition. Raw results: [differential-results.json](differential-results.json). The asymmetric child performs two seconds of work after a fast prerequisite while an unrelated job also takes two seconds. [Timestamp ordering](readiness-ordering.json) extracted from the raw logs shows the child's main step before the slow job completes in all three patched runs; the official barrier delays it. The logger has second-resolution timestamps. These small samples demonstrate the mechanism, **not** the application's 20-repetition release performance gate. They do not establish cancellation/fail-fast correctness for every nested reusable/matrix combination.

## Before any upstream acceptance or future shipping decision

Resolve/isolate the broad race failures, add cancellation and matrix fail-fast differential coverage across reusable workflows and post cleanup, and obtain native-platform evidence. Repeat controlled regression batches (at least 20 interleaved warm repetitions per configuration, separate cold trials), then run upstream tests/race tests and verify official released platform artifacts/checksums. Only an official upstream release containing an accepted patch may change the bundled production engine. Until then keep official v0.2.89, even if local asymmetric timing is attractive.

[Draft upstream PR description](PR_DESCRIPTION.md) records the proposal and remaining gates. It has not been submitted.
