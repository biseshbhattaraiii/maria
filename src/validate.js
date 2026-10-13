import fs from 'node:fs';
import path from 'node:path';
import { readProjectData } from './results.js';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const array = value => Array.isArray(value);
const unique = items => new Set(items).size === items.length;

export function validateContext(project, phase = 'discovery') {
  const { product, cases, runner, handoff } = readProjectData(project);
  const errors = [];
  if (product.schemaVersion !== 1 || !nonempty(product.name) || !nonempty(product.summary)) errors.push('product.json needs version 1, name, and summary');
  if (!array(product.features) || !array(product.rules) || !product.features.length || !product.rules.length) errors.push('product.json needs features and evidence-backed rules');
  const features = (product.features || []).map(item => item.id);
  const rules = (product.rules || []).map(item => item.id);
  const featureIds = new Set(features);
  const ruleIds = new Set(rules);
  if (!unique(features) || !unique(rules)) errors.push('Feature and rule IDs must be unique');
  for (const rule of product.rules || []) {
    if (!nonempty(rule.id) || !nonempty(rule.statement) || !featureIds.has(rule.featureId) || !array(rule.sourcePaths) || !rule.sourcePaths.length) errors.push(`Invalid rule ${rule.id || '(missing id)'}`);
  }
  if (cases.schemaVersion !== 1 || !array(cases.cases) || !cases.cases.length) errors.push('cases.json needs version 1 and at least one case');
  const caseIds = (cases.cases || []).map(item => item.id);
  if (!unique(caseIds)) errors.push('Case IDs must be unique');
  for (const item of cases.cases || []) {
    if (!nonempty(item.id) || !nonempty(item.title) || !featureIds.has(item.featureId) || !array(item.ruleIds) || !item.ruleIds.length || item.ruleIds.some(id => !ruleIds.has(id)) || !array(item.steps) || !item.steps.length || !array(item.expected) || !item.expected.length) errors.push(`Invalid case ${item.id || '(missing id)'}`);
    if (phase === 'automation' && item.automation?.status === 'automated') {
      if (!nonempty(item.automation.file) || !fs.existsSync(path.join(project, item.automation.file))) errors.push(`Automated case ${item.id} has no test file`);
    }
  }
  if (!handoff || handoff.schemaVersion !== 1 || !nonempty(handoff.summary)) errors.push('handoff.json needs version 1 and a summary');
  if (phase === 'automation' && (runner.schemaVersion !== 1 || !nonempty(runner.command) || !['playwright-json', 'jest-json', 'junit'].includes(runner.format) || !nonempty(runner.reportPath))) errors.push('runner.json needs a command and a supported machine-readable report');
  return errors;
}
