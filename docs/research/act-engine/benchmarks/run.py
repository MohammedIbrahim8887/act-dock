#!/usr/bin/env python3
"""Research harness, not a CI engine. Requires macOS, Python 3, Docker, Bun, act.

Writes generated projects/state under .cache, and raw measurements under evidence.
Never removes pre-existing images, volumes, caches, or application state.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import selectors
import signal
import subprocess
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
WORK = Path(os.environ.get('ACT_RESEARCH_WORK', str(ROOT / '.cache/engine-research/bench'))).resolve()
OUT = Path(os.environ.get('ACT_RESEARCH_OUTPUT', str(HERE.parent / 'evidence'))).resolve()
IMAGE = 'catthehacker/ubuntu:act-latest'
SMALL = 'node:22-bookworm-slim'
SETUP_NODE = '49933ea5288caeca8642d1e84afbd3f7d6820020'

def shell(args, **kw):
    return subprocess.check_output(args, text=True, **kw).strip()

def workflow(name, steps, jobs=None):
    return json.dumps({'name': 'research-' + name, 'on': 'workflow_dispatch', 'jobs': jobs or {
        'bench': {'runs-on': 'ubuntu-latest', 'steps': steps}}}, indent=2) + '\n'

def prepare():
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    project = WORK / 'project'
    (project / '.github/workflows').mkdir(parents=True, exist_ok=True)
    (WORK / 'home').mkdir(exist_ok=True)
    (project / '.gitignore').write_text('node_modules/\ndist/\n')
    (project / 'package.json').write_text(json.dumps({
        'name': 'act-engine-research-fixture', 'private': True, 'version': '1.0.0',
        'dependencies': {'lodash': '4.17.21'}, 'devDependencies': {'typescript': '5.9.3'},
        'scripts': {'build': 'tsc', 'test': 'node --test test.cjs'}}))
    (project / 'tsconfig.json').write_text(json.dumps({'compilerOptions': {
        'target': 'ES2020', 'module': 'commonjs', 'strict': True, 'outDir': 'dist'}, 'include': ['src.ts']}))
    (project / 'src.ts').write_text('export const sum = (a: number, b: number): number => a + b;\n')
    (project / 'test.cjs').write_text("const {test}=require('node:test');const assert=require('node:assert/strict');const {sum}=require('./dist/src');test('sum',()=>assert.equal(sum(2,3),5));\n")
    # Lock generation is setup work, not counted as a workflow measurement.
    if not (project / 'package-lock.json').exists():
        subprocess.run(['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=project, check=True)
    subprocess.run(['git', 'init', '-q', str(project)], check=True)
    subprocess.run(['git', '-C', str(project), 'config', 'user.name', 'Research fixture'], check=True)
    subprocess.run(['git', '-C', str(project), 'config', 'user.email', 'fixture@example.invalid'], check=True)
    subprocess.run(['git', '-C', str(project), 'remote', 'add', 'origin', 'https://github.com/example/act-engine-research'], capture_output=True)
    minimal = [{'name': 'probe', 'run': 'echo BENCH_FIRST; true'}]
    checkout = {'uses': 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'}
    install = {'name': 'install', 'run': 'echo BENCH_FIRST; npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/bench-npm-cache'}
    specs = {
        'minimal': minimal,
        'node': [checkout, install, {'run': 'node -e "if(require(\'lodash\').sum([1,2,3])!==6)process.exit(1)"'}],
        'typescript': [checkout, install, {'run': 'npm run build'}, {'run': 'npm test'}],
        'multistep': [{'name': 'step-' + str(i), 'run': 'echo ' + ('BENCH_FIRST' if i == 0 else 'step-' + str(i))} for i in range(12)],
        'external': [{'uses': 'actions/setup-node@' + SETUP_NODE}, {'run': 'echo BENCH_FIRST; node --version'}],
        'logs': [{'run': "echo BENCH_FIRST; seq 1 10000"}],
        'cancel': [{'run': 'echo BENCH_FIRST; sleep 60'}],
    }
    for name, steps in specs.items():
        (project / '.github/workflows' / (name + '.yml')).write_text(workflow(name, steps))
    jobs = {f'job{i}': {'runs-on': 'ubuntu-latest', 'steps': [{'run': 'echo BENCH_FIRST; sleep 2'}]} for i in range(4)}
    (project / '.github/workflows/parallel.yml').write_text(workflow('parallel', [], jobs))
    # A stage-barrier probe: C needs short A, but not long B. Does C wait for B?
    jobs = { 'a': {'runs-on':'ubuntu-latest', 'steps':[{'run':'echo BENCH_FIRST; sleep 1'}]},
        'b': {'runs-on':'ubuntu-latest', 'steps':[{'run':'echo BENCH_FIRST; sleep 4'}]},
        'c': {'runs-on':'ubuntu-latest', 'needs':'a', 'steps':[{'run':'echo BENCH_FIRST; true'}]} }
    (project / '.github/workflows/dag.yml').write_text(workflow('dag', [], jobs))
    subprocess.run(['git', '-C', str(project), 'add', '.'], check=True)
    subprocess.run(['git', '-C', str(project), 'commit', '-qm', 'Research fixture'], capture_output=True)
    return project

def environment():
    # No ambient GitHub tokens, HOME .actrc, .env, or .secrets in the fixture.
    context = json.loads(shell(['docker', 'context', 'inspect']))[0]
    return {'PATH': os.environ['PATH'], 'HOME': str(WORK / 'home'), 'TERM': 'dumb',
        'DOCKER_HOST': os.environ.get('DOCKER_HOST', context['Endpoints']['docker']['Host']),
        'DOCKER_CONFIG': str(Path.home() / '.docker'),
        'XDG_CONFIG_HOME': str(WORK / 'home/config'), 'XDG_CACHE_HOME': str(WORK / 'home/cache')}

def act_args(act, project, case, image, extra, cache):
    args = [str(act), 'workflow_dispatch', '-W', str(project / '.github/workflows' / (case + '.yml')),
        '--json', '--rm', '--insecure-secrets=false', '--container-architecture', 'linux/amd64',
        '--container-daemon-socket=-', '--action-cache-path', str(cache),
        '--cache-server-path', str(WORK / 'workflow-cache')]
    for label in ['ubuntu-latest', 'ubuntu-20.04', 'ubuntu-22.04', 'ubuntu-24.04']:
        args += ['-P', label + '=' + image]
    return args + extra

def run_case(name, args, project, env, metadata):
    # time -l accounts target process and reaped children, not Docker daemon/VM.
    start_wall = time.time()
    start = time.perf_counter()
    eventfile = OUT / (name + '.docker-events.jsonl')
    ef = eventfile.open('w')
    events = subprocess.Popen(['docker', 'events', '--since', str(int(start_wall)), '--format', '{{json .}}',
        '--filter', 'type=container'], stdout=ef, stderr=subprocess.DEVNULL)
    proc = subprocess.Popen(['/usr/bin/time', '-l'] + args, cwd=project, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    selector = selectors.DefaultSelector()
    for stream in [proc.stdout, proc.stderr]:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)
    buffers = {proc.stdout: b'', proc.stderr: b''}
    records, err = [], []
    first_step = first_output = None
    timed_out = False
    escalation = None
    logpath = OUT / (name + '.jsonl')
    with logpath.open('w') as log:
        while selector.get_map():
            if time.perf_counter() - start > 240 and not timed_out:
                timed_out = True
                escalation = time.perf_counter() + 10
                try: os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError: pass
            if escalation is not None and time.perf_counter() > escalation:
                try: os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                escalation = None
            for key, _ in selector.select(timeout=.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                buffers[key.fileobj] += chunk
                while b'\n' in buffers[key.fileobj]:
                    raw, buffers[key.fileobj] = buffers[key.fileobj].split(b'\n', 1)
                    text = raw.decode(errors='replace').rstrip('\r')
                    elapsed = time.perf_counter() - start
                    try:
                        record = json.loads(text)
                        msg = str(record.get('msg', record.get('message', '')))
                        if first_step is None and 'Run Main ' in msg:
                            first_step = elapsed
                        if first_output is None and 'BENCH_FIRST' in msg and record.get('raw_output'):
                            first_output = elapsed
                        records.append(record)
                        log.write(json.dumps({'elapsed_s': elapsed, 'record': record}) + '\n')
                    except (json.JSONDecodeError, AttributeError):
                        err.append(text)
    rc = proc.wait()
    elapsed = time.perf_counter() - start
    events.terminate()
    events.wait()
    ef.close()
    stderr = '\n'.join(err)
    (OUT / (name + '.time.txt')).write_text(stderr + '\n')
    realmatch = re.search(r'([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys', stderr)
    def number(label):
        match = re.search(r'^\s*(\d+)\s+' + re.escape(label), stderr, re.M)
        return int(match[1]) if match else None
    selector.close()
    row = {'name': name, **metadata, 'exit_code': rc, 'timed_out': timed_out, 'elapsed_s': elapsed,
        'first_main_step_s': first_step, 'first_marker_s': first_output,
        'user_s': float(realmatch[2]) if realmatch else None,
        'system_s': float(realmatch[3]) if realmatch else None,
        'max_rss_bytes': number('maximum resident set size'),
        'disk_read_bytes': number('bytes read'), 'disk_written_bytes': number('bytes written'),
        'block_inputs': number('block input operations'), 'block_outputs': number('block output operations'),
        'records': len(records), 'started_at': datetime.datetime.fromtimestamp(start_wall, datetime.timezone.utc).isoformat(),
        'command': args}
    with (OUT / 'runs.jsonl').open('a') as f:
        f.write(json.dumps(row) + '\n')
    print(json.dumps({k:v for k,v in row.items() if k != 'command'}), flush=True)
    return row

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--act', type=Path, default=ROOT / '.cache/engine-research/bin/act')
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--cases', nargs='+', default=['minimal','node','typescript','multistep','external','parallel','dag'])
    parser.add_argument('--modes', nargs='+', default=['current','optimized'])
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--batch', default=datetime.datetime.now(datetime.timezone.utc).strftime('%H%M%S'))
    options = parser.parse_args()
    if 'pinned' in options.modes and not os.environ.get('RESEARCH_PINNED_IMAGE'):
        parser.error('pinned mode requires RESEARCH_PINNED_IMAGE for the same platform-specific image')
    project = prepare()
    if options.prepare_only:
        print(project)
        return
    env = environment()
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    host = {'captured_at':stamp, 'app_commit':shell(['git','rev-parse','HEAD']),
        'act_version':shell([str(options.act),'--version']),
        'act_sha256':hashlib.sha256(options.act.read_bytes()).hexdigest(),
        'docker_info':json.loads(shell(['docker','info','--format','{{json .}}'])),
        'images':json.loads(shell(['docker','image','inspect',IMAGE])),
        'hardware':shell(['sysctl','-n','hw.model','hw.memsize','hw.ncpu']),
        'os':shell(['sw_vers']), 'platform':'linux/amd64 under Docker Desktop on Apple arm64; Rosetta enabled',
        'repeats':options.repeats, 'cases':options.cases, 'modes':options.modes}
    # Docker info has machine paths/names but never config or registry credentials.
    (OUT / ('host-' + stamp.replace(':','-') + '.json')).write_text(json.dumps(host,indent=2)+'\n')
    if not (OUT / 'host.json').exists():
        (OUT / 'host.json').write_text(json.dumps(host,indent=2)+'\n')
    for case in options.cases:
        for rep in range(options.repeats):
            # Alternate order to reduce consistent time/order bias.
            modes = options.modes if rep % 2 == 0 else list(reversed(options.modes))
            for mode in modes:
                image = SMALL if mode == 'small' else os.environ.get('RESEARCH_PINNED_IMAGE', IMAGE) if mode == 'pinned' else IMAGE
                extra = [] if mode in ['current','integration','native-current'] else ['--pull=false','--action-offline-mode']
                if mode == 'serial': extra += ['--concurrent-jobs','1']
                if mode == 'bind': extra += ['--bind']
                if mode == 'newcache': extra += ['--use-new-action-cache']
                cache = WORK / ('actions-' + mode)
                args = act_args(options.act, project, case, image, extra, cache)
                if mode.startswith('native-'):
                    idx = args.index('--container-architecture')
                    del args[idx:idx+2]
                if mode == 'dryrun': args += ['--dryrun']
                if mode == 'integration':
                    args = ['bun', str(HERE / 'integration.ts'), str(project), case, str(options.act)]
                name = f'{options.batch}-{case}-{mode}-{rep+1}'
                run_case(name,args,project,env,{'case':case,'mode':mode,'repeat':rep+1,'image':image,
                    'action_cache_preexisting':cache.exists()})

if __name__ == '__main__':
    main()
