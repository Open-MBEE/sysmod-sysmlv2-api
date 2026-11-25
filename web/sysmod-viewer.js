/* sysmod-viewer.js: the interface of the SYSMOD viewer. Shows a SYSMOD project of a SysML v2 model:
   the SYSMOD Atlas, problem statement, system idea and objectives, stakeholders, needs, requirements, use cases and the
   system context diagrams. The model comes from
     - a SysML v2 API server (the browser asks the server directly, or through a relay; see sysmod-viewer-api.js),
     - the Delivery Drone example (a SysML v2 engine reads the SYSMOD files in the browser; only where cfg.engine is set),
     - files of the visitor: .json (elements as the API delivers them) or, with cfg.engine, .sysml.
   Nothing is sent anywhere else. All texts from the model are inserted with textContent, never as HTML.
   The same file runs in github.com/Open-MBEE/sysmod-sysmlv2-api (web/index.html) and on mbse4u.com/tools/sysmod-viewer/:
   without cfg.engine there is no example and no .sysml files (only .json), without cfg.relay no relay. */

// ---------- small DOM and text helpers ----------

const SVGNS = 'http://www.w3.org/2000/svg';
const isContent = (k) => k != null && k !== false && k !== '';
const toNode = (k) => (k.nodeType ? k : document.createTextNode(String(k)));

function setAttribute(e, k, v) {
  if (v == null || v === false) return;
  if (k === 'class') e.className = v;
  else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
  else e.setAttribute(k, v === true ? '' : v);
}

/** An HTML element with attributes and children (strings become text nodes) */
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) setAttribute(e, k, v);
  e.append(...kids.flat(Infinity).filter(isContent).map(toNode));
  return e;
}

/** An SVG element with attributes and children */
function s(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) e.setAttribute(k, v);
  }
  e.append(...kids.flat(Infinity).filter(isContent).map(toNode));
  return e;
}

/** text if the condition holds, else '' (keeps template literals flat) */
const when = (cond, text) => (cond ? text : '');
const clip = (text, n) => (text.length > n ? text.slice(0, n - 1) + '…' : text);
const nf = new Intl.NumberFormat('en');

/** Doc text as paragraphs: blank lines separate paragraphs, single line breaks are the line breaks of the source. */
function paras(text, cls = '') {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .map((p) => h('p', { class: cls }, p));
}

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.dataset.kind = kind;
}

function errorBox(e) {
  return h('div', { class: 'mc-result mc-bad' },
    h('p', { class: 'mc-verdict' }, e?.message || String(e)),
    e?.hint ? h('p', { class: 'm-0' }, e.hint) : null,
    e?.url ? h('p', { class: 'mc-facts' }, h('code', {}, e.url)) : null);
}

const withHint = (message, hint) => Object.assign(new Error(message), { hint });

// ---------- the SysML v2 engine in the browser (example and .sysml files; only where cfg.engine is set) ----------

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' could not be loaded (HTTP ' + r.status + ')');
  const raw = new Uint8Array(await r.arrayBuffer());
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw;   // the server already decompressed it
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the engine. Use a current Chrome, Edge, Firefox or Safari.');
  return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

let kernelPromise = null;
function loadKernel(engine) {
  kernelPromise ||= (async () => {
    const at = (name) => engine.base + name;
    const [k, wasm, bundle, snapshot] = await Promise.all([
      import(at(engine.kernel)), fetchBytes(at(engine.wasm)), fetchBytes(at(engine.bundle)), fetchBytes(at(engine.snapshot)),
    ]);
    await k.default({ module_or_path: wasm });
    return { k, lib: new k.PreparedLibrary(new TextDecoder().decode(bundle), snapshot) };
  })().catch((err) => {
    kernelPromise = null;   // a failed start can be retried
    throw err;
  });
  return kernelPromise;
}

/** SysML v2 text files -> elements (SysML v2 API JSON), by the engine. Parse errors stop with a message. */
async function elementsFromSources(engine, files, statusEl) {
  setStatus(statusEl, 'Loading the SysML v2 engine (about 5 MB, once) …');
  const { k, lib } = await loadKernel(engine);
  setStatus(statusEl, 'Reading ' + files.length + ' files …');
  await new Promise((r) => setTimeout(r, 30));   // let the browser paint the status
  const json = JSON.stringify(files);
  const syntax = JSON.parse(k.checkSyntax(json)).filter((x) => x.stage === 'parse');
  if (syntax.length) {
    const errors = syntax.length + ' syntax error' + when(syntax.length > 1, 's');
    throw withHint(errors + ', the model cannot be read.', syntax.slice(0, 3).map((x) => x.unit + ', line ' + x.line + ': ' + x.message).join(' · '));
  }
  const session = k.Session.fromSourcesWithPreparedLibrary(json, lib);
  try {
    return JSON.parse(session.toFullJson(false, 'passthrough'));
  } finally {
    session.free();
  }
}

/** The elements of .json files (arrays of elements, or { elements: [...] }) */
async function elementsFromJsonFiles(files) {
  const elements = [];
  for (const file of files) {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data?.elements;
    if (!Array.isArray(list)) throw withHint(file.name + ' is not a list of elements.', 'Expected: a JSON array of elements as GET …/commits/{commit}/elements returns it.');
    elements.push(...list);
  }
  return elements;
}

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
const targetOf = (k) => TARGET[k] || 'sv-ctx-' + k;

const section = (id, title, ...kids) => h('section', { class: 'sv-sec', id, 'aria-labelledby': id + '-h' }, h('h3', { id: id + '-h', class: 'display sv-h' }, title), ...kids);
const empty = (text) => h('p', { class: 'ui text-muted sv-empty' }, text);
const tag = (text) => (text ? h('span', { class: 'sv-tag' }, text) : null);
const typesText = (types) => when(types?.length, ' : ' + (types || []).join(', '));
const typesLine = (types) => (types?.length ? h('span', { class: 'notation text-muted' }, ': ' + types.join(', ')) : null);
const indent = (depth, prop) => (depth ? prop + ':' + depth * 1.25 + 'rem' : null);
const table = (cols, rows) => h('div', { class: 'overflow-x-auto' }, h('table', { class: 'mc-files sv-table' },
  h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col' }, c)))),
  h('tbody', {}, rows)));

function atlasCell(v, k) {
  const on = v.atlas[k];
  if (!on) {
    return h('span', { class: 'sv-cell', title: LABEL[k] + ': not in the model' },
      h('span', { class: 'sv-cell-mark', 'aria-hidden': 'true' }, '□'), LABEL[k], h('span', { class: 'sr-only' }, ' (not in the model)'));
  }
  return h('a', { class: 'sv-cell on', href: '#' + targetOf(k), title: 'Go to ' + LABEL[k] },
    h('span', { class: 'sv-cell-mark', 'aria-hidden': 'true' }, '■'), LABEL[k], h('span', { class: 'sr-only' }, ' (in the model)'));
}

function atlasSection(v) {
  const atlas = h('div', { class: 'sv-atlas' },
    ['problem', 'solution'].map((side) => h('div', { class: 'sv-space sv-' + side },
      h('p', { class: 'stereo sv-space-h' }, side + ' space'),
      ATLAS[side].map((row) => h('div', { class: 'sv-row' }, row.map((k) => atlasCell(v, k)))))));
  const passed = (c) => c.status === 'passed';
  const checks = h('ul', { class: 'sv-checks' }, v.checks.map((c) => h('li', { class: 'sv-check ' + c.status },
    h('span', { class: 'sv-check-mark', 'aria-hidden': 'true' }, passed(c) ? '✓' : '!'),
    h('span', {}, h('strong', {}, c.title), ' ', h('span', { class: 'sr-only' }, passed(c) ? '(passed) ' : '(open) '), c.text))));
  return section('sv-atlas', 'SYSMOD Atlas', h('p', { class: 'ui text-muted m-0 mb-3' }, 'Which SYSMOD artifacts the project has. Click one to go there.'), atlas,
    h('details', { class: 'sv-details', open: true }, h('summary', { class: 'ui' }, 'Completeness: ' + v.checks.filter(passed).length + ' of ' + v.checks.length), checks));
}

function projectHead(v, sourceLabel, size, ms) {
  const facts = [when(v.sysmodVersion, 'SYSMOD ' + v.sysmodVersion), when(v.coverView, 'cover view: ' + v.coverView)].filter(Boolean).join(' · ');
  const origin = 'Source: ' + sourceLabel + ' · ' + nf.format(size) + ' elements' + when(ms, ' · read in ' + Math.round(ms) + ' ms');
  return h('header', { class: 'sv-head' },
    h('p', { class: 'stereo m-0' }, 'project'),
    h('h2', { class: 'display display-md m-0' }, v.name),
    v.qualifiedName ? h('p', { class: 'notation text-muted m-0' }, v.qualifiedName) : null,
    facts ? h('p', { class: 'ui text-muted m-0 sv-origin' }, facts) : null,
    h('p', { class: 'ui text-muted sv-origin' }, origin),
    v.purpose ? h('p', { class: 'sv-purpose' }, h('span', { class: 'ui font-semibold' }, 'Purpose: '), v.purpose) : null,
    v.owner ? h('p', { class: 'ui m-0' }, h('span', { class: 'font-semibold' }, 'Project owner: '), v.owner) : null,
    v.doc ? h('details', { class: 'sv-details' }, h('summary', { class: 'ui' }, 'Project description'), h('div', { class: 'prose max-w-[46rem]' }, paras(v.doc))) : null);
}

function problemSection(v) {
  const ps = v.problemStatement?.doc;
  return section('sv-problem', 'Problem statement', ps ? h('blockquote', { class: 'sv-quote' }, paras(ps)) : empty('No problem statement in the model.'));
}

function ideaSection(v) {
  const idea = v.systemIdea
    ? [h('p', { class: 'ui m-0 mb-2' }, h('strong', {}, v.systemIdea.name), typesLine(v.systemIdea.types)), h('div', { class: 'prose max-w-[46rem]' }, paras(v.systemIdea.doc))]
    : empty('No system idea context in the model.');
  const items = v.objectives.items;
  const objectives = items.length ? [
    h('h4', { class: 'ui sv-h4' }, 'System objectives'),
    v.objectives.doc ? h('div', { class: 'prose max-w-[46rem] text-muted' }, paras(v.objectives.doc)) : null,
    h('ul', { class: 'sv-list' }, items.map((o) => h('li', { style: indent(o.depth, 'margin-left') }, h('strong', { class: 'ui' }, o.name), typesLine(o.types), paras(o.doc, 'm-0')))),
  ] : null;
  return section('sv-idea', 'System idea', idea, objectives);
}

function stakeholderSection(v) {
  if (!v.stakeholders.length) return section('sv-stakeholders', 'Stakeholders', empty('No stakeholders in the model.'));
  const row = (x) => h('tr', {},
    h('td', {}, h('strong', {}, x.name), x.owner ? [' ', tag('project owner')] : null, h('br'), h('span', { class: 'notation text-muted' }, x.element + typesText(x.types))),
    h('td', { class: 'sv-text' }, paras(x.doc, 'm-0')), h('td', {}, x.risk), h('td', {}, x.effort), h('td', {}, x.categories), h('td', {}, x.contact));
  return section('sv-stakeholders', 'Stakeholders', table(['Stakeholder', 'Description', 'Risk', 'Effort', 'Categories', 'Contact'], v.stakeholders.map(row)));
}

function needsSection(v) {
  if (!v.needs.length) return section('sv-needs', 'Stakeholder needs', empty('No stakeholder needs in the model.'));
  const row = (x) => h('tr', {},
    h('td', { style: indent(x.depth, 'padding-left') }, h('strong', {}, x.name), h('br'), typesLine(x.types)),
    h('td', { class: 'sv-text' }, paras(x.doc, 'm-0')), h('td', {}, x.stakeholders), h('td', {}, x.priority));
  return section('sv-needs', 'Stakeholder needs', table(['Need', 'Text', 'Stakeholders', 'Priority'], v.needs.map(row)));
}

function requirementsSection(v) {
  const spec = v.specification;
  const specLine = spec ? h('p', { class: 'ui text-muted m-0 mb-3' }, h('span', { class: 'notation' }, spec.name + when(spec.types.length, ' : ' + spec.types[0]))) : null;
  if (!v.requirements.length) return section('sv-requirements', 'System requirements', specLine, empty('No system requirements in the model.'));
  const row = (x) => h('tr', {},
    h('td', { style: indent(x.depth, 'padding-left') }, x.shortName ? h('span', { class: 'notation' }, '<' + x.shortName + '> ') : null, h('strong', {}, x.name), h('br'), typesLine(x.types)),
    h('td', { class: 'sv-text' }, paras(x.doc, 'm-0')), h('td', {}, x.obligation), h('td', {}, x.stability), h('td', { class: 'sv-text' }, x.motivation), h('td', {}, x.stakeholders));
  return section('sv-requirements', 'System requirements', specLine,
    table(['Requirement', 'Text', 'Obligation', 'Stability', 'Motivation', 'Stakeholders'], v.requirements.map(row)));
}

function useCaseCard(u) {
  const facts = [['Trigger', u.trigger], ['Result', u.result], ['Precondition', u.precondition], ['Postcondition', u.postcondition], ['Motivation', u.motivation], ['Actors', u.actors], ['Subject', u.subject]]
    .filter(([, val]) => val);
  const steps = u.steps.length
    ? h('details', {}, h('summary', { class: 'ui' }, u.steps.length + ' steps'), h('ol', { class: 'sv-steps notation' }, u.steps.map((st) => h('li', {}, st))))
    : null;
  return h('article', { class: 'bk bk-usage sv-card' },
    h('div', { class: 'bk-head' }, h('p', { class: 'stereo m-0' }, 'use case'), h('h4', { class: 'bk-title sv-card-title' }, u.name), typesLine(u.types)),
    h('div', { class: 'bk-comp' }, paras(u.doc, 'm-0'), h('dl', { class: 'sv-dl' }, facts.map(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])), steps));
}

function useCaseSection(v) {
  const content = v.useCases.length ? h('div', { class: 'sv-cards' }, v.useCases.map(useCaseCard)) : empty('No system use cases in the specification context.');
  return section('sv-usecases', 'System use cases', content);
}

function featureSection(v) {
  const ft = v.featureTree;
  if (!ft) return null;
  return section('sv-features', 'Feature tree', h('p', { class: 'ui text-muted m-0 mb-2' }, ft.name + when(ft.language, ' (' + ft.language + ')')), h('pre', { class: 'mc-src sv-pre' }, ft.body));
}

// ---------- context diagram (SVG) ----------

function contextView(c) {
  const counts = ' · ' + c.actors.length + ' actors · ' + c.links.length + ' interfaces · ' + (c.system?.ports?.length || 0) + ' system ports · '
    + c.parts.length + ' parts' + when(c.systemImpl, ' (white box)');
  const facts = h('p', { class: 'ui text-muted m-0 mb-3' }, h('span', { class: 'notation' }, c.context.name + when(c.context.types.length, ' : ' + c.context.types[0])), counts);
  return [facts, h('figure', { class: 'sv-fig' }, diagram(c), h('figcaption', { class: 'sr-only' }, describe(c))),
    c.context.doc ? h('details', { class: 'sv-details' }, h('summary', { class: 'ui' }, 'Description'), h('div', { class: 'prose max-w-[46rem]' }, paras(c.context.doc))) : null];
}

/** The diagram in words, for screen readers */
function describe(c) {
  const actor = (a) => a.name + when(a.stereotypes.length, ' (' + a.stereotypes.join(', ') + ')');
  const ports = (l) => when(l.actorPort || l.systemPort, ' (' + (l.actorPort || '?') + ' to ' + (l.systemPort || '?') + ')');
  const link = (l) => (l.name || 'interface') + ports(l);
  return 'System context ' + c.context.name + ': system of interest ' + (c.system?.name || 'missing')
    + when(c.parts.length, ' with the parts ' + c.parts.map((p) => p.name).join(', '))
    + '; actors ' + (c.actors.map(actor).join(', ') || 'none')
    + when(c.links.length, '; interfaces ' + c.links.map(link).join(', ')) + '.';
}

const D = { W: 960, ACT_W: 180, ACT_H: 62, GAP: 26, PAD: 20, LANE: 140, PART_H: 40 };

/** Positions of the diagram: the system box in the middle, its parts in one or two columns */
function layout(c) {
  const rows = Math.max(Math.ceil(c.actors.length / 2), 1);
  const sysX = D.PAD + D.ACT_W + D.LANE, sysW = D.W - 2 * sysX;
  const partCols = sysW > 300 ? 2 : 1;
  const partW = (sysW - 36 - (partCols - 1) * 14) / partCols;
  const partRows = Math.ceil(c.parts.length / partCols);
  const sysInner = 64 + (partRows ? partRows * (D.PART_H + 12) + 6 : 10);
  const H = Math.max(rows * D.ACT_H + (rows - 1) * D.GAP, sysInner) + 2 * D.PAD;
  const sysY = D.PAD + Math.max(0, (H - 2 * D.PAD - sysInner) / 2);
  const sysH = Math.max(sysInner, Math.min(H - 2 * D.PAD, sysInner + 40));
  return { H, sysX, sysW, sysY, sysH, partCols, partW };
}

function systemBox(c, L) {
  const name = c.system?.name || '';
  const sys = s('g', { class: 'sv-sys' },
    s('rect', { x: L.sysX, y: L.sysY, width: L.sysW, height: L.sysH, rx: 10 }),
    s('text', { x: L.sysX + L.sysW / 2, y: L.sysY + 22, class: 'sv-st', 'text-anchor': 'middle' }, '«' + (c.system?.stereotypes?.[0] || 'system') + '»'),
    s('text', { x: L.sysX + L.sysW / 2, y: L.sysY + 42, class: 'sv-name', 'text-anchor': 'middle' }, s('title', {}, name), clip(name || '(no system of interest)', 40)));
  c.parts.forEach((p, i) => {
    const x = L.sysX + 18 + (i % L.partCols) * (L.partW + 14), y = L.sysY + 60 + Math.floor(i / L.partCols) * (D.PART_H + 12);
    const label = p.name + when(p.types[0], ' : ' + p.types[0]) + when(p.multiplicity, ' [' + p.multiplicity + ']');
    sys.append(s('g', { class: 'sv-part' }, s('title', {}, label), s('rect', { x, y, width: L.partW, height: D.PART_H, rx: 4 }),
      s('text', { x: x + L.partW / 2, y: y + 25, 'text-anchor': 'middle' }, clip(label, Math.floor(L.partW / 7.2)))));
  });
  return sys;
}

/** Long interface names on two lines, broken at a word boundary of the camelCase name (operator|Interface) */
function splitLabel(label) {
  if (label.length <= 18) return [label];
  const cuts = [...label.matchAll(/(?<=[a-z0-9])(?=[A-Z])|(?<=[,_ -])/g)].map((m) => m.index).filter((i) => i > 2 && i < label.length - 2);
  if (!cuts.length) return [label];
  const middle = label.length / 2;
  const cut = cuts.reduce((best, i) => (Math.abs(i - middle) < Math.abs(best - middle) ? i : best));
  return [label.slice(0, cut).trim(), label.slice(cut).trim()];
}

const unique = (list) => [...new Set(list.filter(Boolean))].join(', ');

/** The interface label above the line, the ports below it, and the port squares on the borders */
function drawLink(g, links, a, ends) {
  const { ax, cy, sx, sy, side, systemName } = ends;
  const mx = (ax + sx) / 2;
  const label = links.map((l) => l.name || 'interface').join(', ');
  const parts = splitLabel(label);
  g.lines.append(s('text', { x: mx, y: cy - 8 - (parts.length - 1) * 13, 'text-anchor': 'middle', class: 'sv-ifc' }, s('title', {}, label),
    parts.map((t, i) => s('tspan', { x: mx, dy: i ? 13 : 0 }, clip(t, 19)))));
  const ap = unique(links.map((l) => l.actorPort)), sp = unique(links.map((l) => l.systemPort));
  if (ap) g.ports.append(s('rect', { x: ax - 4, y: cy - 4, width: 8, height: 8, class: 'sv-port' }, s('title', {}, a.name + '.' + ap)));
  if (sp) g.ports.append(s('rect', { x: sx - 4, y: sy - 4, width: 8, height: 8, class: 'sv-port' }, s('title', {}, systemName + '.' + sp)));
  if (!ap && !sp) return;
  // two lines, left port above the right one, so that long names fit into the lane between the boxes
  const [l, r] = side === 'left' ? [ap || '·', sp || '·'] : [sp || '·', ap || '·'];
  const my = (cy + sy) / 2 + 15;
  g.lines.append(s('text', { x: mx, y: my, 'text-anchor': 'middle', class: 'sv-portname' }, s('title', {}, 'ports: ' + l + ' ↔ ' + r),
    s('tspan', { x: mx, dy: 0 }, clip(l, 19) + ' ↔'), s('tspan', { x: mx, dy: 12 }, clip(r, 19))));
}

/** An actor box; a «user» gets a small stick figure in it */
function actorBox(a, x, y) {
  const st = a.stereotypes[0] || 'actor';
  const title = a.name + typesText(a.types) + when(a.doc, '\n' + a.doc);
  const g = s('g', { class: 'sv-actor sv-' + st }, s('title', {}, title));
  const fig = st === 'user' ? 22 : 0, tx = x + fig + (D.ACT_W - fig) / 2;
  g.append(s('rect', { x, y, width: D.ACT_W, height: D.ACT_H, rx: st === 'environmentalEffect' ? 28 : 4 }));
  if (fig) {
    const fx = x + 18, fy = y + 13;
    const figure = 'M' + fx + ' ' + (fy + 5) + 'v15M' + (fx - 8) + ' ' + (fy + 11) + 'h16M' + fx + ' ' + (fy + 20) + 'l-7 12M' + fx + ' ' + (fy + 20) + 'l7 12';
    g.append(s('circle', { cx: fx, cy: fy, r: 5 }), s('path', { class: 'sv-fig-line', d: figure }));
  }
  g.append(s('text', { x: tx, y: y + 24, 'text-anchor': 'middle', class: 'sv-st' }, '«' + st + '»'),
    s('text', { x: tx, y: y + 44, 'text-anchor': 'middle', class: 'sv-name' }, clip(a.name, fig ? 18 : 21)));
  return g;
}

/** The actors of one side, with the lines to the system box */
function placeActors(g, c, L, list, side) {
  const linksOf = (a) => c.links.filter((l) => l.actor === a.id);
  const off = (L.H - 2 * D.PAD - (list.length * D.ACT_H + (list.length - 1) * D.GAP)) / 2;
  const left = side === 'left';
  list.forEach((a, i) => {
    const x = left ? D.PAD : D.W - D.PAD - D.ACT_W, y = D.PAD + off + i * (D.ACT_H + D.GAP);
    const cy = y + D.ACT_H / 2, ax = left ? x + D.ACT_W : x, sx = left ? L.sysX : L.sysX + L.sysW;
    const sy = Math.min(Math.max(cy, L.sysY + 14), L.sysY + L.sysH - 14);
    const links = linksOf(a);
    g.lines.append(s('line', { x1: ax, y1: cy, x2: sx, y2: sy, class: links.length ? '' : 'sv-nolink' }));
    if (links.length) drawLink(g, links, a, { ax, cy, sx, sy, side, systemName: c.system?.name || 'system' });
    g.actors.append(actorBox(a, x, y));
  });
}

function diagram(c) {
  const L = layout(c);
  const svg = s('svg', { viewBox: '0 0 ' + D.W + ' ' + L.H, class: 'sv-svg', role: 'img', 'aria-label': 'Context diagram of ' + c.context.name });
  const g = { lines: s('g', { class: 'sv-lines' }), actors: s('g', {}), ports: s('g', {}) };
  placeActors(g, c, L, c.actors.filter((_, i) => i % 2 === 0), 'left');
  placeActors(g, c, L, c.actors.filter((_, i) => i % 2 === 1), 'right');
  svg.append(g.lines, systemBox(c, L), g.actors, g.ports);
  if (!c.actors.length) svg.append(s('text', { x: D.PAD, y: D.PAD + 14, class: 'sv-st' }, 'no actors'));
  return svg;
}

/** All sections of a project */
function projectSections(v, contexts) {
  return [
    atlasSection(v), problemSection(v), ideaSection(v), stakeholderSection(v), needsSection(v), requirementsSection(v), useCaseSection(v),
    ...v.contexts.map((c, i) => section('sv-ctx-' + contexts[i].key, contexts[i].title, c ? contextView(c) : empty('No ' + contexts[i].role + ' in the model.'))),
    featureSection(v),
  ].filter(Boolean);
}

// ---------- the page ----------

/** The commit to preselect: the one in the address, else the head of the default branch, else the newest */
function preselectedCommit(commits, wanted, head) {
  const has = (id) => id && commits.some((c) => c['@id'] === id);
  if (has(wanted)) return wanted;
  if (has(head)) return head;
  return commits[0]?.['@id'] || '';
}

function commitLabel(c, head) {
  const d = Date.parse(c.created || '');
  const date = d ? new Date(d).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : c['@id'].slice(0, 8);
  return date + when(c.description, ' · ' + String(c.description).slice(0, 60)) + when(c['@id'] === head, '  (head of the default branch)');
}

async function start(root, cfg) {
  const core = await import(cfg.core);
  const apiMod = await import(cfg.api);
  const $ = (sel) => root.querySelector(sel);

  // ---------- state in the address (never the token) ----------
  const params = new URLSearchParams(location.search);
  const setParams = (obj) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) {
      if (v) p.set(k, v);
    }
    const q = p.toString();
    history.replaceState(null, '', location.pathname + when(q, '?' + q) + location.hash);
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

  function render(projectId, ms) {
    const v = core.readProject(model, projectId);
    if (source?.kind === 'server') setParams({ server: source.server, project: source.project, commit: source.commit, sysmod: projectId });
    out.replaceChildren(projectHead(v, source?.label || '', model.size, ms), ...projectSections(v, core.CONTEXTS));
    out.querySelector('h2')?.setAttribute('tabindex', '-1');
    out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

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
        h('p', { class: 'm-0' }, 'The model has ' + nf.format(model.size) + ' elements, but none of them is a SYSMOD project (#project, or a specialization of SYSMOD::Project). '
          + 'The SYSMOD library must be part of the same model.')));
      return;
    }
    const label = (p) => (p.qualifiedName && p.qualifiedName !== p.name ? p.name + '  (' + p.qualifiedName + ')' : p.name);
    pickSel.replaceChildren(...projects.map((p) => h('option', { value: p.id }, label(p))));
    pick.hidden = projects.length < 2;
    const first = projects.find((p) => p.id === params.get('sysmod')) || projects[0];
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
  if (params.get('server')) {
    f.url.value = params.get('server');
    showTab('server');
  }
  // the servers of the relay as suggestions for the address field
  $('[data-relay-list]')?.replaceChildren(...(cfg.relay?.servers || []).filter((u) => u !== '*').map((u) => h('option', { value: u })));

  const showError = (box, e) => {
    if (e?.name !== 'AbortError') box.replaceChildren(errorBox(e));
  };

  async function connect() {
    f.err.replaceChildren();
    f.projRow.hidden = true;
    try {
      client = apiMod.createClient({ baseUrl: f.url.value, token: f.token.value, relay: cfg.relay });
      f.url.value = client.base;
      const via = when(client.viaRelay, ' via ' + (cfg.relay?.label || 'the relay'));
      setStatus(f.st, 'Connecting' + via + ' …');
      projectList = await client.projects();
      if (!projectList.length) {
        setStatus(f.st, 'The server has no projects.', 'bad');
        return;
      }
      setStatus(f.st, nf.format(projectList.length) + ' projects' + via, 'ok');
      f.proj.replaceChildren();   // a new server: no selection carried over from the previous one
      fillProjects();
      f.projRow.hidden = false;
      const want = params.get('project');
      if (want && projectList.some((p) => p['@id'] === want)) f.proj.value = want;
      await loadCommits();
    } catch (e) {
      setStatus(f.st, '');
      showError(f.err, e);
    }
  }
  f.connect.addEventListener('click', connect);
  f.url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') f.connect.click();
  });

  function fillProjects() {
    const q = f.projFilter.value.trim().toLowerCase();
    const keep = f.proj.value;
    const list = projectList.filter((p) => !q || String(p.name || '').toLowerCase().includes(q) || p['@id'].includes(q));
    f.proj.replaceChildren(...list.map((p) => h('option', { value: p['@id'] }, p.name || p['@id'])));
    if (list.some((p) => p['@id'] === keep)) f.proj.value = keep;
  }
  f.projFilter.addEventListener('input', () => {
    const before = f.proj.value;
    fillProjects();
    if (f.proj.value !== before) loadCommits();
  });
  f.proj.addEventListener('change', () => loadCommits());

  async function defaultHead(pid) {
    try {
      const p = await client.project(pid);
      const bid = p?.defaultBranch?.['@id'];
      if (!bid) return null;
      const b = (await client.branches(pid)).find((x) => x['@id'] === bid);
      return b?.head?.['@id'] || null;
    } catch {
      return null;
    }
  }

  async function loadCommits() {
    f.commit.replaceChildren(h('option', {}, 'Loading commits …'));
    f.load.disabled = true;
    const pid = f.proj.value;
    if (!pid) return;
    try {
      const [commits, head] = await Promise.all([client.commits(pid), defaultHead(pid)]);
      if (pid !== f.proj.value) return;   // the visitor chose another project meanwhile
      if (!commits.length) {
        f.commit.replaceChildren(h('option', {}, 'This project has no commits.'));
        return;
      }
      f.commit.replaceChildren(...commits.map((c) => h('option', { value: c['@id'] }, commitLabel(c, head))));
      f.commit.value = preselectedCommit(commits, params.get('commit'), head);
      f.load.disabled = false;
    } catch (e) {
      f.commit.replaceChildren();
      showError(f.err, e);
    }
  }

  async function loadModel() {
    f.err.replaceChildren();
    abort?.abort();
    abort = new AbortController();
    const pid = f.proj.value, cid = f.commit.value;
    const pname = f.proj.selectedOptions[0]?.textContent || pid;
    f.load.disabled = true;
    try {
      setStatus(f.st, 'Loading the model …');
      const onProgress = (n) => setStatus(f.st, 'Loading the model … ' + nf.format(n) + ' elements');
      const elements = await client.elements(pid, cid, { signal: abort.signal, onProgress });
      setStatus(f.st, nf.format(elements.length) + ' elements loaded', 'ok');
      setParams({ server: client.base, project: pid, commit: cid });
      useElements(elements, { kind: 'server', label: pname + ' on ' + new URL(client.base).host, server: client.base, project: pid, commit: cid });
    } catch (e) {
      setStatus(f.st, '');
      showError(f.err, e);
    } finally {
      f.load.disabled = false;
    }
  }
  f.load.addEventListener('click', loadModel);

  // ---------- 2. + 3. The example and files ----------
  let manifestPromise = null;
  const manifest = () => {
    manifestPromise ||= fetch(cfg.example.manifest).then((r) => {
      if (!r.ok) throw new Error('The SYSMOD files could not be loaded.');
      return r.json();
    });
    return manifestPromise;
  };
  const sysmodFiles = async (roles) => {
    const m = await manifest();
    const files = m.files.filter((x) => roles.includes(x.role));
    return Promise.all(files.map(async (x) => ({ name: x.name, text: await (await fetch(cfg.example.dir + x.name)).text() })));
  };

  const ex = { btn: $('[data-example]'), st: $('[data-status-example]'), err: $('[data-err-example]') };
  async function openExample() {
    ex.err.replaceChildren();
    ex.btn.disabled = true;
    try {
      const elements = await elementsFromSources(cfg.engine, await sysmodFiles(['library', 'example']), ex.st);
      setStatus(ex.st, nf.format(elements.length) + ' elements', 'ok');
      setParams({ example: 'drone' });
      useElements(elements, { kind: 'example', label: 'SYSMOD Delivery Drone example' });
    } catch (e) {
      setStatus(ex.st, '');
      showError(ex.err, e);
    } finally {
      ex.btn.disabled = false;
    }
  }
  ex.btn?.addEventListener('click', openExample);

  /** .sysml files, read together with the SYSMOD library (unless the visitor brings it along) */
  async function elementsFromSysmlFiles(files, statusEl) {
    if (!cfg.engine) throw withHint('.sysml files need the SysML v2 engine, which this page does not have.', 'Open a .json file with the elements of a commit, or use mbse4u.com/tools/sysmod-viewer/, which reads .sysml files.');
    const own = await Promise.all(files.map(async (x) => ({ name: x.name, text: await x.text() })));
    const have = new Set(own.map((x) => x.name));
    const lib = (await sysmodFiles(['library'])).filter((x) => !have.has(x.name));
    return elementsFromSources(cfg.engine, [...lib, ...own], statusEl);
  }

  const fl = { input: $('[data-files]'), st: $('[data-status-files]'), err: $('[data-err-files]') };
  async function openFiles() {
    fl.err.replaceChildren();
    const picked = [...fl.input.files];
    if (!picked.length) return;
    const ofKind = (...ext) => picked.filter((x) => ext.some((e) => x.name.toLowerCase().endsWith(e)));
    const jsons = ofKind('.json'), texts = ofKind('.sysml', '.kerml');
    try {
      if (!jsons.length && !texts.length) throw new Error('Choose .sysml files or a .json file.');
      setStatus(fl.st, 'Reading …');
      const elements = jsons.length ? await elementsFromJsonFiles(jsons) : await elementsFromSysmlFiles(texts, fl.st);
      setStatus(fl.st, nf.format(elements.length) + ' elements', 'ok');
      setParams({});
      useElements(elements, { kind: 'files', label: picked.map((x) => x.name).join(', ') });
    } catch (e) {
      setStatus(fl.st, '');
      showError(fl.err, e);
    }
  }
  fl.input.addEventListener('change', openFiles);

  // ---------- start ----------
  if (params.get('example') === 'drone' && ex.btn && cfg.engine) {
    showTab('example');
    await openExample();
  }
}

const viewerRoot = document.getElementById('sysmod-viewer');
if (viewerRoot) {
  start(viewerRoot, JSON.parse(viewerRoot.dataset.config)).catch((e) => {
    viewerRoot.querySelector('[data-out]')?.replaceChildren(errorBox(e));
    console.error(e);
  });
}
