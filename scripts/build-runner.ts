import { mkdir } from "node:fs/promises";
await mkdir("dist-runner", { recursive: true });
const child = Bun.spawn(
  [
    "bun",
    "build",
    "--compile",
    "src/cli/index.ts",
    "--outfile",
    "dist-runner/act-dock",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await child.exited) !== 0) process.exit(1);
