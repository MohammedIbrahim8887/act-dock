# runner: dispatch jobs when their needs complete

An eligible downstream job currently waits for every unrelated job in the preceding plan stage. For `fast → child` alongside an independent slow job, the child starts only after the slow job finishes. This patch dispatches a job once its known `needs` executors complete, while keeping matrix execution, job conditions, outputs and post cleanup in the existing executor.

Completion is recorded after the executor returns, so dependencies observe completed outputs and cleanup. Jobs are keyed by workflow identity and job ID; the configured concurrent-job limit bounds admitted job executors. Scheduling stops on executor errors/cancellation while awaiting already active executors.

Validation on Act v0.2.89 (`4f411281417e88660bea1c1a1749aa71ae0bd60f`):

- `go test -short ./...` passes.
- `go test -race ./pkg/runner -run '^TestReadiness' -count=20` passes.
- 28 differential Docker executions preserve output markers, job results, exit codes and fixture-container cleanup, covering asymmetric/linear/parallel DAGs, failure and skip with `always()`, matrix outputs, reusable workflows and post actions.
- Three asymmetric trials per version show median makespan 6.814 s → 4.914 s on macOS ARM64 / Linux AMD64 Docker emulation. Three linear and ordinary parallel trials show no median regression; these are exploratory samples rather than a broad performance guarantee.

**Draft / unresolved:** the broad runner race suite reports `TestActionCache` archive-copy races on both the unchanged base and patch. This requires investigation; the patch is not ready for a shipping recommendation. Add broader cancellation/matrix fail-fast/nested reusable fixtures and controlled performance repetitions before acceptance. Act Dock does not bundle this patch.
