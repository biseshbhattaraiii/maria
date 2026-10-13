import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { agentPrompt, runAgent, selectAgents } from './agents.js';
import { configuredProject, dataDir, inside, now, readJson, writeJson } from './files.js';
import { caseCoverage, collectArtifacts, collectEvidence, parseLcov, parseReport, readProjectData } from './results.js';
import { validateContext } from './validate.js';

export function listRuns(project) {
  const dir = path.join(dataDir(project), 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap(id => {
    const run = readJson(path.join(dir, id, 'run.json'));
    return run ? [run] : [];
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function durationFromEnv(name, fallbackMinutes) {
  const minutes = Number(process.env[name]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : fallbackMinutes * 60 * 1000;
}

function agentFailure(name, phase, code, logPath, relativeLog) {
  if (name === 'codex') {
    const tail = fs.readFileSync(logPath, 'utf8').slice(-12000);
    if (/is not supported when using Codex with a ChatGPT account/.test(tail)) {
      return new Error(`Codex's selected model is unsupported for this ChatGPT account. Select a supported model in Codex or set MARIA_CODEX_MODEL, then resume automation. See ${relativeLog}`);
    }
  }
  return new Error(`${name} ${phase} exited with ${code}. See ${relativeLog}`);
}

function executeCommand(command, project, logFile, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(logFile);
    const child = spawn(command, { cwd: project, env: process.env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', error => { clearTimeout(timer); log.end(); reject(error); });
    child.once('close', code => { clearTimeout(timer); log.end(); resolve({ code, timedOut: code === null }); });
  });
}

export async function runWorkflow(projectInput, options = {}, onUpdate = () => {}) {
  const project = configuredProject(projectInput);
  const from = options.from || 'discovery';
  if (!['discovery', 'automation', 'tests'].includes(from)) throw new Error(`Unknown starting phase: ${from}`);
  const mode = options.agent || readJson(path.join(dataDir(project), 'project.json'), {}).preferredAgent || 'auto';
  const selected = from === 'tests' ? [] : selectAgents(mode);
  const agentTimeoutMs = options.agentTimeoutMs ?? durationFromEnv('MARIA_AGENT_TIMEOUT_MINUTES', 45);
  const agentIdleTimeoutMs = options.agentIdleTimeoutMs ?? durationFromEnv('MARIA_AGENT_IDLE_TIMEOUT_MINUTES', 8);
  const id = `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(dataDir(project), 'runs', id);
  fs.mkdirSync(runDir, { recursive: true });
  const record = { schemaVersion: 1, id, processId: process.pid, startedAt: now(), finishedAt: null, status: 'running', phase: 'starting', agents: [], tests: [], artifacts: [], coverage: { lines: null, branches: null, functions: null, rules: null, cases: null }, summary: '' };
  const save = () => { writeJson(path.join(runDir, 'run.json'), record); onUpdate(record); };
  save();
  try {
    if (from === 'automation') {
      const errors = validateContext(project, 'discovery');
      if (errors.length) throw new Error(`Cannot resume automation: ${errors.join('; ')}`);
    }
    for (const [index, phase] of ['discovery', 'automation'].entries()) {
      if (from === 'tests' || (from === 'automation' && phase === 'discovery')) continue;
      if (!selected.length) break;
      record.phase = phase;
      const candidates = selected[0] === selected[1] ? [selected[index]] : [selected[index], selected[1 - index]];
      const failures = [];
      let completed = false;
      for (const name of candidates) {
        const log = path.join(runDir, `${phase}-${name}.log`);
        const step = { phase, name, status: 'running', log: path.relative(project, log) };
        record.agents.push(step);
        record.artifacts.push({ kind: 'log', path: step.log });
        record.activity = `${name} is working on ${phase}`;
        save();
        let lastProgressSave = 0;
        try {
          const result = await runAgent(name, project, agentPrompt(project, phase), log, {
            timeoutMs: agentTimeoutMs,
            idleTimeoutMs: agentIdleTimeoutMs,
            onProgress: message => {
              record.activity = message.slice(0, 200);
              record.lastActivityAt = now();
              if (Date.now() - lastProgressSave > 3000) { save(); lastProgressSave = Date.now(); }
            }
          });
          step.exitCode = result.code;
          if (result.stopReason) throw new Error(`${name} ${phase} stopped: ${result.stopReason}. See ${step.log}`);
          if (result.code !== 0) throw agentFailure(name, phase, result.code, log, step.log);
          const errors = validateContext(project, phase);
          if (errors.length) throw new Error(`${name} ${phase} left invalid Maria data: ${errors.join('; ')}`);
          step.status = 'completed';
          completed = true;
          save();
          break;
        } catch (error) {
          step.status = 'failed';
          step.error = error.message;
          failures.push(error.message);
          record.activity = candidates.length > 1 && name === candidates[0] ? `${name} failed; trying ${candidates[1]}` : error.message;
          save();
        }
      }
      if (!completed) throw new Error(failures.join(' | '));
    }
    record.phase = 'tests';
    save();
    const { runner, product, cases } = readProjectData(project);
    record.coverage = { ...record.coverage, ...caseCoverage(product, cases) };
    if (!runner.command) throw new Error('No test command configured in .maria/runner.json');
    const logFile = path.join(runDir, 'test.log');
    const testStartedAtMs = Date.now();
    const result = await executeCommand(runner.command, project, logFile, options.timeoutMs);
    record.artifacts.push({ kind: 'log', path: path.relative(project, logFile) });
    if (runner.reportPath) {
      const reportFile = inside(project, runner.reportPath);
      if (fs.existsSync(reportFile) && fs.statSync(reportFile).mtimeMs >= testStartedAtMs - 1000) record.tests = parseReport(runner.format, reportFile);
    }
    for (const test of record.tests) {
      if (test.caseId) continue;
      const matches = (cases.cases || []).filter(item => item.automation?.testName === test.name);
      if (matches.length === 1) test.caseId = matches[0].id;
    }
    if (runner.coveragePath) {
      const coverageFile = inside(project, runner.coveragePath);
      if (fs.existsSync(coverageFile) && fs.statSync(coverageFile).mtimeMs >= testStartedAtMs - 1000) {
        record.coverage = { ...record.coverage, ...parseLcov(coverageFile) };
      }
    }
    record.artifacts.push(...collectArtifacts(project, runDir, runner, record.tests, testStartedAtMs));
    record.artifacts.push(...collectEvidence(project, runDir, runner, record.tests, testStartedAtMs));
    record.commandExitCode = result.code;
    if (result.timedOut) throw new Error('Test command timed out');
    if (!record.tests.length) {
      record.status = 'incomplete';
      record.summary = 'Test command finished, but no machine-readable test results were found.';
    } else {
      record.status = result.code === 0 && record.tests.every(test => test.status !== 'failed') ? 'passed' : 'failed';
      record.summary = `${record.tests.filter(test => test.status === 'passed').length} passed, ${record.tests.filter(test => test.status === 'failed').length} failed, ${record.tests.filter(test => test.status === 'skipped').length} skipped.`;
    }
  } catch (error) {
    record.status = 'incomplete';
    record.summary = error.message;
  } finally {
    record.phase = 'finished';
    record.finishedAt = now();
    save();
  }
  return record;
}
