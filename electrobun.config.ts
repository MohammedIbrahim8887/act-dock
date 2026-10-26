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
    postPackage: "scripts/macos/package.ts",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    // Vite builds to dist/, we copy from there
    copy: {
      "dist-runner/act-dock": "act-dock",
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
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
