/**
 * Tiny static server for local preview of dist/.
 * Mirrors Cloudflare Pages behaviour closely enough to catch routing mistakes:
 * clean URLs resolve to index.html, unknown paths get the real 404 page,
 * and _redirects rules are honoured.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 4321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
};

// parse _redirects
const REDIRECTS = [];
const rPath = path.join(ROOT, '_redirects');
if (existsSync(rPath)) {
  for (const line of readFileSync(rPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [from, to, code] = t.split(/\s+/);
    if (from && to) REDIRECTS.push({ from, to, code: Number(code) || 301 });
  }
}

function matchRedirect(pathname) {
  for (const r of REDIRECTS) {
    if (r.from.endsWith('/*')) {
      const base = r.from.slice(0, -2);
      if (pathname.startsWith(base + '/') || pathname === base) {
        const splat = pathname.slice(base.length).replace(/^\//, '');
        return { to: r.to.replace(':splat', splat), code: r.code };
      }
    } else if (r.from === pathname) {
      return { to: r.to, code: r.code };
    }
  }
  return null;
}

async function tryFile(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? p : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a request path to a file inside DIST, or null if it escapes.
 * `new URL()` does NOT decode %2f, so decoding has to happen before the
 * path is resolved, and the result has to be re-checked for containment.
 */
function safeResolve(pathname) {
  const resolved = path.resolve(ROOT, '.' + pathname);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Bad request');
    }

    const rd = matchRedirect(pathname);
    if (rd) {
      res.writeHead(rd.code, { Location: rd.to });
      return res.end();
    }

    const base = safeResolve(pathname);
    if (!base) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }

    // directory → index.html
    let found = await tryFile(base);

    if (!found && !path.extname(pathname)) {
      found = await tryFile(path.join(base, 'index.html'));
      if (!found && !pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname + '/' });
        return res.end();
      }
    }

    if (!found) {
      const nf = await tryFile(path.join(ROOT, '404.html'));
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      return res.end(nf ? await readFile(nf) : 'Not found');
    }

    const ext = path.extname(found).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(await readFile(found));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
}).listen(PORT, () => {
  console.log(`\n  2DY — http://localhost:${PORT}\n`);
});
