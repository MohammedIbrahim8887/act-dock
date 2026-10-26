import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binary } from "../src/runner/process";
import { platformPaths } from "../src/runner/paths";
let dir: string, bundled: string, custom: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ad-act-"));
  bundled = join(dir, "bundled-act");
  custom = join(dir, "custom-act");
  for (const file of [bundled, custom]) {
    await writeFile(file, "#!/bin/sh\n");
    await chmod(file, 0o700);
  }
});
afterAll(() => rm(dir, { recursive: true, force: true }));
test("uses the act engine shipped with the app before anything on PATH", () => {
  expect(binary("act", "", bundled)).toBe(bundled);
});
test("a path chosen in Settings overrides the bundled engine, without silent fallback", () => {
  expect(binary("act", custom, bundled)).toBe(custom);
  expect(binary("act", join(dir, "missing"), bundled)).toBeUndefined();
});
test("falls back to the system act when the bundled engine is absent", () => {
  const system = Bun.which("act");
  expect(binary("act", "", join(dir, "missing"))).toBe(system ?? undefined);
});
test("installs the bundled engine beside the runner on every platform", () => {
  expect(platformPaths("darwin", "/u", {}).act).toBe("/u/Library/Application Support/Act Dock/bin/act");
  expect(platformPaths("linux", "/u", {}).act).toBe("/u/.local/share/act-dock/bin/act");
  expect(platformPaths("win32", "/u", { LOCALAPPDATA: "/l" }).act.endsWith("act.exe")).toBe(true);
});
