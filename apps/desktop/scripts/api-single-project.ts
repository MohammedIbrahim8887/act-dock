/** 
 * API handler for adding a single project (existing functionality).
 * Kept separate for modularity and to support the multi-project handler.
 */

import { Store } from './store';
import { apiResponse } from './api-utils';

export async function add_project(request: {
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