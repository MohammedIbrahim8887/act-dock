import { mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";

export async function run(command: string[], cwd = process.cwd()) {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error(`Command failed: ${command[0]}`);
}
export async function buildBrand(
  channel = process.env.ELECTROBUN_BUILD_ENV || "stable",
) {
  if (process.platform !== "darwin") return;
  const output = resolve("build-support/macos", channel);
  await mkdir(output, { recursive: true });
  const { version } = await Bun.file("package.json").json();
  await run([
    "/usr/bin/swift",
    "scripts/macos/render-assets.swift",
    "--output",
    output,
    "--mark",
    resolve("assets/brand/pipeline-loop.png"),
    "--app-icon",
    resolve("assets/brand/app-icon.png"),
    "--version",
    version,
    "--channel",
    channel,
    "--layout",
    resolve("assets/macos/installer-layout.json"),
  ]);
  async function iconset(source: string, name: string) {
    const path = resolve("build-support/macos", name + ".iconset");
    await mkdir(path, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const file = join(
          path,
          `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
        );
        await run([
          "/usr/bin/sips",
          "-s",
          "format",
          "png",
          "-z",
          String(size * scale),
          String(size * scale),
          source,
          "--out",
          file,
        ]);
      }
    }
    await run([
      "/usr/bin/iconutil",
      "-c",
      "icns",
      path,
      "-o",
      resolve("build-support/macos", name + ".icns"),
    ]);
  }
  await iconset(resolve("assets/brand/app-icon.png"), "ActDock");
  await iconset(join(output, "applications-folder.png"), "Applications");
  await copyFile(
    "assets/brand/approved-pipeline-loop.png",
    join(output, "approved-logo.png"),
  );
  return output;
}
if (import.meta.main) await buildBrand(process.argv[2]);
