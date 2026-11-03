/** 
 * API handler for listing workflows from a project.
 * Supports both GitHub Actions (.github/workflows/) and GitLab CI (.gitlab-ci.yml).
 */

import { join } from 'node:path';
import { discoverAllWorkflows, detectCiCdPlatform, getSourceLabel, getSourceClass } from './discover-workflows';
import { Store } from './store';
import { apiResponse } from './api-utils';

export async function list_workflows(projectId: string) {
  const store = new Store();
  const project = store.project(projectId);

  if (!project || !project.path) {
    return apiResponse(404, { error: 'Project not found' });
  }

  // Discover workflows from both platforms
  const workflows = await discoverAllWorkflows(project.path);

  // Detect which platform(s) are used
  const platform = await detectCiCdPlatform(project.path);

  return apiResponse(200, {
    workflows,
    platform,
    sourceLabel: getSourceLabel(platform as any),
    sourceClass: getSourceClass(platform as any),
    projectPath: project.path,
  });
}

/**
 * Get the CI/CD platform detection for a project
 */
export async function get_platform(projectId: string) {
  const store = new Store();
  const project = store.project(projectId);

  if (!project || !project.path) {
    return apiResponse(404, { error: 'Project not found' });
  }

  const platform = await detectCiCdPlatform(project.path);

  return apiResponse(200, {
    platform,
    sourceLabel: getSourceLabel(platform as any),
  });
}

/**
 * Get workflows filtered by source (github, gitlab, or both)
 */
export async function list_workflows_by_source(projectId: string, source: 'github' | 'gitlab') {
  const store = new Store();
  const project = store.project(projectId);

  if (!project || !project.path) {
    return apiResponse(404, { error: 'Project not found' });
  }

  const allWorkflows = await discoverAllWorkflows(project.path);
  const filteredWorkflows = allWorkflows.filter(
    (w) => w.source === source
  );

  return apiResponse(200, {
    workflows: filteredWorkflows,
    source,
    count: filteredWorkflows.length,
  });
}

/**
 * Validate a workflow file exists and is parseable
 */
export async function validate_workflow(projectId: string, workflowPath: string) {
  const store = new Store();
  const project = store.project(projectId);

  if (!project || !project.path) {
    return apiResponse(404, { error: 'Project not found' });
  }

  const fullPath = join(project.path, workflowPath);
  
  try {
    const content = await Bun.file(fullPath).text();
    
    // Try to determine the source and validate
    let source: 'github' | 'gitlab' | 'unknown' = 'unknown';
    let events: string[] = [];
    let name = workflowPath.split('/').pop()?.replace(/\.ya?ml$/, '') || 'unknown';

    if (workflowPath.startsWith('.github')) {
      source = 'github';
      const onMatches = content.match(/on:\s*([\s\S]*?)(?:\n|\z)/i);
      if (onMatches && onMatches[1]) {
        const onValue = onMatches[1].trim();
        if (onValue === 'push' || onValue === 'pull_request' || onValue === 'schedule') {
          events = [onValue];
        } else if (onValue.startsWith('[')) {
          const arrayEvents = onValue
            .replace(/\[/, '')
            .replace(/\]/, '')
            .split(',')
            .map((e: string) => e.trim())
            .filter((e: string) => e.length > 0);
          events = arrayEvents;
        } else if (onValue.includes(':')) {
          const firstEvent = onValue.split(':')[0].trim();
          if (firstEvent) events = [firstEvent];
        }
      }
    } else if (workflowPath === '.gitlab-ci.yml' || workflowPath.startsWith('.gitlab/')) {
      source = 'gitlab';
      // Simple GitLab event detection
      if (content.includes('push:')) events.push('push');
      if (content.includes('merge_request:')) events.push('merge_request');
      if (content.includes('schedule:')) events.push('schedule');
      if (content.includes('tag_push:')) events.push('tag_push');
      if (content.includes('fork:')) events.push('fork');
      // If no specific events detected, GitLab runs on push by default
      if (events.length === 0) events = ['push'];
    }

    return apiResponse(200, {
      valid: true,
      source,
      name,
      events,
      path: workflowPath,
    });
  } catch (err) {
    return apiResponse(200, {
      valid: false,
      error: (err as Error).message,
      path: workflowPath,
    });
  }
}