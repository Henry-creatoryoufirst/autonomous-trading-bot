/**
 * start.ts — Wrapper to launch the trading agent with dashboard file serving
 *
 * This script:
 * 1. Imports and runs the original agent
 * 2. Monkey-patches the HTTP server to serve dashboard/index.html
 *    instead of the embedded HTML when the file exists
 *
 * Usage: Replace CMD in Dockerfile with:
 *   CMD ["npx", "tsx", "start.ts"]
 *
 * Or on Railway, set the start command to: npx tsx start.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";

// Store original createServer
const originalCreateServer = http.createServer;

// Monkey-patch to intercept the request handler
(http as any).createServer = function(handler: any) {
  const wrappedHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Intercept root path to serve external dashboard
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
    // Fall through to original handler for everything else
    return handler(req, res);
  };

  return originalCreateServer.call(http, wrappedHandler);
};

console.log('[start.ts] Dashboard file serving enabled — will serve dashboard/index.html');

// Now import the original agent (this triggers its main() which creates the HTTP server)
import("./agent-v3.2");
