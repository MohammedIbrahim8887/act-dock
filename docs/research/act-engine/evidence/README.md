# Evidence inventory

- `runs.jsonl`: every timing trial, full command and measurements. 124 retained trials; 106 included, 18 pilot trials explicitly excluded because part of that cohort overlapped Go dependency/tool setup. All retained timing trials exited successfully. An excluded pilot is never silently substituted for a clean trial.
- `summary.json`: generated grouped measurements used by `../results.md`.
- `phases.json`, `docker-phases.json`: generated Act-log and Docker-event phase observations for included timing trials.
- `<trial>.jsonl.gz`: losslessly compressed upstream Act JSON with monotonic local arrival times.
- `<trial>.docker-events.jsonl.gz`: losslessly compressed Docker container event observations. They can contain a small amount of preceding history; the summarizer filters it.
- `<trial>.time.txt`: macOS `/usr/bin/time -l` output, plus non-JSON diagnostic text where present.
- `host*.json`, `image-identities.json`, `small-image-*.json`: host/Docker/image conditions. Containerd's index/platform accounting is discussed in the methodology.
- `rea-*.json`, `rea-*.stderr.txt`: unmodified REA Evidence, scenarios and CLI progress/diagnostics. Read each record's limitations; successful tool execution is not proof of complete observation. Evidence records contain local absolute paths but no deliberately supplied secret values.
- `rea-post-cancel-containers.txt`: empty result from the separately selected Docker container query after cancellation. REA-owned-process cleanup alone cannot prove Docker cleanup.
- `resource-profile.json`: separate sampled Act RSS and container cgroup counters; not part of the uninstrumented timing cohort.
- `profile-act-output.txt`: corresponding Act output from that sampled run.
- `model-bench.txt`, `model-*.pprof`, `model-*-top.txt`, `source-profile-toolchain.json`: upstream model API microbenchmarks and CPU/allocation profiles, separate from full-workflow profiling.
- `sources.json`: exact source commits, locations and file digests.
- `SHA256SUMS`: file integrity manifest for the evidence directory, excluding this manifest itself. A hash verifies retained bytes, not the truth of a research interpretation.

Read compressed records with `gzip -dc FILE.jsonl.gz`. `benchmarks/summarize.py` reads both compressed and plain records and reproduces the tables. The source executables/checkouts and downloaded images are kept outside versioned documentation, under the ignored `.cache/engine-research` directory and Docker's image store.

The raw traces are about 30 MB uncompressed. Gzip preserves them without making ordinary repository browsing expensive. No custom execution engine, application patch, or production configuration change is included.
