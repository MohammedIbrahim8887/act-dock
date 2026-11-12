/** Offline GUI smoke test on a bare Ubuntu 22.04 host, without WebKitGTK.
 * Run: bun scripts/verify-appimage.ts [path/to/ActDock.AppImage or AppDir]
 * Xvfb and the window probe run in a separate build container so they do not
 * accidentally supply dependencies to the application under test.
 */
import { copyFile, cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

async function command(args: string[], check = true) {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (check && code) throw new Error(`${args[0]} failed (${code}):\n${stdout}${stderr}`);
  return { stdout, stderr, code };
}

const artifact = resolve(process.argv[2] || "artifacts/ActDock-x86_64.AppImage");
const stage = await mkdtemp(join(tmpdir(), "act-dock-appimage-"));
const id = `act-dock-smoke-${process.pid}`;
const display = `${id}-display`;
const app = `${id}-app`;
const volume = `${id}-x11`;
try {
  if ((await stat(artifact)).isDirectory()) {
    await cp(artifact, join(stage, "app"), { recursive: true });
  } else {
    const header = Buffer.from(await Bun.file(artifact).slice(0, 64).arrayBuffer());
    if (header.subarray(0, 6).toString("hex") !== "7f454c460201") throw new Error("Expected an ELF64 AppImage");
    const offset = Number(header.readBigUInt64LE(40)) + header.readUInt16LE(58) * header.readUInt16LE(60);
    await command(["docker", "run", "--rm", "--platform", "linux/amd64", "--network", "none", "-v", `${artifact}:/image:ro`, "-v", `${stage}:/stage`, "act-dock-build:0.2.0", "unsquashfs", "-quiet", "-no-progress", "-o", String(offset), "-d", "/stage/app", "/image"]);
  }
  await command(["docker", "volume", "create", volume]);
  const probe = `import { dlopen, FFIType as T, ptr, CString } from "bun:ffi";
const { symbols: x } = dlopen("libX11.so.6", {
 XOpenDisplay: {args:[T.cstring],returns:T.ptr}, XDefaultRootWindow:{args:[T.ptr],returns:T.u64},
 XQueryTree:{args:[T.ptr,T.u64,T.ptr,T.ptr,T.ptr,T.ptr],returns:T.i32},
 XFetchName:{args:[T.ptr,T.u64,T.ptr],returns:T.i32}, XFree:{args:[T.ptr],returns:T.i32},
 XGetWindowAttributes:{args:[T.ptr,T.u64,T.ptr],returns:T.i32},
});
const d=x.XOpenDisplay(ptr(Buffer.from(":99\\0"))); if(!d) process.exit(1); if(process.argv.includes("--ready")) process.exit(0);
const root=new BigUint64Array(1),parent=new BigUint64Array(1),children=new BigUint64Array(1),count=new Uint32Array(1);
x.XQueryTree(d,x.XDefaultRootWindow(d),ptr(root),ptr(parent),ptr(children),ptr(count));
const {toArrayBuffer}=await import("bun:ffi");
if(!children[0]) process.exit(1);
const ids=new BigUint64Array(toArrayBuffer(Number(children[0]),0,count[0]*8));
let found=false;
for(const id of ids){ const name=new BigUint64Array(1), attrs=Buffer.alloc(160); x.XFetchName(d,id,ptr(name));
 if(name[0]){const title=new CString(Number(name[0])).toString(); x.XFree(Number(name[0]));
 if(title.includes("Act Dock") && x.XGetWindowAttributes(d,id,ptr(attrs)) && attrs.readInt32LE(92)===2 && attrs.readInt32LE(8)>100 && attrs.readInt32LE(12)>100){ console.log(title); found=true; }} }
x.XFree(Number(children[0])); process.exit(found?0:1);
`;
  await Bun.write(join(stage, "probe.ts"), probe);
  await command(["docker", "run", "-d", "--name", display, "--platform", "linux/amd64", "--network", "none", "-v", `${volume}:/tmp/.X11-unix`, "-v", `${stage}:/stage`, "act-dock-build:0.2.0", "Xvfb", ":99", "-screen", "0", "1600x1000x24", "-ac", "-nolisten", "tcp"]);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await command(["docker", "exec", display, "bun", "/stage/probe.ts", "--ready"], false)).code) { ready = true; break; }
    await Bun.sleep(250);
  }
  if (!ready) throw new Error("Test display did not start");
  await command(["docker", "run", "-d", "--name", app, "--platform", "linux/amd64", "--network", "none", "-v", `${volume}:/tmp/.X11-unix:ro`, "-v", `${join(stage, "app")}:/app:ro`, "-e", "DISPLAY=:99", "--user", "1000:1000", "-e", "HOME=/tmp", "ubuntu:22.04", "/app/AppRun"]);
  const deadline = Date.now() + 45_000;
  let shown = false;
  while (Date.now() < deadline) {
    const state = await command(["docker", "inspect", "--format", "{{.State.Running}}", app]);
    if (state.stdout.trim() !== "true") break;
    const result = await command(["docker", "exec", display, "bun", "/stage/probe.ts"], false);
    if (!result.code) { shown = true; break; }
    await Bun.sleep(500);
  }
  const logs = await command(["docker", "logs", app], false);
  if (!shown) throw new Error(`FAIL: AppImage did not show a mapped Act Dock window offline on bare Ubuntu 22.04\n${logs.stdout}${logs.stderr}`);
  await Bun.sleep(5000);
  const state = await command(["docker", "inspect", "--format", "{{.State.Running}}", app]);
  if (state.stdout.trim() !== "true") throw new Error("AppImage exited after showing its window");
  let processes = await command(["docker", "top", app, "-eo", "pid,args"]);
  for (let attempt = 0; attempt < 60 && !processes.stdout.includes("WebKitWebProcess"); attempt++) {
    await Bun.sleep(500);
    processes = await command(["docker", "top", app, "-eo", "pid,args"]);
  }
  const finalLogs = await command(["docker", "logs", app], false);
  console.log(finalLogs.stdout + finalLogs.stderr);
  if (/panic\(|error while loading shared libraries|Could not create default EGL|invalid ELF|Couldn't open/.test(finalLogs.stdout + finalLogs.stderr)) throw new Error("Desktop runtime reported a fatal error");
  if (!processes.stdout.includes("act-dock serve")) throw new Error("Background runner did not start");
  await command(["docker", "exec", display, "import", "-display", ":99", "-window", "root", "/stage/screenshot.png"]);
  await mkdir(resolve(".cache"), { recursive: true });
  await copyFile(join(stage, "screenshot.png"), resolve(".cache/appimage-smoke.png"));
  const colors = await command(["docker", "exec", display, "identify", "-format", "%k", "/stage/screenshot.png"]);
  if (Number(colors.stdout) < 32) throw new Error("Window is blank; UI did not render");
  if (!processes.stdout.includes("WebKitWebProcess")) throw new Error("WebKit content process is missing");
  console.log("PASS: AppImage shows a window offline on bare Ubuntu 22.04 without installed GTK/WebKitGTK.");
} finally {
  await command(["docker", "rm", "-f", app, display], false);
  await command(["docker", "volume", "rm", volume], false);
  await rm(stage, { recursive: true, force: true });
}
