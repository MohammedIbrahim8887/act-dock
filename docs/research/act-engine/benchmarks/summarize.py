#!/usr/bin/env python3
"""Derive tables from retained runs. No hand-entered benchmark values."""
import collections
import datetime
import gzip
import json
from pathlib import Path
import statistics
from run import OUT

def read_rows(path):
    actual=path if path.exists() else Path(str(path)+'.gz')
    with (gzip.open(actual,'rt') if actual.suffix=='.gz' else actual.open()) as f:
        return [json.loads(line) for line in f if line.strip()]

def table(rows, key):
    groups=collections.defaultdict(list)
    for row in rows: groups[key(row)].append(row)
    lines=['| Workload / mode | n | Total seconds: median [min–max] | First main step: median s | Peak RSS: median MiB | CPU user+sys: median s |',
        '| --- | ---: | ---: | ---: | ---: | ---: |']
    result=[]
    for name,group in sorted(groups.items()):
        times=[r['elapsed_s'] for r in group]
        ttfs=[r['first_main_step_s'] for r in group if r['first_main_step_s'] is not None]
        rss=[r['max_rss_bytes']/1024**2 for r in group if r['max_rss_bytes'] is not None]
        cpu=[r['user_s']+r['system_s'] for r in group if r['user_s'] is not None and r['system_s'] is not None]
        item={'group':name,'n':len(group),'median_s':statistics.median(times),'min_s':min(times),'max_s':max(times),
            'first_main_median_s':statistics.median(ttfs) if ttfs else None,
            'rss_median_mib':statistics.median(rss) if rss else None,
            'cpu_median_s':statistics.median(cpu) if cpu else None}
        result.append(item)
        fmt=lambda x: f'{x:.3f}' if x is not None else 'unavailable'
        lines.append(f"| {name} | {len(group)} | {item['median_s']:.3f} [{min(times):.3f}–{max(times):.3f}] | {fmt(item['first_main_median_s'])} | {fmt(item['rss_median_mib'])} | {fmt(item['cpu_median_s'])} |")
    return lines,result

def main():
    all_rows=read_rows(OUT/'runs.jsonl')
    rows=[r for r in all_rows if not r.get('excluded_reason')]
    sections=[]
    # This explicitly keeps the paired primary cohort separate from later probes.
    sections.append(('Primary paired cohort', [r for r in rows if r['mode'] in ['current','optimized'] and
        r['case']!='external' and r['name']==f"{r['case']}-{r['mode']}-{r['repeat']}"],lambda r:r['case']+' / '+r['mode']))
    sections.append(('Platform-specific digest versus mutable tag, clean later paired cohort', [r for r in rows if r['name'].startswith('digest-clean-')],lambda r:r['case']+' / '+r['mode']))
    sections.append(('Native ARM64 / auto architecture, later paired cohort', [r for r in rows if r['name'].startswith('native-')],lambda r:r['case']+' / '+r['mode']))
    sections.append(('External action: cold and warm caches', [r for r in rows if r['case']=='external'],
        lambda r:r['mode']+' / '+('warm action cache' if r.get('action_cache_preexisting') else 'cold action cache')))
    sections.append(('Additional controlled probes', [r for r in rows if r['mode'] in ['serial','dryrun','small','npmcache','copy','bind']],
        lambda r:r['case']+' / '+r['mode']+(' / cold image' if r.get('image_cold') else ' / cached image') if r['mode']=='small' else
            r['case']+' / '+r['mode']+(' / cold npm cache' if r.get('npm_cache_cold') else ' / warm npm cache') if r['mode']=='npmcache' else r['case']+' / '+r['mode']))
    sections.append(('Actual scheduler versus direct subprocess, separate cohort', [r for r in rows if r['mode'] in ['current','integration'] and r['case'] in ['minimal','logs'] and
        r['name'][0].isdigit()],lambda r:r['case']+' / '+r['mode']))
    lines=['# Measured results','','Generated from [runs.jsonl](evidence/runs.jsonl) by `benchmarks/summarize.py`.',
        'RSS and CPU cover the timed host command, not Docker containers or the Docker VM. Integration RSS is the Bun scheduler command/process accounting, not the desktop GUI.',
        'Ranges are observed min/max, not confidence intervals. Small n and uncontrolled host/network noise limit generalization.',
        f"Included {len(rows)} timing trials: {sum(r['exit_code']==0 for r in rows)} exited successfully. Also retained {len(all_rows)-len(rows)} explicitly excluded pilot trials; see each record's excluded_reason.",'']
    summaries=[]
    for title,group,key in sections:
        lines+=['## '+title,'']
        t,s=table(group,key)
        lines+=t+['']
        summaries.append({'section':title,'groups':s})
    # Derive source-independent phase observations from uninstrumented logs/events.
    phases=[]
    for row in rows:
        log=read_rows(OUT/(row['name']+'.jsonl'))
        jobs=collections.defaultdict(list)
        for entry in log:
            d=entry['record']
            jobs[d.get('jobID','global')].append(entry)
        for job,entries in jobs.items():
            pull=next((e['elapsed_s'] for e in entries if 'docker pull image=' in e['record'].get('msg','')),None)
            create=next((e['elapsed_s'] for e in entries if 'docker create image=' in e['record'].get('msg','')),None)
            main=next((e['elapsed_s'] for e in entries if 'Run Main ' in e['record'].get('msg','')),None)
            success=[e['elapsed_s'] for e in entries if 'Success - Main ' in e['record'].get('msg','')]
            if main is not None:
                phases.append({'run':row['name'],'job':job,'first_main_s':main,
                    'pull_log_to_create_log_s':create-pull if pull is not None and create is not None else None,
                    'last_main_success_s':max(success) if success else None,
                    'summed_main_execution_s':sum(e['record'].get('executionTime',0)/1e9 for e in entries if e['record'].get('stage')=='Main')})
    (OUT/'phases.json').write_text(json.dumps(phases,indent=2)+'\n')
    # Docker lifecycle/exec observations. Do not include subsecond history from the preceding trial.
    lifecycle=[]
    for row in rows:
        start=datetime.datetime.fromisoformat(row['started_at']).timestamp()
        events=read_rows(OUT/(row['name']+'.docker-events.jsonl'))
        containers=collections.defaultdict(list)
        for event in events:
            if event.get('timeNano',0)/1e9 < start: continue
            if not event.get('Actor',{}).get('Attributes',{}).get('name','').startswith('act-research-'): continue
            containers[event['Actor']['ID']].append(event)
        for cid,group in containers.items():
            def first(action):
                return next((e['timeNano']/1e9 for e in group if e['Action']==action),None)
            create,started,destroy=first('create'),first('start'),first('destroy')
            execs={}
            for event in group:
                attrs=event['Actor']['Attributes']
                if attrs.get('execID'):
                    obj=execs.setdefault(attrs['execID'],{})
                    if event['Action'].startswith('exec_start: '):
                        obj.update(command=event['Action'][12:],start=event['timeNano']/1e9)
                    elif event['Action']=='exec_die': obj['end']=event['timeNano']/1e9
            lifecycle.append({'run':row['name'],'container_id':cid,'create_offset_s':create-start if create else None,
                'create_to_start_s':started-create if create and started else None,
                'start_to_destroy_s':destroy-started if started and destroy else None,
                'execs':[{'command':v.get('command'), 'duration_s':v['end']-v['start']} for v in execs.values() if 'start'in v and 'end'in v]})
    (OUT/'docker-phases.json').write_text(json.dumps(lifecycle,indent=2)+'\n')
    (OUT/'summary.json').write_text(json.dumps(summaries,indent=2)+'\n')
    (OUT.parent/'results.md').write_text('\n'.join(lines)+'\n')
    print(len(rows),'trials;',len(phases),'job timelines;',len(lifecycle),'container timelines')

if __name__=='__main__': main()
