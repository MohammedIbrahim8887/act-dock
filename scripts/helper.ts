import { mkdir, chmod, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ActTarget } from "./act";
const root = resolve(import.meta.dir, "..");
/** Native vault APIs require cgo on macOS; Windows/Linux helpers cross-compile without cgo. */
export async function bundleHelper(target: ActTarget, destination: string) {
  const [host, arch] = target.split("-");
  if (host === "darwin" && process.platform !== "darwin")
    throw new Error("Build the macOS helper on macOS");
  const name = host === "win32" ? "act-dock-helper.exe" : "act-dock-helper";
  await mkdir(destination, { recursive: true });
  const path = resolve(destination, name);
  const env = {
    ...process.env,
    GOOS: host === "win32" ? "windows" : host,
    GOARCH: arch === "x64" ? "amd64" : arch,
    CGO_ENABLED: host === "darwin" ? "1" : "0",
    GOTOOLCHAIN: "go1.25.0",
  };
  const child = Bun.spawn(
    [
      "go",
      "build",
      "-mod=readonly",
      "-buildvcs=false",
      "-trimpath",
      "-ldflags=-s -w",
      "-o",
      path,
      ".",
    ],
    {
      cwd: join(root, "tools/act-dock-helper"),
      env,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0)
    throw new Error(`Native helper build failed: ${target}`);
  if (host !== "win32") await chmod(path, 0o755);
  await Bun.write(
    path + ".sha256",
    createHash("sha256")
      .update(await Bun.file(path).bytes())
      .digest("hex") +
      "  " +
      name +
      "\n",
  );
  const modules = Bun.spawn(
    ["go", "list", "-mod=readonly", "-m", "-json", "all"],
    {
      cwd: join(root, "tools/act-dock-helper"),
      env,
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const text = await new Response(modules.stdout).text();
  if ((await modules.exited) !== 0)
    throw new Error("Unable to record helper dependency inventory");
  const modulesParsed = text
    .trim()
    .split(/\n(?=\{)/)
    .map((row) => JSON.parse(row));
  await Bun.write(
    join(destination, "helper-dependencies.jsonl"),
    modulesParsed
      .map(({ Path, Version, Sum, GoModSum, GoVersion }) =>
        JSON.stringify({ Path, Version, Sum, GoModSum, GoVersion }),
      )
      .join("\n") + "\n",
  );
  const inventory = Bun.spawn(
    [
      "go",
      "list",
      "-mod=readonly",
      "-deps",
      "-f",
      "{{with .Module}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}",
      ".",
    ],
    {
      cwd: join(root, "tools/act-dock-helper"),
      env,
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const entries = (await new Response(inventory.stdout).text())
    .trim()
    .split("\n");
  if ((await inventory.exited) !== 0)
    throw new Error("Helper license inventory failed");
  const goRoot = Bun.spawn(["go", "env", "GOROOT"], {
    env,
    stdout: "pipe",
    stderr: "inherit",
  });
  const goRootPath = (await new Response(goRoot.stdout).text()).trim();
  if ((await goRoot.exited) !== 0)
    throw new Error("Go runtime license path unavailable");
  const notices: string[] = [
    "Go runtime — BSD license\n" +
      (await readFile(join(goRootPath, "LICENSE"), "utf8")),
    "Act Dock native helper dependency notices. Source versions are locked in tools/act-dock-helper/go.sum.",
  ];
  for (const row of new Set(entries.filter(Boolean))) {
    const [module, version, directory] = row.split("\t");
    if (module === "act-dock/helper") continue;
    const licenses = (await readdir(directory)).filter((name) =>
      /^(LICEN[CS]E|COPYING|NOTICE)(\.|$)/i.test(name),
    );
    if (!licenses.length) throw new Error(`Missing license notice: ${module}`);
    for (const name of licenses)
      notices.push(
        `${module} ${version} — ${name}\n${await readFile(join(directory, name), "utf8")}`,
      );
  }
  await Bun.write(
    join(destination, "helper-LICENSES.txt"),
    notices.join("\n\n"),
  );
  return path;
}
if (import.meta.main)
  await bundleHelper(process.argv[2] as ActTarget, process.argv[3]);
