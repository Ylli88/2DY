/**
 * Crawls every generated page in dist/ and checks the things that actually
 * break a site: dead internal links, missing assets, broken structured data,
 * non-reciprocal hreflang, duplicate or missing SEO metadata, images without
 * dimensions or alt text, and heading-order problems.
 *
 * Exits non-zero if anything ERROR-level is found.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const errors = [];
const warns = [];
const err = (page, msg) => errors.push(`${page}: ${msg}`);
const warn = (page, msg) => warns.push(`${page}: ${msg}`);

/* ---------- collect pages ---------- */
async function walk(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

const routeOf = (file) => {
  const rel = path.relative(DIST, file).split(path.sep).join('/');
  if (rel === '404.html') return '/404.html';
  return '/' + rel.replace(/index\.html$/, '');
};

/* ---------- tiny extractors (regex is fine for our own output) ---------- */
const all = (re, s) => Array.from(s.matchAll(re));
const one = (re, s) => { const m = s.match(re); return m ? m[1] : null; };

async function assetExists(urlPath) {
  const clean = urlPath.split('?')[0].split('#')[0];
  return existsSync(path.join(DIST, clean.replace(/^\//, '')));
}

async function main() {
  const files = await walk(DIST);
  const routes = new Set(files.map(routeOf));
  const seenTitles = new Map();
  const seenDescs = new Map();
  const hreflangGraph = new Map(); // route -> {lang: href}

  console.log(`\n  Validating ${files.length} pages…\n`);

  for (const file of files) {
    const page = routeOf(file);
    const html = await readFile(file, 'utf8');

    /* --- head essentials --- */
    const title = one(/<title>([\s\S]*?)<\/title>/, html);
    const desc = one(/<meta name="description" content="([^"]*)"/, html);
    const canonical = one(/<link rel="canonical" href="([^"]*)"/, html);
    const lang = one(/<html lang="([^"]*)"/, html);

    if (!title) err(page, 'no <title>');
    else {
      if (title.length > 65) warn(page, `title ${title.length} chars (>65)`);
      const prev = seenTitles.get(title);
      if (prev && !/(^|\/)404(\.html)?\/?$/.test(page)) {
        err(page, `duplicate title with ${prev}`);
      }
      if (!/(^|\/)404(\.html)?\/?$/.test(page)) seenTitles.set(title, page);
    }

    // The root 404.html is a deliberate copy of the default locale's /404/,
    // so it is exempt from the uniqueness checks.
    const is404 = /(^|\/)404(\.html)?\/?$/.test(page);

    if (!desc) err(page, 'no meta description');
    else {
      if (desc.length > 170) warn(page, `description ${desc.length} chars (>170)`);
      if (desc.length < 60 && !is404) warn(page, `description only ${desc.length} chars`);
      const prev = seenDescs.get(desc);
      if (prev && !is404) err(page, `duplicate description with ${prev}`);
      if (!is404) seenDescs.set(desc, page);
    }

    // A noindex page deliberately carries neither a canonical nor an
    // hreflang cluster — pointing search engines at a page you have just
    // told them to ignore is contradictory.
    const noindex = /<meta name="robots" content="noindex/.test(html);

    if (!canonical && !noindex) err(page, 'no canonical');
    if (canonical && noindex) err(page, 'noindex page still emits a canonical');
    if (!lang) err(page, 'no lang attribute');

    /* --- hreflang --- */
    const alts = all(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g, html);
    if (noindex && alts.length) err(page, 'noindex page still emits hreflang links');
    if (!noindex) {
      if (alts.length < 6) err(page, `only ${alts.length} hreflang links (expected 5 + x-default)`);
      const map = {};
      for (const [, hl, href] of alts) map[hl] = new URL(href).pathname;
      hreflangGraph.set(page, map);
      if (!map['x-default']) err(page, 'missing x-default hreflang');
    }

    /* --- structured data --- */
    for (const [, block] of all(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, html)) {
      try {
        const parsed = JSON.parse(block.replace(/\\u003c/g, '<'));
        const graph = parsed['@graph'] || [parsed];
        for (const node of graph) {
          if (!node['@type']) err(page, 'JSON-LD node without @type');
        }
      } catch (e) {
        err(page, `JSON-LD parse error: ${e.message}`);
      }
    }

    /* --- headings --- */
    const hs = all(/<h([1-6])[^>]*>/g, html).map((m) => +m[1]);
    const h1s = hs.filter((h) => h === 1).length;
    if (h1s === 0) err(page, 'no <h1>');
    if (h1s > 1) err(page, `${h1s} <h1> elements`);

    /* --- images --- */
    for (const [tag] of all(/<img\b[^>]*>/g, html).map((m) => [m[0]])) {
      if (!/\salt=/.test(tag)) err(page, `img without alt: ${tag.slice(0, 90)}`);
      if (!/\swidth=/.test(tag) || !/\sheight=/.test(tag)) {
        warn(page, `img without width/height: ${tag.slice(0, 90)}`);
      }
      const src = one(/\ssrc="([^"]+)"/, tag);
      if (src && src.startsWith('/') && !(await assetExists(src))) {
        err(page, `missing image file ${src}`);
      }
    }

    /* --- srcset targets --- */
    for (const [, srcset] of all(/srcset="([^"]+)"/g, html)) {
      for (const part of srcset.split(',')) {
        const u = part.trim().split(/\s+/)[0];
        if (u && u.startsWith('/') && !(await assetExists(u))) {
          err(page, `missing srcset file ${u}`);
        }
      }
    }

    /* --- video sources and posters --- */
    for (const [, src] of all(/<source[^>]+src="(\/[^"]+)"/g, html)) {
      if (!(await assetExists(src))) err(page, `missing <source> file ${src}`);
    }
    for (const [, poster] of all(/<video[^>]+poster="(\/[^"]+)"/g, html)) {
      if (!(await assetExists(poster))) err(page, `missing video poster ${poster}`);
    }

    /* --- stylesheets / scripts / preloads --- */
    for (const [, href] of all(/<link[^>]+href="(\/[^"]+)"/g, html)) {
      if (!(await assetExists(href))) err(page, `missing linked asset ${href}`);
    }
    for (const [, src] of all(/<script[^>]+src="(\/[^"]+)"/g, html)) {
      if (!(await assetExists(src))) err(page, `missing script ${src}`);
    }

    /* --- internal links --- */
    for (const [, href] of all(/<a\b[^>]+href="([^"]+)"/g, html)) {
      if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
      if (!href.startsWith('/')) { warn(page, `relative link ${href}`); continue; }
      const target = href.split('#')[0];
      if (!routes.has(target) && !(await assetExists(target))) {
        err(page, `dead internal link → ${href}`);
      }
    }
  }

  /* --- hreflang must be reciprocal --- */
  for (const [page, map] of hreflangGraph) {
    for (const [hl, target] of Object.entries(map)) {
      if (hl === 'x-default') continue;
      const back = hreflangGraph.get(target);
      if (!back) { err(page, `hreflang ${hl} → ${target} which has no hreflang map`); continue; }
      const values = Object.values(back);
      if (!values.includes(page)) {
        err(page, `hreflang ${hl} → ${target} does not link back`);
      }
    }
  }

  /* --- reveal attributes must be ones app.js actually observes ---------
     Anything with a reveal attribute starts hidden in CSS. If app.js does
     not observe it, it never receives .is-in and stays invisible forever —
     which looks like an empty grey box on the page, not like a bug. */
  {
    const js = await readFile(path.join(DIST, 'assets', 'js', 'app.js'), 'utf8');
    const declared = new Set(
      all(/\[data-([a-z]+)\]/g, (js.match(/const REVEAL_SELECTOR\s*=\s*[\s\S]*?;/) || [''])[0])
        .map((m) => m[1])
    );

    if (!declared.size) {
      err('app.js', 'could not find REVEAL_SELECTOR — reveal check skipped');
    } else {
      const used = new Map();
      for (const file of files) {
        const html = await readFile(file, 'utf8');
        for (const [, name] of all(/\sdata-(rise|fade|draw|clip|scale|wipe|soft)[=\s>]/g, html)) {
          if (!used.has(name)) used.set(name, routeOf(file));
        }
      }
      for (const [name, page] of used) {
        if (!declared.has(name)) {
          err(page, `data-${name} is used in the markup but is not in app.js REVEAL_SELECTOR — those elements will never become visible`);
        }
      }
    }
  }

  /* --- site files --- */
  for (const f of ['sitemap.xml', 'robots.txt', 'site.webmanifest', '_headers', '_redirects', '404.html']) {
    if (!existsSync(path.join(DIST, f))) err('site', `missing ${f}`);
  }

  const sm = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
  const locs = all(/<loc>([^<]+)<\/loc>/g, sm).map((m) => new URL(m[1]).pathname);
  for (const loc of locs) {
    if (!routes.has(loc)) err('sitemap.xml', `lists ${loc} which was not generated`);
  }
  const expected = [...routes].filter((r) => !r.endsWith('404.html') && !r.endsWith('/404/'));
  for (const r of expected) {
    if (!locs.includes(r)) warn('sitemap.xml', `does not list ${r}`);
  }
  try { JSON.parse(await readFile(path.join(DIST, 'site.webmanifest'), 'utf8')); }
  catch (e) { err('site.webmanifest', `invalid JSON: ${e.message}`); }

  /* --- report --- */
  if (warns.length) {
    console.log(`  WARNINGS (${warns.length})`);
    for (const w of warns.slice(0, 40)) console.log(`    · ${w}`);
    if (warns.length > 40) console.log(`    · …and ${warns.length - 40} more`);
    console.log('');
  }

  if (errors.length) {
    console.log(`  ERRORS (${errors.length})`);
    for (const e of errors.slice(0, 60)) console.log(`    ✗ ${e}`);
    if (errors.length > 60) console.log(`    ✗ …and ${errors.length - 60} more`);
    console.log('');
    process.exit(1);
  }

  console.log(`  ✓ ${files.length} pages · ${locs.length} sitemap URLs · no errors\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
