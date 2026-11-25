/* sysmod-viewer-api.js: the requests of the SYSMOD viewer to a SysML v2 REST API server (OMG Systems Modeling API,
   e.g. the SysML v2 Pilot Implementation's API services or Open-MBEE Flexo). Pure ES module; runs in the browser and in Node.

   Used by the single-page SYSMOD viewer of github.com/Open-MBEE/sysmod-sysmlv2-api (web/) and by mbse4u.com/tools/sysmod-viewer/.

   The browser talks to the server DIRECTLY: there is no server of the viewer in between. That needs
     - CORS: the server must allow requests from the page's origin (Access-Control-Allow-Origin), with a token also the
       header Authorization (Access-Control-Allow-Headers); for paging it should expose the header Link.
     - HTTPS: a page on https:// may not call an http:// server. Exception: http://localhost and http://127.0.0.1.

   Servers that do not allow it (or have no https) can be reached through a relay on the origin of the page:
     createClient({ baseUrl, relay: { url: '/relay', servers: ['https://flexo.systemsmodeling.com'], label: 'the relay of mbse4u.com', contact: 'info@mbse4u.com' } })
   Then every request to such a server goes to <relay.url>?url=<address>, the token as header X-Relay-Authorization.
   servers: ['*'] sends every server through the relay (web/serve.py, the local relay of the repository).
   Relays: web/serve.py (local, any server), mbse4u.com/tools/sysmod-viewer/relay.php (allowlist relay-servers.json).

     const api = createClient({ baseUrl: 'https://sysml.example.org', token: 'Bearer …' });
     await api.projects();                      // [{ '@id', name, description, created, defaultBranch }]
     await api.commits(projectId);              // newest first
     await api.elements(projectId, commitId, { onProgress: (n) => … , signal });   // all elements of the commit
*/

export class ApiError extends Error {
  constructor(message, { status = 0, url = '', hint = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.hint = hint;
  }
}

/** Removes trailing slashes, in linear time (no regular expression anchored at the end). */
function trimSlashes(s) {
  let e = s.length;
  while (e > 0 && s[e - 1] === '/') e--;
  return s.slice(0, e);
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const isLocal = (u) => LOCAL_HOSTS.includes(u.hostname);
const hasScheme = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
const startsWithLocalHost = (s) => LOCAL_HOSTS.some((h) => s.toLowerCase().startsWith(h) && [undefined, ':', '/'].includes(s[h.length]));

/** The base path of the API: the path in front of /projects (a pasted address may contain /projects/…). */
function basePath(pathname) {
  const i = pathname.indexOf('/projects');
  const end = i + '/projects'.length;
  const isSegment = i >= 0 && (pathname.length === end || pathname[end] === '/');
  return trimSlashes(isSegment ? pathname.slice(0, i) : pathname);
}

/** Normalizes what a user pastes: no trailing slash, no /projects…, scheme added if missing. */
export function normalizeBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!hasScheme(s)) {
    const scheme = startsWithLocalHost(s) ? 'http://' : 'https://';
    s = scheme + s;
  }
  const u = new URL(s);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ApiError('The address must start with https:// (or http:// for a server on this computer).');
  u.hash = '';
  u.search = '';
  u.pathname = basePath(u.pathname);
  return trimSlashes(u.href);
}

const LOCAL_RELAY = 'Or run the viewer locally with its relay (python web/serve.py of github.com/Open-MBEE/sysmod-sysmlv2-api).';
const relayOffer = (contact, problem) => (contact ? 'If the server ' + problem + ', it can be added to the relay of this page: write to ' + contact + '.' : LOCAL_RELAY);

/** A reason why the browser will not even send the request (mixed content), or '' */
export function blockedReason(baseUrl, pageProtocol = globalThis.location?.protocol, contact = '') {
  const u = new URL(baseUrl);
  if (pageProtocol !== 'https:' || u.protocol !== 'http:' || isLocal(u)) return '';
  return 'This page is loaded over HTTPS, so your browser does not allow it to call a server over plain HTTP. Use the https:// address of the server. '
    + 'A server on your own computer (http://localhost) is the exception. ' + relayOffer(contact, 'has no https address');
}

/** The next page from a Link header: <url>; rel="next" (parsed without regular expressions) */
export function nextFromLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const open = part.indexOf('<'), close = part.indexOf('>', open + 1);
    if (open < 0 || close < 0) continue;
    const params = part.slice(close + 1).split(';').map((x) => x.trim().toLowerCase().replaceAll('"', ''));
    if (params.includes('rel=next')) return part.slice(open + 1, close).trim();
  }
  return null;
}

/** Is this address on a server that the relay serves? relay.servers are origins (https://host[:port]), or '*'. */
export function usesRelay(url, relay) {
  if (!relay?.url || !Array.isArray(relay.servers)) return false;
  if (relay.servers.includes('*')) return true;
  try {
    const origin = new URL(url).origin.toLowerCase();
    return relay.servers.some((s) => trimSlashes(String(s)).toLowerCase() === origin);
  } catch {
    return false;
  }
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** The header Authorization from what the user enters: "Bearer …", "Basic …" or the bare token */
function authorization(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  return /^(bearer|basic)\s/i.test(t) ? t : 'Bearer ' + t;
}
/** The list of items in an answer: an array, or { elements: [...] } */
function itemsOf(body) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.elements) ? body.elements : null;
}

/** The address of the next page, or null: from the Link header, else page[after]=<last id> if the page was full */
function nextUrl({ link, url, items, fresh, size, first }) {
  if (!fresh) return null;
  const next = nextFromLink(link);
  if (next) return new URL(next, url).href;
  const last = items.at(-1)?.['@id'];
  return items.length >= size && last ? first + '&page%5Bafter%5D=' + encodeURIComponent(last) : null;
}

export function createClient({ baseUrl, token = '', relay = null, fetch: fetchFn = globalThis.fetch.bind(globalThis), pageSize = 256 } = {}) {
  // 256 per page: some servers take too long for larger pages (e.g. sysml2.intercax.com)
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new ApiError('Enter the address of a SysML v2 API server.');
  const auth = authorization(token);
  const viaRelay = usesRelay(base, relay);
  const relayLabel = relay?.label || 'the relay';
  const contact = relay?.contact || '';

  /** The request as the browser sends it: to the server, or to the relay with the address as parameter */
  function request(url, relayed, signal) {
    const headers = { Accept: 'application/json' };
    if (auth) headers[relayed ? 'X-Relay-Authorization' : 'Authorization'] = auth;
    const target = relayed ? relay.url + '?url=' + encodeURIComponent(url) : url;
    return fetchFn(target, { headers, signal, credentials: 'omit', mode: 'cors' });
  }

  function unreachable(url, relayed) {
    if (relayed) return new ApiError(capitalize(relayLabel) + ' could not be reached.', { url, hint: 'Check your connection and try again.' });
    const tokenHint = auth ? 'With a token the server must also allow the header Authorization in its CORS settings. ' : '';
    return new ApiError('The server could not be reached.', {
      url,
      hint: 'Most likely the server does not allow requests from this page (CORS); otherwise the address is wrong or the server is down. '
        + 'The developer console of your browser (F12) shows the exact reason. ' + tokenHint + relayOffer(contact, 'cannot allow it'),
    });
  }

  /** An error for an answer that is not OK, or null */
  async function answerError(r, url, relayed) {
    if (relayed && r.headers.get('X-Relay-Error')) {
      let msg = '';
      try { msg = (await r.json()).error || ''; } catch { /* not JSON */ }
      return new ApiError(capitalize(relayLabel) + ': ' + (msg || 'HTTP ' + r.status) + '.', { status: r.status, url });
    }
    if (r.status === 401 || r.status === 403) {
      const hint = auth ? 'Check the token.' : 'The server needs a token: enter it under "Token".';
      return new ApiError('The server refused access (HTTP ' + r.status + ').', { status: r.status, url, hint });
    }
    if (r.status === 404) return new ApiError('Not found (HTTP 404).', { status: 404, url, hint: 'Is this the base address of the API? It is the address in front of /projects.' });
    if (!r.ok) return new ApiError('The server answered with HTTP ' + r.status + '.', { status: r.status, url });
    return null;
  }

  async function readJson(r, url, relayed) {
    try {
      return await r.json();
    } catch {
      if (relayed) throw new ApiError('The relay did not answer with JSON.', { url, hint: 'Is ' + relayLabel + ' running? (It is a server-side script; a static development server does not run it.)' });
      throw new ApiError('The server did not answer with JSON.', { url, hint: 'Is this the address of a SysML v2 API server?' });
    }
  }

  async function get(url, signal) {
    const relayed = usesRelay(url, relay);
    const blocked = relayed ? '' : blockedReason(url, globalThis.location?.protocol, contact);
    if (blocked) throw new ApiError('The browser blocks this address.', { url, hint: blocked });
    let r;
    try {
      r = await request(url, relayed, signal);
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw unreachable(url, relayed);
    }
    const error = await answerError(r, url, relayed);
    if (error) throw error;
    const body = await readJson(r, url, relayed);
    return { body, link: r.headers.get('Link') || r.headers.get('link') };
  }

  /** All pages of a list resource. Follows the Link header; without it (not exposed by CORS) page[after]=<last id>. */
  async function list(path, { signal, onProgress, size = pageSize } = {}) {
    const sep = path.includes('?') ? '&' : '?';
    const first = base + path + sep + 'page%5Bsize%5D=' + size;
    const paging = { first, size, signal, onProgress, out: [], seen: new Set() };
    await readPages(first, paging, 0);
    return paging.out;
  }

  /** Reads the page at url and, one after the other, the pages after it (at most 10000) */
  async function readPages(url, paging, page) {
    if (!url || page >= 10000) return;
    const { body, link } = await get(url, paging.signal);
    const items = itemsOf(body);
    if (!items) throw new ApiError('The server did not answer with a list.', { url, hint: 'Is this the address of a SysML v2 API server?' });
    const fresh = items.filter((it) => !paging.seen.has(it?.['@id']));
    for (const it of fresh) {
      if (it?.['@id']) paging.seen.add(it['@id']);
    }
    paging.out.push(...fresh);
    paging.onProgress?.(paging.out.length);
    await readPages(nextUrl({ link, url, items, fresh: fresh.length, size: paging.size, first: paging.first }), paging, page + 1);
  }

  const time = (c) => Date.parse(c.created || c.timestamp || '') || 0;
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

  return {
    base,
    viaRelay,
    projects: async (opts) => (await list('/projects', opts)).toSorted(byName),
    project: async (id, opts) => (await get(base + '/projects/' + encodeURIComponent(id), opts?.signal)).body,
    branches: (id, opts) => list('/projects/' + encodeURIComponent(id) + '/branches', opts),
    commits: async (id, opts) => (await list('/projects/' + encodeURIComponent(id) + '/commits', opts)).toSorted((a, b) => time(b) - time(a)),
    elements: (id, commit, opts) => list('/projects/' + encodeURIComponent(id) + '/commits/' + encodeURIComponent(commit) + '/elements', opts),
  };
}
