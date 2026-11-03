/** 
 * API handler for adding multiple projects at once.
 * Supports bulk project addition from multiple folders.
 */

import { Store } from './store';
import { apiResponse } from './api-utils';
import { discoverAllWorkflows, detectCiCdPlatform } from './discover-workflows';

export async function add_projects_multiple(request: {
  projects: { id: string; path: string; name: string }[];
}): Promise<apiResponse> {
  const store = new Store();
  
  try {
    const addedProjects: { id: string; path: string; name: string }[] = [];
    
    for (const project of request.projects) {
      // Validate path exists
      if (!project.path || !Bun.file(project.path).exists) {
        // Skip invalid paths but continue with others
        continue;
      }
      
      // Put project in store
      store.putProject({
        id: project.id,
        path: project.path,
        name: project.name,
        defaults: {},
      });
      
      // Discover workflows from this project
      try {
        const workflows = await discoverAllWorkflows(project.path);
        // Store workflow info if needed
      } catch {
        // Continue even if workflow discovery fails
      }
      
      addedProjects.push(project);
    }
    
    return apiResponse(200, {
      success: true,
      added: addedProjects.length,
      totalRequested: request.projects.length,
      projects: addedProjects,
    });
  } catch (err) {
    return apiResponse(500, {
      success: false,
      error: (err as Error).message,
    });
  }
}

/** 
 * API handler for detecting CI/CD platform for multiple projects
 */
export async function platforms_for_projects(request: {
  projectPaths: string[];
}): Promise<apiResponse> {
  const results: Record<string, 'github' | 'gitlab' | 'both' | 'none'> = {};
  
  for (const path of request.projectPaths) {
    try {
      // Use dynamic import to avoid circular deps
      const { detectCiCdPlatform } = await import('../scripts/discover-workflows');
      results[path] = await detectCiCdPlatform(path);
    } catch {
      results[path] = 'none';
    }
  }
  
  return apiResponse(200, {
    platforms: results,
  });
}