import http.server
import socketserver
import urllib.request
import urllib.error
import sys
import os

PORT = int(os.environ.get('PORT', 8000))
TARGET_URL = "https://api.depositphotos.com/?dp_command=getMediaData"

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
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
