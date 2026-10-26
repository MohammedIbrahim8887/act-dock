// @hutch cli=0.28.2 cottontail=0.7.3
export default {
  scripts: {
    install: ["bun", "install", "--frozen-lockfile"],
    start:
      "hutch electrobun prepare && bun scripts/build-runner.ts && bun run build:ui && hutch electrobun dev",
    dev: "hutch electrobun prepare && bun scripts/build-runner.ts && bun run build:ui && hutch electrobun dev --watch",
    "dev:hmr": [
      "hutch",
      "pm",
      "exec",
      "--",
      "concurrently",
      "hutch run hmr",
      "hutch run start",
    ],
    hmr: "hutch electrobun prepare && hutch pm exec -- vite --port 5173",
    build:
      "hutch electrobun prepare && bun scripts/build-runner.ts && bun run build:ui && hutch electrobun build --env=stable",
    "build:canary":
      "hutch electrobun prepare && bun scripts/build-runner.ts && bun run build:ui && hutch electrobun build --env=canary",
  },
  electrobun: {
    version: "2.0.5",
  },
};
