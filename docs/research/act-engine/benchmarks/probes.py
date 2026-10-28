#!/usr/bin/env python3
"""Additional bounded experiments. No application or engine implementation changes."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid
from run import ROOT, WORK, OUT, IMAGE, SMALL, prepare, environment, act_args, run_case, shell, workflow

def invoke_rea(rea, command, *args, name, env):
    with (OUT / (name + '.json')).open('w') as out, (OUT / (name + '.stderr.txt')).open('w') as err:
        return subprocess.run(['node', str(rea), command, *map(str,args), '--json'],
            cwd=ROOT, env=env, stdout=out, stderr=err, timeout=150).returncode

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('phase', choices=['rea','images','cache','workspace','resources'])
    parser.add_argument('--rea', type=Path)
    options=parser.parse_args()
    project=prepare()
    env=environment()
    act=ROOT / '.cache/engine-research/bin/act'
    if options.phase=='rea':
        if not options.rea: parser.error('--rea is required')
        for mode,case,extra in [('current','minimal',[]),('optimized','minimal',['--pull=false','--action-offline-mode']),
                ('cancel','cancel',['--pull=false','--action-offline-mode'])]:
            args=act_args(act,project,case,IMAGE,extra,WORK/'actions-rea')
            scenario={'executable':str(act),'arguments':args[1:], 'working_directory':str(project),
                'environment':env, 'timeout_ms':20000,'idle_timeout_ms':18000,'settle_ms':200,
                'events':[{'type':'signal','at_ms':4000,'signal':'SIGINT'}] if case=='cancel' else []}
            path=OUT/('rea-'+mode+'-scenario.json')
            path.write_text(json.dumps(scenario,indent=2)+'\n')
            rc=invoke_rea(options.rea,'capture-process',path,name='rea-'+mode+'-capture',env=env)
            print('REA',mode,'status',rc,flush=True)
        rc=invoke_rea(options.rea,'compare-process-captures',OUT/'rea-current-capture.json',
            OUT/'rea-optimized-capture.json',name='rea-process-comparison',env=env)
        print('REA compare',rc,flush=True)
        (OUT/'rea-post-cancel-containers.txt').write_text(shell(['docker','ps','-a','--filter','name=act-research-cancel','--format','{{json .}}'])+'\n')
    elif options.phase=='images':
        exists=subprocess.run(['docker','image','inspect',SMALL],capture_output=True).returncode==0
        (OUT/'small-image-before.json').write_text(json.dumps({'image':SMALL,'present':exists})+'\n')
        for rep in range(4):
            args=act_args(act,project,'minimal',SMALL,['--pull=false'],WORK/'actions-small')
            run_case('small-image-'+str(rep+1),args,project,env,{'case':'minimal','mode':'small','repeat':rep+1,
                'image':SMALL, 'image_cold':not exists and rep==0})
        (OUT/'small-image-inspect.json').write_text(shell(['docker','image','inspect',SMALL])+'\n')
    elif options.phase=='cache':
        volume='act-research-npm-'+uuid.uuid4().hex[:8]
        subprocess.run(['docker','volume','create',volume],check=True,capture_output=True)
        try:
            for rep in range(3):
                args=act_args(act,project,'node',IMAGE,['--pull=false','--action-offline-mode','--env','npm_config_prefer_offline=true',
                    '--container-options',f'--mount type=volume,src={volume},dst=/tmp/bench-npm-cache'],WORK/'actions-npmcache')
                run_case('npm-cache-'+str(rep+1),args,project,env,{'case':'node','mode':'npmcache','repeat':rep+1,
                    'image':IMAGE,'npm_cache_cold':rep==0})
        finally:
            subprocess.run(['docker','volume','rm',volume],check=True,capture_output=True)
        for rep in range(3):
            args=act_args(act,project,'external',IMAGE,['--pull=false','--use-new-action-cache'],WORK/'actions-shallow')
            run_case('external-newcache-'+str(rep+1),args,project,env,{'case':'external','mode':'newcache',
                'repeat':rep+1,'image':IMAGE,'action_cache_preexisting':rep>0})
    elif options.phase=='workspace':
        large=WORK/'large-project'
        if not large.exists(): shutil.copytree(project,large,ignore=shutil.ignore_patterns('node_modules','dist'))
        data=large/'data'
        data.mkdir(exist_ok=True)
        for i in range(2048):
            path=data/(str(i)+'.dat')
            if not path.exists(): path.write_bytes(b'x'*32768)
        steps=[{'uses':'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'}, {'run':'echo BENCH_FIRST; test -f data/2047.dat'}]
        (large/'.github/workflows/workspace.yml').write_text(workflow('workspace',steps))
        for rep in range(3):
            for mode in (['copy','bind'] if rep%2==0 else ['bind','copy']):
                extra=['--pull=false','--action-offline-mode']+(['--bind'] if mode=='bind' else [])
                args=act_args(act,large,'workspace',IMAGE,extra,WORK/'actions-workspace')
                run_case('workspace-'+mode+'-'+str(rep+1),args,large,env,{'case':'workspace','mode':mode,
                    'repeat':rep+1,'image':IMAGE,'data_bytes':2048*32768,'data_files':2048})
    elif options.phase=='resources':
        # Separate sampling run: do not mix its timing with the uninstrumented cohort.
        import http.client
        import socket
        class UnixHTTP(http.client.HTTPConnection):
            def connect(self):
                self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
                self.sock.settimeout(5)
                self.sock.connect(env['DOCKER_HOST'].removeprefix('unix://'))
        def get(path):
            conn=UnixHTTP('localhost',timeout=5)
            try:
                conn.request('GET',path)
                res=conn.getresponse()
                if res.status!=200: return None
                return json.loads(res.read())
            finally: conn.close()
        label='act-research-profile='+uuid.uuid4().hex[:8]
        # A long enough real workload for repeated RSS/cgroup sampling.
        args=act_args(act,project,'typescript',IMAGE,['--pull=false','--action-offline-mode',
            '--container-options','--label '+label],WORK/'actions-profile')
        samples=[]
        started=time.perf_counter()
        with (OUT/'profile-act-output.txt').open('w') as f:
            proc=subprocess.Popen(args,cwd=project,env=env,stdout=f,stderr=f)
            while proc.poll() is None:
                rss=subprocess.run(['ps','-o','rss=','-p',str(proc.pid)],capture_output=True,text=True).stdout.strip()
                containers=get('/containers/json') or []
                matched=[c for c in containers if c.get('Labels',{}).get('act-research-profile')==label.split('=')[1]]
                for c in matched:
                    stats=get('/containers/'+c['Id']+'/stats?stream=false&one-shot=true')
                    if stats:
                        samples.append({'elapsed_s':time.perf_counter()-started, 'act_rss_bytes':int(rss)*1024 if rss else None,
                            'container_id':c['Id'], 'memory':stats.get('memory_stats'), 'cpu':stats.get('cpu_stats'),
                            'blockio':stats.get('blkio_stats'),'networks':stats.get('networks'),
                            'pids':stats.get('pids_stats')})
                if time.perf_counter()-started>180:
                    proc.terminate();proc.wait(timeout=20);raise TimeoutError('profile')
                time.sleep(.2)
            result={'exit_code':proc.returncode,'elapsed_s':time.perf_counter()-started,'samples':samples,
                'caveat':'Separately instrumented workload. RSS samples are act only; Docker counters are container cgroup, not entire VM. Includes cache in memory. Misses pre-first-sample and post-last-sample work.'}
        (OUT/'resource-profile.json').write_text(json.dumps(result,indent=2)+'\n')
        print('profile',result['exit_code'],len(samples),'samples',flush=True)

if __name__=='__main__': main()
