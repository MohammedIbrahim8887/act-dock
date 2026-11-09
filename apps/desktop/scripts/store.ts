/**
 * Project Store for Act Dock.
 * Manages registered projects with local persistence.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectDefaults {
  branch?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
}

export interface Project {
  id: string;
  path: string;
  name: string;
  defaults?: ProjectDefaults;
  addedAt?: string;
}

const STORE_PATH = join(process.cwd(), '.act-dock-store.json');

export class Store {
  private static projectsMap: Map<string, Project> = new Map();
  private static isLoaded = false;

  constructor() {
    Store.loadFromDisk();
  }

  private static loadFromDisk(): void {
    if (Store.isLoaded) return;
    Store.isLoaded = true;

    try {
      if (existsSync(STORE_PATH)) {
        const raw = readFileSync(STORE_PATH, 'utf-8');
        const list: Project[] = JSON.parse(raw);
        for (const item of list) {
          Store.projectsMap.set(item.id, item);
        }
      }
    } catch {
      // Ignore parse errors on first load
    }
  }

  private static saveToDisk(): void {
    try {
      const list = Array.from(Store.projectsMap.values());
      writeFileSync(STORE_PATH, JSON.stringify(list, null, 2), 'utf-8');
    } catch {
      // Continue even if local write fails
    }
  }

  putProject(project: Project): void {
    const existing = Store.projectsMap.get(project.id);
    Store.projectsMap.set(project.id, {
      ...existing,
      ...project,
      addedAt: existing?.addedAt || new Date().toISOString(),
    });
    Store.saveToDisk();
  }

  project(projectId: string): Project | undefined {
    return Store.projectsMap.get(projectId);
  }

  projects(): Project[] {
    return Array.from(Store.projectsMap.values());
  }

  removeProject(projectId: string): boolean {
    const deleted = Store.projectsMap.delete(projectId);
    if (deleted) {
      Store.saveToDisk();
    }
    return deleted;
  }
}

