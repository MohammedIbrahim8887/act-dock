/** Desktop self-update contract, shared by the main process and the webview. */
export const RELEASE_REPOSITORY = "MohammedIbrahim8887/act-dock";
export const MANIFEST_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/latest/download/manifest.json`;
const assetPrefix = `https://github.com/${RELEASE_REPOSITORY}/releases/download/`;

export type UpdatePreferences = {
  /** Download new versions in the background as soon as they are found. */
  autoDownload: boolean;
  /** Restart into a downloaded update once no pipelines are running. */
  autoInstall: boolean;
};
export const defaultUpdatePreferences: UpdatePreferences = {
  autoDownload: true,
  autoInstall: true,
};

/** How this copy of Act Dock was installed, which decides how it can update. */
export type InstallKind =
  | "macos-app"
  | "windows-installer"
  | "linux-appimage"
  | "linux-deb"
  | "linux-rpm"
  | "development"
  | "unsupported";

export type UpdateStatus =
  | "unavailable"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";
export type UpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  installKind: InstallKind;
  /** Why updates are unavailable, or what failed. */
  message?: string;
  version?: string;
  publishedAt?: string;
  /** 0–1 while downloading. */
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  checkedAt?: string;
  /** Epoch milliseconds when an automatic restart is scheduled. */
  installAt?: number;
  /** Why an automatic restart is waiting, e.g. active pipelines. */
  waitingFor?: string;
  /** Installs that need the system package manager ask for a password. */
  needsAdmin?: boolean;
  preferences: UpdatePreferences;
};

export type ReleaseAsset = {
  kind: string;
  name: string;
  url: string;
  sha256: string;
  size: number;
  platform: string;
  arch: string;
  format: string;
};
export type ReleaseManifest = {
  version: string;
  publishedAt: string;
  commit: string;
  assets: ReleaseAsset[];
};

const semver = /^\d+\.\d+\.\d+$/;
/** True when `candidate` is a strictly newer x.y.z version than `current`. */
export function isNewerVersion(candidate: string, current: string) {
  if (!semver.test(candidate) || !semver.test(current)) return false;
  const a = candidate.split(".").map(Number),
    b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Reject manifests that could point downloads anywhere but this repository's releases. */
export function parseManifest(raw: unknown): ReleaseManifest {
  const m = raw as Partial<ReleaseManifest> | null;
  if (!m || typeof m.version !== "string" || !semver.test(m.version))
    throw new Error("The release manifest has no valid version.");
  if (!Array.isArray(m.assets))
    throw new Error("The release manifest lists no downloads.");
  const assets = m.assets.filter(
    (a): a is ReleaseAsset =>
      !!a &&
      typeof a.url === "string" &&
      a.url.startsWith(`${assetPrefix}v${m.version}/`) &&
      typeof a.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(a.sha256) &&
      typeof a.size === "number" &&
      a.size > 0 &&
      typeof a.kind === "string",
  );
  return {
    version: m.version,
    publishedAt: typeof m.publishedAt === "string" ? m.publishedAt : "",
    commit: typeof m.commit === "string" ? m.commit : "",
    assets,
  };
}

const assetKind: Partial<Record<InstallKind, string>> = {
  "macos-app": "macos-arm64",
  "windows-installer": "windows-x64",
  "linux-appimage": "linux-x64-appimage",
  "linux-deb": "linux-x64-deb",
  "linux-rpm": "linux-x64-rpm",
};
export function assetFor(manifest: ReleaseManifest, kind: InstallKind) {
  const wanted = assetKind[kind];
  return wanted ? manifest.assets.find((a) => a.kind === wanted) : undefined;
}

/**
 * Work out how this copy was installed from the running executable.
 * Electrobun runs the main process from `<app>/Contents/MacOS` on macOS and
 * `<install>/bin` elsewhere.
 */
export function detectInstall(
  platform: string,
  arch: string,
  execPath: string,
  env: Record<string, string | undefined>,
  channel: string,
): { kind: InstallKind; root?: string; reason?: string } {
  if (channel === "dev")
    return { kind: "development", reason: "Updates are off in development builds." };
  if (platform === "darwin") {
    if (arch !== "arm64")
      return { kind: "unsupported", reason: "Releases are built for Apple Silicon Macs." };
    const match = execPath.match(/^(.*?\.app)\/Contents\//);
    if (!match) return { kind: "unsupported", reason: "Act Dock is not running from an app bundle." };
    if (match[1].startsWith("/Volumes/"))
      return {
        kind: "unsupported",
        root: match[1],
        reason: "Act Dock is running from the disk image. Drag it to Applications to enable updates.",
      };
    return { kind: "macos-app", root: match[1] };
  }
  if (platform === "win32") {
    const bin = execPath.replace(/[\\/][^\\/]+$/, "");
    return { kind: "windows-installer", root: bin.replace(/[\\/]bin$/i, "") };
  }
  if (platform === "linux") {
    if (env.APPIMAGE) return { kind: "linux-appimage", root: env.APPIMAGE };
    if (execPath.startsWith("/opt/act-dock/"))
      // The main process asks rpm whether it owns the install and switches to linux-rpm.
      return { kind: "linux-deb", root: "/opt/act-dock" };
    return { kind: "unsupported", reason: "This copy wasn't installed from an Act Dock package." };
  }
  return { kind: "unsupported", reason: "Updates aren't available on this platform." };
}
