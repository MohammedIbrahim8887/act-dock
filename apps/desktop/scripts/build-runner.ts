import { mkdir } from "node:fs/promises";
import { bundleAct, hostActTarget } from "../../../scripts/act";
await mkdir("dist-runner", { recursive: true });
const child = Bun.spawn(
  [
    "bun",
    "build",
    "--compile",
    "src/cli/index.ts",
    "--outfile",
    process.platform === "win32" ? "dist-runner/act-dock.exe" : "dist-runner/act-dock",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await child.exited) !== 0) process.exit(1);
await bundleAct(hostActTarget(), "dist-runner");
