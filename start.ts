/**
 * start.ts — Wrapper to launch the trading agent with dashboard file serving
 *
 * Uses createRequire to get a mutable CJS reference to the http module,
 * then monkey-patches createServer to intercept "/" requests and serve
 * dashboard/index.html from disk instead of the embedded HTML.
 *
 * Usage: CMD ["npx", "tsx", "start.ts"] in Dockerfile
 */

import { createRequire } from "module";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// createRequire gives us CJS require() in ESM context — mutable module refs
const require = createRequire(import.meta.url);
const http = require("http");

// Store original createServer
const originalCreateServer = http.createServer.bind(http);

// Monkey-patch createServer to intercept the request handler
http.createServer = function(handler: any) {
  const wrappedHandler = (req: any, res: any) => {
    // Intercept root path to serve external dashboard file
    if (req.url === '/' || req.url === '') {
      const dashPath = join(process.cwd(), 'dashboard', 'index.html');
      try {
        if (existsSync(dashPath)) {
          const html = readFileSync(dashPath, 'utf-8');
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
    // Fall through to original handler for everything else (API routes, /health, etc.)
    return handler(req, res);
  };

  return originalCreateServer(wrappedHandler);
};

console.log('[start.ts] Dashboard file override enabled — / will serve dashboard/index.html');

// Now import the original agent (triggers main() which creates the HTTP server)
import("./agent-v3.2");
