import { randomBytes, createHmac } from "node:crypto";
import { mkdir, readFile, rm, open } from "node:fs/promises";
import { parseDocument } from "yaml";
import { actrcPaths, managedActrc } from "./execution-config";
import { join, resolve } from "node:path";
import {
  AppError,
  secretMetadataSchema,
  type SecretMetadata,
  type RunRequest,
  type Project,
} from "../shared/contracts";
import { Store } from "./store";
import { nativeHelper } from "./native-helper";

// Dotenv grammar: quoted/multiline values, export, comments, escaped newlines. Never shell-evaluated.
export function parseDotenv(content: string): Record<string, string> {
  if (Buffer.byteLength(content) > 4 * 1024 * 1024)
    throw new AppError(
      "CONFIG_TOO_LARGE",
      "Configuration files must be smaller than 4 MiB.",
    );
  const values: Record<string, string> = Object.create(null);
  const pattern =
    /(?:^|\n)\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\r\n]*))/g;
  const spans: { start: number; length: number }[] = [];
  const expand = (value: string) =>
    value
      .replace(
        /(\\)?\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
        (match, escaped, a, b) =>
          escaped ? match.slice(1) : values[a || b] || "",
      )
      .replaceAll("\\$", "$");
  for (const match of content.matchAll(pattern)) {
    spans.push({ start: match.index!, length: match[0].length });
    const value =
      match[2] !== undefined
        ? match[2].replace(/\\([\s\S])/g, (_match, char) =>
            char === "n"
              ? "\n"
              : char === "r"
                ? "\r"
                : char === "t"
                  ? "\t"
                  : char === "$"
                    ? "\\$"
                    : char,
          )
        : match[3] !== undefined
          ? match[3]
          : match[4].replace(/\s+#.*$/, "").trim();
    values[match[1]] = match[3] !== undefined ? value : expand(value);
  }
  let remaining = content;
  for (const span of spans.reverse())
    remaining =
      remaining.slice(0, span.start) +
      "\n" +
      remaining.slice(span.start + span.length);
  if (
    remaining
      .split(/\r?\n/)
      .some((line) => line.trim() && !line.trim().startsWith("#"))
  )
    throw new AppError(
      "INVALID_DOTENV",
      "The dotenv file contains an invalid assignment. Correct its syntax, then preview it again.",
    );
  return values;
}
const encoded = (value: string) => JSON.stringify(value).replaceAll("$", "\\$");
export function dotenvText(values: Record<string, string>) {
  return (
    Object.entries(values)
      .map(([name, value]) => `${name}=${encoded(value)}`)
      .join("\n") + "\n"
  );
}
export class Secrets {
  ephemeral = new Map<string, Record<string, string>>();
  private keyPromise?: Promise<Buffer>;
  constructor(readonly store: Store) {}
  list(projectId: string): SecretMetadata[] {
    this.store.project(projectId);
    return (
      this.store.db
        .query(
          "SELECT data FROM secret_metadata WHERE project_id=? ORDER BY name",
        )
        .all(projectId) as { data: string }[]
    ).map((r) => secretMetadataSchema.parse(JSON.parse(r.data)));
  }
  async put(projectId: string, name: string, value: string, granted = true) {
    this.store.project(projectId);
    const revision = crypto.randomUUID(),
      id = `${this.store.installationId()}/${projectId}/${revision}`;
    await nativeHelper({ op: "vault_put", id, value });
    const old = this.list(projectId).find((s) => s.name === name);
    const metadata: SecretMetadata = {
      id,
      projectId,
      name,
      revision,
      updatedAt: new Date().toISOString(),
      granted,
    };
    try {
      this.store.db
        .query(
          "INSERT INTO secret_metadata VALUES (?,?,?,?) ON CONFLICT(project_id,name) DO UPDATE SET id=excluded.id,data=excluded.data",
        )
        .run(id, projectId, name, JSON.stringify(metadata));
    } catch (error) {
      await nativeHelper({ op: "vault_delete", id }).catch(() => {});
      throw error;
    }
    if (old)
      await nativeHelper({ op: "vault_delete", id: old.id }).catch(() => {});
    const project = this.store.project(projectId);
    const selected = new Set(project.defaults.execution?.secretNames || []);
    if (granted) selected.add(name);
    else selected.delete(name);
    this.store.putProject({
      ...project,
      defaults: {
        ...project.defaults,
        execution: {
          ...project.defaults.execution,
          secretNames: [...selected],
        },
      },
    });
    return metadata;
  }
  async delete(projectId: string, name: string) {
    const item = this.list(projectId).find((s) => s.name === name);
    if (item) {
      await nativeHelper({ op: "vault_delete", id: item.id });
      this.store.db
        .query("DELETE FROM secret_metadata WHERE id=?")
        .run(item.id);
      if (this.list(projectId).some((secret) => secret.name === name))
        return null;
      const project = this.store.project(projectId);
      this.store.putProject({
        ...project,
        defaults: {
          ...project.defaults,
          execution: {
            ...project.defaults.execution,
            secretNames: (project.defaults.execution?.secretNames || []).filter(
              (n) => n !== name,
            ),
          },
        },
      });
    }
    return null;
  }
  async selected(projectId: string, names: string[], read = false) {
    const all = this.list(projectId),
      values: Record<string, string> = Object.create(null);
    for (const name of names) {
      const item = all.find((s) => s.name === name && s.granted);
      if (!item)
        throw new AppError(
          "SECRET_NOT_FOUND",
          `Secret ${name} is not saved or granted for this project.`,
        );
      if (read)
        values[name] = await nativeHelper<string>({
          op: "vault_get",
          id: item.id,
        });
    }
    if (names.length && !read) await nativeHelper({ op: "vault_status" });
    return values;
  }
  async fingerprint(values: Record<string, string> = {}) {
    this.keyPromise ||= (async () => {
      const path = join(this.store.directory, "run-fingerprint.key");
      try {
        await readFile(path);
      } catch {
        const key = randomBytes(32).toString("hex");
        if (process.platform === "win32")
          await nativeHelper({ op: "private_file", path, value: key });
        else {
          try {
            const file = await open(path, "wx", 0o600);
            await file.writeFile(key);
            await file.close();
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
        }
      }
      return readFile(path);
    })().catch((error) => {
      this.keyPromise = undefined;
      throw error;
    });
    return createHmac("sha256", await this.keyPromise)
      .update(
        JSON.stringify(
          Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
      .digest("hex");
  }
  async prepare(
    runId: string,
    project: Project,
    request: RunRequest,
    names: string[],
  ) {
    let base: Record<string, string> = {};
    let inheritedFile = "";
    for (const path of actrcPaths(project.path))
      inheritedFile = managedActrc(path).secretFile || inheritedFile;
    const selectedFile =
      request.secretFile || project.defaults.secretFile || inheritedFile;
    const source = resolve(project.path, selectedFile || ".secrets");
    try {
      const content = await readFile(source, "utf8");
      if (/\.ya?ml$/i.test(source)) {
        const document = parseDocument(content, { uniqueKeys: true });
        if (document.errors.length) throw new Error("Invalid YAML");
        const parsed = document.toJS();
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          Object.values(parsed).some((v) => typeof v !== "string")
        )
          throw new Error("Invalid secrets map");
        base = parsed;
      } else
        base = await nativeHelper<Record<string, string>>({
          op: "parse_dotenv",
          value: content,
        });
      base = Object.fromEntries(
        Object.entries(base).map(([name, value]) => [
          name.toUpperCase(),
          value,
        ]),
      );
    } catch (error) {
      if (selectedFile || (error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new AppError(
          "SECRETS_FILE",
          "The secrets file could not be read.",
        );
    }
    const values = {
      ...base,
      ...(await this.selected(project.id, names, true)),
      ...this.ephemeral.get(runId),
    };
    // Act may discover a token through gh. Supply an empty token explicitly when it was not granted.
    if (!("GITHUB_TOKEN" in values)) values.GITHUB_TOKEN = "";
    const dir = join(this.store.directory, "private", runId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "secrets.env");
    if (process.platform === "win32")
      await nativeHelper({
        op: "private_file",
        path,
        value: dotenvText(values),
      });
    else {
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(dotenvText(values));
        await file.sync();
      } finally {
        await file.close();
      }
    }
    return { path, values: Object.values(values).filter(Boolean) };
  }
  async cleanup(runId: string, preserve = false) {
    if (!preserve) this.ephemeral.delete(runId);
    await rm(join(this.store.directory, "private", runId), {
      recursive: true,
      force: true,
    });
  }
  async recover() {
    await rm(join(this.store.directory, "private"), {
      recursive: true,
      force: true,
    });
  }
  async preview(
    projectId: string,
    path: string,
    target: "env" | "vars" | "secrets",
  ) {
    const project = this.store.project(projectId),
      values = await nativeHelper<Record<string, string>>({
        op: "parse_dotenv",
        value: await readFile(resolve(project.path, path), "utf8"),
      });
    let existing: Record<string, string> = {};
    if (target !== "secrets")
      try {
        existing = parseDotenv(
          await readFile(
            join(this.store.directory, `${projectId}.${target}.env`),
            "utf8",
          ),
        );
      } catch {}
    if (target === "secrets") {
      const uppercase = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k.toUpperCase(), v]),
      );
      for (const key of Object.keys(values)) delete values[key];
      Object.assign(values, uppercase);
    }
    const previous =
      target === "secrets"
        ? this.list(projectId).map((s) => s.name)
        : Object.keys(existing);
    return {
      names: Object.keys(values),
      duplicates: Object.keys(values).filter((n) => previous.includes(n)),
    };
  }
  async import(
    projectId: string,
    path: string,
    target: "env" | "vars" | "secrets",
    names: string[],
    overwrite: boolean,
  ) {
    const project = this.store.project(projectId),
      values = await nativeHelper<Record<string, string>>({
        op: "parse_dotenv",
        value: await readFile(resolve(project.path, path), "utf8"),
      });
    if (target === "secrets") {
      const uppercase = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k.toUpperCase(), v]),
      );
      for (const key of Object.keys(values)) delete values[key];
      Object.assign(values, uppercase);
      names = names.map((n) => n.toUpperCase());
    }
    const imported: string[] = [];
    if (target === "secrets") {
      const previous = new Set(this.list(projectId).map((s) => s.name));
      for (const name of names)
        if (name in values && (!previous.has(name) || overwrite)) {
          await this.put(projectId, name, values[name]);
          imported.push(name);
        }
    } else {
      // Keep environment/variable imports as user-visible file references, not secret-like hidden DB values.
      const destination = join(
        this.store.directory,
        `${projectId}.${target}.env`,
      );
      let previous: Record<string, string> = {};
      try {
        previous = parseDotenv(await readFile(destination, "utf8"));
      } catch {}
      for (const name of names)
        if (name in values && (!(name in previous) || overwrite)) {
          previous[name] = values[name];
          imported.push(name);
        }
      // Avoid persisting imported configuration until its destination has been explicitly selected.
      const temp = destination + "." + crypto.randomUUID();
      if (process.platform === "win32")
        await nativeHelper({
          op: "private_file",
          path: temp,
          value: dotenvText(previous),
        });
      else {
        const f = await open(temp, "wx", 0o600);
        await f.writeFile(dotenvText(previous));
        await f.close();
      }
      const { rename } = await import("node:fs/promises");
      await rename(temp, destination);
      this.store.putProject({
        ...project,
        defaults: {
          ...project.defaults,
          [target === "env" ? "envFile" : "varFile"]: destination,
        },
      });
    }
    return { imported };
  }
}
