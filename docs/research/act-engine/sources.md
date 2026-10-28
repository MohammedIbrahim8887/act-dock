# Source evidence index

Every link is pinned to the commit inspected. File digests are in [sources.json](evidence/sources.json).
Binary-to-source identity is independently recorded by REA in [rea-go-binary.json](evidence/rea-go-binary.json).

| Component | File and symbol | Location |
| --- | --- | --- |
| act | `cmd/root.go` · `func args()` | [line 155](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/cmd/root.go#L155) |
| act | `cmd/root.go` · `func newRunCommand(` | [line 391](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/cmd/root.go#L391) |
| act | `cmd/root.go` · `input.forcePull` | [line 85](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/cmd/root.go#L85) |
| act | `cmd/root.go` · `cacheHandler` | [line 682](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/cmd/root.go#L682) |
| act | `cmd/platforms.go` · `func (i *Input) newPlatforms(` | [line 7](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/cmd/platforms.go#L7) |
| act | `pkg/model/workflow.go` · `func ReadWorkflow(` | [line 714](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/model/workflow.go#L714) |
| act | `pkg/model/workflow.go` · `func (w *Workflow) UnmarshalYAML(` | [line 71](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/model/workflow.go#L71) |
| act | `pkg/model/workflow.go` · `func (j *Job) GetMatrixes(` | [line 401](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/model/workflow.go#L401) |
| act | `pkg/model/planner.go` · `func NewWorkflowPlanner(` | [line 59](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/model/planner.go#L59) |
| act | `pkg/model/planner.go` · `func createStages(` | [line 343](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/model/planner.go#L343) |
| act | `pkg/runner/runner.go` · `func (config *Config) GetConcurrentJobs(` | [line 67](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/runner.go#L67) |
| act | `pkg/runner/runner.go` · `func (runner *runnerImpl) NewPlanExecutor(` | [line 122](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/runner.go#L122) |
| act | `pkg/common/executor.go` · `func NewParallelExecutor(` | [line 95](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/common/executor.go#L95) |
| act | `pkg/common/executor.go` · `func (e Executor) Finally(` | [line 225](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/common/executor.go#L225) |
| act | `pkg/runner/run_context.go` · `func (rc *RunContext) GetBindsAndMounts(` | [line 127](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/run_context.go#L127) |
| act | `pkg/runner/run_context.go` · `func (rc *RunContext) startJobContainer(` | [line 255](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/run_context.go#L255) |
| act | `pkg/runner/run_context.go` · `func (rc *RunContext) GetNodeToolFullPath(` | [line 454](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/run_context.go#L454) |
| act | `pkg/runner/run_context.go` · `func (rc *RunContext) platformImage(` | [line 775](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/run_context.go#L775) |
| act | `pkg/runner/job_executor.go` · `func newJobExecutor(` | [line 23](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/job_executor.go#L23) |
| act | `pkg/runner/job_executor.go` · `func useStepLogger(` | [line 200](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/job_executor.go#L200) |
| act | `pkg/runner/step.go` · `func runStepExecutor(` | [line 94](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/step.go#L94) |
| act | `pkg/runner/step.go` · `func monitorJobCancellation(` | [line 217](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/step.go#L217) |
| act | `pkg/runner/step.go` · `func evaluateStepTimeout(` | [line 235](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/step.go#L235) |
| act | `pkg/runner/step_run.go` · `func (sr *stepRun) main(` | [line 32](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/step_run.go#L32) |
| act | `pkg/runner/step_run.go` · `func (sr *stepRun) setupShellCommandExecutor(` | [line 72](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/step_run.go#L72) |
| act | `pkg/runner/step_factory.go` · `func (sf *stepFactoryImpl) newStep(` | [line 15](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/step_factory.go#L15) |
| act | `pkg/runner/action.go` · `func runActionImpl(` | [line 153](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/action.go#L153) |
| act | `pkg/runner/action.go` · `func execAsDocker(` | [line 248](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/action.go#L248) |
| act | `pkg/runner/action.go` · `func maybeCopyToActionDir(` | [line 119](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/action.go#L119) |
| act | `pkg/runner/step_action_remote.go` · `func (sar *stepActionRemote) prepareActionExecutor(` | [line 40](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/step_action_remote.go#L40) |
| act | `pkg/runner/step_action_remote.go` · `func (sar *stepActionRemote) main(` | [line 155](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/step_action_remote.go#L155) |
| act | `pkg/runner/reusable_workflow.go` · `func newLocalReusableWorkflowExecutor(` | [line 19](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/reusable_workflow.go#L19) |
| act | `pkg/runner/reusable_workflow.go` · `func newRemoteReusableWorkflowExecutor(` | [line 23](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/reusable_workflow.go#L23) |
| act | `pkg/runner/reusable_workflow.go` · `func newReusableWorkflowExecutor(` | [line 116](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/reusable_workflow.go#L116) |
| act | `pkg/runner/expression.go` · `func (rc *RunContext) NewExpressionEvaluator(` | [line 30](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/expression.go#L30) |
| act | `pkg/exprparser/interpreter.go` · `func (impl *interperterImpl) Evaluate(` | [line 81](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/exprparser/interpreter.go#L81) |
| act | `pkg/exprparser/interpreter.go` · `func (impl *interperterImpl) evaluateNode(` | [line 120](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/exprparser/interpreter.go#L120) |
| act | `pkg/exprparser/functions.go` · `func (impl *interperterImpl) hashFiles(` | [line 183](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/exprparser/functions.go#L183) |
| act | `pkg/common/git/git.go` · `func NewGitCloneExecutor(` | [line 300](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/common/git/git.go#L300) |
| act | `pkg/common/git/git.go` · `func CloneIfRequired(` | [line 232](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/common/git/git.go#L232) |
| act | `pkg/runner/action_cache.go` · `func (c GoGitActionCache) Fetch(` | [line 34](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/action_cache.go#L34) |
| act | `pkg/runner/action_cache.go` · `func (c GoGitActionCache) GetTarArchive(` | [line 130](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/action_cache.go#L130) |
| act | `pkg/container/docker_run.go` · `func GetDockerClient(` | [line 218](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/container/docker_run.go#L218) |
| act | `pkg/container/docker_run.go` · `func (cr *containerReference) exec(` | [line 550](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/container/docker_run.go#L550) |
| act | `pkg/container/docker_run.go` · `func (cr *containerReference) copyDir(` | [line 738](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/container/docker_run.go#L738) |
| act | `pkg/container/docker_pull.go` · `func NewDockerPullExecutor(` | [line 21](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/container/docker_pull.go#L21) |
| act | `pkg/container/docker_pull.go` · `func getImagePullOptions(` | [line 78](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/container/docker_pull.go#L78) |
| act | `pkg/container/docker_auth.go` · `func LoadDockerAuthConfig(` | [line 15](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/container/docker_auth.go#L15) |
| act | `pkg/runner/logger.go` · `func withStepLogger(` | [line 135](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/logger.go#L135) |
| act | `pkg/runner/logger.go` · `func valueMasker(` | [line 146](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/logger.go#L146) |
| act | `pkg/runner/command.go` · `func (rc *RunContext) commandHandler(` | [line 36](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/command.go#L36) |
| act | `pkg/artifactcache/handler.go` · `func StartHandler(` | [line 48](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/artifactcache/handler.go#L48) |
| act | `LICENSE` · `MIT License` | [line 1](https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/LICENSE#L1) |
| app | `apps/desktop/src/runner/process.ts` · `export async function health(` | [line 32](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/process.ts#L32) |
| app | `apps/desktop/src/runner/process.ts` · `  log(` | [line 126](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/process.ts#L126) |
| app | `apps/desktop/src/runner/process.ts` · `  async pump(` | [line 283](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/process.ts#L283) |
| app | `apps/desktop/src/runner/process.ts` · `  async execute(` | [line 300](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/process.ts#L300) |
| app | `apps/desktop/src/runner/process.ts` · `  cancel(` | [line 230](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/process.ts#L230) |
| app | `apps/desktop/src/runner/process.ts` · `  async cleanup(` | [line 260](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/process.ts#L260) |
| app | `apps/desktop/src/runner/workflows.ts` · `export async function discover(` | [line 21](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/workflows.ts#L21) |
| app | `apps/desktop/src/runner/workflows.ts` · `export async function validateRun(` | [line 117](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/workflows.ts#L117) |
| app | `apps/desktop/src/runner/workflows.ts` · `export const RUNNER_IMAGE` | [line 189](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/workflows.ts#L189) |
| app | `apps/desktop/src/runner/workflows.ts` · `export function commandArgs(` | [line 190](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/workflows.ts#L190) |
| app | `apps/desktop/src/runner/store.ts` · `  constructor(` | [line 17](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/store.ts#L17) |
| app | `apps/desktop/src/runner/store.ts` · `  prune(` | [line 214](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/store.ts#L214) |
| app | `apps/desktop/src/runner/transport.ts` · `export function localRequest(` | [line 6](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/transport.ts#L6) |
| app | `apps/desktop/src/runner/transport.ts` · `export async function listenLocal(` | [line 26](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/runner/transport.ts#L26) |
| app | `apps/desktop/src/mainview/components/run-detail.tsx` · `    async function poll()` | [line 57](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/mainview/components/run-detail.tsx#L57) |
| app | `apps/desktop/src/mainview/App.tsx` · `    const id = setInterval(() => void refresh()` | [line 207](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/mainview/App.tsx#L207) |
| app | `apps/desktop/src/shared/contracts.ts` · `export const runRequestSchema` | [line 2](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/shared/contracts.ts#L2) |
| app | `apps/desktop/src/shared/run-progress.ts` · `export function advanceProgress(` | [line 30](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/apps/desktop/src/shared/run-progress.ts#L30) |
| app | `scripts/act.ts` · `export const ACT_VERSION` | [line 6](https://github.com/MohammedIbrahim8887/act-dock/blob/b71aad89437f89becee13aa8f2ed714eb418e1b9/scripts/act.ts#L6) |
| runner | `src/Runner.Worker/JobRunner.cs` · `public async Task<TaskResult> RunAsync(` | [line 36](https://github.com/actions/runner/blob/4197182ef8f39c719f66038c1bc9b34cd9e9ac9a/src/Runner.Worker/JobRunner.cs#L36) |
| runner | `src/Runner.Worker/StepsRunner.cs` · `public sealed class StepsRunner` | [line 36](https://github.com/actions/runner/blob/4197182ef8f39c719f66038c1bc9b34cd9e9ac9a/src/Runner.Worker/StepsRunner.cs#L36) |
| runner | `src/Runner.Worker/ActionManager.cs` · `public sealed class ActionManager` | [line 50](https://github.com/actions/runner/blob/4197182ef8f39c719f66038c1bc9b34cd9e9ac9a/src/Runner.Worker/ActionManager.cs#L50) |
| runner | `src/Runner.Worker/ContainerOperationProvider.cs` · `public class ContainerOperationProvider` | [line 28](https://github.com/actions/runner/blob/4197182ef8f39c719f66038c1bc9b34cd9e9ac9a/src/Runner.Worker/ContainerOperationProvider.cs#L28) |
| runner | `src/Runner.Worker/Container/DockerCommandManager.cs` · `public class DockerCommandManager` | [line 40](https://github.com/actions/runner/blob/4197182ef8f39c719f66038c1bc9b34cd9e9ac9a/src/Runner.Worker/Container/DockerCommandManager.cs#L40) |
| runner | `LICENSE` · `The MIT License` | [line 1](https://github.com/actions/runner/blob/4197182ef8f39c719f66038c1bc9b34cd9e9ac9a/LICENSE#L1) |
