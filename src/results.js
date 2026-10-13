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

export function collectArtifacts(project, runDir, runner) {
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
    if (!stat.isFile() || stat.size > 50 * 1024 * 1024) return;
    const ext = path.extname(source).toLowerCase();
    if (kind === 'screenshot' && !['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return;
    const destination = path.join(runDir, 'artifacts', `${String(artifacts.length + 1).padStart(3, '0')}-${path.basename(source)}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    artifacts.push({ kind, path: path.relative(project, destination).split(path.sep).join('/') });
  };
  if (runner.reportPath) include(inside(project, runner.reportPath), 'report');
  if (runner.screenshotsPath) include(inside(project, runner.screenshotsPath), 'screenshot');
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
