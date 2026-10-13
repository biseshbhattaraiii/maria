# Maria

Maria is a local, open-source testing command center for an existing web, mobile, or API project. It gives Claude Code and Codex a shared, versioned product and test-case contract; runs their work in sequence; executes the project's test command; and displays results, screenshots, and coverage at `http://127.0.0.1:4317`.

## Requirements

- Node.js 20 or newer.
- Git for the one-command installer.
- Claude Code and/or Codex installed and authenticated for AI discovery and test authoring. Both are optional when importing an existing test command with `--agent none`.

## Install into a project

From the project directory, after this repository is published:

```bash
curl -fsSL https://raw.githubusercontent.com/biseshbhattaraiii/maria/main/install.sh | bash
```

The installer places Maria in `~/.local/share/maria`, links `maria` in `~/.local/bin`, initializes the current project, runs the available agent workflow, executes tests, and opens the command center. Add `~/.local/bin` to `PATH` to use `maria` in later shells. Use `MARIA_AGENT=claude`, `codex`, `collaborate`, or `none` to select the mode.

For development from a checkout:

```bash
node bin/maria.js init /path/to/your/project
node bin/maria.js run /path/to/your/project --agent auto
node bin/maria.js serve
```

`maria bootstrap /path/to/your/project` performs those three steps together. Use `--no-open` with `serve` or `bootstrap` for a headless machine.

## How the agents work together

With both CLIs available, `auto` uses Claude Code to inspect the application and write the product model and test cases, then Codex to author automation. Each phase reads the same `.maria/` files and a written `handoff.json`. With one CLI, the same agent performs both phases. `collaborate` requires both. `none` skips the agents and runs an already configured test command.

Maria calls `claude -p --permission-mode acceptEdits` and `codex exec --approve-for-me -C <project> -` as local subprocesses. Their normal authentication and permission mechanisms still apply. Agent output is saved in the run directory. Maria does not silently fall back to a different agent if a requested CLI is unavailable.

The project-local skill is installed at `.agents/skills/maria/SKILL.md` and `.claude/skills/maria/SKILL.md`, with references added to `AGENTS.md` and `CLAUDE.md`. Maria preserves existing context and case files on subsequent `init` calls.

## Data contract

The version 1 contract is in [schema/maria.schema.json](schema/maria.schema.json). Maria stores these files in each project:

| File | Purpose |
| --- | --- |
| `.maria/project.json` | Project identity and preferred agent mode |
| `.maria/schema.json` | Local copy of Maria's versioned JSON Schema for both agents |
| `.maria/product.json` | Product summary, features, source-backed rules, open questions |
| `.maria/cases.json` | Test cases, linked rule IDs, automation status and test paths |
| `.maria/runner.json` | Test command and paths for machine-readable results, coverage, screenshots |
| `.maria/handoff.json` | Explicit context transfer between phases |
| `.maria/runs/<id>/run.json` | Immutable-by-convention run summary with tests, coverage, artifacts, agent phases |

Maria checks key references after each agent phase. Rule IDs must point to existing features, cases must point to existing rules, and automated cases must name a test file.

The runner supports Playwright JSON, Jest JSON, and JUnit XML results. Code coverage is read from LCOV. Rule coverage is the percentage of documented rules linked to automated cases; case coverage is the percentage of cases marked automated. These are separate from code coverage. Screenshot files are copied into each run so later test runs cannot overwrite the evidence.

Configure an existing runner without agents:

```bash
maria config --command "npm run test:e2e" --format playwright-json \
  --reportPath test-results/results.json \
  --coveragePath coverage/lcov.info \
  --screenshotsPath test-results
maria run --agent none
```

For Playwright, configure a JSON reporter and screenshots on failure in the project's Playwright config. For mobile projects, use a framework that can emit JUnit XML plus screenshot files; Maria can ingest those through the same runner contract. Maria currently delegates app startup, emulator setup, and test authoring to the agent and project scripts rather than prescribing a mobile framework.

## Dashboard and files

The dashboard shows registered projects, product rules, cases, run history, test failures, screenshots, logs, reports, and coverage. **Add a project** browses local folders through the Maria server; project files can be browsed inside the dashboard. The server binds only to `127.0.0.1`. Adding a folder writes Maria setup files to it; running Maria explicitly launches agents and the project's configured test command.

## Current scope

Maria is a working local foundation. It has no cloud sync, user accounts, visual test editor, or built-in device farm. The actual quality of generated tests depends on the project setup and the installed agent. Agent CLI availability is detected locally; a real Claude/Codex project run requires their authenticated CLIs on your machine.

Run verification with `npm test`.
