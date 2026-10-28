import { APP_VERSION } from "./src/shared/version";
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Act Dock",
    identifier: "sh.actdock.desktop",
    version: APP_VERSION,
  },
  scripts: {
    preBuild: "scripts/macos/prebuild.ts",
    postPackage: "scripts/package.ts",
  },
  release: { baseUrl: "https://github.com/MohammedIbrahim8887/act-dock/releases/latest/download" },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    // Vite builds to dist/, we copy from there
    copy: {
      [process.platform === "win32" ? "dist-runner/act-dock.exe" : "dist-runner/act-dock"]: process.platform === "win32" ? "act-dock.exe" : "act-dock",
      [process.platform === "win32" ? "dist-runner/act.exe" : "dist-runner/act"]: process.platform === "win32" ? "act.exe" : "act",
      "dist-runner/act-LICENSE.txt": "act-LICENSE.txt",
      [process.platform === "win32" ? "dist-runner/act-dock-helper.exe" : "dist-runner/act-dock-helper"]: process.platform === "win32" ? "act-dock-helper.exe" : "act-dock-helper",
      "dist-runner/helper-LICENSES.txt": "helper-LICENSES.txt",
      "dist-runner/helper-dependencies.jsonl": "helper-dependencies.jsonl",
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    // Ignore Vite output in watch mode — HMR handles view rebuilds separately
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
      createDmg: false,
      icons: "build-support/macos/ActDock.iconset",
    },
    linux: {
      bundleCEF: false,
      icon: "assets/brand/app-icon.png",
    },
    win: {
      bundleCEF: false,
      icon: "assets/brand/app-icon.png",
    },
  },
} satisfies ElectrobunConfig;
