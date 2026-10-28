// Runs the real application scheduler in isolated storage, without changing production code.
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../../../apps/desktop/src/runner/store';
import { Scheduler } from '../../../../apps/desktop/src/runner/process';
const [projectPath, workflow, act] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'act-research-integration-'));
mkdirSync(join(dir, 'logs'));
const store = new Store(dir);
store.saveSettings({...store.settings(), actPath:act, dockerPath:Bun.which('docker')!});
const project = store.putProject({id:crypto.randomUUID(), path:projectPath, name:'Research fixture', defaults:{}});
const scheduler = new Scheduler(store);
// Preserve real log parsing, writes and indexing; relay only masked messages.
const write = scheduler.log.bind(scheduler);
scheduler.log = (id, message, stream) => {
  write(id, message, stream);
  console.log(message);
};
try {
  const run = scheduler.enqueue({projectId:project.id, workflowPath:`.github/workflows/${workflow}.yml`,
    event:'workflow_dispatch', inputs:{}, architecture:'linux/amd64'}, 'cli');
  while (!scheduler.busy) await Bun.sleep(1);
  while (scheduler.busy) await Bun.sleep(5);
  const result = store.run(run.id);
  console.error(JSON.stringify({integration: {state:result.state, records:store.db.query('SELECT count(*) AS n FROM log_index').get()}}));
  if (result.state !== 'succeeded') process.exitCode=1;
} finally {
  store.close();
  rmSync(dir,{recursive:true,force:true});
}
