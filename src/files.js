import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const mariaHome = () => path.resolve(process.env.MARIA_HOME || path.join(os.homedir(), '.maria'));
export const dataDir = project => path.join(project, '.maria');
export const now = () => new Date().toISOString();

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function inside(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('Path leaves the project');
  return target;
}

export function copyTemplate(name, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(packageRoot, 'templates', name), target);
}

export function configuredProject(input = process.cwd()) {
  const project = path.resolve(input);
  if (!fs.existsSync(path.join(dataDir(project), 'project.json'))) {
    throw new Error(`Maria is not initialized in ${project}. Run: maria init ${project}`);
  }
  return project;
}

export function projectCatalog() {
  return readJson(path.join(mariaHome(), 'projects.json'), { schemaVersion: 1, projects: [] });
}

export function registerProject(project) {
  const catalog = projectCatalog();
  catalog.projects = [...new Set([project, ...catalog.projects])];
  writeJson(path.join(mariaHome(), 'projects.json'), catalog);
}
