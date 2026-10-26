import { expect, test } from "bun:test";
import { installerNames } from "../scripts/macos/package";
import layout from "../assets/macos/installer-layout.json";

test("macOS installer names preserve stable and canary channels", () => {
  expect(installerNames("stable", "arm64")).toEqual({
    archive: "stable-macos-arm64-ActDock.app.tar.zst",
    installer: "macos-arm64-ActDock.dmg",
  });
  expect(installerNames("canary", "x64")).toEqual({
    archive: "canary-macos-x64-ActDock-canary.app.tar.zst",
    installer: "canary-macos-x64-ActDock-canary.dmg",
  });
  expect(() => installerNames("../../bad", "arm64")).toThrow();
  expect(() => installerNames("stable", "unknown")).toThrow();
});
test("Finder icons and their labels fit the install surface without covering instructions", () => {
  for (const [x, y] of [layout.appPosition, layout.applicationsPosition]) {
    expect(x - layout.iconSize / 2).toBeGreaterThan(0);
    expect(x + layout.iconSize / 2).toBeLessThan(layout.width);
    expect(y - layout.iconSize / 2).toBeGreaterThan(layout.heroHeight);
    expect(y + layout.iconSize / 2 + layout.textSize + 16).toBeLessThan(
      layout.footerTop,
    );
  }
  expect(
    layout.applicationsPosition[0] - layout.appPosition[0],
  ).toBeGreaterThan(layout.iconSize * 2);
});
