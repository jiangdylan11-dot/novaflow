"""Static server for the built NovaFlow Web renderer.

Plain static files with permissive CORS, because the page talks to a control
plane on one origin and a worker gateway on another. Nothing here ships with
the product - a real deployment uses a static host (see docs/DEPLOY.md). This
exists so the build can be opened locally without a bundler in the way.
"""

import argparse
import http.server
import os


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        # Chrome's Private Network Access check: a page on a public origin may
        # only reach 127.0.0.1 if the local server opts in. Without this a
        # fetch from, say, a dashboard tab fails as "Failed to fetch" with no
        # further explanation.
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4892)
    ap.add_argument("--root", default="web-dist")
    args = ap.parse_args()

    os.chdir(args.root)
    # Threaded: Chromium opens spare connections ahead of its requests, and a
    # one-request-at-a-time server sits on an idle socket while the page waits.
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as srv:
        print(
            "NovaFlow Web renderer on http://127.0.0.1:%d  (root=%s)"
            % (args.port, args.root),
            flush=True,
        )
        srv.serve_forever()


if __name__ == "__main__":
    main()
