import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "../apps/desktop/node_modules/yaml";

const root = resolve(import.meta.dir, "..");
const skillRoot = resolve(root, "skills/act-dock");
const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");
const command = "npx skills add MohammedIbrahim8887/act-dock --skill act-dock";

test("public skill has portable discovery metadata and bundled references", () => {
  const frontmatter = skill.match(/^---\n([\s\S]+?)\n---\n/);
  expect(frontmatter).not.toBeNull();
  const metadata = parse(frontmatter![1]!);
  expect(metadata.name).toBe("act-dock");
  expect(metadata.description.length).toBeGreaterThan(40);
  expect(metadata.license).toBe("MIT");
  expect(existsSync(resolve(skillRoot, "LICENSE"))).toBe(true);
  for (const match of skill.matchAll(/\]\((references\/[^)]+)\)/g)) {
    expect(existsSync(resolve(skillRoot, match[1]!))).toBe(true);
  }
  expect(skill).toContain("installing it does not install Act Dock or register an MCP server");
  expect(skill).toContain("Enqueueing is not completion");
});

test("desktop, website, docs and README advertise the same installable skill", () => {
  for (const file of [
    "README.md",
    "apps/web/src/routes/index.tsx",
    "apps/web/src/routes/docs.tsx",
    "apps/desktop/src/mainview/components/settings.tsx",
    "skills/act-dock/references/connection.md",
  ]) {
    expect(readFileSync(resolve(root, file), "utf8")).toContain(command);
  }
});
