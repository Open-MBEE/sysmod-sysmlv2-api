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
const trimSlashes = (s) => { let e = s.length; while (e > 0 && s[e - 1] === '/') e--; return s.slice(0, e); };

/** Normalizes what a user pastes: no trailing slash, no /projects…, scheme added if missing. */
export function normalizeBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(s) ? 'http://' : 'https://') + s;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new ApiError('The address must start with https:// (or http:// for a server on this computer).');
  u.hash = ''; u.search = '';
  const i = u.pathname.indexOf('/projects');
  const p = i >= 0 && (u.pathname.length === i + 9 || u.pathname[i + 9] === '/') ? u.pathname.slice(0, i) : u.pathname;
  u.pathname = trimSlashes(p);
  return trimSlashes(u.href);
}

const isLocal = (u) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);

/** A reason why the browser will not even send the request (mixed content), or '' */
export function blockedReason(baseUrl, pageProtocol = globalThis.location?.protocol, contact = '') {
  const u = new URL(baseUrl);
  if (pageProtocol === 'https:' && u.protocol === 'http:' && !isLocal(u))
    return 'This page is loaded over HTTPS, so your browser does not allow it to call a server over plain HTTP. Use the https:// address of the server. A server on your own computer (http://localhost) is the exception. '
      + (contact ? `If the server has no https address, it can be added to the relay of this page: write to ${contact}.` : 'Or run the viewer locally with its relay (python web/serve.py of github.com/Open-MBEE/sysmod-sysmlv2-api).');
  return '';
}

/** The next page from a Link header: <url>; rel="next" */
export function nextFromLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

/** Is this address on a server that the relay serves? relay.servers are origins (https://host[:port]). */
export function usesRelay(url, relay) {
  if (!relay?.url || !Array.isArray(relay.servers)) return false;
  if (relay.servers.includes('*')) return true;
  try { return relay.servers.map((s) => trimSlashes(String(s)).toLowerCase()).includes(new URL(url).origin.toLowerCase()); } catch { return false; }
}

export function createClient({ baseUrl, token = '', relay = null, fetch: fetchFn = globalThis.fetch.bind(globalThis), pageSize = 256 } = {}) {   // 256 per page: some servers take too long for larger pages (e.g. sysml2.intercax.com)
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new ApiError('Enter the address of a SysML v2 API server.');
  const t = String(token || '').trim();
  const auth = t ? (/^(bearer|basic)\s/i.test(t) ? t : `Bearer ${t}`) : '';
  const viaRelay = usesRelay(base, relay);
  const relayLabel = relay?.label || 'the relay';
  const contact = relay?.contact || '';

  async function get(url, signal) {
    const relayed = usesRelay(url, relay);
    const headers = { Accept: 'application/json' };
    if (auth) headers[relayed ? 'X-Relay-Authorization' : 'Authorization'] = auth;
    const target = relayed ? `${relay.url}?url=${encodeURIComponent(url)}` : url;
    if (!relayed) {
      const blocked = blockedReason(url, globalThis.location?.protocol, contact);
      if (blocked) throw new ApiError('The browser blocks this address.', { url, hint: blocked });
    }
    let r;
    try {
      r = await fetchFn(target, { headers, signal, credentials: 'omit', mode: 'cors' });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw new ApiError(relayed ? `${relayLabel[0].toUpperCase()}${relayLabel.slice(1)} could not be reached.` : 'The server could not be reached.', {
        url,
        hint: relayed ? 'Check your connection and try again.'
          : 'Most likely the server does not allow requests from this page (CORS); otherwise the address is wrong or the server is down. '
          + 'The developer console of your browser (F12) shows the exact reason. '
          + (auth ? 'With a token the server must also allow the header Authorization in its CORS settings. ' : '')
          + (contact ? `If the server cannot allow it, it can be added to the relay of this page: write to ${contact}.` : 'Or run the viewer locally with its relay (python web/serve.py of github.com/Open-MBEE/sysmod-sysmlv2-api).'),
      });
    }
    if (relayed && r.headers.get('X-Relay-Error')) {
      let msg = '';
      try { msg = (await r.json()).error || ''; } catch { /* not JSON */ }
      throw new ApiError(`${relayLabel[0].toUpperCase()}${relayLabel.slice(1)}: ${msg || `HTTP ${r.status}`}.`, { status: r.status, url });
    }
    if (r.status === 401 || r.status === 403) throw new ApiError(`The server refused access (HTTP ${r.status}).`, { status: r.status, url, hint: auth ? 'Check the token.' : 'The server needs a token: enter it under "Token".' });
    if (r.status === 404) throw new ApiError('Not found (HTTP 404).', { status: 404, url, hint: 'Is this the base address of the API? It is the address in front of /projects.' });
    if (!r.ok) throw new ApiError(`The server answered with HTTP ${r.status}.`, { status: r.status, url });
    let body;
    try { body = await r.json(); } catch {
      throw new ApiError(relayed ? 'The relay did not answer with JSON.' : 'The server did not answer with JSON.', { url, hint: relayed ? `Is ${relayLabel} running? (It is a server-side script; a static development server does not run it.)` : 'Is this the address of a SysML v2 API server?' });
    }
    return { body, link: r.headers.get('Link') || r.headers.get('link') };
  }

  /** All pages of a list resource. Follows the Link header; without it (not exposed by CORS) page[after]=<last id>. */
  async function list(path, { signal, onProgress, size = pageSize } = {}) {
    const sep = path.includes('?') ? '&' : '?';
    let url = `${base}${path}${sep}page%5Bsize%5D=${size}`;
    const out = [], seen = new Set();
    for (let page = 0; page < 10000; page++) {
      const { body, link } = await get(url, signal);
      const items = Array.isArray(body) ? body : Array.isArray(body?.elements) ? body.elements : null;
      if (!items) throw new ApiError('The server did not answer with a list.', { url, hint: 'Is this the address of a SysML v2 API server?' });
      let fresh = 0;
      for (const it of items) { const id = it?.['@id']; if (id && seen.has(id)) continue; if (id) seen.add(id); out.push(it); fresh++; }
      onProgress?.(out.length);
      const next = nextFromLink(link);
      if (next) { url = new URL(next, url).href; if (!fresh) break; continue; }
      // no Link header: if the page was full there may be more, ask for the page after the last element
      if (items.length < size || !fresh || !items.at(-1)?.['@id']) break;
      url = `${base}${path}${sep}page%5Bsize%5D=${size}&page%5Bafter%5D=${encodeURIComponent(items.at(-1)['@id'])}`;
    }
    return out;
  }

  const time = (c) => Date.parse(c.created || c.timestamp || '') || 0;

  return {
    base,
    viaRelay,
    projects: async (opts) => (await list('/projects', opts)).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    project: async (id, opts) => (await get(`${base}/projects/${encodeURIComponent(id)}`, opts?.signal)).body,
    branches: (id, opts) => list(`/projects/${encodeURIComponent(id)}/branches`, opts),
    commits: async (id, opts) => (await list(`/projects/${encodeURIComponent(id)}/commits`, opts)).sort((a, b) => time(b) - time(a)),
    elements: (id, commit, opts) => list(`/projects/${encodeURIComponent(id)}/commits/${encodeURIComponent(commit)}/elements`, opts),
  };
}
