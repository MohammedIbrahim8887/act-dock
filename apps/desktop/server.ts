/**
 * Act Dock Local Dashboard Server
 * Powered by Bun.serve
 */

import { join, resolve } from 'node:path';
import { Store } from './scripts/store';
import { add_project_handler, add_projects_multiple_handler } from './scripts/api-projects';
import { list_workflows } from './scripts/api-workflows';
import { discoverAllWorkflows, detectCiCdPlatform } from './scripts/discover-workflows';

const PORT = 3333;
const store = new Store();
const HTML_PATH = join(import.meta.dir, 'dashboard.html');

// Pre-seed current project and samples if empty
if (store.projects().length === 0) {
  store.putProject({
    id: resolve(process.cwd()),
    path: resolve(process.cwd()),
    name: 'act-dock-clone (Current)',
  });
  store.putProject({
    id: '/Users/oza/Developer/Personal P/Red Cross 2',
    path: '/Users/oza/Developer/Personal P/Red Cross 2',
    name: 'Red Cross 2 (Sample)',
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const method = req.method;
  const path = url.pathname;

  if (path === '/api/projects') {
    if (method === 'GET') {
      return jsonResponse({ projects: store.projects() });
    }

    if (method === 'POST') {
      const body = await req.json() as { path: string; name?: string };
      const result = await add_project_handler(body);
      return jsonResponse(result.data, result.status);
    }

    if (method === 'DELETE') {
      const id = url.searchParams.get('id') || '';
      const removed = store.removeProject(id);
      return jsonResponse({ success: removed });
    }
  }

  if (path === '/api/projects/multiple' && method === 'POST') {
    const body = await req.json() as { projects: { id: string; path: string; name: string }[] };
    const result = await add_projects_multiple_handler(body);
    return jsonResponse(result.data, result.status);
  }

  if (path === '/api/workflows' && method === 'GET') {
    const projectId = url.searchParams.get('projectId') || '';
    const result = await list_workflows(projectId);
    return jsonResponse(result.data, result.status);
  }

  if (path === '/api/scan' && method === 'POST') {
    const body = await req.json() as { path: string };
    const targetPath = resolve(body.path || '.');
    const platform = await detectCiCdPlatform(targetPath);
    const workflows = await discoverAllWorkflows(targetPath);
    return jsonResponse({ path: targetPath, platform, workflows });
  }

  return jsonResponse({ error: 'Endpoint not found' }, 404);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/') {
      return new Response(Bun.file(HTML_PATH), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, url);
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`⚡ Act Dock Dashboard live at http://localhost:${server.port}`);

