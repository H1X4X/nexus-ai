#!/usr/bin/env node
/* Minimal dependency-free static server for local development. */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = normalize(decoded).replace(/^([/\\])+/, "");
  const full = join(root, clean || "index.html");
  if (!full.startsWith(root.endsWith(sep) ? root : root + sep) && full !== root) return null;
  return full;
}

const server = createServer(async (req, res) => {
  try {
    let full = resolvePath(req.url || "/");
    if (!full) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    let info = await stat(full).catch(() => null);
    if (info?.isDirectory()) {
      full = join(full, "index.html");
      info = await stat(full).catch(() => null);
    }
    if (!info?.isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    const body = await readFile(full);
    res.writeHead(200, {
      "Content-Type": MIME[extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end("Server error: " + err.message);
  }
});

server.listen(port, () => {
  console.log(`NEXUS AI running at http://localhost:${port}/`);
});
