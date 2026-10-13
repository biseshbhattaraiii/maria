import fs from 'node:fs';
import path from 'node:path';
import { inside, readJson } from './files.js';

const asStatus = value => value === 'passed' || value === 'pass' ? 'passed' : value === 'skipped' || value === 'pending' ? 'skipped' : 'failed';
const decodeXml = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag, key) => decodeXml(tag.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] || '');

function playwrightTests(report) {
  const output = [];
  function visit(suite) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const last = test.results?.at(-1) || {};
        output.push({ name: spec.title, status: asStatus(test.status === 'skipped' ? 'skipped' : last.status || test.status), durationMs: last.duration || 0,
          error: last.error?.message || last.errors?.map(error => error.message).join('\n') || '',
          file: spec.file || suite.file || '', caseId: spec.title.match(/\[(case-[\w-]+)\]/)?.[1] || '' });
      }
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites || []) visit(suite);
  return output;
}

function jestTests(report) {
  return (report.testResults || []).flatMap(file => (file.assertionResults || []).map(test => ({
    name: test.fullName || test.title, status: asStatus(test.status), durationMs: test.duration || 0,
    error: (test.failureMessages || []).join('\n'), file: file.name || '',
    caseId: (test.fullName || test.title || '').match(/\[(case-[\w-]+)\]/)?.[1] || ''
  })));
}

function junitTests(xml) {
  const output = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = match[2] || '';
    const name = attr(match[1], 'name');
    const error = body.match(/<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/)?.[1] || '';
    output.push({ name, status: /<(?:failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed',
      durationMs: Number(attr(match[1], 'time')) * 1000 || 0, error: decodeXml(error.trim()),
      file: attr(match[1], 'classname'), caseId: name.match(/\[(case-[\w-]+)\]/)?.[1] || '' });
  }
  return output;
}

export function parseReport(format, file) {
  if (!file || !fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  if (format === 'playwright-json') return playwrightTests(JSON.parse(content));
  if (format === 'jest-json') return jestTests(JSON.parse(content));
  if (format === 'junit') return junitTests(content);
  return [];
}

export function parseLcov(file) {
  if (!file || !fs.existsSync(file)) return { lines: null, branches: null, functions: null };
  const content = fs.readFileSync(file, 'utf8');
  const sums = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
  for (const match of content.matchAll(/^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/gm)) sums[match[1]] += Number(match[2]);
  const pct = (hit, found) => found ? Math.round(hit / found * 1000) / 10 : null;
  return { lines: pct(sums.LH, sums.LF), branches: pct(sums.BRH, sums.BRF), functions: pct(sums.FNH, sums.FNF) };
}

export function caseCoverage(product, cases) {
  const all = cases.cases || [];
  const automated = all.filter(item => item.automation?.status === 'automated');
  const ruleIds = new Set(automated.flatMap(item => item.ruleIds || []));
  const rules = product.rules || [];
  return { cases: all.length ? Math.round(automated.length / all.length * 1000) / 10 : null,
    rules: rules.length ? Math.round(rules.filter(item => ruleIds.has(item.id)).length / rules.length * 1000) / 10 : null };
}

function isWithinRealProject(project, file) {
  const root = fs.realpathSync(project);
  const target = fs.realpathSync(file);
  return target === root || target.startsWith(root + path.sep);
}

function isFreshFile(project, file, startedAtMs) {
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) return false;
  if (!isWithinRealProject(project, file)) return false;
  const stat = fs.statSync(file);
  return stat.isFile() && stat.mtimeMs >= startedAtMs - 1000;
}

export function collectArtifacts(project, runDir, runner, tests = [], startedAtMs = 0) {
  const artifacts = [];
  const include = (source, kind) => {
    if (!source || !fs.existsSync(source)) return;
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (artifacts.length >= 150) break;
        if (entry.isSymbolicLink()) continue;
        include(path.join(source, entry.name), kind);
      }
      return;
    }
    if (!isFreshFile(project, source, startedAtMs) || stat.size > 50 * 1024 * 1024) return;
    const ext = path.extname(source).toLowerCase();
    if (kind === 'screenshot' && !['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return;
    const destination = path.join(runDir, 'artifacts', `${String(artifacts.length + 1).padStart(3, '0')}-${path.basename(source)}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    const artifact = { kind, path: path.relative(project, destination).split(path.sep).join('/'), label: path.basename(source) };
    if (kind === 'screenshot') {
      const sourcePath = path.relative(project, source);
      const matches = tests.filter(test => test.caseId && sourcePath.includes(test.caseId));
      if (matches.length === 1) {
        artifact.caseId = matches[0].caseId;
        artifact.testName = matches[0].name;
        matches[0].evidence ||= { checks: [], artifacts: [] };
        matches[0].evidence.artifacts.push(artifact);
      }
    }
    artifacts.push(artifact);
  };
  if (runner.reportPath) include(inside(project, runner.reportPath), 'report');
  if (runner.screenshotsPath) include(inside(project, runner.screenshotsPath), 'screenshot');
  return artifacts;
}

// Evidence is written by the tests during this run, then copied into the run snapshot.
// A case ID alone is accepted only when it identifies exactly one reported test.
export function collectEvidence(project, runDir, runner, tests, startedAtMs) {
  if (!runner.evidencePath) return [];
  const source = inside(project, runner.evidencePath);
  if (!fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink() || !isWithinRealProject(project, source)) return [];
  const files = fs.statSync(source).isDirectory()
    ? fs.readdirSync(source).filter(name => name.endsWith('.json')).slice(0, 150).map(name => path.join(source, name))
    : [source];
  const artifacts = [];
  const fresh = file => isFreshFile(project, file, startedAtMs);
  for (const file of files) {
    if (!fresh(file) || fs.statSync(file).size > 1024 * 1024) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const entries = Array.isArray(manifest?.tests) ? manifest.tests : [manifest];
    if (manifest?.schemaVersion !== 1) continue;
    for (const entry of entries.slice(0, 150)) {
      if (!entry || typeof entry !== 'object' || (!entry.caseId && !entry.testName)) continue;
      const matches = tests.filter(test => (!entry.caseId || test.caseId === entry.caseId) && (!entry.testName || test.name === entry.testName));
      if (matches.length !== 1) continue;
      const test = matches[0];
      test.evidence ||= { checks: [], artifacts: [] };
      for (const check of (Array.isArray(entry.checks) ? entry.checks : []).slice(0, 20)) {
        if (typeof check?.expected !== 'string' || typeof check?.actual !== 'string') continue;
        test.evidence.checks.push({ expected: check.expected.slice(0, 1000), actual: check.actual.slice(0, 1000) });
      }
      for (const attachment of (Array.isArray(entry.attachments) ? entry.attachments : []).slice(0, 20)) {
        if (!['screenshot', 'video', 'trace', 'log'].includes(attachment?.kind) || typeof attachment.path !== 'string') continue;
        let attachmentFile;
        try { attachmentFile = inside(project, attachment.path); } catch { continue; }
        if (!fresh(attachmentFile) || fs.statSync(attachmentFile).size > 50 * 1024 * 1024) continue;
        const ext = path.extname(attachmentFile).toLowerCase();
        const allowed = { screenshot: ['.png', '.jpg', '.jpeg', '.webp'], video: ['.mp4', '.webm'], trace: ['.zip'], log: ['.log', '.txt'] };
        if (!allowed[attachment.kind].includes(ext)) continue;
        const destination = path.join(runDir, 'artifacts', `evidence-${String(tests.indexOf(test) + 1).padStart(3, '0')}-${String(artifacts.length + 1).padStart(3, '0')}${ext}`);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(attachmentFile, destination);
        const artifact = { kind: attachment.kind, path: path.relative(project, destination).split(path.sep).join('/'), label: path.basename(attachmentFile), caseId: test.caseId, testName: test.name };
        artifacts.push(artifact);
        test.evidence.artifacts.push(artifact);
      }
    }
  }
  return artifacts;
}

export function readProjectData(project) {
  const dir = path.join(project, '.maria');
  return {
    project: readJson(path.join(dir, 'project.json'), {}),
    product: readJson(path.join(dir, 'product.json'), { rules: [], features: [] }),
    cases: readJson(path.join(dir, 'cases.json'), { cases: [] }),
    runner: readJson(path.join(dir, 'runner.json'), {}),
    handoff: readJson(path.join(dir, 'handoff.json'), null)
  };
}
