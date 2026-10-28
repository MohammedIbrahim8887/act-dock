#!/usr/bin/env python3
"""Differential fixtures for the isolated upstream patch; never used by production."""
import json,os,pathlib,subprocess,tempfile,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[5]
BIN=ROOT/'.cache/engine-research/bin'
IMAGE='catthehacker/ubuntu@sha256:4f2d5083a9d10d018c1c511eb8665cd480553c11975e78fd903a46daa830768b'
OUT=pathlib.Path(__file__).resolve().parent
WORK=pathlib.Path(tempfile.mkdtemp(prefix='act-readiness-fixtures-'))
(WORK/'.github/workflows').mkdir(parents=True)
subprocess.run(['git','init','-q',str(WORK)],check=True)
def step(command):return {'run':command}
def job(command,**extra):return {'runs-on':'ubuntu-latest','steps':[step(command)],**extra}
CASES={
 'asymmetric':{'fast':job('echo "value=ready" >> "$GITHUB_OUTPUT"; sleep 0.2',outputs={'value':'${{ steps.out.outputs.value }}'}),'slow':job('sleep 2; echo fixture:slow'),'child':job('sleep 2; echo fixture:child',needs='fast')},
 'linear':{'a':job('echo fixture:a'),'b':job('echo fixture:b',needs='a'),'c':job('echo fixture:c',needs='b')},
 'parallel':{'a':job('echo fixture:a'),'b':job('echo fixture:b')},
 'failure':{'bad':job('exit 3'),'skip':job('echo fixture:should-not-run',needs='bad'),'always':job('echo fixture:always',needs='bad',**{'if':'${{ always() }}'})},
 'skip':{'skip':job('echo fixture:should-not-run',**{'if':'${{ false }}'}),'child':job('echo fixture:should-not-run',needs='skip'),'always':job('echo fixture:always',needs='skip',**{'if':'${{ always() }}'})},
 'matrix':{'matrix':job('echo "value=ready" >> "$GITHUB_OUTPUT"; echo fixture:matrix',strategy={'matrix':{'n':[1,2]},'fail-fast':False},outputs={'value':'${{ steps.out.outputs.value }}'}),'child':job('test "${{ needs.matrix.outputs.value }}" = ready; echo fixture:matrix-child',needs='matrix')},
 'reusable':{'root':job('echo fixture:root'),'call':{'needs':'root','uses':'./.github/workflows/reusable.yml'}},
 'post':{'post':{'runs-on':'ubuntu-latest','steps':[{'uses':'actions/checkout@v4'},{'uses':'./.github/actions/post'}]}},
}
for case in ['asymmetric','matrix']:
 key='fast' if case=='asymmetric' else 'matrix'
 CASES[case][key]['steps'][0]['id']='out'
(WORK/'.github/workflows/reusable.yml').write_text(json.dumps({'name':'Reusable fixture','on':'workflow_call','jobs':{'nested':job('echo fixture:reusable')}}))
post=WORK/'.github/actions/post';post.mkdir(parents=True)
(post/'action.yml').write_text(json.dumps({'name':'Post fixture','description':'Local fixture','runs':{'using':'node20','main':'main.js','post':'post.js'}}))
(post/'main.js').write_text("console.log('fixture:main')")
(post/'post.js').write_text("console.log('fixture:post')")
results=[]
for case,jobs in CASES.items():
 for repeat in range(3 if case in ['asymmetric','linear','parallel'] else 1):
  name='Readiness-'+case+'-'+uuid.uuid4().hex[:8]
  workflow=WORK/'.github/workflows/fixture.yml';workflow.write_text(json.dumps({'name':name,'on':'push','jobs':jobs}))
  pair=[]
  for variant in (['official','readiness'] if repeat%2==0 else ['readiness','official']):
   label='act-dock.study='+uuid.uuid4().hex
   args=[str(BIN/('act' if variant=='official' else 'act-readiness')),'push','-W',str(workflow),'--json','--pull=false','--rm','--concurrent-jobs','2','--container-architecture','linux/amd64','-P','ubuntu-latest='+IMAGE,'--container-options','--label '+label]
   started=time.monotonic();p=subprocess.run(args,cwd=WORK,capture_output=True,text=True,timeout=90);elapsed=time.monotonic()-started
   records=[]
   for line in (p.stdout+'\n'+p.stderr).splitlines():
    try:records.append(json.loads(line))
    except ValueError:pass
   markers=sorted(r['msg'].strip() for r in records if r.get('raw_output') and 'fixture:' in str(r.get('msg','')))
   statuses=sorted((str(r.get('jobID')),str(r.get('msg'))) for r in records if str(r.get('msg','')).startswith(('🏁  Job','Skipping job')))
   remaining=subprocess.check_output(['docker','ps','-aq','--filter','label='+label],text=True).strip()
   item={'case':case,'repeat':repeat,'variant':variant,'seconds':elapsed,'exit':p.returncode,'markers':markers,'statuses':statuses,'containersRemain':bool(remaining)}
   results.append(item);pair.append(item)
   (OUT/(case+'-'+str(repeat)+'-'+variant+'.jsonl')).write_text('\n'.join(json.dumps(r,ensure_ascii=False) for r in records)+'\n')
  (OUT/'differential-results.json').write_text(json.dumps({'host':'macOS ARM64; Linux AMD64 Docker emulation','source':'4f411281417e88660bea1c1a1749aa71ae0bd60f','image':IMAGE,'samples':results},indent=2)+'\n')
  a,b=pair
  assert a['exit']==b['exit'],case+' exit changed'
  assert a['markers']==b['markers'],case+' output changed'
  assert a['statuses']==b['statuses'],case+' result changed'
  assert not a['containersRemain'] and not b['containersRemain'],case+' cleanup failed'
  assert a['exit']==(1 if case=='failure' else 0),case+' unexpected result'
  print(json.dumps({'case':case,'repeat':repeat,'equivalent':True}),flush=True)
(OUT/'differential-results.json').write_text(json.dumps({'host':'macOS ARM64; Linux AMD64 Docker emulation','source':'4f411281417e88660bea1c1a1749aa71ae0bd60f','image':IMAGE,'samples':results},indent=2)+'\n')
print('fixtures',WORK)
