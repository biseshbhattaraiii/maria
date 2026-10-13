---
name: maria
description: Understand a product, design test cases, implement automated tests, and report them to Maria.
---

# Maria testing contract (version 1)

Read `.maria/schema.json`, `.maria/project.json`, `.maria/product.json`, `.maria/cases.json`, and `.maria/runner.json` before testing work. Inspect the application, documentation, existing tests, routes/screens, business rules, and setup instructions. Treat source evidence as more reliable than guesses. Never put secrets or credentials into Maria files.

## Discovery

Write `.maria/product.json` with the actual product summary, platforms, personas, features, and rules. Use stable IDs such as `feature-login` and `rule-login-invalid-password`. Each rule must cite project-relative source paths and mark its confidence (`documented`, `inferred`, or `observed`). Record unanswered questions in `unknowns`; do not present inferred behavior as a requirement.

Write `.maria/cases.json` with actionable cases. Each case has a stable ID, featureId, linked ruleIds, preconditions, steps, expected outcomes, priority, and `automation: { "status": "planned", "file": null }`. Include happy paths, validation, permissions, failures, and relevant edge cases. Keep cases that cannot yet be automated and explain a `blocked` status.

## Automation

Use the project's existing test framework when suitable. Start with no more than three important cases per Maria run so results arrive before expanding coverage. Add or update automation for those cases. Update each case's `automation.file` and `automation.testName` only when that test actually exists. Use stable case IDs in test titles where possible, for example `[case-login-01] rejects invalid password`.

Set `.maria/runner.json` to a repeatable test command. Its `format` is `playwright-json`, `jest-json`, `junit`, or `none`. Set `reportPath`, `coveragePath` (LCOV info file), and `screenshotsPath` relative to the project root. Configure the test framework to emit the declared report. Do not claim a passing test without a run result.

For case-specific evidence, set optional `runner.evidencePath` to a JSON file or directory of JSON files that the tests generate during each run. Each file has `schemaVersion: 1` and `tests: [{ caseId, testName?, checks: [{ expected, actual }], attachments: [{ kind, path }] }]`. `path` is project-relative; `kind` can be `screenshot`, `video`, `trace`, or `log`. Capture actual values from the running test, and capture a screenshot at the relevant UI assertion when possible. Unit tests should record useful observed values instead of a screenshot. Use the same stable case ID in the test title and evidence. Never manufacture evidence from the expected value or reuse a prior run's files. Maria attaches fresh evidence to matching test results and snapshots the files.

## Handoffs

Read `.maria/handoff.json` if present. At the end of your phase, write a concise `.maria/handoff.json` with `schemaVersion: 1`, `phase`, `agent`, `summary`, `completed`, `next`, `risks`, and `updatedAt`. The next agent should use the files above as the source of truth, verify previous claims, and continue from the current state.

Maria itself records run results and artifacts in `.maria/runs/`. Do not edit those records manually.
