# Benchmark methodology and reproduction

## Scope and environment

The primary subject is Act v0.2.89, the binary bundled by Act Dock v0.2.4. The macOS release archive SHA-256 is `48ae218af96725f7635a66de2b87e1e346893b02add0f16b92f560296b2151fc`, matching `scripts/act.ts`. The extracted executable digest and VCS identity are retained by REA. Source inspection uses that exact Act commit. The application and official-runner source revisions are in [sources.json](evidence/sources.json).

Host: Mac17,2, Apple ARM64, 10 logical CPUs, 24 GiB RAM, macOS 26.5.1. Docker Engine 29.6.2 under Docker Desktop, Linux ARM64 VM with 10 CPUs and 8,321,515,520 reported bytes of RAM. AMD64 fixtures run through Docker Desktop's Rosetta support. Native/auto-architecture fixtures are reported separately. This is one developer machine, not an isolated performance lab. Other host activity and external network variability were not globally disabled.

The medium runner tag already existed. The Node slim image was absent before its cold trial. Both images are retained after research; no user images, caches, volumes or containers were globally pruned. Image identity/platform inspection and Docker's reported storage displays are saved in [image-identities.json](evidence/image-identities.json). Do not interpret `.Size` on a containerd multi-platform index as a simple unpacked filesystem size: Docker's listing and per-platform inspect show different accounting. The listing showed approximately 4.56 GB for the runner tag and 329 MB for Node slim. The full hosted-runner snapshot image was not downloaded or tested; “larger image” in this study means the existing runner image compared with Node slim, not `full-latest`.

The report uses the actual image versions observed, not assumptions about what a mutable `latest` tag means. Catthehacker's current published documentation may refer to newer Ubuntu variants than the locally cached tag. A production image picker should resolve and display versions rather than equating every Ubuntu label with today's latest image.

## Harness and fixtures

`benchmarks/run.py` generates a disposable Git project under `.cache/engine-research/bench/project`. No CI engine is implemented. Every workflow is executed by the verified upstream Act binary. The harness records the full command and starts a bounded subprocess; no app source, bundled binary, workflow configuration or existing user runner is replaced.

| Fixture | Work performed | Important limitations |
| --- | --- | --- |
| `minimal` | One shell step, marker and `true` | Measures short-run overhead, not a realistic full build. |
| `node` | Local checkout shortcut, `npm ci`, lodash assertion | Tiny synthetic project: lodash 4.17.21 and TypeScript 5.9.3 in the lockfile. No native dependencies/lifecycle scripts. |
| `typescript` | Same install, `tsc`, Node test runner | One TypeScript module and one assertion; not the production monorepo. |
| `multistep` | Twelve named shell steps | Exposes repeated step lifecycle cost, not heavy commands. |
| `external` | `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`, then Node version | No version input; exercises fetch/JS/pre-post behavior without intentionally downloading a new Node distribution. Does not represent every marketplace action. |
| `parallel` | Four independent jobs, each sleeps two seconds | Tests job overlap; not CPU-saturated throughput. |
| `dag` | A sleeps one second; B sleeps four; C needs A only | Demonstrates stage barrier; C is near-zero duration, so its earlier eligibility need not improve total makespan. |
| `logs` | 10,000 output lines | Synthetic stress case, valuable for persistence/streaming analysis. |
| `workspace` | Checkout of 64 MiB in 2,048 files, existence assertion | Copy versus bind; does not measure repeated metadata scans/node_modules on mounted storage. |
| `cancel` | Marker and 60-second sleep | REA sends SIGINT at four seconds; one cancellation path only. |

Git checkout in these local fixtures is Act's local-worktree copy shortcut, not a remote checkout of the fixture's placeholder origin. Project files and `package-lock.json` are copied into the documentation alongside the generator after execution for reproducibility. Original fixture generation is deterministic except Git metadata; exact raw commands and action refs remain in the records.

The benchmark uses an isolated HOME/XDG config/cache and an explicitly selected Docker endpoint. It does not read a real user's `.actrc`, `.env` or `.secrets` as workflow configuration. Docker's existing credential configuration is available for public registry access, but its contents are never recorded. The harness passes a small environment allowlist; REA's launcher receives the same restricted environment. No real secrets are used.

### Configuration cohorts

- `current`: production-style fixed `-P` mappings, JSON, `--rm`, masking enabled and explicit AMD64 architecture. The direct harness disables the in-container Docker socket mount and uses dedicated action/cache-server paths; it is not a claim to measure the GUI end to end.
- `optimized`: same workflow/image/architecture with `--pull=false --action-offline-mode`. Despite the name, traces reveal a platform mismatch still causes pulls. The label denotes an attempted optimization, not a proven one.
- `pinned`: the same AMD64 runner filesystem via its platform-specific manifest digest, plus pull/offline flags. The digest reference is registered once before timing, reusing existing image content. This tests actual cached-image behavior without changing the app.
- `native-current` / `native-optimized`: omit the architecture override, matching the app's default `auto` behavior on this ARM64 VM. Different architecture from the AMD64 cohort; do not combine them into one speedup result.
- `serial`: same parallel fixture with `--concurrent-jobs 1`; this is a control proving Act's existing parallel execution.
- `dryrun`: no container creation. It still includes CLI initialization, model/schema work, expressions, logging, cache/server lifecycle and shutdown. It is **not** an isolated parser timing and cannot be subtracted from a real run as if all other work were identical.
- `integration`: a fresh Bun harness uses the actual application's scheduler/store/logging against a disposable database. Unlike direct mode it retains production socket-mount behavior and default cache flags. Includes Bun startup, excludes desktop GUI/IPC; not a pure logging-cost measurement.
- `small`: Node slim image, fixed AMD64 and `--pull=false`; the initial image is absent. Subsequent “warm” trials still encounter index/platform reinspection and may contact the registry. Image-cached does not mean network-free.
- `npmcache`: one uniquely named Docker volume mounted at `/tmp/bench-npm-cache`, with npm prefer-offline. Empty at first run; reused for subsequent runs; only this study-owned volume is removed afterward. Same install and assertion as `node`.
- `newcache`: `--use-new-action-cache --pull=false` using a separate empty action cache initially. The shallow implementation can still fetch on later executions; this is not the same as offline mode.
- `copy` / `bind`: same large fixture and flags except `--bind`. A live bind changes write visibility/isolation; this probe only reads the checked-out file.

Each ordinary pair has three repeats with reversed mode order on the second repeat. This reduces one fixed ordering bias; it does not eliminate thermal/network/cache effects. Each external-action mode has one observed cold acquisition and two observed warm acquisitions. The two initial cache directories are independently empty; network timing between those cold trials is uncontrolled. Do not quote their ratio as a stable engine gain.

### Cold and warm definitions

“Cold image” means the tag is not locally present before that one trial; shared layers may still exist. It is not a fully empty Docker installation. “Warm image” means image content exists, not that registry auth/manifest checks are absent. “Cold action cache” means the scenario's dedicated action cache directory is initially empty. “Warm action cache” means the previous successful action invocation populated it. “Warm npm cache” means the dedicated package-cache volume was populated in a previous successful install. Normal fresh-container runs do not retain `/tmp` package downloads from their predecessors.

Docker containers and job workspace volumes are freshly created/cleaned per ordinary invocation. The global toolcache can preexist. No claim is made about fully cold OS page cache, daemon/VM restart, first-ever runtime extraction, or an empty underlying storage layer. Image pulls, external actions and npm downloads are network dependent.

## Measurements

Each `runs.jsonl` record contains wall duration, first main-step log timestamp, first actual `BENCH_FIRST` raw-output timestamp, process exit, host user/system CPU and macOS maximum RSS from `/usr/bin/time -l`, input/output block counts, command and start time. Raw Act JSON logs retain local arrival timestamps. “First main step” can be the local checkout shortcut; it is not always the user's install command. The marker is recorded separately so this distinction is visible.

Docker events are recorded independently. The summarizer filters preceding subsecond history and names outside the research namespace. It derives create/start/destroy and Docker-exec timelines. `phases.json` uses Act log arrivals; `docker-phases.json` uses daemon timestamps. Logs/daemon clocks are not treated as perfectly synchronized causal traces. Parallel phase sums are not presented as total wall-time decomposition.

`resource-profile.json` is a **separate instrumented run**. It polls target Act RSS through `ps` and container stats through the Docker Unix socket, at a nominal 200 ms interval plus request time. It retains sample timestamps, cgroup memory, cumulative CPU, block-I/O and network counters. Average memory is an arithmetic mean of observed samples, not a time-weighted lifetime average. Neither the sampling nor macOS `time` measures the entire Docker VM's resource consumption.

The Go source microbenchmark separately measures the existing `ReadWorkflow` and `PlanEvent` APIs using a two-job workflow. It runs with the installed Go compiler rather than the release binary's compiler; it demonstrates order of magnitude for those specific APIs only. Its CPU/heap profiles cover those microbenchmarks, not full Act execution or Docker. See retained compiler metadata and output. Go module acquisition/build time is excluded from benchmark timings.

Results retain min/max with medians and n. No p95 or confidence interval is inferred from three samples. Failures, if any, must remain in raw records; a failed configuration cannot be ranked as a faster successful run. A later diagnostic digest pilot overlapped Go dependency setup and is explicitly excluded from the final digest comparison; its evidence is retained. The clean digest cohort is run after setup completes. No primary-cohort slow outlier is dropped.

## REA reproduction

Use the official package pinned to 6.8.0. The executed package's evidence manifests preserve its runtime/provider identity. The captured host Node was v24.18.0; the package advertises a newer engine range, so repeat on a supported Node release before treating provider portability as validated. The retained operations succeeded on this host, but this does not validate every REA provider or erase the capture's observation limitations.

```sh
bunx rea-agents@6.8.0 inspect-go-binary /absolute/path/to/act --json
bunx rea-agents@6.8.0 inspect-macho /absolute/path/to/act --json
bunx rea-agents@6.8.0 inspect-binary-layout /absolute/path/to/act --json
bunx rea-agents@6.8.0 capture-process /absolute/path/to/scenario.json --json
bunx rea-agents@6.8.0 compare-process-captures current.json optimized.json --json
```

The saved scenarios contain absolute paths appropriate to this host. Regenerate them with `probes.py rea --rea /path/to/rea.mjs` rather than replaying paths blindly. The CLI fallback is intentional; the research did not modify agent MCP registration or install a native decompiler.

## Reproduce timing and profiles

Run from the repository root. Have Docker running, macOS `/usr/bin/time`, Python 3, Bun, npm, and the exact verified Act binary available. The default extraction path is `.cache/engine-research/bin/act`. Fetch the official v0.2.89 archive and compare its checksum to `scripts/act.ts` before extracting. Fetching other architectures changes the subject and should create a separately named cohort.

```sh
python3 docs/research/act-engine/benchmarks/run.py --prepare-only
python3 docs/research/act-engine/benchmarks/run.py --batch primary
python3 docs/research/act-engine/benchmarks/run.py --cases parallel --modes serial --batch serial
python3 docs/research/act-engine/benchmarks/run.py --cases minimal --modes dryrun --batch dry
python3 docs/research/act-engine/benchmarks/run.py --cases minimal logs --modes current integration --batch app
python3 docs/research/act-engine/benchmarks/probes.py images
python3 docs/research/act-engine/benchmarks/probes.py cache
python3 docs/research/act-engine/benchmarks/probes.py workspace
python3 docs/research/act-engine/benchmarks/probes.py resources
python3 docs/research/act-engine/benchmarks/summarize.py
```

For a fresh study, set `ACT_RESEARCH_WORK` and `ACT_RESEARCH_OUTPUT` to new absolute directories before running the commands; both paths are honored by all Python tools. This keeps caches and results separate from the retained study. Batch names avoid timing-log collisions, but additional probes have fixed filenames, so use fresh directories when rerunning them. Do not overwrite retained evidence. The table generator identifies this study's original primary filenames; adapt its cohort selection for a new batch before comparing. It reads both raw and gzip-compressed JSONL traces.

For the platform-specific test, inspect the relevant manifest for **the same image filesystem**, register it with Docker once, set `RESEARCH_PINNED_IMAGE=repository@sha256:platform-manifest-digest`, then run `--cases minimal typescript parallel --modes current pinned --batch digest-clean`. A digest for this study's image is not a recommendation to pin every future release to an old image.

For source profiling, copy `benchmarks/model_bench_test.go` into the exact Act checkout at `pkg/model/engine_research_test.go` and run there:

```sh
go test ./pkg/model -run '^$' -bench '^BenchmarkResearch' -benchmem -benchtime=500ms -count=3 \
  -cpuprofile=/tmp/act-model-cpu.pprof -memprofile=/tmp/act-model-memory.pprof
go tool pprof -top /tmp/act-model-cpu.pprof
```

Do not run compilation, other builds, image downloads or REA's instrumented captures concurrently with controlled timing cohorts. Go's test binary and profiles stay outside product build paths. The only product-repository writes in this research are documentation and benchmark tooling/fixtures; there are no execution-engine changes.

## Coverage limits

Not measured: native Windows/Linux hosts, CPU-saturated multi-workflow throughput, private registry pulls, OIDC/cloud permissions, all marketplace actions, large real dependency trees, full hosted-runner images, dirty-container reuse, safe pooling, actual GUI paint latency, physical VM disk bytes, complete cancellation/failure matrix, or a custom engine. Source-supported functionality is not labeled runtime-conformant unless this study exercised it. These limits do not prevent an architectural decision about the currently identified product gaps, but they constrain any performance forecast.
