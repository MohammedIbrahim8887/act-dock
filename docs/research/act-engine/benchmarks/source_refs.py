#!/usr/bin/env python3
"""Capture exact source anchors and digests used by this investigation."""
import hashlib
import json
from pathlib import Path
import subprocess
from run import ROOT, OUT

SOURCES = {
    'act': ('nektos/act', ROOT/'.cache/engine-research/act', {
        'cmd/root.go':['func args()', 'func newRunCommand(', 'input.forcePull', 'cacheHandler'],
        'cmd/platforms.go':['func (i *Input) newPlatforms('],
        'pkg/model/workflow.go':['func ReadWorkflow(', 'func (w *Workflow) UnmarshalYAML(', 'func (j *Job) GetMatrixes('],
        'pkg/model/planner.go':['func NewWorkflowPlanner(', 'func createStages('],
        'pkg/runner/runner.go':['func (config *Config) GetConcurrentJobs(', 'func (runner *runnerImpl) NewPlanExecutor('],
        'pkg/common/executor.go':['func NewParallelExecutor(', 'func (e Executor) Finally('],
        'pkg/runner/run_context.go':['func (rc *RunContext) GetBindsAndMounts(', 'func (rc *RunContext) startJobContainer(', 'func (rc *RunContext) GetNodeToolFullPath(', 'func (rc *RunContext) platformImage('],
        'pkg/runner/job_executor.go':['func newJobExecutor(', 'func useStepLogger('],
        'pkg/runner/step.go':['func runStepExecutor(', 'func monitorJobCancellation(', 'func evaluateStepTimeout('],
        'pkg/runner/step_run.go':['func (sr *stepRun) main(', 'func (sr *stepRun) setupShellCommandExecutor('],
        'pkg/runner/step_factory.go':['func (sf *stepFactoryImpl) newStep('],
        'pkg/runner/action.go':['func runActionImpl(', 'func execAsDocker(', 'func maybeCopyToActionDir('],
        'pkg/runner/step_action_remote.go':['func (sar *stepActionRemote) prepareActionExecutor(', 'func (sar *stepActionRemote) main('],
        'pkg/runner/reusable_workflow.go':['func newLocalReusableWorkflowExecutor(', 'func newRemoteReusableWorkflowExecutor(', 'func newReusableWorkflowExecutor('],
        'pkg/runner/expression.go':['func (rc *RunContext) NewExpressionEvaluator('],
        'pkg/exprparser/interpreter.go':['func (impl *interperterImpl) Evaluate(', 'func (impl *interperterImpl) evaluateNode('],
        'pkg/exprparser/functions.go':['func (impl *interperterImpl) hashFiles('],
        'pkg/common/git/git.go':['func NewGitCloneExecutor(', 'func CloneIfRequired('],
        'pkg/runner/action_cache.go':['func (c GoGitActionCache) Fetch(', 'func (c GoGitActionCache) GetTarArchive('],
        'pkg/container/docker_run.go':['func GetDockerClient(', 'func (cr *containerReference) exec(', 'func (cr *containerReference) copyDir('],
        'pkg/container/docker_pull.go':['func NewDockerPullExecutor(', 'func getImagePullOptions('],
        'pkg/container/docker_auth.go':['func LoadDockerAuthConfig('],
        'pkg/runner/logger.go':['func withStepLogger(', 'func valueMasker('],
        'pkg/runner/command.go':['func (rc *RunContext) commandHandler('],
        'pkg/artifactcache/handler.go':['func StartHandler('],
        'LICENSE':['MIT License'],
    }),
    'app': ('MohammedIbrahim8887/act-dock', ROOT, {
        'apps/desktop/src/runner/process.ts':['export async function health(', '  log(', '  async pump(', '  async execute(', '  cancel(', '  async cleanup('],
        'apps/desktop/src/runner/workflows.ts':['export async function discover(', 'export async function validateRun(', 'export const RUNNER_IMAGE', 'export function commandArgs('],
        'apps/desktop/src/runner/store.ts':['  constructor(', '  prune('],
        'apps/desktop/src/runner/transport.ts':['export function localRequest(', 'export async function listenLocal('],
        'apps/desktop/src/mainview/components/run-detail.tsx':['    async function poll()'],
        'apps/desktop/src/mainview/App.tsx':['    const id = setInterval(() => void refresh()'],
        'apps/desktop/src/shared/contracts.ts':['export const runRequestSchema'],
        'apps/desktop/src/shared/run-progress.ts':['export function advanceProgress('],
        'scripts/act.ts':['export const ACT_VERSION'],
    }),
    'runner': ('actions/runner', ROOT/'.cache/engine-research/runner', {
        'src/Runner.Worker/JobRunner.cs':['public async Task<TaskResult> RunAsync('],
        'src/Runner.Worker/StepsRunner.cs':['public sealed class StepsRunner'],
        'src/Runner.Worker/ActionManager.cs':['public sealed class ActionManager'],
        'src/Runner.Worker/ContainerOperationProvider.cs':['public class ContainerOperationProvider'],
        'src/Runner.Worker/Container/DockerCommandManager.cs':['public class DockerCommandManager'],
        'LICENSE':['The MIT License'],
    }),
}

def main():
    records=[]
    for group,(repo,base,paths) in SOURCES.items():
        commit=subprocess.check_output(['git','-C',str(base),'rev-parse','HEAD'],text=True).strip()
        for path,symbols in paths.items():
            text=(base/path).read_text()
            for symbol in symbols:
                matches=[i for i,line in enumerate(text.splitlines(),1) if symbol in line]
                if not matches: raise RuntimeError(f'Missing source anchor {path}: {symbol}')
                records.append({'group':group,'commit':commit,'path':path,'symbol':symbol,'line':matches[0],
                    'file_sha256':hashlib.sha256(text.encode()).hexdigest(),
                    'url':f'https://github.com/{repo}/blob/{commit}/{path}#L{matches[0]}'})
    (OUT/'sources.json').write_text(json.dumps(records,indent=2)+'\n')
    lines=['# Source evidence index','','Every link is pinned to the commit inspected. File digests are in [sources.json](evidence/sources.json).',
        'Binary-to-source identity is independently recorded by REA in [rea-go-binary.json](evidence/rea-go-binary.json).','',
        '| Component | File and symbol | Location |','| --- | --- | --- |']
    for row in records:
        lines.append(f"| {row['group']} | `{row['path']}` · `{row['symbol']}` | [line {row['line']}]({row['url']}) |")
    (OUT.parent/'sources.md').write_text('\n'.join(lines)+'\n')
    print(len(records),'source anchors')

if __name__=='__main__': main()
