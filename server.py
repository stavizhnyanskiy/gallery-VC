import http.server
import socketserver
import urllib.request
import urllib.error
import urllib.parse
import sys
import os
import json

PORT = int(os.environ.get('PORT', 8000))
TARGET_URL = "https://api.depositphotos.com/?dp_command=getMediaData"
GOOGLE_SCRIPT_URL = os.environ.get('GOOGLE_SCRIPT_URL', '')

print(f"[CONFIG] GOOGLE_SCRIPT_URL is {'SET (' + GOOGLE_SCRIPT_URL[:40] + '...)' if GOOGLE_SCRIPT_URL else 'NOT SET - checkboxes will not persist!'}", flush=True)

# Google Apps Script executes doPost on the FIRST request, then redirects (302).
# We must NOT follow that redirect (the redirect target returns 405 for POST).
# So we intercept the 302 and treat it as success.
class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):
        return fp  # Don't follow redirect, just return the response
    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def post_to_apps_script(url, data):
    opener = urllib.request.build_opener(NoRedirectHandler)
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    print(f"[POST] Sending to Apps Script: {data[:200]}", flush=True)
    with opener.open(req, timeout=15) as response:
        result = response.read()
        print(f"[POST] Apps Script initial response code: {response.code if hasattr(response, 'code') else 'N/A'}", flush=True)
        return result or b'{"status": "ok"}'



def get_from_apps_script(url):
    req = urllib.request.Request(url, method='GET')
    print(f"[GET] Fetching from Apps Script...", flush=True)
    with urllib.request.urlopen(req, timeout=10) as response:
        result = response.read()
        print(f"[GET] Apps Script response ({len(result)} bytes): {result[:200]}", flush=True)
        return result


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Keep server logs but add flush
        print(f"[HTTP] {self.address_string()} - {format % args}", flush=True)

    def do_GET(self):
        clean_path = urllib.parse.urlparse(self.path).path

        if clean_path == '/ids.csv':
            # Serve ids.csv with no-cache headers so browser always gets the latest version
            try:
                with open('ids.csv', 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/csv; charset=utf-8')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                print(f"[ERROR] Failed to serve ids.csv: {e}", flush=True)
                self.send_error(404, 'ids.csv not found')
            return

        if clean_path == '/api_get_checked_ids':
            if not GOOGLE_SCRIPT_URL:
                print("[WARNING] /api_get_checked_ids called but GOOGLE_SCRIPT_URL is not set!", flush=True)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'')
                return

            try:
                result = get_from_apps_script(GOOGLE_SCRIPT_URL + '?t=' + str(id(self)))
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.end_headers()
                self.wfile.write(result)
            except Exception as e:
                print(f"[ERROR] /api_get_checked_ids failed: {e}", flush=True)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'')

        elif clean_path == '/api_test_google':
            # Debug endpoint: tests connectivity to Google Script
            result = {"google_url_set": bool(GOOGLE_SCRIPT_URL)}
            if GOOGLE_SCRIPT_URL:
                result["google_url_preview"] = GOOGLE_SCRIPT_URL[:50] + "..."
                try:
                    data = get_from_apps_script(GOOGLE_SCRIPT_URL)
                    result["get_status"] = "OK"
                    result["get_response_preview"] = data.decode('utf-8')[:200]
                except Exception as e:
                    result["get_status"] = "ERROR"
                    result["get_error"] = str(e)

                try:
                    test_payload = json.dumps({"id": 99999999, "selected": True}).encode()
                    response = post_to_apps_script(GOOGLE_SCRIPT_URL, test_payload)
                    result["post_status"] = "OK"
                    result["post_response"] = response.decode('utf-8')[:200]
                except Exception as e:
                    result["post_status"] = "ERROR"
                    result["post_error"] = str(e)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result, indent=2).encode())

        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api_proxy':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)

                req = urllib.request.Request(TARGET_URL, data=post_data, method="POST")
                req.add_header('Content-Type', 'application/x-www-form-urlencoded')

                with urllib.request.urlopen(req, timeout=15) as response:
                    self.send_response(response.status)
                    self.end_headers()
                    self.wfile.write(response.read())

            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self.end_headers()
                self.wfile.write(e.read())
            except Exception as e:
                print(f"[ERROR] /api_proxy failed: {e}", flush=True)
                self.send_error(500, str(e))

        elif self.path == '/api_update_selection':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)

                print(f"[UPDATE] Received selection update: {post_data[:200]}", flush=True)

                if not GOOGLE_SCRIPT_URL:
                    print("[WARNING] /api_update_selection called but GOOGLE_SCRIPT_URL is not set!", flush=True)
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"status": "no_google_url_configured"}')
                    return

                result = post_to_apps_script(GOOGLE_SCRIPT_URL, post_data)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(result)

            except Exception as e:
                print(f"[ERROR] /api_update_selection failed: {e}", flush=True)
                self.send_error(500, str(e))
        else:
            super().do_POST()


print(f"[START] Server starting at port {PORT}", flush=True)
sys.stdout.flush()

try:
    with socketserver.ThreadingTCPServer(("", PORT), ProxyHandler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped.")
