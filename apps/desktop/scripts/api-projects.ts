/** 
 * Main API handler for project management.
 * Supports both single and multiple project addition.
 */

import { Store } from './store';
import { apiResponse } from './api-utils';
import { add_projects_multiple, platforms_for_projects } from './api-multi-projects';
import { add_project } from './api-single-project'; // Assume exists

/** 
 * Handle adding a single project (existing functionality)
 */
export async function add_project_handler(request: {
  path: string;
  name?: string;
}): Promise<apiResponse> {
  const store = new Store();
  
  try {
    const path = request.path.trim();
    const name = request.name || path.split('/').pop() || 'Unknown Project';
    
    if (!path) {
      return apiResponse(400, { error: 'Path is required' });
    }
    
    // Validate path exists
    if (!Bun.file(path).exists) {
      return apiResponse(400, { error: 'Path does not exist' });
    }
    
    // Put project in store
    store.putProject({
      id: path,
      path,
      name,
      defaults: {},
    });
    
    // Discover workflows
    try {
      const { discoverAllWorkflows } = await import('./discover-workflows');
      const workflows = await discoverAllWorkflows(path);
    } catch {
      // Continue even if discovery fails
    }
    
    return apiResponse(200, {
      success: true,
      project: { id: path, path, name },
    });
  } catch (err) {
    return apiResponse(500, {
      success: false,
      error: (err as Error).message,
    });
  }
}

/** 
 * Handle adding multiple projects at once (new functionality)
 */
export async function add_projects_multiple_handler(request: {
  projects: { id: string; path: string; name: string }[];
}): Promise<apiResponse> {
  return await add_projects_multiple(request);
}

/** 
 * Detect CI/CD platform for multiple projects */
export async function platforms_for_projects_handler(request: {
  projectPaths: string[];
}): Promise<apiResponse> {
  return await platforms_for_projects(request);
}