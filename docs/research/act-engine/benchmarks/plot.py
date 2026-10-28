#!/usr/bin/env python3
"""Optional plot; run with uv run --with matplotlib python path/to/plot.py."""
import json
import statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from run import OUT

rows=[json.loads(line) for line in (OUT/'runs.jsonl').read_text().splitlines()]
rows=[r for r in rows if r['name'].startswith('digest-clean-') and not r.get('excluded_reason')]
fig,ax=plt.subplots(figsize=(9,4.8))
cases=[('minimal','Single command'),('parallel','Four parallel jobs'),('typescript','TypeScript build + tests')]
for offset,mode,color,label in [(-.17,'current','#767b85','Current tag + pull policy'),(.17,'pinned','#2463a3','Platform digest + cached policy')]:
    values=[[r['elapsed_s'] for r in rows if r['case']==case and r['mode']==mode] for case,_ in cases]
    centers=[statistics.median(v) for v in values]
    ax.barh([i+offset for i in range(len(cases))],centers,height=.29,color=color,label=label,
        xerr=[[m-min(v) for m,v in zip(centers,values)],[max(v)-m for m,v in zip(centers,values)]],
        capsize=3,error_kw={'linewidth':1,'ecolor':'#20252a'})
ax.set_yticks(range(len(cases)),[label for _,label in cases])
ax.invert_yaxis()
ax.set_xlabel('Workflow wall time (seconds)')
ax.set_title('Image resolution helps without replacing Act',loc='left',fontweight='bold',pad=18)
ax.spines[['top','right','left']].set_visible(False)
ax.grid(axis='x',alpha=.16)
ax.set_axisbelow(True)
ax.set_xlim(left=0)
ax.legend(frameon=False,loc='upper right',fontsize=9)
fig.text(.02,.02,'Act v0.2.89 · same AMD64 image content · Docker Desktop on Apple ARM64\nMedians of 3 runs; error bars show observed min–max, not confidence intervals. Network-dependent build times vary.',fontsize=8,color='#4b5563')
fig.tight_layout(rect=(0,.10,1,1))
fig.savefig(OUT.parent/'image-policy-benchmark.png',dpi=170)
fig.savefig(OUT.parent/'image-policy-benchmark.svg')
