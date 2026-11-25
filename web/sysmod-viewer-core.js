/* sysmod-viewer-core.js: reads a SYSMOD project from the elements of a SysML v2 model, as the SysML v2 REST API delivers them.
   Pure ES module without dependencies: runs in the browser (page /tools/sysmod-viewer/) and in Node (scripts/test-sysmod-viewer.mjs).

   Port of the reading part of github.com/Open-MBEE/sysmod-sysmlv2-api (sysmod_api_helpers.py) and
   github.com/MBSE4U/mbse4u_sysmlv2_helpers (Apache License 2.0, Tim Weilkiens and contributors), adapted to SYSMOD v5
   (SYSMOD::Project with brownfieldContext, systemIdeaContext, specificationContext, functionalContext, logicalContext,
   productContext and their *Impl white box variants). Differences to the Python original:
     - The whole commit is loaded once (paged), then everything is read locally. No request per element.
     - Roles of the project are found by their DIRECT redefinition/subsetting of the library feature (:>> problemStatement),
       not by any specialization: specificationContext also specializes systemIdeaContext, the direct relation tells them apart.
     - Read-only. No AI, no writing commits.

     const model = createModel(elements);          // elements: array of SysML v2 API element objects (with derived properties)
     const projects = findProjects(model);          // [{ id, name, qualifiedName }]
     const view = readProject(model, projects[0].id);   // everything the viewer shows, plain data, see readProject()
*/

export const SYSMOD = {
  project: 'SYSMOD::Project',
  soi: 'SYSMOD::SystemContext::systemOfInterest',
  actors: 'SYSMOD::SystemContext::actors',
  useCases: 'SYSMOD::SystemContext::useCases',
};

/** The contexts of a SYSMOD v5 project, in the order of the SYSMOD Atlas. key = atlas id, role = feature of SYSMOD::Project. */
export const CONTEXTS = [
  { key: 'BFAC', role: 'brownfieldContext', title: 'Brownfield Architecture', space: 'solution' },
  { key: 'SIC', role: 'systemIdeaContext', title: 'System Idea Architecture', space: 'solution' },
  { key: 'SC', role: 'specificationContext', title: 'System Specification', space: 'problem' },
  { key: 'FUC', role: 'functionalContext', title: 'Functional Architecture', space: 'solution' },
  { key: 'LAC', role: 'logicalContext', title: 'Logical Architecture', space: 'solution' },
  { key: 'PAC', role: 'productContext', title: 'Product Architecture', space: 'solution' },
];

const ref = (r) => (r && typeof r === 'object' ? r['@id'] : r) || null;
const refs = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(ref).filter(Boolean);

/** Element access over an array of elements. Unknown ids (e.g. the standard library, not part of the project) give null. */
export function createModel(elements) {
  const byId = new Map();
  for (const e of elements) if (e && e['@id']) byId.set(e['@id'], e);
  let byQName = null, byType = null, annotations = null;
  const M = {
    size: byId.size,
    get: (r) => byId.get(ref(r)) ?? null,
    all: (rs) => refs(rs).map((id) => byId.get(id)).filter(Boolean),
    /** first element with this qualified name; library elements are preferred over model elements with the same name */
    byQName(qn) {
      if (!byQName) {
        byQName = new Map();
        for (const e of byId.values()) if (e.qualifiedName && !byQName.has(e.qualifiedName)) byQName.set(e.qualifiedName, e);
      }
      return byQName.get(qn) ?? null;
    },
    ofType(t) {
      if (!byType) {
        byType = new Map();
        for (const e of byId.values()) { const k = e['@type']; if (!byType.has(k)) byType.set(k, []); byType.get(k).push(e); }
      }
      return byType.get(t) ?? [];
    },
    /** ids of the metadata definitions applied to an element (#user, #system, ...), from the MetadataUsages */
    metadataOf(el) {
      if (!annotations) {
        annotations = new Map();
        for (const mu of M.ofType('MetadataUsage')) {
          const def = M.get(mu.metadataDefinition) || M.all(mu.definition)[0];
          if (!def) continue;
          for (const a of refs(mu.annotatedElement)) { if (!annotations.has(a)) annotations.set(a, []); annotations.get(a).push(def); }
        }
      }
      return annotations.get(ref(el)) ?? [];
    },
  };
  return M;
}

/** An element of the SYSMOD library itself (SYSMOD, SYSMOD15288, SYSMOD4AI, SYSMODViews …) or of another library */
export const isLibrary = (el) => !!el && (el.isLibraryElement === true || /^SYSMOD[A-Za-z0-9_]*::/.test(el.qualifiedName || ''));

export const nameOf = (el) => (el && (el.name ?? el.declaredName ?? el.shortName ?? el.declaredShortName)) || '';

/** The general elements of an element: what it redefines, subsets, is typed by, specializes. */
function generals(M, el) {
  const out = [];
  for (const s of M.all(el.ownedSpecialization)) { const g = ref(s.general); if (g) out.push(g); }
  // some servers omit ownedSpecialization on usages: typing and redefinition are specializations as well
  for (const t of refs(el.type)) out.push(t);
  return out;
}

/** Does el specialize target (transitively, also over typing)? el === target counts. */
export function specializes(M, el, target) {
  const goal = ref(target);
  if (!el || !goal) return false;
  const seen = new Set(), todo = [ref(el)];
  while (todo.length) {
    const id = todo.pop();
    if (id === goal) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const e = M.get(id);
    if (e) todo.push(...generals(M, e));
  }
  return false;
}

/** Does el redefine or subset target directly (:>> target, :> target)? */
export function directlySpecializes(M, el, target) {
  const goal = ref(target);
  return M.all(el.ownedSpecialization).some((s) => ref(s.general) === goal);
}

/** Documentation text of an element; with viaDefinition the documentation of its definition if it has none of its own. */
export function docOf(M, el, viaDefinition = true) {
  if (!el) return '';
  const own = M.all(el.documentation).map((d) => cleanDoc(d.body)).filter(Boolean);
  if (own.length) return own.join('\n\n');
  // the text of the definition, but not the generic text of a SYSMOD library definition ("Base element for concerns.")
  if (viaDefinition) for (const d of definitionsOf(M, el)) { if (isLibrary(d)) continue; const t = docOf(M, d, false); if (t) return t; }
  return '';
}

/** The most specific definitions of a usage: a definition that another one of the list specializes is left out. */
export function definitionsOf(M, el) {
  const defs = M.all(el?.definition ?? el?.type);
  return defs.filter((d) => !defs.some((o) => o !== d && specializes(M, o, d)));
}

/** Removes the comment layout that some servers keep in the body (leading asterisks of continued lines). */
export function cleanDoc(body) {
  if (typeof body !== 'string') return '';
  // without regular expressions anchored at the end (linear time also for long texts)
  let t = body.trim();
  if (t.startsWith('/*')) { let i = 1; while (i < t.length && t[i] === '*') i++; t = t.slice(i); }
  if (t.endsWith('*/')) { let e = t.length - 1; while (e > 0 && t[e - 1] === '*') e--; t = t.slice(0, e); }
  const lines = t.split('\n').map((l) => { const s = l.trimStart(); return (s.startsWith('*') ? s.slice(1) : s).trim(); });
  const out = [];
  for (const l of lines) if (l || (out.length && out[out.length - 1] !== '')) out.push(l);   // at most one blank line
  return out.join('\n').trim();
}

/**
 * All features of an element, effective: its own and the inherited ones, a redefined feature replaced by its redefinition.
 * Computed here over the generalizations (typing, subclassification, subsetting, redefinition), because not every server
 * delivers the derived inheritedFeature; what the server delivers in feature/inheritedFeature is added.
 */
export function featuresOf(M, el, type) {
  if (!el) return [];
  const all = M.effective ? M.effective(el) : effectiveFeatures(M, el);
  return type ? all.filter((f) => (Array.isArray(type) ? type.includes(f['@type']) : f['@type'] === type)) : all;
}
function effectiveFeatures(M, el) {
  const cache = (M._eff ||= new Map());
  const hit = cache.get(el['@id']);
  if (hit) return hit;
  cache.set(el['@id'], []);   // guards against cycles
  const out = [], seen = new Set(), redefined = new Set();
  const add = (f) => {
    if (!f || seen.has(f['@id']) || redefined.has(f['@id'])) return;
    seen.add(f['@id']);
    out.push(f);
    for (const r of M.all(f.ownedSpecialization)) if (r['@type'] === 'Redefinition') { const g = ref(r.redefinedFeature ?? r.general); if (g) redefined.add(g); }
  };
  for (const f of M.all(el.ownedFeature)) add(f);
  for (const g of generals(M, el)) { const ge = M.get(g); if (ge && ge !== el) for (const f of effectiveFeatures(M, ge)) add(f); }
  for (const f of M.all(el.feature)) add(f);
  for (const f of M.all(el.inheritedFeature)) add(f);
  // the nearest feature of a name wins (several paths of inheritance can bring redefinitions of the same feature)
  const names = new Set();
  const result = out.filter((f) => {
    if (redefined.has(f['@id'])) return false;
    const n = nameOf(f);
    if (!n) return true;
    if (names.has(n)) return false;
    names.add(n);
    return true;
  });
  cache.set(el['@id'], result);
  return result;
}
/** Only the owned features (no inherited ones) */
export const ownedFeaturesOf = (M, el, type) => M.all(el?.ownedFeature).filter((f) => !type || (Array.isArray(type) ? type.includes(f['@type']) : f['@type'] === type));

/** The feature of an element with this name (effective, inherited included) */
export const featureNamed = (M, el, name, type) => featuresOf(M, el, type).find((f) => nameOf(f) === name) || null;

/** Text of the value of an attribute (literal, enumeration literal, quantity, feature chain); '' if it has none. */
export function valueOf(M, feature) {
  if (!feature) return '';
  for (const r of M.all(feature.ownedRelationship)) {
    if (r['@type'] !== 'FeatureValue') continue;
    const t = exprText(M, M.get(r.value), 0);
    if (t !== '') return t;
  }
  return '';
}

/** A readable text of an expression. Keeps to the common cases of SYSMOD attribute values. */
export function exprText(M, e, depth = 0) {
  if (!e || depth > 8) return '';
  const t = e['@type'];
  if ('value' in e && /^Literal/.test(t)) return t === 'LiteralInfinity' ? '*' : String(e.value);
  if (t === 'LiteralInfinity') return '*';
  if (t === 'NullExpression') return '';
  if (t === 'FeatureReferenceExpression') return nameOf(M.get(e.referent));
  if (t === 'FeatureChainExpression') {
    const target = M.get(e.targetFeature);
    const chain = target && refs(target.chainingFeature).length ? M.all(target.chainingFeature).map(nameOf) : [nameOf(target)];
    const src = argsOf(M, e).map((a) => exprText(M, a, depth + 1)).filter(Boolean)[0];
    return [src, ...chain].filter(Boolean).join('.');
  }
  if (t === 'OperatorExpression') {
    const args = argsOf(M, e).map((a) => exprText(M, a, depth + 1));
    const op = e.operator;
    if (op === '[') return `${args[0] ?? ''} [${args[1] ?? ''}]`;
    if (op === ',') return args.filter(Boolean).join(', ');
    if (op === '-' && args.length === 1) return `-${args[0]}`;
    if (args.length === 2 && op) return `${args[0]} ${op} ${args[1]}`;
    return args.filter(Boolean).join(' ');
  }
  if (t === 'InvocationExpression') return `${nameOf(M.all(e.instantiatedType ?? e.type)[0])}(${argsOf(M, e).map((a) => exprText(M, a, depth + 1)).join(', ')})`;
  return '';
}
/** Arguments of an invocation: the values of its input parameters, in order. */
function argsOf(M, e) {
  const direct = M.all(e.argument);
  if (direct.length) return direct;
  const out = [];
  for (const p of M.all(e.ownedFeature)) {
    if (p.direction && p.direction !== 'in') continue;
    for (const r of M.all(p.ownedRelationship)) if (r['@type'] === 'FeatureValue') { const v = M.get(r.value); if (v) out.push(v); }
  }
  return out;
}

const valueNamed = (M, el, name) => valueOf(M, featureNamed(M, el, name, 'AttributeUsage'));

/** The SYSMOD projects of the model: elements with #project, otherwise definitions that specialize SYSMOD::Project. */
export function findProjects(M) {
  const lib = M.byQName(SYSMOD.project);
  const found = new Map();
  for (const mu of M.ofType('MetadataUsage')) {
    const def = M.get(mu.metadataDefinition) || M.all(mu.definition)[0];
    if (!def || !(def.declaredShortName === 'project' || def.qualifiedName === 'SYSMOD::ProjectMetadata')) continue;
    for (const a of M.all(mu.annotatedElement)) if (a !== lib) found.set(a['@id'], a);
  }
  if (!found.size && lib) {
    for (const d of M.ofType('OccurrenceDefinition')) if (d !== lib && !d.isLibraryElement && specializes(M, d, lib)) found.set(d['@id'], d);
  }
  return [...found.values()]
    .map((p) => ({ id: p['@id'], name: nameOf(p) || '(unnamed project)', qualifiedName: p.qualifiedName || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The features of the project that play a role of SYSMOD::Project (e.g. 'problemStatement'). */
function roleOf(M, project, role, { transitive = false } = {}) {
  const lib = M.byQName(`${SYSMOD.project}::${role}`);
  if (!lib) return [];
  const own = ownedFeaturesOf(M, project);
  const direct = own.filter((f) => f !== lib && directlySpecializes(M, f, lib));
  if (direct.length || !transitive) return direct;
  return own.filter((f) => f !== lib && specializes(M, f, lib));
}

/** Stereotype-like labels from the SYSMOD metadata on an element and the elements it redefines (#user, #system ...). */
function stereotypesOf(M, el) {
  const names = new Set();
  const seen = new Set(), todo = [el['@id']];
  while (todo.length && seen.size < 40) {
    const id = todo.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of M.metadataOf(id)) { const n = d.declaredShortName || nameOf(d); if (n) names.add(n); }
    const e = M.get(id);
    if (e) for (const s of M.all(e.ownedSpecialization)) if (s['@type'] !== 'FeatureTyping') { const g = ref(s.general); if (g) todo.push(g); }
  }
  return [...names];
}

const brief = (M, el) => (el ? { id: el['@id'], name: nameOf(el), type: el['@type'], doc: docOf(M, el) } : null);
const typeNames = (M, el) => definitionsOf(M, el).map(nameOf).filter(Boolean);

/** System of interest, actors, connections and (white box) internal parts of a context. */
export function readContext(M, project, def) {
  const ctx = roleOf(M, project, def.role)[0];
  if (!ctx) return null;
  const impl = roleOf(M, project, `${def.role}Impl`)[0] || null;
  const soiLib = M.byQName(SYSMOD.soi), actorsLib = M.byQName(SYSMOD.actors);
  const parts = featuresOf(M, ctx, 'PartUsage');
  const soi = parts.find((p) => p !== soiLib && specializes(M, p, soiLib)) || null;
  const actors = parts.filter((p) => p !== actorsLib && p !== soi && specializes(M, p, actorsLib));
  // connections between the actors and the system (interfaces, connections), by the parts their ends point to
  // a feature stands for the soi or an actor if it is that part or one the part redefines (e.g. the part of the context definition)
  const match = (x) => {
    if (!x || x === soiLib || x === actorsLib) return null;
    if (soi && (x === soi || specializes(M, soi, x))) return soi;
    return actors.find((a) => a === x || specializes(M, a, x)) || null;
  };
  // the part (soi or actor) an end connects, and the port it connects at (operator.controlPort -> operator, controlPort)
  const partOfEnd = (end) => {
    let e = end, port = null;
    for (let i = 0; e && i < 6; i++) {
      const hit = match(e);
      if (hit) return { part: hit, port };
      if (e['@type'] === 'PortUsage' && !port) port = e;
      const chain = M.all(e.chainingFeature);
      if (chain.length) {
        const last = chain[chain.length - 1];
        if (last['@type'] === 'PortUsage') port = last;
        e = chain[0];
        continue;
      }
      const rs = M.all(e.ownedSpecialization).find((s) => s['@type'] === 'ReferenceSubsetting') || M.all(e.ownedReferenceSubsetting)[0];
      const next = rs ? M.get(rs.referencedFeature ?? rs.general) : null;
      if (next) { e = next; continue; }
      // a port of the soi (or of a part that redefines it) also stands for the soi
      const owner = match(M.get(e.owningType ?? e.owner));
      return owner ? { part: owner, port: port || (e['@type'] === 'PortUsage' ? e : null) } : null;
    }
    return null;
  };
  const links = [];
  for (const c of featuresOf(M, ctx, ['InterfaceUsage', 'ConnectionUsage', 'AllocationUsage', 'FlowUsage', 'SuccessionFlowUsage', 'BindingConnectorAsUsage'])) {
    if (c['@type'] === 'BindingConnectorAsUsage' || c['@type'] === 'AllocationUsage') continue;
    // the owned ends: the inherited ends of the library (actorPort, systemPort) point to the generic actors and soi
    const ends = M.all(c.ownedEndFeature).length ? M.all(c.ownedEndFeature) : M.all(c.connectorEnd).length ? M.all(c.connectorEnd) : M.all(c.relatedFeature);
    const hits = ends.map(partOfEnd).filter(Boolean);
    const ps = [...new Set(hits.map((x) => x.part))];
    if (ps.length === 2 && ps.includes(soi)) {
      const actor = ps.find((p) => p !== soi);
      const portOf = (part) => nameOf(hits.find((x) => x.part === part)?.port) || '';
      links.push({ id: c['@id'], name: nameOf(c), kind: c['@type'], actor: actor['@id'], actorPort: portOf(actor), systemPort: portOf(soi) });
    }
  }
  // white box: the system of interest of the Impl context, its parts
  let soiImpl = null;
  if (impl) soiImpl = featuresOf(M, impl, 'PartUsage').find((p) => p !== soiLib && specializes(M, p, soiLib)) || null;
  const inner = featuresOf(M, soiImpl || soi, 'PartUsage').filter((p) => !p.isLibraryElement && !specializes(M, p, actorsLib));
  return {
    key: def.key, role: def.role, title: def.title,
    context: { ...brief(M, ctx), types: typeNames(M, ctx) },
    impl: impl ? brief(M, impl) : null,
    system: soi ? { ...brief(M, soi), types: typeNames(M, soi), stereotypes: stereotypesOf(M, soi), ports: portsOf(M, soi) } : null,
    systemImpl: soiImpl ? { ...brief(M, soiImpl), types: typeNames(M, soiImpl) } : null,
    actors: actors.map((a) => ({ ...brief(M, a), types: typeNames(M, a), stereotypes: stereotypesOf(M, a).filter((s) => s !== 'system'), ports: portsOf(M, a) })),
    links,
    parts: inner.map((p) => ({ ...brief(M, p), types: typeNames(M, p), multiplicity: multiplicityOf(M, p), ports: portsOf(M, p) })),
  };
}

/** The ports of a part (effective, without the generic ports of the SYSMOD library such as actorPorts, systemPorts) */
const portsOf = (M, el) => featuresOf(M, el, 'PortUsage').filter((p) => !isLibrary(p) && nameOf(p)).map((p) => ({ id: p['@id'], name: nameOf(p), types: typeNames(M, p) }));

/** "1..*", "0..1", "" from the multiplicity of a feature */
export function multiplicityOf(M, f) {
  const m = M.get(f?.multiplicity);
  if (!m) return '';
  const lo = exprText(M, M.get(m.lowerBound)), hi = exprText(M, M.get(m.upperBound));
  if (!lo && !hi) {
    const bounds = M.all(m.ownedFeature).map((b) => valueOf(M, b) || exprText(M, b));
    if (bounds.length === 2) return `${bounds[0]}..${bounds[1]}`;
    if (bounds.length === 1) return bounds[0];
    return '';
  }
  return lo && hi && lo !== hi ? `${lo}..${hi}` : hi || lo;
}

function readStakeholders(M, project) {
  const ownerLib = M.byQName(`${SYSMOD.project}::projectOwner`);
  const lib = M.byQName(`${SYSMOD.project}::projectStakeholders`);
  // all owned features that are stakeholders, also the project owner (:>> projectOwner, which :> projectStakeholders)
  const all = lib ? ownedFeaturesOf(M, project).filter((f) => f !== lib && f !== ownerLib && specializes(M, f, lib)) : [];
  return all.sort((a, b) => (ownerLib && specializes(M, b, ownerLib)) - (ownerLib && specializes(M, a, ownerLib))).map((p) => ({
    id: p['@id'],
    name: valueNamed(M, p, 'name') || nameOf(p),
    element: nameOf(p),
    types: typeNames(M, p),
    owner: !!ownerLib && specializes(M, p, ownerLib),
    doc: docOf(M, p),
    contact: valueNamed(M, p, 'contact'),
    risk: valueNamed(M, p, 'risk'),
    effort: valueNamed(M, p, 'effort'),
    categories: valueNamed(M, p, 'categories'),
  }));
}

/** Nested concerns/requirements of a root (the needs under stakeholderNeeds, the requirements under the specification) */
function nestedOf(M, root, types, depth = 0, seen = new Set()) {
  if (!root || depth > 6) return [];
  const out = [];
  for (const f of featuresOf(M, root, types)) {
    if (seen.has(f['@id']) || f.isLibraryElement || !nameOf(f)) continue;
    if (M.get(f.owningMembership)?.['@type'] === 'FramedConcernMembership') continue;   // frame x: a reference, not a nested need
    seen.add(f['@id']);
    out.push({ el: f, depth });
    out.push(...nestedOf(M, f, types, depth + 1, seen));
  }
  return out;
}

const subjectStakeholders = (M, el) => featuresOf(M, el)
  .filter((f) => f['@type'] === 'PartUsage' && M.all(f.owningMembership ? [f.owningMembership] : []).some((m) => m['@type'] === 'StakeholderMembership'))
  .map((f) => { const v = valueOf(M, f); return v && v !== nameOf(f) ? v.split('.').pop() : nameOf(f); })
  .filter(Boolean);

function readNeeds(M, project) {
  const root = roleOf(M, project, 'stakeholderNeeds')[0];
  return nestedOf(M, root, 'ConcernUsage').map(({ el, depth }) => ({
    id: el['@id'], depth,
    name: nameOf(el), shortName: el.shortName || el.declaredShortName || '',
    types: typeNames(M, el),
    doc: docOf(M, el),
    stakeholders: subjectStakeholders(M, el).join(', '),
    priority: valueNamed(M, el, 'priority'),
  }));
}

function readRequirements(M, project) {
  const root = roleOf(M, project, 'systemRequirementSpecification')[0];
  return {
    specification: root ? { ...brief(M, root), types: typeNames(M, root) } : null,
    requirements: nestedOf(M, root, ['RequirementUsage', 'ConcernUsage']).filter(({ el }) => el['@type'] === 'RequirementUsage').map(({ el, depth }) => ({
      id: el['@id'], depth,
      shortName: el.shortName || el.declaredShortName || M.all(el.definition).map((d) => d.shortName || d.declaredShortName).find(Boolean) || '',
      name: nameOf(el),
      types: typeNames(M, el),
      doc: docOf(M, el),
      motivation: valueNamed(M, el, 'motivation'),
      priority: valueNamed(M, el, 'priority'),
      obligation: valueNamed(M, el, 'obligation'),
      stability: valueNamed(M, el, 'stability'),
      stakeholders: subjectStakeholders(M, el).join(', '),
    })),
  };
}

function readUseCases(M, ctx) {
  if (!ctx) return [];
  const lib = M.byQName(SYSMOD.useCases);
  const el = M.get(ctx.context.id);
  return featuresOf(M, el, 'UseCaseUsage').filter((u) => u !== lib && !u.isLibraryElement).map((u) => {
    const objective = M.all(u.objectiveRequirement)[0]
      || featuresOf(M, u, 'RequirementUsage').find((r) => M.get(r.owningMembership)?.['@type'] === 'ObjectiveMembership');
    const subject = M.get(u.subjectParameter) || featuresOf(M, u).find((f) => M.get(f.owningMembership)?.['@type'] === 'SubjectMembership');
    // steps: the actions the use case (or its definition) owns and the actions its subject performs for it
    const steps = [];
    const ACTIONS = ['PerformActionUsage', 'ActionUsage', 'AcceptActionUsage', 'SendActionUsage'];
    for (const s of [u, ...definitionsOf(M, u)]) {
      const subj = M.get(s.subjectParameter) || ownedFeaturesOf(M, s).find((f) => M.get(f.owningMembership)?.['@type'] === 'SubjectMembership');
      for (const owner of [subj, s].filter(Boolean)) {
        for (const a of ownedFeaturesOf(M, owner, ACTIONS)) {
          const n = nameOf(a);
          if (n && !a.isLibraryElement && !steps.includes(n) && !/^(start|done|subactions|actions)$/.test(n)) steps.push(n);
        }
      }
    }
    const actors = M.all(u.actorParameter).map((a) => nameOf(a)).filter(Boolean);
    return {
      id: u['@id'],
      name: nameOf(u),
      types: typeNames(M, u),
      doc: docOf(M, objective) || docOf(M, u),
      subject: subject ? nameOf(subject) : '',
      actors: actors.join(', '),
      trigger: valueNamed(M, u, 'ucTrigger'),
      result: valueNamed(M, u, 'ucResult'),
      motivation: valueNamed(M, u, 'ucMotivation'),
      precondition: modelDoc(M, featureNamed(M, u, 'precondition')),
      postcondition: modelDoc(M, featureNamed(M, u, 'postcondition')),
      steps,
    };
  });
}

/** Documentation of a feature of the model; '' for the inherited feature of the SYSMOD library with its generic text */
const modelDoc = (M, f) => (f && !isLibrary(f) ? docOf(M, f) : '');

function readObjectives(M, project) {
  const root = roleOf(M, project, 'systemObjectives')[0];
  return {
    doc: docOf(M, root, false),
    items: nestedOf(M, root, 'ConcernUsage').map(({ el, depth }) => ({ id: el['@id'], depth, name: nameOf(el), types: typeNames(M, el), doc: docOf(M, el) })),
  };
}

/** UVL text of a feature tree (PLEML): element with #featureTree and a textual representation */
function readFeatureTree(M) {
  for (const mu of M.ofType('MetadataUsage')) {
    const def = M.get(mu.metadataDefinition) || M.all(mu.definition)[0];
    if (!def || def.declaredShortName !== 'featureTree') continue;
    for (const a of M.all(mu.annotatedElement)) {
      const rep = M.all(a.textualRepresentation)[0] || M.all(a.ownedElement).find((e) => e['@type'] === 'TextualRepresentation');
      if (rep?.body) return { name: nameOf(a), language: rep.language || '', body: cleanDoc(rep.body) };
    }
  }
  return null;
}

/** The version of the SYSMOD library in the model: @SYSMOD { version = "5.1.4"; } on the SYSMOD package; '' if not stated */
export function sysmodVersionOf(M) {
  for (const mu of M.ofType('MetadataUsage')) {
    const def = M.get(mu.metadataDefinition) || M.all(mu.definition)[0];
    if (!def || nameOf(def) !== 'SYSMOD' || !/^SYSMOD::/.test(def.qualifiedName || 'SYSMOD::')) continue;
    const v = valueOf(M, featureNamed(M, mu, 'version'));
    if (v) return v;
  }
  return '';
}

/** Everything the viewer shows for one SYSMOD project. Plain data: strings, arrays, objects. */
export function readProject(M, projectId) {
  const project = M.get(projectId);
  if (!project) throw new Error('The SYSMOD project is not in the loaded model.');
  const ps = roleOf(M, project, 'problemStatement')[0];
  const contexts = CONTEXTS.map((def) => readContext(M, project, def));
  const byKey = Object.fromEntries(CONTEXTS.map((d, i) => [d.key, contexts[i]]));
  const owner = roleOf(M, project, 'projectOwner')[0];
  const sic = byKey.SIC;
  const sicImpl = M.get(sic?.systemImpl?.id), sicSoi = M.get(sic?.system?.id);
  const cover = featureNamed(M, project, 'projectCoverView', 'ViewUsage') || featureNamed(M, project, 'projectCover', 'ViewUsage');
  const view = {
    sysmodVersion: sysmodVersionOf(M),
    coverView: cover ? nameOf(cover) : '',
    id: project['@id'],
    name: nameOf(project),
    qualifiedName: project.qualifiedName || '',
    doc: docOf(M, project, false),
    purpose: valueNamed(M, project, 'purpose'),
    owner: owner ? valueNamed(M, owner, 'name') || nameOf(owner) : '',
    problemStatement: ps ? { id: ps['@id'], name: nameOf(ps), doc: docOf(M, ps, false) } : null,
    // the system idea: the white box system of interest of the system idea context (its own text, else its definition's)
    systemIdea: sic?.system ? {
      name: sic.system.name,
      types: (sicImpl ? typeNames(M, sicImpl) : sic.system.types),
      doc: docOf(M, sicImpl) || docOf(M, sicSoi),
      blackBox: sicImpl ? docOf(M, sicSoi) : '',
    } : null,
    objectives: readObjectives(M, project),
    stakeholders: readStakeholders(M, project),
    needs: readNeeds(M, project),
    ...readRequirements(M, project),
    useCases: readUseCases(M, byKey.SC),
    contexts,
    featureTree: readFeatureTree(M),
  };
  view.atlas = atlasOf(view);
  view.checks = checksOf(view);
  return view;
}

/** Which SYSMOD artifacts the project has: the status of the SYSMOD Atlas. */
export function atlasOf(v) {
  const ctx = Object.fromEntries(v.contexts.map((c, i) => [CONTEXTS[i].key, !!c]));
  return {
    FEATURE: !!v.featureTree,
    STAKE: v.stakeholders.length > 0,
    PS: !!v.problemStatement?.doc,
    NE: v.needs.length > 0,
    RE: v.requirements.length > 0,
    UC: v.useCases.length > 0,
    ...ctx,
  };
}

/** Simple completeness checks (the "quality checks" of the original viewer, extended to SYSMOD v5). */
export function checksOf(v) {
  const c = (id, ok, title, okText, failText) => ({ id, status: ok ? 'passed' : 'failed', title, text: ok ? okText : failText });
  const owner = v.stakeholders.find((s) => s.owner);
  return [
    c('SYSMOD-001', !!v.problemStatement?.doc, 'Problem statement', 'The project has a problem statement with text.', 'The project has no problem statement with text (concern :>> problemStatement with a doc).'),
    c('SYSMOD-002', !!owner, 'Project owner', `The project owner is ${owner?.name}.`, 'No stakeholder redefines projectOwner.'),
    c('SYSMOD-003', v.stakeholders.length > 1, 'Stakeholders', `${v.stakeholders.length} stakeholders.`, 'Besides the project owner, no stakeholders are modeled (:> projectStakeholders).'),
    c('SYSMOD-004', !!v.systemIdea, 'System idea', 'The system idea context has a system of interest.', 'No system idea context with a system of interest (:>> systemIdeaContext).'),
    c('SYSMOD-005', v.contexts.some((x) => x && x.key === 'SC'), 'System context', 'The project has a specification context.', 'No specification context (:>> specificationContext).'),
    c('SYSMOD-006', v.contexts.filter(Boolean).every((x) => x.actors.length > 0), 'Actors', 'Every context has actors.', `Contexts without actors: ${v.contexts.filter((x) => x && !x.actors.length).map((x) => x.title).join(', ')}.`),
    c('SYSMOD-007', v.useCases.length > 0, 'Use cases', `${v.useCases.length} system use cases.`, 'The specification context has no system use cases.'),
    c('SYSMOD-008', v.requirements.length > 0, 'Requirements', `${v.requirements.length} requirements.`, 'No requirements under the system requirement specification (:>> systemRequirementSpecification).'),
    c('SYSMOD-009', v.requirements.every((r) => r.doc), 'Requirement texts', 'Every requirement has a text.', `Requirements without text: ${v.requirements.filter((r) => !r.doc).map((r) => r.name).join(', ')}.`),
  ];
}
