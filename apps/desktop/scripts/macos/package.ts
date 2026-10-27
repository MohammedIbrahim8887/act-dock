import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  copyFile,
} from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { run } from "../build-brand";

const MACH_O = new Set(["feedfacf", "cffaedfe", "cafebabe", "bebafeca"]);
async function isMachO(file: string) {
  const head = new Uint8Array(await Bun.file(file).slice(0, 4).arrayBuffer());
  return MACH_O.has(Buffer.from(head).toString("hex"));
}
/**
 * Electrobun leaves the bundle with only the launcher's linker signature, so nothing seals the
 * bundle and quarantined downloads are reported as "damaged". Ad-hoc sign every nested binary,
 * then the bundle, so Gatekeeper treats it as an unnotarized app with an "Open Anyway" path.
 */
export async function signAppBundle(app: string) {
  await run(["/usr/bin/xattr", "-cr", app]);
  const launcher = join(app, "Contents/MacOS/launcher");
  for (const entry of await readdir(app, { recursive: true, withFileTypes: true })) {
    const file = join(entry.parentPath, entry.name);
    if (!entry.isFile() || file === launcher || !(await isMachO(file))) continue;
    await run(["/usr/bin/codesign", "--force", "--sign", "-", file]);
  }
  await run(["/usr/bin/codesign", "--force", "--sign", "-", app]);
  await run(["/usr/bin/codesign", "--verify", "--deep", "--strict", app]);
  console.log("Signed (ad-hoc):", relative(process.cwd(), app));
}

export function installerNames(channel: string, arch: string) {
  if (!["stable", "canary"].includes(channel))
    throw new Error("Only release channels have installers");
  if (!["arm64", "x64"].includes(arch))
    throw new Error("Unsupported macOS architecture");
  const stem = "ActDock" + (channel === "stable" ? "" : "-canary");
  return {
    archive: `${channel}-macos-${arch}-${stem}.app.tar.zst`,
    installer: `${channel === "stable" ? "" : "canary-"}macos-${arch}-${stem}.dmg`,
  };
}
export async function packageMacInstaller() {
  if (process.platform !== "darwin") return;
  const channel =
    process.env.ELECTROBUN_BUILD_ENV || process.argv[2] || "stable";
  if (channel === "dev") return;
  const arch = process.env.ELECTROBUN_ARCH || process.arch;
  const names = installerNames(channel, arch);
  const artifacts = resolve(process.env.ELECTROBUN_ARTIFACT_DIR || "artifacts");
  const artwork = resolve("build-support/macos", channel);
  if (!(await Bun.file(join(artwork, "background.png")).exists())) {
    throw new Error(
      "Installer artwork is missing. Run bun scripts/build-brand.ts " + channel,
    );
  }
  const archive = join(artifacts, names.archive);
  if (!(await Bun.file(archive).exists()))
    throw new Error("Runnable application archive missing: " + archive);
  await mkdir(".cache/installer", { recursive: true });
  const staging = await mkdtemp(
    resolve(".cache/installer", `${channel}-${arch}-`),
  );
  const temporary = join(
    artifacts,
    names.installer.replace(/\.dmg$/, ".partial.dmg"),
  );
  try {
    await run(["/usr/bin/tar", "-xf", archive, "-C", staging]);
    const apps = (await readdir(staging)).filter((name) =>
      name.endsWith(".app"),
    );
    if (apps.length !== 1)
      throw new Error("Expected exactly one application in the update archive");
    await signAppBundle(join(staging, apps[0]));
    const uv = Bun.which("uv") || "/opt/homebrew/bin/uv";
    await run([
      uv,
      "run",
      "--with",
      "dmgbuild==1.6.7",
      "python",
      "scripts/macos/build-dmg.py",
      "--app",
      join(staging, apps[0]),
      "--artwork",
      artwork,
      "--layout",
      resolve("assets/macos/installer-layout.json"),
      "--icon",
      resolve("build-support/macos/ActDock.icns"),
      "--folder-icon",
      resolve("build-support/macos/Applications.icns"),
      "--channel",
      channel,
      "--output",
      temporary,
    ]);
    await rename(temporary, join(artifacts, names.installer));
    const checksum = createHash("sha256")
      .update(
        new Uint8Array(
          await Bun.file(join(artifacts, names.installer)).arrayBuffer(),
        ),
      )
      .digest("hex");
    await Bun.write(
      join(artifacts, names.installer + ".sha256"),
      checksum + "  " + names.installer + "\n",
    );
    await copyFile(
      join(artwork, "installer-preview.png"),
      join(artifacts, names.installer.replace(/\.dmg$/, "-preview.png")),
    );
    console.log(
      `Branded native installer ready: ${join(artifacts, names.installer)}`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(temporary, { force: true });
  }
}
export default packageMacInstaller;
if (import.meta.main) await packageMacInstaller();
