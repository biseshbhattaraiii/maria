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
  return `${shared}\nRead .maria/handoff.json and verify the discovery output. In this run, implement at most three highest-priority test cases using an appropriate existing framework. Get a working runner and machine-readable report configured before expanding coverage. Update .maria/cases.json with actual test paths and names. Configure .maria/runner.json with a repeatable command and machine-readable report path; configure failure screenshots where supported. Write a new .maria/handoff.json summarizing what runs and anything blocked. Maria will run the configured test command after you finish.`;
}

function claudeEvent(line) {
  try {
    const event = JSON.parse(line);
    if (event.type === 'system' && event.subtype === 'init') return 'Claude session started';
    if (event.type === 'assistant') {
      const parts = event.message?.content || [];
      const tools = parts.filter(part => part.type === 'tool_use').map(part => part.name);
      if (tools.length) return `Claude using ${tools.join(', ')}`;
      const spoken = parts.filter(part => part.type === 'text').map(part => part.text).join(' ').trim();
      if (spoken) return spoken.slice(0, 500);
    }
    if (event.type === 'result') return event.is_error ? `Claude error: ${event.result || event.subtype}` : `Claude finished: ${String(event.result || '').slice(0, 500)}`;
    return '';
  } catch { return line.trim(); }
}

export async function runAgent(name, project, prompt, logFile, { timeoutMs = 45 * 60 * 1000, idleTimeoutMs = 8 * 60 * 1000, onProgress = () => {} } = {}) {
  const bin = commands[name]();
  const args = name === 'codex'
    ? ['exec', '--approve-for-me', ...(process.env.MARIA_CODEX_MODEL ? ['-m', process.env.MARIA_CODEX_MODEL] : []), '-C', project, '-']
    : ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose'];
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: project, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stopReason = '';
    let forceTimer;
    let idleTimer;
    const stop = reason => {
      if (stopReason) return;
      stopReason = reason;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    const timer = setTimeout(() => stop('time limit'), timeoutMs);
    const activity = message => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop('no activity'), idleTimeoutMs);
      if (message) onProgress(message);
    };
    activity('Agent started');
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      clearTimeout(forceTimer);
      log.end(() => error ? reject(error) : resolve(result));
    };
    if (name === 'claude') {
      let pending = '';
      child.stdout.on('data', chunk => {
        pending += chunk.toString();
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          const message = claudeEvent(line);
          if (message) { log.write(`${message}\n`); activity(message); }
        }
      });
      child.stdout.on('end', () => { if (pending.trim()) { const message = claudeEvent(pending); if (message) log.write(`${message}\n`); } });
    } else child.stdout.on('data', chunk => { log.write(chunk); activity('Codex is working'); });
    child.stderr.on('data', chunk => { log.write(chunk); activity(`${name} reported diagnostic output`); });
    child.stdin.end(prompt);
    child.once('error', error => finish(error));
    child.once('close', code => finish(null, { code, stopReason, status: code === 0 ? 'completed' : 'failed' }));
  });
}
