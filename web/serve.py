#!/usr/bin/env python3
"""
Serves the single-page SYSMOD viewer (this folder) and relays its requests to SysML v2 API servers.

    python web/serve.py                 # http://localhost:8080/
    python web/serve.py --port 9090

Only the Python standard library, no packages.

Why a relay: a web page may only read servers that allow requests from it (CORS), and a page may not call
plain-http servers from https. The relay asks the server on behalf of the page, so every allowed SysML v2 API server
works, also e.g. http://sysml2.intercax.com:9000 or a server without CORS such as Flexo:

    ALLOWED_SYSML_SERVER_ORIGINS=http://localhost:9000,http://sysml2.intercax.com:9000 python web/serve.py

The relay is narrow:
  - it listens on localhost only (unless --host says otherwise);
  - only GET of the read endpoints of the SysML v2 API (/projects, /projects/{id}, .../branches, .../commits,
    .../commits/{id}/elements[/{id}], optionally behind a path prefix such as /api/v1) and only the paging query
    page[size], page[after], page[before]; http and https; no redirects followed; JSON only;
  - the token (header X-Relay-Authorization) is passed on as Authorization and never stored or logged.
  - only the servers in ALLOWED_SYSML_SERVER_ORIGINS (comma-separated origins, as for the Flask server; default
    http://localhost:9000, http://127.0.0.1:9000, http://[::1]:9000);
The same rules as relay.php of mbse4u.com/tools/sysmod-viewer/, which in addition has an allowlist of servers.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
TIMEOUT = 60
MAX_BYTES = 64 * 1024 * 1024
QUERY_KEYS = ("page[size]", "page[after]", "page[before]")
SEGMENT = r"[A-Za-z0-9._~%-]{1,200}"
READ_PATH = re.compile(
    r"^(/[A-Za-z0-9._~-]{1,60}){0,3}?/projects(/" + SEGMENT + r"(/branches(/" + SEGMENT + r")?|/commits(/" + SEGMENT
    + r"(/elements(/" + SEGMENT + r")?)?)?)?)?$"
)
DEFAULT_ORIGINS = "http://localhost:9000,http://127.0.0.1:9000,http://[::1]:9000"   # as sysmod_api_server.py


def allowed_origins():
    """The servers the relay may ask: ALLOWED_SYSML_SERVER_ORIGINS, as for the Flask server."""
    raw = os.environ.get("ALLOWED_SYSML_SERVER_ORIGINS", DEFAULT_ORIGINS)
    return [o.strip().rstrip("/").lower() for o in raw.split(",") if o.strip()]


def viewer_config():
    return {"relay": {"url": "relay", "servers": allowed_origins(), "label": "the local relay (serve.py)",
                      "contact": "the variable ALLOWED_SYSML_SERVER_ORIGINS of serve.py"}}


def check_url(url: str):
    """The address to request, or (None, reason). Same rules as relay.php of mbse4u.com."""
    if not url or len(url) > 2048 or re.search(r"[\x00-\x20\x7f\\]", url):
        return None, "invalid address"
    p = urllib.parse.urlsplit(url)
    if p.scheme.lower() not in ("http", "https") or not p.hostname:
        return None, "only http and https"
    if p.username or p.password or p.fragment:
        return None, "invalid address"
    path = p.path or ""
    if "//" in path:
        return None, "invalid path"
    for segment in path.split("/"):
        d = urllib.parse.unquote(segment)
        if d in (".", "..") or any(c in d for c in "/\\\0"):
            return None, "invalid path"
    if not READ_PATH.match(path):
        return None, "not a read endpoint of the SysML v2 API"
    query = []
    seen = set()
    for pair in filter(None, (p.query or "").split("&")):
        k, _, v = pair.partition("=")
        k, v = urllib.parse.unquote(k), urllib.parse.unquote(v)
        if k not in QUERY_KEYS or k in seen or len(v) > 200 or re.search(r"[\x00-\x1f\x7f]", v):
            return None, "query not allowed"
        if k == "page[size]" and not re.fullmatch(r"\d{1,5}", v):
            return None, "query not allowed"
        seen.add(k)
        query.append(urllib.parse.quote(k, safe="") + "=" + urllib.parse.quote(v, safe=""))
    host = p.hostname.lower()
    origin = f"{p.scheme.lower()}://" + (f"[{host}]" if ":" in host else host) + (f":{p.port}" if p.port else "")
    # the server part of the request is taken from the allowlist, never from the address the page sent
    base = next((allowed for allowed in allowed_origins() if allowed == origin), None)
    if base is None:
        return None, "server not allowed (ALLOWED_SYSML_SERVER_ORIGINS)"
    return base + path + ("?" + "&".join(query) if query else ""), ""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None   # a redirect is answered as an HTTP error, never followed


OPENER = urllib.request.build_opener(NoRedirect)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def log_message(self, fmt, *args):   # no query strings in the log (they may name projects)
        sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def answer(self, status, body: bytes, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, message):
        self.answer(status, json.dumps({"error": message}).encode(), {"X-Relay-Error": "1"})

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/viewer-config.json":
            return self.answer(200, json.dumps(viewer_config()).encode())
        if path == "/relay":
            return self.relay()
        if path.endswith(".py"):
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        self.fail(405, "only GET")

    def relay(self):
        site = self.headers.get("Sec-Fetch-Site", "")
        if site not in ("", "same-origin", "none"):
            return self.fail(403, "only for the SYSMOD viewer of this server")
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        target, error = check_url((params.get("url") or [""])[0])
        if not target:
            return self.fail(400, error)
        headers = {"Accept": "application/json", "User-Agent": "SYSMOD-viewer-relay/1"}
        auth = self.headers.get("X-Relay-Authorization") or self.headers.get("Authorization")
        if auth and len(auth) < 8192 and "\r" not in auth and "\n" not in auth:
            headers["Authorization"] = auth
        try:
            with OPENER.open(urllib.request.Request(target, headers=headers), timeout=TIMEOUT) as r:
                status, body, rh = r.status, r.read(MAX_BYTES + 1), r.headers
        except urllib.error.HTTPError as e:
            if 300 <= e.code < 400:
                return self.fail(502, "the server answered with a redirect, which the relay does not follow")
            status, body, rh = e.code, e.read(MAX_BYTES + 1), e.headers
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            timeout = "timed out" in str(e).lower()
            return self.fail(504 if timeout else 502, "the server did not answer in time" if timeout else "the server could not be reached")
        if len(body) > MAX_BYTES:
            return self.fail(502, "the answer of the server is too large for the relay")
        try:
            json.loads(body or b"null")
        except ValueError:
            body = json.dumps({"error": "the server did not answer with JSON", "status": status}).encode()
        extra = {}
        link = rh.get("Link")
        if link and "\r" not in link and "\n" not in link:
            extra["Link"] = link   # unchanged: the viewer resolves the next page against the server's address
        self.answer(status, body, extra)


def main():
    ap = argparse.ArgumentParser(description="Serves the SYSMOD viewer and relays its requests to SysML v2 API servers.")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="127.0.0.1", help="default 127.0.0.1: only this computer can use the relay")
    a = ap.parse_args()
    server = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"SYSMOD viewer: http://localhost:{a.port}/   (Ctrl+C to stop)")
    print("Servers it may read (ALLOWED_SYSML_SERVER_ORIGINS): " + ", ".join(allowed_origins()))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
