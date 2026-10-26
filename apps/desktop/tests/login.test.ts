import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loginPlist, setLogin } from "../src/runner/login";
test("login enable/disable writes correct plist and invokes launchctl without changing real login settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-login-"));
  const calls: string[][] = [];
  const env = {
    platform: "darwin",
    path: join(dir, "agents/test.plist"),
    executable: join(dir, "Act & Dock"),
    logFile: join(dir, "runner.log"),
    uid: 501,
    launchctl: async (args: string[]) => {
      calls.push(args);
    },
  };
  try {
    await writeFile(env.executable, "fixture");
    await setLogin(true, env);
    const plist = await readFile(env.path, "utf8");
    expect(plist).toContain("Act &amp; Dock");
    expect(plist).toContain("<string>runner</string><string>start</string>");
    expect(calls[0]).toEqual(["bootstrap", "gui/501", env.path]);
    await setLogin(false, env);
    expect(calls[1]).toEqual(["bootout", "gui/501", env.path]);
    expect(await Bun.file(env.path).exists()).toBe(false);
    expect(loginPlist("/test", "/logs")).not.toContain("KeepAlive");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("failed login installation removes its plist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-login-"));
  try {
    const executable = join(dir, "runner");
    await writeFile(executable, "fixture");
    const path = join(dir, "agent.plist");
    await expect(
      setLogin(true, {
        platform: "darwin",
        path,
        executable,
        logFile: join(dir, "log"),
        uid: 501,
        launchctl: async () => {
          throw new Error("launchctl failed");
        },
      }),
    ).rejects.toThrow("launchctl failed");
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
for (const platform of ['linux','win32']) test(`${platform} login enable/disable uses user startup files`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ad-login-'));
  try{
    const executable=join(dir,'Act % Dock');await writeFile(executable,'fixture');
    const env={platform,path:join(dir,'startup/entry'),executable,logFile:join(dir,'log'),uid:501,launchctl:async()=>{throw new Error('native launchctl must not run')}};
    await setLogin(true,env);const entry=await readFile(env.path,'utf8');
    expect(entry).toContain('runner start');
    expect(entry).toContain(platform==='linux'?'[Desktop Entry]':'@echo off');
    await setLogin(false,env);expect(await Bun.file(env.path).exists()).toBe(false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
