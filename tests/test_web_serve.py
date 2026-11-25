"""Tests of web/serve.py: the rules of the relay and real HTTP requests against a fake SysML v2 API server.
Standard library only:  python -m unittest tests/test_web_serve.py   (pytest runs it too)"""
import json
import sys
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "web"))
import serve  # noqa: E402


class FakeSysml(BaseHTTPRequestHandler):
    """A tiny SysML v2 API server: echoes what it received, pages elements with a Link header."""
    def log_message(self, *a):
        pass

    def send(self, code, body, headers=None):
        b = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path == "/projects":
            return self.send(200, [{"@id": "p-1", "name": "P", "auth": self.headers.get("Authorization", ""), "query": u.query}])
        if u.path == "/projects/p-1/commits/c/elements":
            return self.send(200, [{"@id": "e-1"}], {"Link": f"<http://{self.headers['Host']}/projects/p-1/commits/c/elements?page%5Bafter%5D=e-1>; rel=\"next\""})
        if u.path == "/projects/redirect":
            self.send_response(302); self.send_header("Location", "https://example.org/"); self.end_headers(); return
        if u.path == "/projects/html":
            b = b"<html>oops</html>"
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(b); return
        if u.path == "/projects/secret":
            return self.send(401, {"error": "unauthorized"})
        return self.send(404, {"error": "not found"})


def start(handler):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class Rules(unittest.TestCase):
    def ok(self, url, expected=None):
        target, error = serve.check_url(url)
        self.assertEqual(error, "", url)
        if expected:
            self.assertEqual(target, expected)

    def refused(self, url, reason):
        self.assertEqual(serve.check_url(url), (None, reason), url)

    def test_allowed(self):
        self.ok("https://h.org/projects")
        self.ok("http://sysml2.intercax.com:9000/projects?page%5Bsize%5D=1000", "http://sysml2.intercax.com:9000/projects?page%5Bsize%5D=1000")
        self.ok("https://h.org/projects?page[size]=10", "https://h.org/projects?page%5Bsize%5D=10")
        self.ok("https://h.org/api/v1/projects/p/commits/c/elements?page%5Bafter%5D=x")
        self.ok("https://h.org/projects/p/branches/b")
        self.ok("https://H.org/projects", "https://h.org/projects")

    def test_allowed_origins(self):
        import os
        os.environ["ALLOWED_SYSML_SERVER_ORIGINS"] = "http://localhost:9000, https://h.org/"
        try:
            self.ok("http://localhost:9000/projects")
            self.ok("https://h.org/projects")
            self.refused("https://other.org/projects", "server not allowed (ALLOWED_SYSML_SERVER_ORIGINS)")
            self.refused("http://localhost:9001/projects", "server not allowed (ALLOWED_SYSML_SERVER_ORIGINS)")
        finally:
            del os.environ["ALLOWED_SYSML_SERVER_ORIGINS"]

    def test_refused(self):
        self.refused("", "invalid address")
        self.refused("file:///etc/passwd", "only http and https")
        self.refused("https://u:p@h.org/projects", "invalid address")
        self.refused("https://h.org/projects#x", "invalid address")
        self.refused("https://h.org/admin", "not a read endpoint of the SysML v2 API")
        self.refused("https://h.org/projects/p/query-results", "not a read endpoint of the SysML v2 API")
        self.refused("https://h.org/projects/../admin", "invalid path")
        self.refused("https://h.org/projects/%2e%2e", "invalid path")
        self.refused("https://h.org//projects", "invalid path")
        self.refused("https://h.org/projects?x=1", "query not allowed")
        self.refused("https://h.org/projects?page%5Bsize%5D=1&page%5Bsize%5D=2", "query not allowed")
        self.refused("https://h.org/projects?page%5Bsize%5D=x", "query not allowed")


class Relay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.up = start(FakeSysml)
        cls.viewer = start(serve.Handler)
        cls.U = f"http://127.0.0.1:{cls.up.server_address[1]}"
        cls.R = f"http://127.0.0.1:{cls.viewer.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.up.shutdown(); cls.viewer.shutdown()

    def get(self, path, headers=None):
        req = urllib.request.Request(self.R + path, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def relay(self, url, headers=None):
        return self.get("/relay?url=" + urllib.parse.quote(url, safe=""), headers)

    def test_page_and_config(self):
        status, _, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b'id="sysmod-viewer"', body)
        status, _, body = self.get("/viewer-config.json")
        self.assertEqual(json.loads(body)["relay"]["servers"], ["*"])
        self.assertEqual(self.get("/serve.py")[0], 404)

    def test_relayed_with_token_and_paging(self):
        status, _, body = self.relay(self.U + "/projects?page%5Bsize%5D=1000", {"X-Relay-Authorization": "Bearer t"})
        data = json.loads(body)[0]
        self.assertEqual((status, data["auth"], data["query"]), (200, "Bearer t", "page%5Bsize%5D=1000"))
        status, headers, _ = self.relay(self.U + "/projects/p-1/commits/c/elements")
        self.assertEqual(headers["Link"], f"<{self.U}/projects/p-1/commits/c/elements?page%5Bafter%5D=e-1>; rel=\"next\"")
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_errors(self):
        self.assertEqual(self.relay(self.U + "/projects/secret")[0], 401)
        self.assertEqual(self.relay(self.U + "/projects/nothing")[0], 404)
        self.assertEqual(self.relay(self.U + "/projects/redirect")[0], 502)
        self.assertIn(b"did not answer with JSON", self.relay(self.U + "/projects/html")[2])
        self.assertEqual(self.relay(self.U + "/admin")[0], 400)
        self.assertEqual(self.relay("http://127.0.0.1:1/projects")[0], 502)
        self.assertEqual(self.relay(self.U + "/projects", {"Sec-Fetch-Site": "cross-site"})[0], 403)
        status, headers, _ = self.relay(self.U + "/admin")
        self.assertEqual(headers["X-Relay-Error"], "1")


if __name__ == "__main__":
    unittest.main()
