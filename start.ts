/**
 * start.ts — Wrapper to launch the trading agent with dashboard file serving
 *
 * This script:
 * 1. Monkey-patches http.createServer using require() (mutable CJS reference)
 * 2. Then imports the original agent which creates its HTTP server
 * 3. The patched createServer intercepts "/" to serve dashboard/index.html
 *
 * Usage: CMD ["npx", "tsx", "start.ts"] in Dockerfile
 */

// Use require() to get a mutable reference to the http module
// (ESM import gives a read-only module namespace object)
const http = require("http");
const fs = require("fs");
const path = require("path");

// Store original createServer
const originalCreateServer = http.createServer.bind(http);

// Monkey-patch createServer to intercept the request handler
http.createServer = function(handler: any) {
  const wrappedHandler = (req: any, res: any) => {
    // Intercept root path to serve external dashboard file
    if (req.url === '/' || req.url === '') {
      const dashPath = path.join(process.cwd(), 'dashboard', 'index.html');
      try {
        if (fs.existsSync(dashPath)) {
          const html = fs.readFileSync(dashPath, 'utf-8');
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(html);
          return;
        }
      } catch (e) {
        console.warn('[start.ts] Could not serve dashboard/index.html, falling back:', e);
      }
    }
    // Fall through to original handler for everything else (API routes, etc.)
    return handler(req, res);
  };

  return originalCreateServer(wrappedHandler);
};

console.log('[start.ts] Dashboard file override enabled — / will serve dashboard/index.html');

// Now import the original agent (triggers main() which creates the HTTP server)
import("./agent-v3.2");
