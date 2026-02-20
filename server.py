import http.server
import socketserver
import urllib.request
import urllib.error
import sys
import os

PORT = int(os.environ.get('PORT', 8000))
TARGET_URL = "https://api.depositphotos.com/?dp_command=getMediaData"
GOOGLE_SCRIPT_URL = os.environ.get('GOOGLE_SCRIPT_URL', '')

# Custom redirect handler: keeps POST method through 302 redirects (Google Apps Script always redirects)
class KeepPostRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.get_method() == 'POST':
            data = req.data
            new_req = urllib.request.Request(newurl, data=data, method='POST')
            for key, val in req.headers.items():
                new_req.add_header(key, val)
            return new_req
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def post_to_apps_script(url, data):
    opener = urllib.request.build_opener(KeepPostRedirectHandler)
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    with opener.open(req) as response:
        return response.read()

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api_get_checked_ids':
            if not GOOGLE_SCRIPT_URL:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'')
                return
            
            try:
                # Follow redirects must be handled manually or by using urlopen if it follows automatically. Google Apps script endpoints often redirect GET requests. urllib.request.urlopen handles 301/302 automatically by default.
                req = urllib.request.Request(GOOGLE_SCRIPT_URL, method="GET")
                with urllib.request.urlopen(req) as response:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(response.read())
            except Exception as e:
                print(f"Error fetching checked IDs: {e}")
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'')
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api_proxy':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)

                # Create request to external API
                req = urllib.request.Request(TARGET_URL, data=post_data, method="POST")
                req.add_header('Content-Type', 'application/x-www-form-urlencoded')
                
                # Forward the request
                with urllib.request.urlopen(req) as response:
                    self.send_response(response.status)
                    self.end_headers()
                    self.wfile.write(response.read())

            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self.end_headers()
                self.wfile.write(e.read())
            except Exception as e:
                self.send_error(500, str(e))

        elif self.path == '/api_update_selection':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                
                if not GOOGLE_SCRIPT_URL:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"status": "no_google_url_configured"}')
                    return
                
                # Use custom opener to keep POST through 302 redirect from Apps Script
                result = post_to_apps_script(GOOGLE_SCRIPT_URL, post_data)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(result)

            except Exception as e:
                print(f"Error updating selection: {e}")
                self.send_error(500, str(e))
        else:
            # Default behavior for other POST requests (though we don't expect any)
            super().do_POST()

print(f"Starting server at http://localhost:{PORT}")
print("Press Ctrl+C to stop")

# Reduce default buffering
sys.stdout.flush()

try:
    with socketserver.ThreadingTCPServer(("", PORT), ProxyHandler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped.")
