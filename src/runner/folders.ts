import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { AppError, type FolderListing } from "../shared/contracts";

export async function browseFolders({
  path,
  showHidden = false,
}: {
  path?: string;
  showHidden?: boolean;
}): Promise<FolderListing> {
  if (path && !isAbsolute(path))
    throw new AppError("INVALID_PATH", "Choose an absolute folder path.");
  const current = await realpath(path || homedir());
  const entries = await readdir(current, { withFileTypes: true });
  const folders = (
    await Promise.all(
      entries
        .filter((e) => showHidden || !e.name.startsWith("."))
        .map(async (entry) => {
          const child = join(current, entry.name);
          if (entry.isDirectory()) return { name: entry.name, path: child };
          if (entry.isSymbolicLink())
            try {
              if ((await stat(child)).isDirectory())
                return { name: entry.name, path: child };
            } catch {}
          return null;
        }),
    )
  )
    .filter((e): e is { name: string; path: string } => e !== null)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const home = homedir();
  const shortcuts = (
    await Promise.all(
      [
        { name: "Home", path: home },
        { name: "Desktop", path: join(home, "Desktop") },
        { name: "Documents", path: join(home, "Documents") },
      ].map(async (item) => {
        try {
          return (await stat(item.path)).isDirectory() ? item : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter((e): e is { name: string; path: string } => e !== null);
  let hasWorkflows = false;
  try {
    hasWorkflows = (
      await stat(join(current, ".github/workflows"))
    ).isDirectory();
  } catch {}
  return {
    path: current,
    parentPath: dirname(current) === current ? null : dirname(current),
    folders,
    shortcuts,
    hasWorkflows,
  };
}
