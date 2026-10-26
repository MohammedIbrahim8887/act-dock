import { resolve } from 'node:path';
import { call } from '../apps/desktop/src/runner/client';
const project = await call('add_project',{path:resolve(import.meta.dir,'..')});
const run = await call('run_pipeline',{projectId:project.id,workflowPath:'.github/workflows/ci.yml',event:'workflow_dispatch',inputs:{},architecture:'linux/amd64'});
console.log('Act Dock CI run:',run.id);
const cancel=()=>{void call('cancel_run',{runId:run.id}).catch(()=>{});};
process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
let cursor=0;
try{
  for (;;) {
    const page=await call('get_run_logs',{runId:run.id,cursor,limit:500});
    for(const line of page.entries)console.log(line.message);
    cursor=page.nextCursor;
    const state=await call('get_run',{runId:run.id});
    if(!['queued','running','cancelling'].includes(state.state)){
      console.log('CI result:',state.state,state.diagnostic||'');
      if(state.state!=='succeeded')process.exitCode=1;
      break;
    }
    await Bun.sleep(1500);
  }
}finally{
  process.off('SIGTERM',cancel);process.off('SIGINT',cancel);
  if(process.env.ACT_DOCK_TRANSIENT_PROJECT==='1')await call('remove_project',{projectId:project.id}).catch(()=>{});
}
