import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { nativeHelper } from "./native-helper";
import { createHash } from "node:crypto";
import {
  AppError,
  imageReferenceSchema,
  imageResolutionSchema,
  type ImageResolution,
} from "../shared/contracts";
import type { Store } from "./store";
import { binary, exec, executionEnvironment } from "./executor/act";

export function imageCatalog() {
  return ["20.04", "22.04", "24.04"].flatMap((version) =>
    (["medium", "full"] as const).map((tier) => ({
      label: `ubuntu-${version}`,
      reference: `catthehacker/ubuntu:${tier === "medium" ? "act" : "full"}-${version}`,
      tier,
      legacy: version === "20.04",
    })),
  );
}
type ImageOperation = {
  id: string;
  reference: string;
  platform: string;
  state: "pulling" | "complete" | "failed" | "cancelled";
  detail: string;
  fraction?: number;
  child?: ReturnType<typeof spawn>;
  completion: Promise<void>;
};
export class Images {
  operations = new Map<
    string,
    {
      id: string;
      reference: string;
      platform: string;
      state: "pulling" | "complete" | "failed" | "cancelled";
      detail: string;
      fraction?: number;
      child?: ReturnType<typeof spawn>;
      completion: Promise<void>;
    }
  >();
  resolving = new Map<string, Promise<ImageResolution>>();
  constructor(readonly store: Store) {}
  docker() {
    const path = binary("docker", this.store.settings().dockerPath);
    if (!path)
      throw new AppError(
        "DOCKER_UNAVAILABLE",
        "Docker was not found. Open System health to fix it.",
      );
    return path;
  }
  async command(args: string[], timeout = 15000, signal?: AbortSignal) {
    const path = this.docker();
    return exec(path, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: executionEnvironment(path),
      windowsHide: true,
      signal,
    });
  }
  async platform(architecture: string) {
    if (architecture !== "auto") return architecture;
    try {
      const { stdout } = await this.command(
        ["info", "--format", "{{.OSType}}/{{.Architecture}}"],
        5000,
      );
      const value = stdout
        .trim()
        .replace("aarch64", "arm64")
        .replace("x86_64", "amd64");
      if (!["linux/amd64", "linux/arm64"].includes(value)) throw new Error();
      return value;
    } catch {
      throw new AppError(
        "DOCKER_UNAVAILABLE",
        "Docker's Linux platform could not be detected. Start Docker, then check again.",
      );
    }
  }
  key(reference: string, platform: string) {
    return createHash("sha256")
      .update(
        `${this.store.settings().dockerPath}\0${process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT || "default"}\0${reference}\0${platform}`,
      )
      .digest("hex");
  }
  async inspect(reference: string, platform: string): Promise<ImageResolution> {
    imageReferenceSchema.parse(reference);
    let image: Record<string, unknown> | undefined;
    try {
      const { stdout } = await this.command([
        "image",
        "inspect",
        "--platform",
        platform,
        reference,
      ]);
      image = JSON.parse(stdout)?.[0];
    } catch {
      try {
        image = JSON.parse(
          (await this.command(["image", "inspect", reference])).stdout,
        )?.[0];
      } catch {}
    }
    if (!image || `${image.Os}/${image.Architecture}` !== platform)
      return {
        reference,
        platform,
        resolved: reference,
        available: false,
        source: "local",
        checkedAt: new Date().toISOString(),
      };
    const descriptor = image.Descriptor as { digest?: string } | undefined;
    let resolved = String(image.Id || reference);
    if (descriptor?.digest && reference.includes("/")) {
      const repository = reference.split("@")[0].replace(/:[^/:]+$/, "");
      const qualified = `${repository}@${descriptor.digest}`;
      // Containerd can inspect a platform variant while not registering it as an addressable reference.
      try {
        const result = JSON.parse(
          (await this.command(["image", "inspect", qualified])).stdout,
        )?.[0];
        if (`${result?.Os}/${result?.Architecture}` === platform)
          resolved = qualified;
      } catch {}
    }
    try {
      const result = JSON.parse(
        (await this.command(["image", "inspect", resolved])).stdout,
      )?.[0];
      if (`${result?.Os}/${result?.Architecture}` !== platform)
        throw new Error();
    } catch {
      // Register an immutable variant without a registry fetch. docker tag --platform is available on newer engines.
      const alias = `act-dock-local:${this.key(reference, platform).slice(0, 24)}`;
      try {
        await this.command([
          "image",
          "tag",
          "--platform",
          platform,
          reference,
          alias,
        ]);
        resolved = alias;
      } catch {
        const root = join(this.store.directory, "image-imports");
        await mkdir(root, { recursive: true, mode: 0o700 });
        const temp = await mkdtemp(join(root, "variant-"));
        try {
          const source = join(temp, "image.tar"),
            path = join(temp, "alias.tar");
          await this.command(
            [
              "image",
              "save",
              "--platform",
              platform,
              "--output",
              source,
              reference,
            ],
            300000,
          );
          await nativeHelper(
            { op: "image_alias", source, path, alias },
            300000,
          );
          await this.command(["image", "load", "--input", path], 300000);
          resolved = alias;
        } catch {
          throw new AppError(
            "IMAGE_PLATFORM_ADDRESS",
            "Docker has this platform but could not register a local image alias. Check free disk space or refresh a platform-specific image reference.",
          );
        } finally {
          await rm(temp, { recursive: true, force: true });
        }
      }
    }
    return {
      reference,
      platform,
      resolved,
      available: true,
      bytes: typeof image.Size === "number" ? image.Size : undefined,
      source: "local",
      checkedAt: new Date().toISOString(),
    };
  }
  async resolve(
    reference: string,
    platform: string,
    policy: "if-missing" | "always" | "never",
    allowPull = true,
  ) {
    const key = this.key(reference, platform);
    const prior = this.store.db
      .query("SELECT data FROM image_resolutions WHERE key=?")
      .get(key) as { data: string } | null;
    if (prior && policy !== "always") {
      const cached = imageResolutionSchema.parse(JSON.parse(prior.data));
      const found = await this.inspect(cached.resolved, platform);
      if (found.available) return { ...cached, checkedAt: found.checkedAt };
    }
    const local = await this.inspect(reference, platform);
    if (policy !== "always" && local.available) {
      this.save(key, local);
      return local;
    }
    if (!allowPull || policy === "never") return local;
    if (this.resolving.has(key)) return this.resolving.get(key)!;
    const promise = (async () => {
      // Inspect manifests through Docker's credential-aware tooling. Do not guess architecture from an index.
      let resolved = reference;
      try {
        const manifest = JSON.parse(
          (await this.command(["manifest", "inspect", reference], 30000))
            .stdout,
        );
        const child = manifest.manifests?.find(
          (m: { platform?: { os: string; architecture: string } }) =>
            `${m.platform?.os}/${m.platform?.architecture}` === platform,
        );
        if (manifest.manifests && !child)
          throw new AppError(
            "IMAGE_PLATFORM_UNAVAILABLE",
            `This image does not provide ${platform}. Choose another image or architecture.`,
          );
        if (child?.digest)
          resolved = `${reference.split("@")[0].replace(/:[^/:]+$/, "")}@${child.digest}`;
      } catch (e) {
        if (e instanceof AppError) throw e;
      }
      const operation = this.pull(resolved, platform);
      await this.operations.get(operation.operationId)!.completion;
      const result = await this.inspect(resolved, platform);
      if (!result.available)
        throw new AppError(
          "IMAGE_UNAVAILABLE",
          `The downloaded image does not provide ${platform}.`,
        );
      const final = { ...result, reference, source: "registry" as const };
      this.save(key, final);
      return final;
    })().finally(() => this.resolving.delete(key));
    this.resolving.set(key, promise);
    return promise;
  }
  save(key: string, value: ImageResolution) {
    this.store.db
      .query(
        "INSERT INTO image_resolutions VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(key, JSON.stringify(value));
  }
  pull(reference: string, platform: string) {
    imageReferenceSchema.parse(reference);
    const existing = [...this.operations.values()].find(
      (o) =>
        o.reference === reference &&
        o.platform === platform &&
        o.state === "pulling",
    );
    if (existing) return { operationId: existing.id };
    const id = crypto.randomUUID(),
      docker = this.docker();
    const child = spawn(docker, ["pull", "--platform", platform, reference], {
      env: executionEnvironment(docker),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const op: ImageOperation = {
      id,
      reference,
      platform,
      state: "pulling",
      detail: "Starting download…",
      child,
      completion: Promise.resolve(),
    };
    op.completion = new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        if (op.state !== "cancelled") op.state = error ? "failed" : "complete";
        op.detail = error
          ? "Image download failed. Check the registry, credentials, and platform in System health."
          : op.state === "cancelled"
            ? "Download cancelled"
            : "Downloaded";
        this.store.emit("image", null, { id, state: op.state });
        if (error) reject(error);
        else resolve();
      };
      child.once("error", () =>
        finish(
          new AppError(
            "IMAGE_PULL_FAILED",
            "Docker could not start the image download.",
          ),
        ),
      );
      child.once("close", (code) =>
        finish(
          code === 0
            ? undefined
            : new AppError(
                op.state === "cancelled"
                  ? "IMAGE_PULL_CANCELLED"
                  : "IMAGE_PULL_FAILED",
                "Image download did not complete. Check Docker and registry credentials.",
              ),
        ),
      );
    });
    void op.completion.catch(() => {});
    for (const stream of [child.stdout, child.stderr]) {
      const reader = createInterface({ input: stream });
      reader.on("line", (line) => {
        // Registry errors can contain URLs or credentials; retain only known progress phrases.
        const match = line.match(
          /(?:Downloading|Extracting|Pull complete|Already exists|Download complete)(?:\s+\[[=> .]+\])?/,
        );
        if (match) {
          op.detail = match[0].slice(0, 150);
          this.store.emit("image", null, {
            id,
            state: op.state,
            detail: op.detail,
          });
        }
      });
    }
    this.operations.set(id, op);
    // Bound completed operation history without affecting subscribers to an active pull.
    if (this.operations.size > 50)
      for (const [key, o] of this.operations)
        if (o.state !== "pulling") {
          this.operations.delete(key);
          break;
        }
    return { operationId: id };
  }
  cancel(id: string) {
    const op = this.operations.get(id);
    if (op?.state === "pulling") {
      op.state = "cancelled";
      op.child?.kill("SIGTERM");
    }
    return null;
  }
  list() {
    return [...this.operations.values()].map(
      ({ child: _child, completion: _completion, ...op }) => op,
    );
  }
}
