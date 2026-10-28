import { mkdir, rm, lstat, readdir, realpath, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, isAbsolute } from "node:path";
import {
  AppError,
  cacheEntrySchema,
  type CacheEntry,
  type Project,
  type ExecutionSnapshot,
} from "../shared/contracts";
import { Store } from "./store";
import { nativeHelper } from "./native-helper";
import { restoreDockerEnvironment } from "./executor/act";
import { Images } from "./images";
import { actrcPaths, managedActrc } from "./execution-config";
import { yamlData, safeLocalAction } from "./workflow-analysis";

async function directoryBytes(path: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) return info.size;
  let bytes = 0;
  for (const name of await readdir(path))
    bytes += await directoryBytes(join(path, name));
  return bytes;
}
const q = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export class Caches {
  pending = new Map<string, Promise<CacheEntry>>();
  projectIntents = new Map<string, string>();
  maintenanceProjects = new Set<string>();
  root: string;
  runLeases = new Map<string, Set<string>>();
  constructor(
    readonly store: Store,
    readonly images: Images,
  ) {
    this.root = join(store.directory, "cache");
  }
  list(projectId?: string) {
    return (
      this.store.db.query("SELECT data FROM cache_entries").all() as {
        data: string;
      }[]
    )
      .map((r) => cacheEntrySchema.parse(JSON.parse(r.data)))
      .filter((c) => !projectId || c.projectId === projectId);
  }
  save(entry: CacheEntry) {
    this.store.db
      .query(
        "INSERT INTO cache_entries VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(entry.id, JSON.stringify(entry));
  }
  lease(entry: CacheEntry, runId: string) {
    const ids = this.runLeases.get(runId) || new Set<string>();
    this.store.db.transaction(() => {
      this.store.db
        .query("INSERT OR IGNORE INTO cache_leases VALUES (?,?)")
        .run(runId, entry.id);
      entry.leases = (
        this.store.db
          .query("SELECT COUNT(*) AS n FROM cache_leases WHERE cache_id=?")
          .get(entry.id) as { n: number }
      ).n;
      entry.lastUsedAt = new Date().toISOString();
      this.save(entry);
    })();
    ids.add(entry.id);
    this.runLeases.set(runId, ids);
  }
  release(runId: string) {
    this.projectIntents.delete(runId);
    this.store.db.transaction(() => {
      const ids = (
        this.store.db
          .query("SELECT cache_id FROM cache_leases WHERE run_id=?")
          .all(runId) as { cache_id: string }[]
      ).map((row) => row.cache_id);
      this.store.db.query("DELETE FROM cache_leases WHERE run_id=?").run(runId);
      for (const id of ids) {
        const entry = this.list().find((c) => c.id === id);
        if (entry) {
          entry.leases = (
            this.store.db
              .query("SELECT COUNT(*) AS n FROM cache_leases WHERE cache_id=?")
              .get(id) as { n: number }
          ).n;
          this.save(entry);
        }
      }
    })();
    this.runLeases.delete(runId);
  }
  recover() {
    const rows = this.store.db.query("SELECT * FROM cache_leases").all() as {
      run_id: string;
      cache_id: string;
    }[];
    for (const row of rows) {
      const ids = this.runLeases.get(row.run_id) || new Set<string>();
      ids.add(row.cache_id);
      this.runLeases.set(row.run_id, ids);
    }
    for (const [runId] of this.runLeases) {
      if (
        !this.store.db
          .query("SELECT id FROM resources WHERE run_id=? LIMIT 1")
          .get(runId)
      )
        this.release(runId);
      else {
        try {
          this.projectIntents.set(
            runId,
            this.store.run(runId).request.projectId,
          );
        } catch {}
      }
    }
    for (const entry of this.list()) {
      entry.leases = (
        this.store.db
          .query("SELECT COUNT(*) AS n FROM cache_leases WHERE cache_id=?")
          .get(entry.id) as { n: number }
      ).n;
      this.save(entry);
    }
  }
  async action(
    project: Project,
    url: string,
    ref: string,
    policy: string,
    token: string,
    runId: string,
  ): Promise<CacheEntry> {
    const previous = this.list(project.id)
      .filter(
        (c) =>
          c.kind === "action" &&
          c.metadata.url === url &&
          (c.metadata.ref === ref ||
            c.metadata.commit === ref ||
            (Array.isArray(c.metadata.refs) && c.metadata.refs.includes(ref))),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const immutable = /^[0-9a-f]{40}$/i.test(ref),
      fresh =
        previous &&
        (immutable ||
          Date.now() -
            Date.parse(
              String(
                (
                  previous.metadata.refTimes as
                    | Record<string, string>
                    | undefined
                )?.[ref] ||
                  previous.metadata.refreshedAt ||
                  previous.createdAt,
              ),
            ) <
            86400000);
    if (
      previous &&
      existsSync(previous.path) &&
      ((policy === "cache-first" && fresh) || policy === "cached-only")
    ) {
      this.lease(previous, runId);
      return previous;
    }
    if (policy === "cached-only")
      throw new AppError(
        "ACTION_CACHE_MISS",
        `Action ${url.split("/").slice(-2).join("/")}@${ref} is not cached. Refresh this project's actions while online.`,
      );
    const key = `${project.id}\0${url}\0${ref}`;
    let promise = this.pending.get(key);
    if (!promise) {
      promise = (async () => {
        const root = join(this.root, project.id, "actions");
        await mkdir(root, { recursive: true, mode: 0o700 });
        const path = join(root, crypto.randomUUID());
        const result = await nativeHelper<{ commit: string }>(
          { op: "action_fetch", url, ref, token, path },
          130000,
        );
        const now = new Date().toISOString();
        const identity = createHash("sha256")
          .update(`${project.id}\0${url}\0${result.commit}`)
          .digest("hex");
        const destination = join(root, identity);
        if (existsSync(destination))
          await rm(path, { recursive: true, force: true });
        else
          try {
            await rename(path, destination);
          } catch (error) {
            if (
              !["EEXIST", "ENOTEMPTY"].includes(
                (error as NodeJS.ErrnoException).code || "",
              )
            )
              throw error;
            await rm(path, { recursive: true, force: true });
          }
        const bytes = await directoryBytes(destination);
        const current = this.list(project.id).find((c) => c.id === identity);
        const refs = [
          ...new Set([
            ...(Array.isArray(current?.metadata.refs)
              ? current.metadata.refs
              : []),
            ref,
          ]),
        ];
        const entry: CacheEntry = {
          id: identity,
          projectId: project.id,
          kind: "action",
          path: destination,
          createdAt: current?.createdAt || now,
          lastUsedAt: now,
          bytes,
          leases: current?.leases || 0,
          generation: 1,
          metadata: {
            url,
            ref,
            refs,
            refTimes: {
              ...(current?.metadata.refTimes as Record<string, string>),
              [ref]: now,
            },
            refreshedAt: now,
            commit: result.commit,
          },
        };
        this.save(entry);
        this.store.emit("cache", runId, { id: entry.id, state: "ready" });
        return entry;
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, promise);
    }
    const entry = await promise;
    this.lease(this.list().find((c) => c.id === entry.id) || entry, runId);
    return entry;
  }
  actionHost(project: Project) {
    let server = "github.com",
      noSkip = false;
    for (const path of actrcPaths(project.path)) {
      const config = managedActrc(path);
      server = config.githubInstance || server;
      noSkip = config.noSkipCheckout ?? noSkip;
    }
    return { server, noSkip };
  }
  async inspect(project: Project, uses: string[], snapshot: ExecutionSnapshot) {
    const { server, noSkip } = this.actionHost(project);
    const issues: {
        code: string;
        severity: "error" | "warning" | "unknown";
        message: string;
        recoverable: boolean;
      }[] = [],
      visited = new Set<string>();
    const walk = async (reference: string, depth = 0): Promise<void> => {
      if (visited.has(reference)) return;
      visited.add(reference);
      if (depth > 32 || visited.size > 500) {
        issues.push({
          code: "ACTION_GRAPH_LIMIT",
          severity: "error",
          message: "Action dependencies exceed inspection limits.",
          recoverable: false,
        });
        return;
      }
      if (
        reference.startsWith("docker://") ||
        (!noSkip &&
          /^actions\/checkout@/.test(reference) &&
          existsSync(join(project.path, ".git")))
      )
        return;
      let dir: string | undefined;
      if (reference.startsWith("./")) {
        try {
          dir = await safeLocalAction(project.path, reference);
        } catch {
          issues.push({
            code: "LOCAL_ACTION_UNKNOWN",
            severity: "unknown",
            message:
              "A local action is not available until workspace preparation.",
            recoverable: false,
          });
          return;
        }
      } else {
        const match = reference.match(
          /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(\/[^@]*)?@(.+)$/,
        );
        const entry =
          match &&
          this.list(project.id).find(
            (c) =>
              c.kind === "action" &&
              c.metadata.url === `https://${server}/${match[1]}` &&
              (c.metadata.ref === match[3] ||
                (Array.isArray(c.metadata.refs) &&
                  c.metadata.refs.includes(match[3]))) &&
              existsSync(c.path),
          );
        if (!entry) {
          issues.push({
            code: "ACTION_CACHE_MISS",
            severity:
              snapshot.options.actionCachePolicy === "cached-only"
                ? "error"
                : "warning",
            message: `Action ${reference} requires acquisition.`,
            recoverable: false,
          });
          return;
        }
        dir = match?.[2]
          ? await safeLocalAction(entry.path, "." + match[2])
          : entry.path;
      }
      const path = (await lstat(dir!)).isFile()
        ? dir!
        : [join(dir!, "action.yml"), join(dir!, "action.yaml")].find(
            existsSync,
          );
      if (path) {
        const data = await yamlData(path);
        for (const job of Object.values(data.jobs || {})) {
          if (job.uses) await walk(job.uses, depth + 1);
          for (const step of job.steps || [])
            if (step.uses) await walk(step.uses, depth + 1);
        }
        for (const step of data.runs?.steps || [])
          if (step.uses) await walk(step.uses, depth + 1);
      }
    };
    for (const reference of uses) await walk(reference);
    if (snapshot.options.packageCaches.includes("pnpm"))
      issues.push({
        code: "PNPM_STORE_COMMAND",
        severity: "warning",
        message:
          "Use pnpm install --store-dir /var/cache/act-dock/pnpm in the workflow to use the managed store.",
        recoverable: false,
      });
    return issues;
  }
  async prepare(
    project: Project,
    uses: string[],
    snapshot: ExecutionSnapshot,
    platform: string,
    runId: string,
    token = "",
    images = this.images,
  ) {
    const { server, noSkip } = this.actionHost(project);
    const args: string[] = [],
      mounts: string[] = [],
      env: Record<string, string> = {};
    const visited = new Set<string>(),
      localRepositories = new Map<string, string>();
    const walk = async (
      reference: string,
      root: string,
      depth = 0,
    ): Promise<void> => {
      if (depth > 32 || visited.size > 500)
        throw new AppError(
          "ACTION_GRAPH_LIMIT",
          "Action dependencies exceed the supported inspection bounds.",
        );
      const identity = `${root}\0${reference}`;
      if (visited.has(identity)) return;
      visited.add(identity);
      if (reference.startsWith("docker://")) return;
      let dir: string;
      if (reference.startsWith("./")) {
        try {
          dir = await safeLocalAction(project.path, reference);
        } catch (error) {
          if (snapshot.options.actionCachePolicy === "cached-only")
            throw new AppError(
              "ACTION_UNRESOLVED",
              "A local action is unavailable for cached-only preparation.",
            );
          // A preceding workflow step may generate the action. Act owns its execution semantics.
          if (!existsSync(join(project.path, reference))) return;
          throw error;
        }
      } else {
        if (
          !noSkip &&
          /^actions\/checkout@/.test(reference) &&
          existsSync(join(project.path, ".git"))
        )
          return;
        const match = reference.match(
          /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(\/[^@]*)?@(.+)$/,
        );
        if (!match) {
          if (snapshot.options.actionCachePolicy === "cached-only")
            throw new AppError(
              "ACTION_UNRESOLVED",
              "An action reference cannot be resolved without network fallback.",
            );
          return;
        }
        const repo = match[1],
          ref = match[3];
        const entry = await this.action(
          project,
          `https://${server}/${repo}`,
          ref,
          snapshot.options.actionCachePolicy,
          token,
          runId,
        );
        localRepositories.set(`https://${server}/${repo}@${ref}`, entry.path);
        dir = match[2]
          ? await safeLocalAction(entry.path, "." + match[2])
          : entry.path;
      }
      const path = (await lstat(dir)).isFile()
        ? dir
        : [join(dir, "action.yml"), join(dir, "action.yaml")].find(existsSync);
      if (!path) return;
      const data = await yamlData(path);
      for (const job of Object.values(data.jobs || {})) {
        if (job.uses) await walk(job.uses, project.path, depth + 1);
        for (const step of job.steps || [])
          if (step.uses) await walk(step.uses, project.path, depth + 1);
      }
      for (const nested of data.runs?.steps || [])
        if (nested.uses) await walk(nested.uses, project.path, depth + 1);
    };
    for (const reference of uses) await walk(reference, project.path);
    for (const [reference, path] of localRepositories)
      args.push("--local-repository", `${reference}=${path}`);
    if (snapshot.options.actionCachePolicy === "cached-only") {
      // All literal action dependencies were mapped above. Stock Act's offline flag alone is not a network barrier.
      args.push("--action-offline-mode");
    }
    for (const kind of snapshot.options.packageCaches) {
      const generationKey = `cache-generation:${project.id}:${platform}:${kind}:${snapshot.docker?.host || "default"}`;
      const generation = Number(
        (
          this.store.db
            .query("SELECT value FROM installation WHERE key=?")
            .get(generationKey) as { value: string } | null
        )?.value || 1,
      );
      const id = createHash("sha256")
        .update(
          `${this.store.installationId()}:${project.id}:${platform}:${kind}:${generation}:${snapshot.docker?.host || "default"}`,
        )
        .digest("hex");
      let entry = this.list(project.id).find((c) => c.id === id);
      if (!entry) {
        const now = new Date().toISOString();
        entry = {
          id,
          projectId: project.id,
          kind,
          path: `act-dock-cache-${id.slice(0, 32)}`,
          createdAt: now,
          lastUsedAt: now,
          bytes: null,
          leases: 0,
          generation,
          metadata: {
            platform,
            installation: this.store.installationId(),
            docker: snapshot.docker,
            generationKey,
          },
        };
        this.save(entry);
      }
      await images.command([
        "volume",
        "create",
        "--label",
        `act-dock.installation=${this.store.installationId()}`,
        "--label",
        `act-dock.cache=${id}`,
        entry.path,
      ]);
      this.lease(entry, runId);
      const path = `/var/cache/act-dock/${kind}`;
      mounts.push(`--mount ${q(`type=volume,src=${entry.path},dst=${path}`)}`);
      if (kind === "npm") env.npm_config_cache = path;
      if (kind === "bun") env.BUN_INSTALL_CACHE_DIR = path;
      if (kind === "pnpm") env.ACT_DOCK_PNPM_STORE = path;
    }
    for (const [name, value] of Object.entries(env))
      args.push("--env", `${name}=${value}`);
    return { args, mounts };
  }
  async clear(id: string) {
    const entry = this.list().find((c) => c.id === id);
    if (!entry) return null;
    if (
      this.maintenanceProjects.has(entry.projectId) ||
      [...this.projectIntents.values()].includes(entry.projectId)
    )
      throw new AppError(
        "CACHE_BUSY",
        "This project is preparing or running work. Wait before clearing caches.",
      );
    if (entry.leases || this.pending.size)
      throw new AppError(
        "CACHE_BUSY",
        "This cache is in use. Wait for active runs and downloads to finish.",
      );
    this.maintenanceProjects.add(entry.projectId);
    try {
      if (entry.kind === "action") {
        const root = await realpath(this.root),
          path = await realpath(entry.path).catch(() => null);
        if (path) {
          const rel = relative(root, path);
          if (rel.startsWith("..") || isAbsolute(rel))
            throw new AppError(
              "CACHE_OWNERSHIP",
              "This directory is not owned by Act Dock.",
            );
          await rm(path, { recursive: true, force: true });
        }
      } else {
        const docker = entry.metadata.docker as ExecutionSnapshot["docker"];
        const images = docker
          ? new Images(
              this.store,
              restoreDockerEnvironment(
                docker,
                docker.executable || this.store.settings().dockerPath,
              ),
              this.images,
              docker.executable,
            )
          : this.images;
        const { stdout } = await images.command([
          "volume",
          "inspect",
          entry.path,
        ]);
        const volume = JSON.parse(stdout)[0];
        if (
          volume.Labels?.["act-dock.installation"] !==
            this.store.installationId() ||
          volume.Labels?.["act-dock.cache"] !== entry.id
        )
          throw new AppError(
            "CACHE_OWNERSHIP",
            "This Docker volume is not owned by Act Dock.",
          );
        await images.command(["volume", "rm", entry.path]);
        this.store.db
          .query(
            "INSERT INTO installation VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(
            String(
              entry.metadata.generationKey ||
                `cache-generation:${entry.projectId}:${entry.metadata.platform}:${entry.kind}`,
            ),
            String(entry.generation + 1),
          );
      }
      this.store.db.query("DELETE FROM cache_entries WHERE id=?").run(id);
      this.store.emit("cache", null, { id, state: "removed" });
      return null;
    } finally {
      this.maintenanceProjects.delete(entry.projectId);
    }
  }
  async refresh(projectId: string) {
    this.store.project(projectId);
    let cleared = 0;
    for (const entry of this.list(projectId))
      if (!entry.leases) {
        await this.clear(entry.id);
        cleared++;
      }
    return { cleared };
  }
  async maintain() {
    if (this.pending.size) return;
    // Measure only application-owned volumes. Docker does not always expose usage; unknown remains null.
    try {
      const data = JSON.parse(
        (
          await this.images.command(
            ["system", "df", "-v", "--format", "{{json .}}"],
            15000,
          )
        ).stdout,
      );
      for (const v of data.Volumes || []) {
        const entry = this.list().find((c) => c.path === v.Name);
        if (entry && typeof v.UsageData?.Size === "number") {
          entry.bytes = v.UsageData.Size;
          this.save(entry);
        }
      }
    } catch {}
    let entries = this.list();
    for (const entry of entries
      .filter((c) => !c.leases && c.bytes !== null)
      .sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt))) {
      const total = entries.reduce((n, c) => n + (c.bytes || 0), 0),
        project = entries
          .filter((c) => c.projectId === entry.projectId)
          .reduce((n, c) => n + (c.bytes || 0), 0);
      const budgets = this.store.settings().cacheBudgets || {
        projectGiB: 5,
        totalGiB: 20,
      };
      if (
        total > budgets.totalGiB * 1024 ** 3 ||
        project > budgets.projectGiB * 1024 ** 3
      ) {
        await this.clear(entry.id);
        entries = entries.filter((c) => c.id !== entry.id);
      }
    }
  }
}
