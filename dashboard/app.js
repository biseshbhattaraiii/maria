const state = { meta: null, projects: [], selected: null, data: null, view: 'overview', folder: null, filesPath: '', selectedRun: null };
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const api = async (route, payload) => {
  const response = await fetch(route, payload === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};
const query = (route, values) => `${route}?${new URLSearchParams(values)}`;
const fmtDate = date => date ? new Date(date).toLocaleString() : '—';
const pct = value => value === null || value === undefined ? '—' : `${value}%`;
const badge = value => `<span class="pill ${escape(value)}">${escape(value)}</span>`;
const toast = (message, error = false) => { const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.remove('hidden'); setTimeout(() => node.classList.add('hidden'), 4200); };

async function loadProjects() {
  state.projects = await api('/api/projects');
  $('#project-list').innerHTML = state.projects.map(item => `<button class="project-button ${state.selected === item.path ? 'active' : ''}" data-project="${escape(item.path)}" title="${escape(item.path)}"><span class="p-dot"></span><span class="p-name">${escape(item.path.split(/[\\/]/).filter(Boolean).at(-1) || item.path)}</span></button>`).join('');
  document.querySelectorAll('[data-project]').forEach(button => button.addEventListener('click', () => selectProject(button.dataset.project)));
}

async function selectProject(project) {
  state.selected = project;
  localStorage.setItem('maria.project', project);
  state.selectedRun = null;
  await refresh();
}

async function refresh() {
  if (!state.selected) return render();
  try {
    state.data = await api(query('/api/project', { path: state.selected }));
    $('#crumb-project').textContent = state.data.project.name || state.selected;
    await loadProjects();
    render();
  } catch (error) { toast(error.message, true); }
}

function sectionHeading(title, description, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">MARIA / ${escape(state.view)}</div><h1>${escape(title)}</h1><p>${escape(description)}</p></div><div class="head-actions">${actions}</div></div>`;
}

function runControls() {
  const available = state.meta.agents;
  const options = [['auto', 'Auto'], ['collaborate', 'Claude + Codex'], ['codex', 'Codex'], ['claude', 'Claude'], ['none', 'Tests only']];
  return `<select class="select" id="agent-mode" aria-label="Agent mode">${options.map(([value, label]) => `<option value="${value}" ${value === 'collaborate' && !(available.claude && available.codex) ? 'disabled' : ''} ${value === 'codex' && !available.codex ? 'disabled' : ''} ${value === 'claude' && !available.claude ? 'disabled' : ''}>${label}</option>`).join('')}</select><button class="button primary" id="run-button" ${state.data?.running ? 'disabled' : ''}>${state.data?.running ? 'Running…' : 'Run Maria'} <span>↗</span></button>`;
}

function metric(label, value, note, icon) { return `<div class="metric-card"><div class="metric-label">${escape(label)}<span class="metric-icon">${icon}</span></div><div class="metric-value">${escape(value)}</div><div class="metric-note">${escape(note)}</div></div>`; }

function runNotice(run) {
  if (!run || run.status === 'passed' || run.status === 'failed') return '';
  const active = run.status === 'running';
  const phase = run.phase === 'discovery' ? 'learning the project and writing cases' : run.phase === 'automation' ? 'writing automated tests' : run.phase === 'tests' ? 'running the tests' : 'preparing the run';
  const message = active ? `Maria is ${phase}. Test results and coverage appear after the test command finishes.` : run.summary || 'This run did not produce complete results.';
  return `<section class="panel"><div class="panel-body"><strong>${active ? 'Run in progress' : 'Run needs attention'}</strong><p class="muted">${escape(message)}</p>${active ? '<button class="view-link" data-view-link="runs">Open this run →</button>' : ''}</div></section>`;
}

function renderOverview() {
  const { product, cases, runs, running } = state.data;
  const latest = runs[0];
  const all = cases.cases || [];
  const automated = all.filter(item => item.automation?.status === 'automated').length;
  const lastTests = latest?.tests || [];
  return `${sectionHeading('Your testing command center', 'Product knowledge, automated coverage, and run evidence in one place.', runControls())}
    ${runNotice(latest)}
    <div class="hero"><div><div class="eyebrow">ACTIVE PROJECT</div><h2>${escape(product.name || state.data.project.name)}</h2><p>${escape(product.summary || 'Run Maria to map your product, write cases, and build automation. The project context will appear here.')}</p></div><div class="hero-side"><small>CURRENT STATUS</small><strong>${running ? 'Testing in progress' : latest ? latest.status[0].toUpperCase() + latest.status.slice(1) : 'Ready to explore'}</strong><span>${latest ? `Latest run · ${escape(fmtDate(latest.startedAt))}` : 'No test runs yet'}</span></div></div>
    <div class="metric-grid">${metric('PRODUCT RULES', product.rules?.length || 0, 'Evidence-backed requirements', '◇')}${metric('TEST CASES', all.length, `${automated} automated`, '☷')}${metric('LATEST RESULTS', lastTests.length ? `${lastTests.filter(item => item.status === 'passed').length}/${lastTests.length}` : '—', latest?.status === 'running' ? 'Waiting for test execution' : 'Tests passed', '✓')}${metric('RULE COVERAGE', pct(latest?.coverage?.rules ?? null), 'Rules linked to automation', '◉')}</div>
    <div class="section-grid"><section class="panel"><div class="panel-head"><h2>Recent test runs</h2><button class="view-link" data-view-link="runs">View all →</button></div><div class="panel-body">${runs.length ? runs.slice(0, 5).map(runRow).join('') : '<div class="empty">No results yet. Run Maria to generate the first test run.</div>'}</div></section><section class="panel"><div class="panel-head"><h2>Automation snapshot</h2><button class="view-link" data-view-link="cases">View cases →</button></div><div class="panel-body"><div class="detail-grid"><div class="detail"><label>Automated cases</label><strong>${automated} of ${all.length}</strong></div><div class="detail"><label>Case coverage</label><strong>${pct(latest?.coverage?.cases ?? (all.length ? Math.round(automated / all.length * 100) : null))}</strong></div><div class="detail"><label>Line coverage</label><strong>${pct(latest?.coverage?.lines)}</strong></div><div class="detail"><label>Features</label><strong>${product.features?.length || 0}</strong></div></div></div></section></div>`;
}

function runRow(run) { return `<div class="run-row"><button data-run="${escape(run.id)}"><strong>${escape(run.id)}</strong><small>${escape(fmtDate(run.startedAt))} · ${escape(run.summary || run.phase)}</small></button>${badge(run.status)}</div>`; }

function renderProduct() {
  const { product, handoff } = state.data;
  return `${sectionHeading('Product context', 'The product model Maria and your agents use to design meaningful tests.', runControls())}<div class="hero"><div><div class="eyebrow">PRODUCT PROFILE</div><h2>${escape(product.name)}</h2><p>${escape(product.summary || 'Product discovery has not run yet.')}</p></div><div class="hero-side"><small>PLATFORMS</small><strong>${escape((product.platforms || []).join(' · ') || 'Unspecified')}</strong><span>${product.sources?.length || 0} source files referenced</span></div></div><div class="section-grid"><section class="panel"><div class="panel-head"><h2>Features</h2><small>${product.features?.length || 0} mapped</small></div>${product.features?.length ? product.features.map(item => `<div class="feature-card"><strong>${escape(item.name)}</strong><p>${escape(item.description)}</p><span class="source">${escape((item.sourcePaths || []).join(' · '))}</span></div>`).join('') : '<div class="empty">No features mapped yet.</div>'}</section><section class="panel"><div class="panel-head"><h2>Product rules</h2><small>${product.rules?.length || 0} recorded</small></div>${product.rules?.length ? product.rules.map(item => `<div class="rule-card"><strong>${escape(item.id)}</strong><p>${escape(item.statement)}</p><span class="source">${escape((item.sourcePaths || []).join(' · '))} · ${escape(item.confidence || 'unspecified')}</span></div>`).join('') : '<div class="empty">No rules recorded yet.</div>'}</section></div>${product.unknowns?.length ? `<section class="panel"><div class="panel-head"><h2>Open questions</h2></div><div class="panel-body">${product.unknowns.map(item => `<p class="muted">• ${escape(item)}</p>`).join('')}</div></section>` : ''}${handoff ? `<section class="panel"><div class="panel-head"><h2>Agent handoff</h2><small>${escape(handoff.agent || '')} · ${escape(handoff.phase || '')}</small></div><div class="panel-body"><p class="muted">${escape(handoff.summary || '')}</p></div></section>` : ''}`;
}

function renderCases() {
  const cases = state.data.cases.cases || [];
  return `${sectionHeading('Test cases', 'Every case links product intent to actual automation.', runControls())}<section class="panel"><div class="panel-head"><h2>Case inventory</h2><small>${cases.length} total</small></div><div class="table-wrap"><table><thead><tr><th>Case</th><th>Feature / rules</th><th>Priority</th><th>Automation</th></tr></thead><tbody>${cases.map(item => `<tr><td><div class="case-title">${escape(item.title)}</div><span class="case-id">${escape(item.id)}</span><div class="muted">${escape((item.expected || []).join(' · '))}</div></td><td>${escape(item.featureId)}<div class="source">${escape((item.ruleIds || []).join(', '))}</div></td><td>${badge(item.priority)}</td><td>${badge(item.automation?.status || 'planned')}<div class="source">${escape(item.automation?.file || item.automation?.reason || '')}</div></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No cases yet. Run discovery to generate them.</td></tr>'}</tbody></table></div></section>`;
}

function artifactUrl(run, artifact) { return query('/api/artifact', { project: state.selected, run: run.id, path: artifact.path }); }

function renderRuns() {
  const runs = state.data.runs;
  const run = runs.find(item => item.id === state.selectedRun) || runs[0];
  return `${sectionHeading('Test runs', 'Reproducible results, agent activity, and visual evidence.', runControls())}${runNotice(run)}<div class="split"><section class="panel"><div class="panel-head"><h2>Run history</h2><small>${runs.length} runs</small></div><div class="panel-body">${runs.length ? runs.map(runRow).join('') : '<div class="empty">No runs yet.</div>'}</div></section><div>${run ? `<section class="panel"><div class="panel-head"><h2>${escape(run.id)}</h2>${badge(run.status)}</div><div class="panel-body"><p class="muted">${escape(run.summary || `Current phase: ${run.phase}`)}</p><div class="detail-grid"><div class="detail"><label>Started</label><strong>${escape(fmtDate(run.startedAt))}</strong></div><div class="detail"><label>Finished</label><strong>${escape(fmtDate(run.finishedAt))}</strong></div><div class="detail"><label>Line coverage</label><strong>${pct(run.coverage?.lines)}</strong></div><div class="detail"><label>Rule coverage</label><strong>${pct(run.coverage?.rules)}</strong></div></div><p class="muted">${(run.agents || []).map(step => `${escape(step.name)}: ${escape(step.phase)} (${escape(step.status)})`).join(' → ')}</p></div></section><section class="panel"><div class="panel-head"><h2>Test results</h2><small>${run.tests.length} tests</small></div><div class="table-wrap"><table><thead><tr><th>Test</th><th>Result</th></tr></thead><tbody>${run.tests.map(test => `<tr><td><span class="case-title">${escape(test.name)}</span><div class="source">${escape(test.file || test.caseId || '')}</div>${test.error ? `<div class="test-error">${escape(test.error)}</div>` : ''}</td><td>${badge(test.status)}</td></tr>`).join('') || `<tr><td colspan="2" class="empty">${run.status === 'running' ? 'Test results will appear after the test command finishes.' : 'No machine-readable test results.'}</td></tr>`}</tbody></table></div></section><section class="panel"><div class="panel-head"><h2>Artifacts</h2><small>${run.artifacts.length} files</small></div><div class="panel-body artifacts">${run.artifacts.map(item => `<a class="artifact-card" href="${escape(artifactUrl(run, item))}" target="_blank" rel="noopener">${item.kind === 'screenshot' ? `<img src="${escape(artifactUrl(run, item))}" alt="Test screenshot">` : ''}<span>${escape(item.path.split('/').at(-1))}</span></a>`).join('') || '<div class="empty">No artifacts collected.</div>'}</div></section>` : '<section class="panel"><div class="empty">Run Maria to see results here.</div></section>'}</div></div>`;
}

function renderFiles() {
  return `${sectionHeading('Project files', 'Browse the selected project and inspect Maria’s local data contract.', '<button class="button secondary" id="browse-filesystem">Browse laptop</button>')}<section class="panel file-list"><div class="panel-head"><h2>File browser</h2><span class="path-crumb">${escape(state.selected)}${state.filesPath ? '/' + escape(state.filesPath) : ''}</span></div><div id="file-rows"></div></section>`;
}

function renderEmpty() { return `<div class="page-head"><div><div class="eyebrow">WELCOME TO MARIA</div><h1>Testing starts with context.</h1><p>Choose a folder on your laptop to create a project workspace.</p></div><button class="button primary" id="empty-add">Add a project ↗</button></div><div class="hero"><div><div class="eyebrow">HOW IT WORKS</div><h2>Explore. Design. Automate. Verify.</h2><p>Maria gives Claude Code and Codex a shared product model, then brings cases, automated tests, screenshots, and coverage back into one local command center.</p></div><div class="hero-side"><small>YOUR DATA</small><strong>Stored with your project</strong><span>Project records live in .maria/</span></div></div>`; }

async function loadFiles() {
  if (state.view !== 'files' || !state.selected) return;
  try {
    const result = await api(query('/api/files', { project: state.selected, path: state.filesPath }));
    const parent = state.filesPath.split(/[\\/]/).slice(0, -1).join('/');
    $('#file-rows').innerHTML = `${state.filesPath ? `<button class="file-row" data-folder="${escape(parent)}"><span>↖</span> ..</button>` : ''}${result.entries.map(item => `<button class="file-row" ${item.directory && !item.symlink ? `data-folder="${escape(item.path)}"` : 'disabled'}><span>${item.directory ? '▣' : '▤'}</span>${escape(item.name)}${item.symlink ? '<small>symlink</small>' : ''}</button>`).join('')}`;
    document.querySelectorAll('#file-rows [data-folder]').forEach(button => button.addEventListener('click', () => { state.filesPath = button.dataset.folder; render(); }));
  } catch (error) { toast(error.message, true); }
}

function render() {
  $('#crumb-project').textContent = state.data?.project?.name || 'No project selected';
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === state.view));
  $('#main').innerHTML = !state.data ? renderEmpty() : ({ overview: renderOverview, product: renderProduct, cases: renderCases, runs: renderRuns, files: renderFiles })[state.view]();
  document.querySelectorAll('[data-view-link]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.viewLink; render(); }));
  document.querySelectorAll('[data-run]').forEach(button => button.addEventListener('click', () => { state.view = 'runs'; state.selectedRun = button.dataset.run; render(); }));
  $('#run-button')?.addEventListener('click', startRun);
  $('#empty-add')?.addEventListener('click', openPicker);
  $('#browse-filesystem')?.addEventListener('click', openPicker);
  loadFiles();
}

async function startRun() {
  try { await api('/api/runs', { project: state.selected, agent: $('#agent-mode').value }); toast('Maria run started. Results will appear here.'); await refresh(); }
  catch (error) { toast(error.message, true); }
}

async function browse(folder) {
  try {
    state.folder = await api(query('/api/browse', { path: folder || state.meta.home }));
    $('#folder-path').value = state.folder.path;
    $('#folder-list').innerHTML = state.folder.entries.map(item => `<button class="folder-row ${item.directory ? '' : 'file'}" ${item.directory && !item.symlink ? `data-path="${escape(state.folder.path.replace(/\/$/, '') + '/' + item.name)}"` : 'disabled'}><span class="folder-icon">${item.directory ? '▣' : '▤'}</span>${escape(item.name)}${item.symlink ? ' ↗' : ''}</button>`).join('') || '<div class="empty">This folder is empty.</div>';
    $('#folder-count').textContent = `${state.folder.entries.length} items`;
    document.querySelectorAll('#folder-list [data-path]').forEach(button => button.addEventListener('dblclick', () => browse(button.dataset.path)));
    document.querySelectorAll('#folder-list [data-path]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('#folder-list .folder-row').forEach(row => row.style.background = ''); button.style.background = '#334c55'; $('#folder-path').value = button.dataset.path; }));
  } catch (error) { toast(error.message, true); }
}

function openPicker() { $('#picker').classList.remove('hidden'); browse(state.folder?.path || state.meta.home); }
function closePicker() { $('#picker').classList.add('hidden'); }

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
$('#browse-button').addEventListener('click', openPicker);
$('#close-picker').addEventListener('click', closePicker);
$('#picker').addEventListener('click', event => { if (event.target.id === 'picker') closePicker(); });
$('#folder-up').addEventListener('click', () => browse(state.folder?.parent));
$('#folder-go').addEventListener('click', () => browse($('#folder-path').value));
$('#folder-path').addEventListener('keydown', event => { if (event.key === 'Enter') browse(event.target.value); });
$('#select-folder').addEventListener('click', async () => {
  try { const project = await api('/api/projects', { path: $('#folder-path').value }); closePicker(); await loadProjects(); await selectProject(project.root); toast('Project ready. Maria skills and schema files were installed.'); }
  catch (error) { toast(error.message, true); }
});
$('#refresh-button').addEventListener('click', refresh);

async function start() {
  try {
    state.meta = await api('/api/meta');
    $('#version').textContent = `v${state.meta.version}`;
    $('#agent-status').textContent = [state.meta.agents.claude ? 'Claude' : null, state.meta.agents.codex ? 'Codex' : null].filter(Boolean).join(' + ') || 'No agents found';
    await loadProjects();
    const last = localStorage.getItem('maria.project');
    const first = state.projects.find(item => item.path === last && item.exists) || state.projects.find(item => item.exists);
    if (first) await selectProject(first.path); else render();
    setInterval(() => { if (state.selected && (state.data?.running || state.view === 'runs')) refresh(); }, 2500);
  } catch (error) { toast(error.message, true); render(); }
}
start();
