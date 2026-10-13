import fs from 'node:fs';
import path from 'node:path';
import { copyTemplate, dataDir, now, packageRoot, readJson, registerProject, writeJson } from './files.js';

const marker = '<!-- maria-testing-kit -->';
function addReference(file, text) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!existing.includes(marker)) fs.writeFileSync(file, `${existing.trimEnd()}${existing ? '\n\n' : ''}${marker}\n${text}\n`);
}

function ignoreRuns(project) {
  const file = path.join(project, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!existing.split(/\r?\n/).includes('.maria/runs/')) fs.writeFileSync(file, `${existing.trimEnd()}${existing ? '\n' : ''}.maria/runs/\n`);
}

export function detectRunner(project) {
  const pkg = readJson(path.join(project, 'package.json'), {});
  const scripts = pkg.scripts || {};
  const command = scripts['test:e2e'] ? 'npm run test:e2e' : scripts['test:ui'] ? 'npm run test:ui' : '';
  return { schemaVersion: 1, command, format: 'none', reportPath: '', coveragePath: '', screenshotsPath: '', evidencePath: '' };
}

export function initialize(project) {
  project = path.resolve(project);
  if (!fs.statSync(project).isDirectory()) throw new Error('Project path must be a directory');
  const dir = dataDir(project);
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  const projectFile = path.join(dir, 'project.json');
  if (!fs.existsSync(projectFile)) writeJson(projectFile, {
    schemaVersion: 1, id: path.basename(project), name: path.basename(project),
    root: project, createdAt: now(), preferredAgent: 'auto'
  });
  const starterFiles = {
    'product.json': { schemaVersion: 1, name: path.basename(project), summary: '', platforms: [], personas: [], features: [], rules: [], sources: [], unknowns: [] },
    'cases.json': { schemaVersion: 1, cases: [] },
    'runner.json': detectRunner(project)
  };
  for (const [name, content] of Object.entries(starterFiles)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) writeJson(file, content);
  }
  fs.copyFileSync(path.join(packageRoot, 'schema', 'maria.schema.json'), path.join(dir, 'schema.json'));
  copyTemplate('SKILL.md', path.join(project, '.agents', 'skills', 'maria', 'SKILL.md'));
  copyTemplate('SKILL.md', path.join(project, '.claude', 'skills', 'maria', 'SKILL.md'));
  addReference(path.join(project, 'AGENTS.md'), 'For testing work, read `.agents/skills/maria/SKILL.md` and follow the `.maria/` data contract.');
  addReference(path.join(project, 'CLAUDE.md'), 'For testing work, read `.claude/skills/maria/SKILL.md` and follow the `.maria/` data contract.');
  ignoreRuns(project);
  registerProject(project);
  return readJson(projectFile);
}
