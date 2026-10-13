import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const commands = { codex: () => process.env.MARIA_CODEX_BIN || 'codex', claude: () => process.env.MARIA_CLAUDE_BIN || 'claude' };

export function availableAgents() {
  return Object.fromEntries(Object.entries(commands).map(([name, command]) => {
    const result = spawnSync(command(), ['--version'], { timeout: 4000, encoding: 'utf8' });
    return [name, !result.error && result.status === 0];
  }));
}

export function selectAgents(mode, available = availableAgents()) {
  if (mode === 'none') return [];
  if (mode === 'claude' || mode === 'codex') {
    if (!available[mode]) throw new Error(`${mode} CLI is not installed or available`);
    return [mode, mode];
  }
  if (mode === 'collaborate') {
    if (!available.claude || !available.codex) throw new Error('Collaboration needs both Claude Code and Codex CLIs');
    return ['claude', 'codex'];
  }
  if (available.claude && available.codex) return ['claude', 'codex'];
  if (available.codex) return ['codex', 'codex'];
  if (available.claude) return ['claude', 'claude'];
  throw new Error('Install and authenticate Claude Code or Codex, or run with --agent none');
}

export function agentPrompt(project, phase) {
  const shared = `You are working in ${project}. Read the local Maria skill and the files in .maria/ first. Follow existing project instructions. The JSON contract is in .maria/schema.json. Preserve stable IDs and write valid JSON. Keep actions within this project. Do not edit .maria/runs/.`;
  if (phase === 'discovery') return `${shared}\nDiscover the product and its real requirements from source and documentation. Write .maria/product.json and .maria/cases.json with evidence-linked rules and executable test cases. End with .maria/handoff.json for the automation agent. Do not write tests in this phase.`;
  return `${shared}\nRead .maria/handoff.json, verify the discovery output, implement the highest-priority test cases using an appropriate existing framework, and update .maria/cases.json with actual test paths and names. Configure .maria/runner.json with a repeatable command and machine-readable report path; configure failure screenshots where supported. Write a new .maria/handoff.json summarizing what runs and anything blocked. Maria will run the configured test command after you finish.`;
}

export async function runAgent(name, project, prompt, logFile) {
  const bin = commands[name]();
  const args = name === 'codex' ? ['exec', '--approve-for-me', '-C', project, '-'] : ['-p', '--permission-mode', 'acceptEdits'];
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: project, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60 * 1000);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.stdin.end(prompt);
    child.once('error', error => { clearTimeout(timer); log.end(); reject(error); });
    child.once('close', code => { clearTimeout(timer); log.end(); resolve({ code, status: code === 0 ? 'completed' : 'failed' }); });
  });
}
