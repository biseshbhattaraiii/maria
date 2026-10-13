#!/usr/bin/env node
import path from 'node:path';
import { availableAgents } from '../src/agents.js';
import { configuredProject, projectCatalog, readJson, writeJson } from '../src/files.js';
import { listRuns, runWorkflow } from '../src/run.js';
import { initialize } from '../src/setup.js';
import { serve } from '../src/server.js';

const args = process.argv.slice(2);
const command = args.shift() || 'help';
const option = name => { const index = args.indexOf(name); return index === -1 ? null : args[index + 1]; };
const positional = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));

try {
  if (command === 'init') {
    const result = initialize(positional[0] || process.cwd());
    console.log(`Maria initialized ${result.root}`);
    console.log('Next: maria run --agent auto, then maria serve');
  } else if (command === 'bootstrap') {
    const project = initialize(positional[0] || process.cwd());
    console.log(`Maria initialized ${project.root}`);
    try {
      const run = await runWorkflow(project.root, { agent: option('--agent') || 'auto' }, current => console.log(`${current.id}: ${current.phase} → ${current.status}`));
      console.log(run.summary);
    } catch (error) { console.error(`Initial run unavailable: ${error.message}`); }
    await serve({ port: Number(option('--port') || 4317), open: !args.includes('--no-open') });
  } else if (command === 'run') {
    const project = configuredProject(positional[0] || process.cwd());
    const run = await runWorkflow(project, { agent: option('--agent') || undefined }, current => console.log(`${current.id}: ${current.phase} → ${current.status}`));
    console.log(`${run.summary} Open with: maria serve`);
    if (run.status !== 'passed') process.exitCode = 1;
  } else if (command === 'serve') {
    const port = Number(option('--port') || 4317);
    await serve({ port, open: !args.includes('--no-open') });
  } else if (command === 'projects') {
    for (const project of projectCatalog().projects) console.log(project);
  } else if (command === 'status') {
    const project = configuredProject(positional[0] || process.cwd());
    const latest = listRuns(project)[0];
    console.log(JSON.stringify({ project, agents: availableAgents(), latest }, null, 2));
  } else if (command === 'config') {
    const project = configuredProject(positional[0] || process.cwd());
    const file = path.join(project, '.maria', 'runner.json');
    const runner = readJson(file, {});
    for (const key of ['command', 'format', 'reportPath', 'coveragePath', 'screenshotsPath']) {
      const value = option(`--${key}`);
      if (value !== null) runner[key] = value;
    }
    writeJson(file, runner);
    console.log(JSON.stringify(runner, null, 2));
  } else {
    console.log(`Maria testing kit\n\nUsage:\n  maria bootstrap [project] [--agent auto|collaborate|claude|codex|none]\n  maria init [project]\n  maria run [project] [--agent auto|collaborate|claude|codex|none]\n  maria serve [--port 4317] [--no-open]\n  maria status [project]\n  maria projects\n  maria config [project] --command "npm run test:e2e" --format playwright-json --reportPath results.json\n\nAgents: ${JSON.stringify(availableAgents())}`);
  }
} catch (error) {
  console.error(`Maria: ${error.message}`);
  process.exitCode = 1;
}
