import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialize } from '../src/setup.js';
import { readJson, writeJson } from '../src/files.js';
import { parseReport } from '../src/results.js';
import { runWorkflow } from '../src/run.js';
import { serve } from '../src/server.js';

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maria-test-'));
  const project = path.join(root, 'example-app');
  fs.mkdirSync(project);
  process.env.MARIA_HOME = path.join(root, 'home');
  initialize(project);
  assert.ok(fs.existsSync(path.join(project, '.maria', 'schema.json')));
  return { root, project };
}

test('agent handoff, Jest ingestion, screenshots, and coverage work together', async () => {
  const { root, project } = workspace();
  const originalClaude = process.env.MARIA_CLAUDE_BIN;
  const originalCodex = process.env.MARIA_CODEX_BIN;
  try {
    fs.writeFileSync(path.join(project, 'report.cjs'), `const fs = require('fs'); fs.mkdirSync('test-results',{recursive:true}); fs.writeFileSync('test-results/results.json',JSON.stringify({testResults:[{name:'tests/login.test.js',assertionResults:[{fullName:'[case-login-01] accepts a valid user',status:'passed',duration:12,failureMessages:[]}]}]})); fs.writeFileSync('test-results/screenshot.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X5HkAAAAASUVORK5CYII=','base64')); fs.mkdirSync('coverage',{recursive:true}); fs.writeFileSync('coverage/lcov.info','SF:login.js\\nLF:10\\nLH:8\\nBRF:4\\nBRH:3\\nFNF:2\\nFNH:2\\nend_of_record\\n');`);
    const fake = `#!/usr/bin/env node
const fs=require('fs'); const path=require('path');
if(process.argv.includes('--version')) { console.log('1.0'); process.exit(0); }
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Exploring project'}]}}));
let input=''; process.stdin.on('data',chunk=>input+=chunk); process.stdin.on('end',()=>{
const dir=path.join(process.cwd(),'.maria');
if(input.includes('Do not write tests in this phase')) {
fs.writeFileSync(path.join(dir,'product.json'),JSON.stringify({schemaVersion:1,name:'Example app',summary:'A login screen',platforms:['web'],features:[{id:'feature-login',name:'Login',description:'Authenticate users'}],rules:[{id:'rule-login',featureId:'feature-login',statement:'Valid users can log in',sourcePaths:['README.md'],confidence:'documented'}],sources:['README.md'],unknowns:[]}));
fs.writeFileSync(path.join(dir,'cases.json'),JSON.stringify({schemaVersion:1,cases:[{id:'case-login-01',title:'Valid login',featureId:'feature-login',ruleIds:['rule-login'],steps:['Enter valid credentials'],expected:['User enters'],priority:'high',automation:{status:'planned',file:null}}]}));
fs.writeFileSync(path.join(dir,'handoff.json'),JSON.stringify({schemaVersion:1,phase:'discovery',agent:'claude',summary:'Login mapped',completed:['product'],next:['tests'],risks:[],updatedAt:new Date().toISOString()}));
} else {
const cases=JSON.parse(fs.readFileSync(path.join(dir,'cases.json'))); cases.cases[0].automation={status:'automated',file:'tests/login.test.js',testName:'[case-login-01] accepts a valid user'}; fs.mkdirSync('tests',{recursive:true}); fs.writeFileSync('tests/login.test.js','// test fixture'); fs.writeFileSync(path.join(dir,'cases.json'),JSON.stringify(cases));
fs.writeFileSync(path.join(dir,'runner.json'),JSON.stringify({schemaVersion:1,command:'node report.cjs',format:'jest-json',reportPath:'test-results/results.json',coveragePath:'coverage/lcov.info',screenshotsPath:'test-results'}));
fs.writeFileSync(path.join(dir,'handoff.json'),JSON.stringify({schemaVersion:1,phase:'automation',agent:'codex',summary:'Test created',completed:['tests'],next:['run'],risks:[],updatedAt:new Date().toISOString()}));
}
});`;
    const claude = path.join(root, 'fake-claude');
    const codex = path.join(root, 'fake-codex');
    fs.writeFileSync(claude, fake, { mode: 0o755 });
    fs.writeFileSync(codex, fake, { mode: 0o755 });
    process.env.MARIA_CLAUDE_BIN = claude;
    process.env.MARIA_CODEX_BIN = codex;
    const run = await runWorkflow(project, { agent: 'collaborate' });
    assert.equal(run.status, 'passed', run.summary);
    assert.deepEqual(run.agents.map(agent => agent.name), ['claude', 'codex']);
    assert.equal(run.tests[0].caseId, 'case-login-01');
    assert.equal(run.coverage.lines, 80);
    assert.equal(run.coverage.rules, 100);
    assert.ok(run.artifacts.some(item => item.kind === 'screenshot'));
    assert.ok(run.artifacts.some(item => item.path.endsWith('discovery-claude.log')));
    assert.match(fs.readFileSync(path.join(project, run.agents[0].log), 'utf8'), /Exploring project/);
    assert.ok(run.artifacts.every(item => fs.existsSync(path.join(project, item.path))));
    assert.equal(readJson(path.join(project, '.maria', 'handoff.json')).agent, 'codex');
  } finally {
    if (originalClaude === undefined) delete process.env.MARIA_CLAUDE_BIN; else process.env.MARIA_CLAUDE_BIN = originalClaude;
    if (originalCodex === undefined) delete process.env.MARIA_CODEX_BIN; else process.env.MARIA_CODEX_BIN = originalCodex;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex takes over discovery when Claude makes no progress', async () => {
  const { root, project } = workspace();
  const originalClaude = process.env.MARIA_CLAUDE_BIN;
  const originalCodex = process.env.MARIA_CODEX_BIN;
  try {
    fs.writeFileSync(path.join(project, 'report.cjs'), `require('fs').writeFileSync('junit.xml','<testsuite><testcase name="[case-ready] works"/></testsuite>');`);
    const claude = path.join(root, 'fake-claude');
    fs.writeFileSync(claude, `#!/usr/bin/env node\nif(process.argv.includes('--version')) process.exit(0); setInterval(()=>{},1000);`, { mode: 0o755 });
    const codex = path.join(root, 'fake-codex');
    fs.writeFileSync(codex, `#!/usr/bin/env node
const fs=require('fs'); const path=require('path');
if(process.argv.includes('--version')) process.exit(0);
let prompt=''; process.stdin.on('data',chunk=>prompt+=chunk); process.stdin.on('end',()=>{
const dir=path.join(process.cwd(),'.maria');
if(prompt.includes('Do not write tests in this phase')) {
fs.writeFileSync(path.join(dir,'product.json'),JSON.stringify({schemaVersion:1,name:'Ready app',summary:'A readiness check',features:[{id:'feature-ready',name:'Ready',description:'Show readiness'}],rules:[{id:'rule-ready',featureId:'feature-ready',statement:'Ready state works',sourcePaths:['README.md']}]}));
fs.writeFileSync(path.join(dir,'cases.json'),JSON.stringify({schemaVersion:1,cases:[{id:'case-ready',title:'Readiness',featureId:'feature-ready',ruleIds:['rule-ready'],steps:['Open app'],expected:['Ready'],priority:'high',automation:{status:'planned',file:null}}]}));
} else {
const cases=JSON.parse(fs.readFileSync(path.join(dir,'cases.json'))); cases.cases[0].automation={status:'automated',file:'tests/ready.test.js'}; fs.mkdirSync('tests',{recursive:true}); fs.writeFileSync('tests/ready.test.js','// fixture'); fs.writeFileSync(path.join(dir,'cases.json'),JSON.stringify(cases));
fs.writeFileSync(path.join(dir,'runner.json'),JSON.stringify({schemaVersion:1,command:'node report.cjs',format:'junit',reportPath:'junit.xml',coveragePath:'',screenshotsPath:''}));
}
fs.writeFileSync(path.join(dir,'handoff.json'),JSON.stringify({schemaVersion:1,phase:'done',agent:'codex',summary:'Phase completed',completed:[],next:[],risks:[],updatedAt:new Date().toISOString()}));
});`, { mode: 0o755 });
    process.env.MARIA_CLAUDE_BIN = claude;
    process.env.MARIA_CODEX_BIN = codex;
    const run = await runWorkflow(project, { agent: 'auto', agentTimeoutMs: 5000, agentIdleTimeoutMs: 100 });
    assert.equal(run.status, 'passed', run.summary);
    assert.deepEqual(run.agents.map(agent => [agent.name, agent.status]), [['claude', 'failed'], ['codex', 'completed'], ['codex', 'completed']]);
    assert.match(run.agents[0].error, /no activity/);
  } finally {
    if (originalClaude === undefined) delete process.env.MARIA_CLAUDE_BIN; else process.env.MARIA_CLAUDE_BIN = originalClaude;
    if (originalCodex === undefined) delete process.env.MARIA_CODEX_BIN; else process.env.MARIA_CODEX_BIN = originalCodex;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('JUnit and Playwright reports are normalized', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maria-results-'));
  try {
    const junit = path.join(root, 'junit.xml');
    fs.writeFileSync(junit, '<testsuite><testcase name="[case-a] works" time="0.05"/><testcase name="[case-b] fails" time="0.1"><failure>Expected true</failure></testcase></testsuite>');
    assert.deepEqual(parseReport('junit', junit).map(item => item.status), ['passed', 'failed']);
    const playwright = path.join(root, 'playwright.json');
    writeJson(playwright, { suites: [{ specs: [{ title: '[case-c] opens page', file: 'home.spec.ts', tests: [{ status: 'expected', results: [{ status: 'passed', duration: 20 }] }] }] }] });
    assert.equal(parseReport('playwright-json', playwright)[0].status, 'passed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('local API exposes project data and rejects cross-origin mutations', async () => {
  const { root, project } = workspace();
  const server = await serve({ port: 0, open: false });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Testing command center/);
    const data = await fetch(`${base}/api/project?path=${encodeURIComponent(project)}`).then(response => response.json());
    assert.equal(data.project.root, project);
    const runDir = path.join(project, '.maria', 'runs', 'active-run');
    writeJson(path.join(runDir, 'run.json'), { id: 'active-run', startedAt: new Date().toISOString(), status: 'running', processId: process.pid, agents: [], artifacts: [], tests: [], coverage: {} });
    const active = await fetch(`${base}/api/project?path=${encodeURIComponent(project)}`).then(response => response.json());
    assert.equal(active.running, true);
    const duplicate = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, agent: 'none' }) });
    assert.equal(duplicate.status, 409);
    const response = await fetch(`${base}/api/projects`, { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: JSON.stringify({ path: root }) });
    assert.equal(response.status, 403);
  } finally { server.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
