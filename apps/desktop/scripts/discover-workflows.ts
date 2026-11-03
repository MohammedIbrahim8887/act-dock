/** 
 * Discover workflows from both GitHub Actions and GitLab CI/CD configurations.
 * 
 * GitHub: looks for .github/workflows/*.{yml,yaml}
 * GitLab: looks for .gitlab-ci.yml at project root
 * 
 * Returns workflows tagged with their source platform.
 */

import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type WorkflowSource = 'github' | 'gitlab';

export interface DiscoveredWorkflow {
  source: WorkflowSource;
  path: string;          // relative path within project
  name: string;          // workflow name (derived from filename)
  events: string[];      // trigger events
  diagnostic?: string;   // any parse errors
}

/**
 * Extract trigger events from a GitHub Actions workflow file
 */
function extractGitHubEvents(content: string): string[] {
  const events: string[] = [];
  // Match "on:" keyword and its value
  const onMatches = content.match(/on:\s*([\s\S]*?)(?:\n|\z)/);
  if (onMatches && onMatches[1]) {
    const onValue = onMatches[1].trim();
    // Handle different on: formats
    if (onValue === 'push' || onValue === 'pull_request' || onValue === 'schedule') {
      events.push(onValue);
    } else if (onValue.startsWith('[')) {
      // Array format: on: [push, pull_request]
      const arrayEvents = onValue
        .replace(/\[/, '')
        .replace(/\]/, '')
        .split(',')
        .map((e: string) => e.trim())
        .filter((e: string) => e.length > 0);
      events.push(...arrayEvents);
    } else if (onValue.includes(':')) {
      // Mapping format: on: push: branches: [main]
      const firstEvent = onValue.split(':')[0].trim();
      if (firstEvent) events.push(firstEvent);
    }
  }
  return events;
}

/**
 * Extract trigger events from a GitLab CI/CD configuration file
 */
function extractGitLabEvents(content: string): string[] {
  const events: string[] = [];
  // GitLab CI triggers: push, merge_request, schedule, tag_push, etc.
  // Match job-level `on:` or top-level `trigger:` but most common is implicit
  // Look for `only:`/`except:` keywords which define when jobs run
  const onlyMatches = content.match(/only:\s*([\s\S]*?)(?:\n|\z)/i);
  const exceptMatches = content.match(/except:\s*([\s\S]*?)(?:\n|\z)/i);

  if (onlyMatches && onlyMatches[1]) {
    const onlyContent = onlyMatches[1].trim();
    // Parse YAML-like list or single value
    if (onlyContent.startsWith('-')) {
      // List format
      const items = onlyContent
        .split('\n')
        .map((l: string) => l.trim().replace(/^-/, '').trim())
        .filter((l: string) => l.length > 0);
      events.push(...items);
    } else {
      // Single value or comma-separated
      const items = onlyContent
        .split(',')
        .map((e: string) => e.trim())
        .filter((e: string) => e.length > 0);
      events.push(...items);
    }
  } else {
    // If no `only:`, GitLab runs on all supported events by default
    // Check for common top-level keys
    if (content.includes('push:')) events.push('push');
    if (content.includes('merge_request:')) events.push('merge_request');
    if (content.includes('schedule:')) events.push('schedule');
    if (content.includes('tag_push:')) events.push('tag_push');
    if (content.includes('fork:')) events.push('fork');
  }

  // Deduplicate while preserving order
  return [...new Set(events)];
}

/**
 * Discover GitHub Actions workflows from .github/workflows/
 */
async function discoverGitHubWorkflows(projectPath: string): Promise<DiscoveredWorkflow[]> {
  const workflows: DiscoveredWorkflow[] = [];
  const githubDir = join(projectPath, '.github', 'workflows');

  try {
    const entries = await readdir(githubDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
        try {
          const content = await readFile(join(githubDir, entry.name), 'utf8');
          workflows.push({
            source: 'github',
            path: `.github/workflows/${entry.name}`,
            name: entry.name.replace(/\.ya?ml$/, ''),
            events: extractGitHubEvents(content),
          });
        } catch (err) {
          workflows.push({
            source: 'github',
            path: `.github/workflows/${entry.name}`,
            name: entry.name.replace(/\.ya?ml$/, ''),
            events: [],
            diagnostic: (err as Error).message,
          });
        }
      }
    }
  } catch {
    // Directory doesn't exist - no GitHub workflows found
  }

  return workflows;
}

/**
 * Discover GitLab CI/CD configuration from .gitlab-ci.yml
 */
async function discoverGitLabWorkflows(projectPath: string): Promise<DiscoveredWorkflow[]> {
  const workflows: DiscoveredWorkflow[] = [];
  const gitlabFile = join(projectPath, '.gitlab-ci.yml');

  try {
    const content = await readFile(gitlabFile, 'utf8');
    workflows.push({
      source: 'gitlab',
      path: '.gitlab-ci.yml',
      name: 'default',
      events: extractGitLabEvents(content),
    });
  } catch {
    // No .gitlab-ci.yml at root
  }

  // Also check for .gitlab/ci/ directory (newer GitLab setups)
  try {
    const ciDir = join(projectPath, '.gitlab', 'ci');
    const entries = await readdir(ciDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
        try {
          const content = await readFile(join(ciDir, entry.name), 'utf8');
          workflows.push({
            source: 'gitlab',
            path: `.gitlab/ci/${entry.name}`,
            name: entry.name.replace(/\.ya?ml$/, ''),
            events: extractGitLabEvents(content),
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return workflows;
}

/**
 * Main discovery function - finds workflows from both platforms
 */
export async function discoverAllWorkflows(projectPath: string): Promise<DiscoveredWorkflow[]> {
  const [github, gitlab] = await Promise.all([
    discoverGitHubWorkflows(projectPath),
    discoverGitLabWorkflows(projectPath),
  ]);

  // If both platforms have workflows, return combined list
  // If only one has workflows, return just those
  if (github.length > 0 && gitlab.length > 0) {
    return [...github, ...gitlab];
  }
  if (github.length > 0) return github;
  if (gitlab.length > 0) return gitlab;

  return [];
}

/**
 * Auto-detect which CI/CD platform a project uses
 */
export async function detectCiCdPlatform(projectPath: string): Promise<'github' | 'gitlab' | 'both' | 'none'> {
  import('node:fs/promises').then(() => {}).catch(() => {});

  // Check for GitHub workflows using readdir
  let hasGitHub = false;
  try {
    const { readdir } = await import('node:fs/promises');
    await readdir(join(projectPath, '.github', 'workflows'));
    hasGitHub = true;
  } catch {
    // Directory doesn't exist
  }

  // Check for GitLab CI
  let hasGitLab = false;
  try {
    const { access } = await import('node:fs/promises');
    await access(join(projectPath, '.gitlab-ci.yml'));
    hasGitLab = true;
  } catch {
    // File doesn't exist
  }

  if (hasGitHub && hasGitLab) return 'both';
  if (hasGitHub) return 'github';
  if (hasGitLab) return 'gitlab';
  return 'none';
}

/**
 * Get display label for a workflow source
 */
export function getSourceLabel(source: WorkflowSource): string {
  switch (source) {
    case 'github':
      return 'GitHub Actions';
    case 'gitlab':
      return 'GitLab CI';
    case 'both':
      return 'Both';
    default:
      return 'Unknown';
  }
}

/**
 * Get color/icon class for a workflow source (for UI)
 */
export function getSourceClass(source: WorkflowSource): string {
  switch (source) {
    case 'github':
      return 'text-primary';
    case 'gitlab':
      return 'text-secondary';
    case 'both':
      return 'text-success';
    default:
      return 'text-muted-foreground';
  }
}