import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { Store } from "../src/runner/store";
import { resolveExecution } from "../src/runner/execution-config";
import { runRequestSchema, settingsSchema } from "../src/shared/contracts";
import { readEvents } from "../src/runner/events";

test("execution layers merge label maps without exposing unrecognized secret flags", () => {
  const dir = mkdtempSync(join(tmpdir(),"ad-config-"));
  try {
    const config = join(dir,".actrc");
    writeFileSync(config,"-P ubuntu-22.04=local/ubuntu:22\n--pull=false\n--secret TOKEN=never-return-this\n");
    const project = {id:"p",name:"p",path:dir,defaults:{execution:{workspaceMode:"bind" as const}}};
    const snapshot = resolveExecution(project,runRequestSchema.parse({projectId:"p",workflowPath:"ci",event:"push",execution:{runnerMappings:{"ubuntu-latest":"local/custom:tag"}}}),settingsSchema.parse({executionDefaults:{imagePullPolicy:"always"}}),[config]);
    expect(snapshot.options.runnerMappings["ubuntu-22.04"]).toBe("local/ubuntu:22");
    expect(snapshot.options.runnerMappings["ubuntu-latest"]).toBe("local/custom:tag");
    expect(snapshot.options.imagePullPolicy).toBe("if-missing");
    expect(snapshot.options.workspaceMode).toBe("bind");
    expect(JSON.stringify(snapshot)).not.toContain("never-return-this");
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("v2 migration backs up a live database and retains metadata; events resume without a subscribe race", async () => {
  const dir = mkdtempSync(join(tmpdir(),"ad-migration-"));
  mkdirSync(join(dir,"logs"));
  const database = new Database(join(dir,"act-dock.sqlite"));
  database.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,data TEXT NOT NULL); CREATE TABLE runs(id TEXT PRIMARY KEY,created TEXT NOT NULL,data TEXT NOT NULL,idem TEXT UNIQUE); CREATE TABLE settings(id INTEGER PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE log_index(run_id TEXT,cursor INTEGER,offset INTEGER,length INTEGER,PRIMARY KEY(run_id,cursor)); PRAGMA user_version=2;");
  database.query("INSERT INTO projects VALUES (?,?,?)").run("p",dir,JSON.stringify({id:"p",path:dir,name:"Preserved",defaults:{}}));
  database.close();
  const store = new Store(dir);
  try {
    expect(store.projects()[0].name).toBe("Preserved");
    expect((store.db.query("PRAGMA user_version").get() as {user_version:number}).user_version).toBe(3);
    expect((await Array.fromAsync(new Bun.Glob("*.v2.*.sqlite").scan(dir))).length).toBe(1);
    const waiting = readEvents(store,{cursor:0,limit:10,waitMs:1000});
    store.emit("queue","r",{reason:"resource-budget"});
    const page = await waiting;
    expect(page.events[0].data.reason).toBe("resource-budget");
    expect((await readEvents(store,{cursor:page.nextCursor,limit:10,waitMs:0})).events).toEqual([]);
  } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
});
