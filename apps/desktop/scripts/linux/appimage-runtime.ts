import {
  chmodSync as chmod, copyFileSync as copyFile, cpSync as cp,
  mkdirSync as mkdir, readdirSync as readdir, rmSync as rm,
  readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync,
} from "node:fs";
import { basename, join } from "node:path";

function files(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...files(path));
    else result.push(path);
  }
  return result;
}

// AppImages cannot rely on the distro having WebKitGTK (or a recent glibc).
// Keep the private loader's search path local to the GUI and WebKit children:
// exporting LD_LIBRARY_PATH would also inject our libc into users' CLI tools.
export function bundleAppImageRuntime(appdir: string) {
  const app = join(appdir, "usr/lib/act-dock");
  const runtime = join(app, "runtime");
  const lib = join(runtime, "lib");
  rm(runtime, { recursive: true, force: true });
  mkdir(lib, { recursive: true });
  const multiarch = "/usr/lib/x86_64-linux-gnu";
  for (const name of ["webkit2gtk-4.1", "gio/modules", "gdk-pixbuf-2.0", "gtk-3.0", "dri"]) {
    cp(join(multiarch, name), join(runtime, name), { recursive: true, dereference: true });
  }
  for (const name of ["glib-2.0/schemas", "mime", "icons/Adwaita", "icons/hicolor", "glvnd/egl_vendor.d"]) {
    cp(join("/usr/share", name), join(runtime, "share", name), { recursive: true, dereference: true });
  }
  cp("/usr/share/fonts/truetype/dejavu", join(runtime, "share/fonts/dejavu"), { recursive: true });
  writeFileSync(join(runtime, "fonts.conf"), `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>/usr/share/fonts</dir><dir>/usr/local/share/fonts</dir>
  <dir prefix="xdg">fonts</dir><dir prefix="relative">share/fonts</dir>
  <cachedir prefix="xdg">fontconfig</cachedir>
</fontconfig>
`);
  // This build uses the native WebKit renderer, not the optional CEF helper.
  rm(join(app, "bin/process_helper"), { force: true });
  const queue = [...files(join(app, "bin"))];
  for (const name of ["webkit2gtk-4.1", "gio/modules", "gdk-pixbuf-2.0", "gtk-3.0", "dri"]) queue.push(...files(join(runtime, name)));
  const copied = new Set<string>();
  // Include libraries loaded with dlopen as well as ELF DT_NEEDED entries.
  const dynamicLibraries = ["libnss_dns.so.2", "libnss_files.so.2", "libnss_compat.so.2", "librsvg-2.so.2", "libEGL_mesa.so.0", "libGLESv2.so.2", "libGLX_mesa.so.0"].map(n => join(multiarch, n));
  for (const source of dynamicLibraries) {
    copyFile(source, join(lib, basename(source)));
    copied.add(basename(source));
    queue.push(source);
  }
  for (const name of readdir(multiarch)) {
    if (name.startsWith("libgallium-") && name.endsWith(".so")) {
      copyFile(join(multiarch, name), join(lib, name));
      copied.add(name);
      queue.push(join(lib, name));
    }
  }
  for (const path of queue) {
    const header = Buffer.alloc(4);
    const fd = openSync(path, "r");
    try { readSync(fd, header, 0, 4, 0); } finally { closeSync(fd); }
    if (header.toString("hex") !== "7f454c46") continue;
    const child = Bun.spawnSync(["ldd", path], { stdout: "pipe", stderr: "pipe", env: { ...process.env, LD_LIBRARY_PATH: join(app, "bin") } });
    const output = child.stdout.toString();
    if (output.includes("not found")) throw new Error(`Unresolved AppImage dependency: ${path}\n${output}`);
    for (const match of output.matchAll(/(?:=>\s+)?(\/[^\s()]+)/g)) {
      const source = match[1]!;
      const name = basename(source);
      if (copied.has(name)) continue;
      copied.add(name);
      const target = join(lib, name);
      copyFile(source, target);
    }
  }
  // Release builds of WebKit ignore WEBKIT_EXEC_PATH. Relocate its compiled-in
  // helper directory; AppRun fixes the working directory to the sibling bin/.
  const webkit = join(lib, "libwebkit2gtk-4.1.so.0");
  const bytes = readFileSync(webkit);
  const original = Buffer.from(`${multiarch}/webkit2gtk-4.1\0`);
  const relocated = Buffer.from("../runtime/webkit2gtk-4.1\0");
  const offset = bytes.indexOf(original);
  if (offset < 0) throw new Error("WebKit helper directory missing; review the runtime relocation");
  bytes.fill(0, offset, offset + original.length);
  relocated.copy(bytes, offset);
  writeFileSync(webkit, bytes);
  // Electrobun locates its native wrapper relative to /proc/self/exe.
  // Keep the GUI loader next to Bun so that lookup still points to bin/.
  copyFile(join(lib, "ld-linux-x86-64.so.2"), join(app, "bin/ld-linux-x86-64.so.2"));
  // WebKit spawns these by name; each needs the same private glibc as Bun.
  for (const name of ["WebKitWebProcess", "WebKitNetworkProcess", "WebKitGPUProcess"]) {
    const path = join(runtime, "webkit2gtk-4.1", name);
    copyFile(join(multiarch, "webkit2gtk-4.1", name), `${path}.elf`);
    writeFileSync(path, `#!/bin/sh
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$HERE/../lib/ld-linux-x86-64.so.2" --library-path "$HERE/../lib" --argv0 "$0" "$0.elf" "$@"
`);
    chmod(path, 0o755);
  }
  writeFileSync(join(appdir, "AppRun"), `#!/bin/sh
APPDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export APPDIR
APP="$APPDIR/usr/lib/act-dock"
RUNTIME="$APP/runtime"
export WEBKIT_INJECTED_BUNDLE_PATH="$RUNTIME/webkit2gtk-4.1/injected-bundle"
export __EGL_VENDOR_LIBRARY_DIRS="$RUNTIME/share/glvnd/egl_vendor.d:/usr/share/glvnd/egl_vendor.d"
export LIBGL_DRIVERS_PATH="$RUNTIME/dri"
export FONTCONFIG_FILE="$RUNTIME/fonts.conf"
export GIO_MODULE_DIR="$RUNTIME/gio/modules"
export GSETTINGS_SCHEMA_DIR="$RUNTIME/share/glib-2.0/schemas"
export XDG_DATA_DIRS="$RUNTIME/share:\${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
cd "$APP/bin" || exit 1
exec "$APP/bin/ld-linux-x86-64.so.2" --library-path "$RUNTIME/lib:$APP/bin" --argv0 "$APP/bin/bun" "$APP/bin/bun" "$APP/Resources/main.js" "$@"
`);
  chmod(join(appdir, "AppRun"), 0o755);
  // Include redistribution notices for every distro package supplying the runtime.
  const packages = new Set<string>();
  const resourceOwners = [
    ...["webkit2gtk-4.1", "gio/modules", "gdk-pixbuf-2.0", "gtk-3.0", "dri"].map(name => join(multiarch, name)),
    ...["glib-2.0/schemas", "mime", "icons/Adwaita", "icons/hicolor", "glvnd/egl_vendor.d"].map(name => join("/usr/share", name)),
  ];
  const inventory = Bun.spawnSync(["dpkg-query", "-S", ...[...copied].map(name => join(multiarch, name)), ...resourceOwners], { stdout: "pipe", stderr: "ignore" });
  for (const line of inventory.stdout.toString().trim().split("\n")) {
    if (line.includes(": /")) {
      for (const owner of line.split(": /")[0]!.split(", ")) packages.add(owner.split(":")[0]!);
    }
  }
  packages.add("libwebkit2gtk-4.1-0");
  packages.add("fonts-dejavu-core");
  packages.add("libgl1-mesa-dri");
  cp("/usr/share/common-licenses", join(runtime, "share/common-licenses"), { recursive: true, dereference: true });
  const notices = join(runtime, "licenses");
  mkdir(notices, { recursive: true });
  writeFileSync(join(notices, "WEBKIT-MODIFICATIONS.txt"), "Act Dock relocates the compiled-in WebKit helper directory to ../runtime/webkit2gtk-4.1. No other WebKit code is changed. See apps/desktop/scripts/linux/appimage-runtime.ts in the Act Dock source repository.\n");
  for (const name of packages) {
    const copyright = join("/usr/share/doc", name, "copyright");
    if (existsSync(copyright)) copyFile(copyright, join(notices, `${name}.txt`));
  }
}
