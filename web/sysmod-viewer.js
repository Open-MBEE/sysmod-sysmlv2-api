/* sysmod-viewer.js: the interface of the page /tools/sysmod-viewer/. Shows a SYSMOD project of a SysML v2 model:
   the SYSMOD Atlas, problem statement, system idea and objectives, stakeholders, needs, requirements, use cases and the
   system context diagrams. The model comes from
     - a SysML v2 API server (the browser asks the server directly, see sysmod-viewer-api.js),
     - the Delivery Drone example (the SysML v2 engine of the checker reads the SYSMOD files of this site in the browser),
     - files of the visitor: .sysml (read by the same engine, together with the SYSMOD library) or .json (elements as the API delivers them).
   Nothing is sent anywhere else. All texts from the model are inserted with textContent, never as HTML.
   The same file runs in github.com/Open-MBEE/sysmod-sysmlv2-api (web/index.html) and on mbse4u.com/tools/sysmod-viewer/:
   without cfg.engine there is no example and no .sysml files (only .json), without cfg.relay no relay. */

const root = document.getElementById('sysmod-viewer');
if (root) start(JSON.parse(root.dataset.config));

async function start(cfg) {
  const core = await import(cfg.core);
  const apiMod = await import(cfg.api);
  const $ = (s) => root.querySelector(s);

  // ---------- small DOM helpers ----------
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== '') e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs = {}, ...kids) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  /** Doc text as paragraphs: blank lines separate paragraphs, single line breaks are the line breaks of the source. */
  const paras = (text, cls = '') => String(text || '').split(/\n{2,}/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')).filter(Boolean).map((p) => h('p', { class: cls }, p));
  const nf = new Intl.NumberFormat('en');
  const status = (el, text, kind = '') => { el.textContent = text; el.dataset.kind = kind; };

  // ---------- state in the address (never the token) ----------
  const params = new URLSearchParams(location.search);
  const setParams = (obj) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) if (v) p.set(k, v);
    const q = p.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  };

  // ---------- source tabs ----------
  const tabs = [...root.querySelectorAll('[data-src-tab]')];
  const panels = [...root.querySelectorAll('[data-src-panel]')];
  const showTab = (name) => {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.srcTab === name));
    for (const p of panels) p.hidden = p.dataset.srcPanel !== name;
  };
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.srcTab)));
  root.querySelector('[data-js-only]')?.removeAttribute('hidden');

  // ---------- the model ----------
  let model = null, source = null;   // source: { kind: 'server'|'example'|'files', label, server?, project?, commit? }
  const out = $('[data-out]');
  const pick = $('[data-pick]'), pickSel = $('[data-pick-select]');

  function useElements(elements, src) {
    const t0 = performance.now();
    model = core.createModel(elements);
    source = src;
    const projects = core.findProjects(model);
    out.replaceChildren();
    if (!projects.length) {
      pick.hidden = true;
      out.append(h('div', { class: 'mc-result mc-bad' },
        h('p', { class: 'mc-verdict' }, 'No SYSMOD project found'),
        h('p', { class: 'm-0' }, `The model has ${nf.format(model.size)} elements, but none of them is a SYSMOD project (#project, or a specialization of SYSMOD::Project). `
          + 'The SYSMOD library must be part of the same model.')));
      return;
    }
    pickSel.replaceChildren(...projects.map((p) => h('option', { value: p.id }, p.qualifiedName && p.qualifiedName !== p.name ? `${p.name}  (${p.qualifiedName})` : p.name)));
    pick.hidden = projects.length < 2;
    const wanted = params.get('sysmod');
    const first = projects.find((p) => p.id === wanted) || projects[0];
    pickSel.value = first.id;
    render(first.id, performance.now() - t0);
  }
  pickSel.addEventListener('change', () => render(pickSel.value));

  // ---------- 1. SysML v2 API server ----------
  const f = {
    url: $('[data-url]'), token: $('[data-token]'), connect: $('[data-connect]'), st: $('[data-status-server]'),
    projRow: $('[data-proj-row]'), proj: $('[data-proj]'), projFilter: $('[data-proj-filter]'),
    commit: $('[data-commit]'), load: $('[data-load]'), err: $('[data-err-server]'),
  };
  let client = null, projectList = [], abort = null;
  if (params.get('server')) { f.url.value = params.get('server'); showTab('server'); }
  // the servers of the relay as suggestions for the address field
  const dl = $('[data-relay-list]');
  if (dl) dl.replaceChildren(...(cfg.relay?.servers || []).map((u) => h('option', { value: u })));

  const showError = (box, e) => {
    if (e?.name === 'AbortError') return;
    box.replaceChildren(h('div', { class: 'mc-result mc-bad' },
      h('p', { class: 'mc-verdict' }, e?.message || String(e)),
      e?.hint ? h('p', { class: 'm-0' }, e.hint) : null,
      e?.url ? h('p', { class: 'mc-facts' }, h('code', {}, e.url)) : null));
  };

  f.connect.addEventListener('click', async () => {
    f.err.replaceChildren();
    f.projRow.hidden = true;
    try {
      client = apiMod.createClient({ baseUrl: f.url.value, token: f.token.value, relay: cfg.relay });
      f.url.value = client.base;
      const via = client.viaRelay ? ` via ${cfg.relay?.label || 'the relay'}` : '';
      status(f.st, `Connecting${via} …`);
      projectList = await client.projects();
      if (!projectList.length) { status(f.st, 'The server has no projects.', 'bad'); return; }
      status(f.st, `${nf.format(projectList.length)} projects${via}`, 'ok');
      f.proj.replaceChildren();   // a new server: no selection carried over from the previous one
      fillProjects();
      f.projRow.hidden = false;
      const want = params.get('project');
      if (want && projectList.some((p) => p['@id'] === want)) f.proj.value = want;
      await loadCommits();
    } catch (e) { status(f.st, ''); showError(f.err, e); }
  });
  f.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') f.connect.click(); });

  function fillProjects() {
    const q = f.projFilter.value.trim().toLowerCase();
    const keep = f.proj.value;
    const list = projectList.filter((p) => !q || String(p.name || '').toLowerCase().includes(q) || p['@id'].includes(q));
    f.proj.replaceChildren(...list.map((p) => h('option', { value: p['@id'] }, p.name || p['@id'])));
    if (list.some((p) => p['@id'] === keep)) f.proj.value = keep;
  }
  f.projFilter.addEventListener('input', () => { const before = f.proj.value; fillProjects(); if (f.proj.value !== before) loadCommits(); });
  f.proj.addEventListener('change', () => loadCommits());

  async function loadCommits() {
    f.commit.replaceChildren(h('option', {}, 'Loading commits …'));
    f.load.disabled = true;
    try {
      const pid = f.proj.value;
      if (!pid) return;
      const [commits, head] = await Promise.all([client.commits(pid), defaultHead(pid)]);
      if (pid !== f.proj.value) return;   // the visitor chose another project meanwhile
      const fmt = (c) => {
        const d = Date.parse(c.created || '');
        const when = d ? new Date(d).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : c['@id'].slice(0, 8);
        const desc = c.description ? ` · ${String(c.description).slice(0, 60)}` : '';
        return `${when}${desc}${c['@id'] === head ? '  (head of the default branch)' : ''}`;
      };
      f.commit.replaceChildren(...commits.map((c) => h('option', { value: c['@id'] }, fmt(c))));
      const want = params.get('commit');
      f.commit.value = commits.some((c) => c['@id'] === want) ? want : head && commits.some((c) => c['@id'] === head) ? head : commits[0]?.['@id'] || '';
      f.load.disabled = !commits.length;
      if (!commits.length) f.commit.replaceChildren(h('option', {}, 'This project has no commits.'));
    } catch (e) { f.commit.replaceChildren(); showError(f.err, e); }
  }
  async function defaultHead(pid) {
    try {
      const p = await client.project(pid);
      const bid = p?.defaultBranch?.['@id'];
      if (!bid) return null;
      const b = (await client.branches(pid)).find((x) => x['@id'] === bid);
      return b?.head?.['@id'] || null;
    } catch { return null; }
  }

  f.load.addEventListener('click', async () => {
    f.err.replaceChildren();
    abort?.abort();
    abort = new AbortController();
    const pid = f.proj.value, cid = f.commit.value;
    const pname = f.proj.selectedOptions[0]?.textContent || pid;
    f.load.disabled = true;
    try {
      status(f.st, 'Loading the model …');
      const elements = await client.elements(pid, cid, { signal: abort.signal, onProgress: (n) => status(f.st, `Loading the model … ${nf.format(n)} elements`) });
      status(f.st, `${nf.format(elements.length)} elements loaded`, 'ok');
      setParams({ server: client.base, project: pid, commit: cid });
      useElements(elements, { kind: 'server', label: `${pname} on ${new URL(client.base).host}`, server: client.base, project: pid, commit: cid });
    } catch (e) { status(f.st, ''); showError(f.err, e); }
    finally { f.load.disabled = false; }
  });

  // ---------- 2. + 3. The SysML v2 engine in the browser (example and .sysml files) ----------
  let kernelPromise = null;
  async function fetchBytes(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} could not be loaded (HTTP ${r.status})`);
    const raw = new Uint8Array(await r.arrayBuffer());
    if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw;   // the server already decompressed it
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the engine. Use a current Chrome, Edge, Firefox or Safari.');
    return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  const kernel = () => (kernelPromise ||= (async () => {
    const e = cfg.engine;
    const [k, wasm, bundle, snapshot] = await Promise.all([
      import(e.base + e.kernel), fetchBytes(e.base + e.wasm), fetchBytes(e.base + e.bundle), fetchBytes(e.base + e.snapshot),
    ]);
    await k.default({ module_or_path: wasm });
    return { k, lib: new k.PreparedLibrary(new TextDecoder().decode(bundle), snapshot) };
  })().catch((err) => { kernelPromise = null; throw err; }));

  /** SysML v2 text files -> elements (SysML v2 API JSON), by the engine. Parse errors stop with a message. */
  async function elementsFromSources(files, st) {
    status(st, 'Loading the SysML v2 engine (about 5 MB, once) …');
    const { k, lib } = await kernel();
    status(st, `Reading ${files.length} files …`);
    await new Promise((r) => setTimeout(r, 30));   // let the browser paint the status
    const json = JSON.stringify(files);
    const syntax = JSON.parse(k.checkSyntax(json)).filter((x) => x.stage === 'parse');
    if (syntax.length) {
      const e = new Error(`${syntax.length} syntax error${syntax.length > 1 ? 's' : ''}, the model cannot be read.`);
      e.hint = syntax.slice(0, 3).map((x) => `${x.unit}, line ${x.line}: ${x.message}`).join(' · ');
      throw e;
    }
    const session = k.Session.fromSourcesWithPreparedLibrary(json, lib);
    try { return JSON.parse(session.toFullJson(false, 'passthrough')); } finally { session.free(); }
  }

  let manifestPromise = null;
  const manifest = () => (manifestPromise ||= fetch(cfg.example.manifest).then((r) => { if (!r.ok) throw new Error('The SYSMOD files could not be loaded.'); return r.json(); }));
  const sysmodFiles = async (roles) => {
    const m = await manifest();
    const files = m.files.filter((x) => roles.includes(x.role));
    return Promise.all(files.map(async (x) => ({ name: x.name, text: await (await fetch(cfg.example.dir + x.name)).text() })));
  };

  const ex = { btn: $('[data-example]'), st: $('[data-status-example]'), err: $('[data-err-example]') };
  ex.btn?.addEventListener('click', async () => {
    ex.err.replaceChildren();
    ex.btn.disabled = true;
    try {
      const files = await sysmodFiles(['library', 'example']);
      const elements = await elementsFromSources(files, ex.st);
      status(ex.st, `${nf.format(elements.length)} elements`, 'ok');
      setParams({ example: 'drone' });
      useElements(elements, { kind: 'example', label: 'SYSMOD Delivery Drone example' });
    } catch (e) { status(ex.st, ''); showError(ex.err, e); }
    finally { ex.btn.disabled = false; }
  });

  const fl = { input: $('[data-files]'), st: $('[data-status-files]'), err: $('[data-err-files]') };
  fl.input.addEventListener('change', async () => {
    fl.err.replaceChildren();
    const picked = [...fl.input.files];
    if (!picked.length) return;
    try {
      const jsons = picked.filter((x) => /\.json$/i.test(x.name)), texts = picked.filter((x) => /\.(sysml|kerml)$/i.test(x.name));
      let elements;
      if (jsons.length) {
        status(fl.st, 'Reading …');
        elements = [];
        for (const j of jsons) {
          const data = JSON.parse(await j.text());
          const list = Array.isArray(data) ? data : Array.isArray(data?.elements) ? data.elements : null;
          if (!list) throw Object.assign(new Error(`${j.name} is not a list of elements.`), { hint: 'Expected: a JSON array of elements as GET …/commits/{commit}/elements returns it.' });
          elements.push(...list);
        }
      } else if (texts.length) {
        if (!cfg.engine) throw Object.assign(new Error('.sysml files need the SysML v2 engine, which this page does not have.'), { hint: 'Open a .json file with the elements of a commit, or use mbse4u.com/tools/sysmod-viewer/, which reads .sysml files.' });
        const own = await Promise.all(texts.map(async (x) => ({ name: x.name, text: await x.text() })));
        // the SYSMOD library is added unless the visitor brings it along
        const have = new Set(own.map((x) => x.name));
        const lib = (await sysmodFiles(['library'])).filter((x) => !have.has(x.name));
        elements = await elementsFromSources([...lib, ...own], fl.st);
      } else throw new Error('Choose .sysml files or a .json file.');
      status(fl.st, `${nf.format(elements.length)} elements`, 'ok');
      setParams({});
      useElements(elements, { kind: 'files', label: picked.map((x) => x.name).join(', ') });
    } catch (e) { status(fl.st, ''); showError(fl.err, e); }
  });

  // ---------- rendering of a SYSMOD project ----------
  const ATLAS = {
    problem: [['FEATURE'], ['STAKE', 'PS'], ['NE', 'RE', 'UC', 'SC']],
    solution: [['BFAC'], ['SIC'], ['FUC', 'LAC', 'PAC']],
  };
  const LABEL = {
    FEATURE: 'Features', STAKE: 'Stakeholders', PS: 'Problem Statement', NE: 'Needs', RE: 'Requirements', UC: 'Use Cases',
    SC: 'System Specification', BFAC: 'Brownfield Architecture', SIC: 'System Idea Architecture', FUC: 'Functional Architecture', LAC: 'Logical Architecture', PAC: 'Product Architecture',
  };
  const TARGET = { FEATURE: 'sv-features', STAKE: 'sv-stakeholders', PS: 'sv-problem', NE: 'sv-needs', RE: 'sv-requirements', UC: 'sv-usecases' };
  const targetOf = (k) => TARGET[k] || `sv-ctx-${k}`;

  const section = (id, title, ...kids) => h('section', { class: 'sv-sec', id, 'aria-labelledby': `${id}-h` }, h('h3', { id: `${id}-h`, class: 'display sv-h' }, title), ...kids);
  const empty = (text) => h('p', { class: 'ui text-muted sv-empty' }, text);
  const tag = (text) => (text ? h('span', { class: 'sv-tag' }, text) : null);
  const typesLine = (types) => (types?.length ? h('span', { class: 'notation text-muted' }, `: ${types.join(', ')}`) : null);
  const table = (cols, rows) => h('div', { class: 'overflow-x-auto' }, h('table', { class: 'mc-files sv-table' },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, rows)));

  function render(projectId, ms) {
    const v = core.readProject(model, projectId);
    if (source?.kind === 'server') setParams({ server: source.server, project: source.project, commit: source.commit, sysmod: projectId });
    const atlasCell = (k) => {
      const on = v.atlas[k];
      return h(on ? 'a' : 'span', { class: `sv-cell${on ? ' on' : ''}`, href: on ? `#${targetOf(k)}` : null, title: on ? `Go to ${LABEL[k]}` : `${LABEL[k]}: not in the model` },
        h('span', { class: 'sv-cell-mark', 'aria-hidden': 'true' }, on ? '■' : '□'), LABEL[k],
        h('span', { class: 'sr-only' }, on ? ' (in the model)' : ' (not in the model)'));
    };
    const atlas = h('div', { class: 'sv-atlas' },
      ['problem', 'solution'].map((side) => h('div', { class: `sv-space sv-${side}` },
        h('p', { class: 'stereo sv-space-h' }, side === 'problem' ? 'problem space' : 'solution space'),
        ATLAS[side].map((row) => h('div', { class: 'sv-row' }, row.map(atlasCell))))));

    const checks = h('ul', { class: 'sv-checks' }, v.checks.map((c) => h('li', { class: `sv-check ${c.status}` },
      h('span', { class: 'sv-check-mark', 'aria-hidden': 'true' }, c.status === 'passed' ? '✓' : '!'),
      h('span', {}, h('strong', {}, c.title), ' ', h('span', { class: 'sr-only' }, c.status === 'passed' ? '(passed) ' : '(open) '), c.text))));

    const head = h('header', { class: 'sv-head' },
      h('p', { class: 'stereo m-0' }, 'project'),
      h('h2', { class: 'display display-md m-0' }, v.name),
      v.qualifiedName ? h('p', { class: 'notation text-muted m-0' }, v.qualifiedName) : null,
      v.sysmodVersion || v.coverView ? h('p', { class: 'ui text-muted m-0 sv-origin' }, [v.sysmodVersion ? `SYSMOD ${v.sysmodVersion}` : '', v.coverView ? `cover view: ${v.coverView}` : ''].filter(Boolean).join(' · ')) : null,
      h('p', { class: 'ui text-muted sv-origin' }, `Source: ${source?.label || ''} · ${nf.format(model.size)} elements${ms ? ` · read in ${Math.round(ms)} ms` : ''}`),
      v.purpose ? h('p', { class: 'sv-purpose' }, h('span', { class: 'ui font-semibold' }, 'Purpose: '), v.purpose) : null,
      v.owner ? h('p', { class: 'ui m-0' }, h('span', { class: 'font-semibold' }, 'Project owner: '), v.owner) : null,
      v.doc ? h('details', { class: 'sv-details' }, h('summary', { class: 'ui' }, 'Project description'), h('div', { class: 'prose max-w-[46rem]' }, paras(v.doc))) : null);

    const sections = [
      section('sv-atlas', 'SYSMOD Atlas', h('p', { class: 'ui text-muted m-0 mb-3' }, 'Which SYSMOD artifacts the project has. Click one to go there.'), atlas,
        h('details', { class: 'sv-details', open: true }, h('summary', { class: 'ui' }, `Completeness: ${v.checks.filter((c) => c.status === 'passed').length} of ${v.checks.length}`), checks)),
      section('sv-problem', 'Problem statement', v.problemStatement?.doc ? h('blockquote', { class: 'sv-quote' }, paras(v.problemStatement.doc)) : empty('No problem statement in the model.')),
      section('sv-idea', 'System idea',
        v.systemIdea ? [h('p', { class: 'ui m-0 mb-2' }, h('strong', {}, v.systemIdea.name), typesLine(v.systemIdea.types)), h('div', { class: 'prose max-w-[46rem]' }, paras(v.systemIdea.doc))] : empty('No system idea context in the model.'),
        v.objectives.items.length ? [h('h4', { class: 'ui sv-h4' }, 'System objectives'), v.objectives.doc ? h('div', { class: 'prose max-w-[46rem] text-muted' }, paras(v.objectives.doc)) : null,
          h('ul', { class: 'sv-list' }, v.objectives.items.map((o) => h('li', { style: `margin-left:${o.depth * 1.25}rem` }, h('strong', { class: 'ui' }, o.name), typesLine(o.types), paras(o.doc, 'm-0'))))] : null),
      section('sv-stakeholders', 'Stakeholders', v.stakeholders.length ? table(['Stakeholder', 'Description', 'Risk', 'Effort', 'Categories', 'Contact'],
        v.stakeholders.map((x) => h('tr', {},
          h('td', {}, h('strong', {}, x.name), x.owner ? [' ', tag('project owner')] : null, h('br'), h('span', { class: 'notation text-muted' }, x.element, x.types.length ? ` : ${x.types.join(', ')}` : '')),
          h('td', { class: 'sv-text' }, paras(x.doc, 'm-0')), h('td', {}, x.risk), h('td', {}, x.effort), h('td', {}, x.categories), h('td', {}, x.contact)))) : empty('No stakeholders in the model.')),
      section('sv-needs', 'Stakeholder needs', v.needs.length ? table(['Need', 'Text', 'Stakeholders', 'Priority'],
        v.needs.map((x) => h('tr', {},
          h('td', { style: x.depth ? `padding-left:${x.depth * 1.25}rem` : null }, h('strong', {}, x.name), h('br'), typesLine(x.types)),
          h('td', { class: 'sv-text' }, paras(x.doc, 'm-0')), h('td', {}, x.stakeholders), h('td', {}, x.priority)))) : empty('No stakeholder needs in the model.')),
      section('sv-requirements', 'System requirements',
        v.specification ? h('p', { class: 'ui text-muted m-0 mb-3' }, h('span', { class: 'notation' }, v.specification.name, v.specification.types.length ? ` : ${v.specification.types[0]}` : '')) : null,
        v.requirements.length ? table(['Requirement', 'Text', 'Obligation', 'Stability', 'Motivation', 'Stakeholders'],
          v.requirements.map((x) => h('tr', {},
            h('td', { style: x.depth ? `padding-left:${x.depth * 1.25}rem` : null }, x.shortName ? h('span', { class: 'notation' }, `<${x.shortName}> `) : null, h('strong', {}, x.name), h('br'), typesLine(x.types)),
            h('td', { class: 'sv-text' }, paras(x.doc, 'm-0')), h('td', {}, x.obligation), h('td', {}, x.stability), h('td', { class: 'sv-text' }, x.motivation), h('td', {}, x.stakeholders)))) : empty('No system requirements in the model.')),
      section('sv-usecases', 'System use cases', v.useCases.length ? h('div', { class: 'sv-cards' }, v.useCases.map((u) => h('article', { class: 'bk bk-usage sv-card' },
        h('div', { class: 'bk-head' }, h('p', { class: 'stereo m-0' }, 'use case'), h('h4', { class: 'bk-title sv-card-title' }, u.name), typesLine(u.types)),
        h('div', { class: 'bk-comp' }, paras(u.doc, 'm-0'),
          h('dl', { class: 'sv-dl' },
            [['Trigger', u.trigger], ['Result', u.result], ['Precondition', u.precondition], ['Postcondition', u.postcondition], ['Motivation', u.motivation], ['Actors', u.actors], ['Subject', u.subject]]
              .filter(([, val]) => val).map(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])),
          u.steps.length ? h('details', {}, h('summary', { class: 'ui' }, `${u.steps.length} steps`), h('ol', { class: 'sv-steps notation' }, u.steps.map((st) => h('li', {}, st)))) : null))))
        : empty('No system use cases in the specification context.')),
      ...v.contexts.map((c, i) => {
        const def = core.CONTEXTS[i];
        return section(`sv-ctx-${def.key}`, def.title, c ? contextView(c) : empty(`No ${def.role} in the model.`));
      }),
      v.featureTree ? section('sv-features', 'Feature tree', h('p', { class: 'ui text-muted m-0 mb-2' }, `${v.featureTree.name}${v.featureTree.language ? ` (${v.featureTree.language})` : ''}`), h('pre', { class: 'mc-src sv-pre' }, v.featureTree.body)) : null,
    ];
    out.replaceChildren(head, ...sections.filter(Boolean));
    out.querySelector('h2')?.setAttribute('tabindex', '-1');
    out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  // ---------- context diagram (SVG) ----------
  function contextView(c) {
    const facts = h('p', { class: 'ui text-muted m-0 mb-3' },
      h('span', { class: 'notation' }, c.context.name, c.context.types.length ? ` : ${c.context.types[0]}` : ''),
      ` · ${c.actors.length} actors · ${c.links.length} interfaces · ${c.system?.ports?.length || 0} system ports · ${c.parts.length} parts${c.systemImpl ? ' (white box)' : ''}`);
    return [facts, h('figure', { class: 'sv-fig' }, diagram(c), h('figcaption', { class: 'sr-only' }, describe(c))),
      c.context.doc ? h('details', { class: 'sv-details' }, h('summary', { class: 'ui' }, 'Description'), h('div', { class: 'prose max-w-[46rem]' }, paras(c.context.doc))) : null];
  }
  const describe = (c) => `System context ${c.context.name}: system of interest ${c.system?.name || 'missing'}`
    + `${c.parts.length ? ` with the parts ${c.parts.map((p) => p.name).join(', ')}` : ''}; actors ${c.actors.map((a) => `${a.name}${a.stereotypes.length ? ` (${a.stereotypes.join(', ')})` : ''}`).join(', ') || 'none'}`
    + `${c.links.length ? `; interfaces ${c.links.map((l) => `${l.name || 'interface'}${l.actorPort || l.systemPort ? ` (${l.actorPort || '?'} to ${l.systemPort || '?'})` : ''}`).join(', ')}` : ''}.`;

  const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
  function diagram(c) {
    const W = 960, ACT_W = 180, ACT_H = 62, GAP = 26, PAD = 20, LANE = 140;
    const left = [], right = [];
    c.actors.forEach((a, i) => (i % 2 ? right : left).push(a));
    const rows = Math.max(left.length, right.length, 1);
    const sysX = PAD + ACT_W + LANE, sysW = W - 2 * sysX;
    const partCols = sysW > 300 ? 2 : 1, partW = (sysW - 36 - (partCols - 1) * 14) / partCols, partH = 40;
    const partRows = Math.ceil(c.parts.length / partCols);
    const sysInner = 64 + (partRows ? partRows * (partH + 12) + 6 : 10);
    const actorsH = rows * ACT_H + (rows - 1) * GAP;
    const H = Math.max(actorsH, sysInner) + 2 * PAD;
    const sysY = PAD + Math.max(0, (H - 2 * PAD - sysInner) / 2), sysH = Math.max(sysInner, Math.min(H - 2 * PAD, sysInner + 40));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sv-svg', role: 'img', 'aria-label': `Context diagram of ${c.context.name}` });
    // the system of interest
    const sys = s('g', { class: 'sv-sys' },
      s('rect', { x: sysX, y: sysY, width: sysW, height: sysH, rx: 10 }),
      s('text', { x: sysX + sysW / 2, y: sysY + 22, class: 'sv-st', 'text-anchor': 'middle' }, `«${(c.system?.stereotypes?.[0]) || 'system'}»`),
      s('text', { x: sysX + sysW / 2, y: sysY + 42, class: 'sv-name', 'text-anchor': 'middle' }, s('title', {}, c.system?.name || ''), clip(c.system?.name || '(no system of interest)', 40)));
    c.parts.forEach((p, i) => {
      const col = i % partCols, row = Math.floor(i / partCols);
      const x = sysX + 18 + col * (partW + 14), y = sysY + 60 + row * (partH + 12);
      const label = `${p.name}${p.types[0] ? ` : ${p.types[0]}` : ''}${p.multiplicity ? ` [${p.multiplicity}]` : ''}`;
      sys.append(s('g', { class: 'sv-part' }, s('title', {}, label), s('rect', { x, y, width: partW, height: partH, rx: 4 }),
        s('text', { x: x + partW / 2, y: y + 25, 'text-anchor': 'middle' }, clip(label, Math.floor(partW / 7.2)))));
    });
    // actors and their interfaces
    const linkOf = new Map();
    for (const l of c.links) { if (!linkOf.has(l.actor)) linkOf.set(l.actor, []); linkOf.get(l.actor).push(l); }
    const lines = s('g', { class: 'sv-lines' }), acts = s('g', {}), portsG = s('g', {});
    const place = (list, side) => list.forEach((a, i) => {
      const off = (H - 2 * PAD - (list.length * ACT_H + (list.length - 1) * GAP)) / 2;
      const x = side === 'left' ? PAD : W - PAD - ACT_W, y = PAD + off + i * (ACT_H + GAP);
      const cy = y + ACT_H / 2, ax = side === 'left' ? x + ACT_W : x, sx = side === 'left' ? sysX : sysX + sysW;
      const ls = linkOf.get(a.id) || [];
      const names = ls.map((l) => l.name || 'interface');
      const sy = Math.min(Math.max(cy, sysY + 14), sysY + sysH - 14);
      lines.append(s('line', { x1: ax, y1: cy, x2: sx, y2: sy, class: ls.length ? '' : 'sv-nolink' }));
      if (ls.length) {
        // the ports the interface connects: small squares on the borders, their names below the line
        const ap = [...new Set(ls.map((l) => l.actorPort).filter(Boolean))].join(', '), sp = [...new Set(ls.map((l) => l.systemPort).filter(Boolean))].join(', ');
        if (ap) portsG.append(s('rect', { x: ax - 4, y: cy - 4, width: 8, height: 8, class: 'sv-port' }, s('title', {}, `${a.name}.${ap}`)));
        if (sp) portsG.append(s('rect', { x: sx - 4, y: sy - 4, width: 8, height: 8, class: 'sv-port' }, s('title', {}, `${c.system?.name || 'system'}.${sp}`)));
        if (ap || sp) {
          // two lines, left port above the right one, so that long names fit into the lane between the boxes
          const [l, r] = side === 'left' ? [ap || '·', sp || '·'] : [sp || '·', ap || '·'];
          const mx = (ax + sx) / 2, my = (cy + sy) / 2 + 15;
          lines.append(s('text', { x: mx, y: my, 'text-anchor': 'middle', class: 'sv-portname' }, s('title', {}, `ports: ${l} ↔ ${r}`),
            s('tspan', { x: mx, dy: 0 }, `${clip(l, 19)} ↔`), s('tspan', { x: mx, dy: 12 }, clip(r, 19))));
        }
      }
      if (ls.length) {
        // long names on two lines, broken at a word boundary of the camelCase name (operator|Interface)
        const label = names.join(', ');
        let parts = [label];
        if (label.length > 18) {
          const cuts = [...label.matchAll(/(?<=[a-z0-9])(?=[A-Z])|(?<=[,_ -])/g)].map((m) => m.index).filter((i) => i > 2 && i < label.length - 2);
          const cut = cuts.sort((a, b) => Math.abs(a - label.length / 2) - Math.abs(b - label.length / 2))[0];
          parts = cut ? [label.slice(0, cut).trim(), label.slice(cut).trim()] : [label];
        }
        lines.append(s('text', { x: (ax + sx) / 2, y: cy - 8 - (parts.length - 1) * 13, 'text-anchor': 'middle', class: 'sv-ifc' }, s('title', {}, label),
          parts.map((t, i) => s('tspan', { x: (ax + sx) / 2, dy: i ? 13 : 0 }, clip(t, 19)))));
      }
      const st = a.stereotypes[0] || 'actor';
      const g = s('g', { class: `sv-actor sv-${st}` }, s('title', {}, `${a.name}${a.types.length ? ` : ${a.types.join(', ')}` : ''}${a.doc ? `\n${a.doc}` : ''}`));
      // every actor is a box, so that the line meets it; a «user» gets a small stick figure in it
      const fig = st === 'user' ? 22 : 0, tx = x + fig + (ACT_W - fig) / 2;
      g.append(s('rect', { x, y, width: ACT_W, height: ACT_H, rx: st === 'environmentalEffect' ? 28 : 4 }));
      if (fig) {
        const fx = x + 18, fy = y + 13;
        g.append(s('circle', { cx: fx, cy: fy, r: 5 }), s('path', { class: 'sv-fig-line', d: `M${fx} ${fy + 5}v15M${fx - 8} ${fy + 11}h16M${fx} ${fy + 20}l-7 12M${fx} ${fy + 20}l7 12` }));
      }
      g.append(s('text', { x: tx, y: y + 24, 'text-anchor': 'middle', class: 'sv-st' }, `«${st}»`),
        s('text', { x: tx, y: y + 44, 'text-anchor': 'middle', class: 'sv-name' }, clip(a.name, fig ? 18 : 21)));
      acts.append(g);
    });
    place(left, 'left'); place(right, 'right');
    svg.append(lines, sys, acts, portsG);
    if (!c.actors.length) svg.append(s('text', { x: PAD, y: PAD + 14, class: 'sv-st' }, 'no actors'));
    return svg;
  }

  // ---------- start ----------
  if (params.get('example') === 'drone' && ex.btn && cfg.engine) { showTab('example'); ex.btn.click(); }
}
