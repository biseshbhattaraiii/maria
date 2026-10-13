import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { availableAgents, selectAgents } from './agents.js';
import { configuredProject, inside, projectCatalog, readJson } from './files.js';
import { readProjectData } from './results.js';
import { listRuns, runWorkflow } from './run.js';
import { initialize } from './setup.js';

const staticRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
const running = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.log': 'text/plain; charset=utf-8' };

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function sendFile(res, file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return send(res, 404, { error: 'File not found' });
  res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

async function body(req) {
  let content = '';
  for await (const chunk of req) {
    content += chunk;
    if (content.length > 1024 * 1024) throw new Error('Request is too large');
  }
  return JSON.parse(content || '{}');
}

function browse(folder) {
  const full = path.resolve(folder || os.homedir());
  const entries = fs.readdirSync(full, { withFileTypes: true }).slice(0, 500).map(entry => ({ name: entry.name, directory: entry.isDirectory(), symlink: entry.isSymbolicLink() }));
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { path: full, parent: path.dirname(full), entries };
}

function fileTree(project, relative = '') {
  const directory = inside(project, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true }).slice(0, 500).map(entry => ({ name: entry.name, path: path.join(relative, entry.name), directory: entry.isDirectory(), symlink: entry.isSymbolicLink() }));
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { path: relative, entries };
}

async function handler(req, res) {
  try {
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Cross-origin request blocked' });
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
      const input = await body(req);
      if (url.pathname === '/api/projects') return send(res, 200, initialize(input.path));
      if (url.pathname === '/api/runs') {
        const project = configuredProject(input.project);
        if (running.has(project)) return send(res, 409, { error: 'A run is already in progress' });
        selectAgents(input.agent || 'auto');
        const promise = runWorkflow(project, { agent: input.agent || 'auto' }).catch(error => console.error(`Maria run failed: ${error.message}`));
        running.set(project, promise);
        promise.finally(() => running.delete(project));
        return send(res, 202, { started: true });
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    if (url.pathname === '/api/meta') return send(res, 200, { agents: availableAgents(), home: os.homedir(), version: '0.1.0' });
    if (url.pathname === '/api/projects') return send(res, 200, projectCatalog().projects.map(project => ({ path: project, exists: fs.existsSync(path.join(project, '.maria', 'project.json')) })));
    if (url.pathname === '/api/browse') return send(res, 200, browse(url.searchParams.get('path')));
    if (url.pathname === '/api/project') {
      const project = configuredProject(url.searchParams.get('path'));
      return send(res, 200, { root: project, ...readProjectData(project), runs: listRuns(project), running: running.has(project) });
    }
    if (url.pathname === '/api/files') return send(res, 200, fileTree(configuredProject(url.searchParams.get('project')), url.searchParams.get('path') || ''));
    if (url.pathname === '/api/artifact') {
      const project = configuredProject(url.searchParams.get('project'));
      const id = url.searchParams.get('run') || '';
      if (!/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Invalid run' });
      const runDir = path.join(project, '.maria', 'runs', id);
      const run = readJson(path.join(runDir, 'run.json'));
      const relative = url.searchParams.get('path') || '';
      if (!run || !run.artifacts.some(item => item.path === relative)) return send(res, 404, { error: 'Artifact not found' });
      const artifact = inside(project, relative);
      inside(runDir, path.relative(runDir, artifact));
      return sendFile(res, artifact);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });
    const file = inside(staticRoot, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    return sendFile(res, file);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 400;
    send(res, status, { error: error.message });
  }
}

export async function serve({ port = 4317, open = true } = {}) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = `http://127.0.0.1:${server.address().port}`;
  console.log(`Maria command center: ${address}`);
  if (open) {
    const platform = process.platform;
    const bin = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', address] : [address];
    const child = spawn(bin, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  }
  return server;
}
