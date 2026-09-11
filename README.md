# 2DY — website

A static, multilingual, animation-led site for 2DY (Hekur · Arkitekturë · Mirëmbajtje · Menaxhim projektesh).

Design reference: **Rimadesio** — hairline uppercase display type, full-bleed cinematic photography, extreme whitespace, restrained motion.

No framework. No runtime dependencies. Two build-time dependencies, both dev-only: `sharp` (images) and `ffmpeg-static` (the hero video).

---

## Quick start

```bash
npm install
```

```bash
npm run all
```

`npm run all` = `images` (PNGs → AVIF/WebP + manifest) → `video` (re-encode the hero plate) → `build` (generate `dist/`) → `validate`.

```bash
npm run serve
```

Serves `dist/` at http://localhost:4321 with Cloudflare-Pages-like routing (clean URLs, `_redirects`, real 404).

```bash
node tools/validate.mjs
```

Crawls every generated page and fails on dead links, missing assets (images, video sources, posters, fonts, scripts), broken JSON-LD, non-reciprocal hreflang, duplicate metadata, or images missing `alt`.

---

## Structure

```
build.mjs                    the generator — templates live here as functions
package.json

src/
  locales/
    sq.json                  MASTER. Albanian. Edit this first.
    en.json  mk.json
    sr.json  de.json         translations, same shape as sq.json
  assets/
    css/main.css             the entire design system, tokenised
    js/app.js                all behaviour, zero dependencies
    fonts/                   self-hosted Geist (4 unicode subsets, 67 KB total)
    brand/                   logo-white.png (the mark) + kera.png
    img/
      *.png                  14 source images
      manifest.json          generated — dimensions + LQIP per image
    video/
      hero.mp4               raw hero plate, re-encoded at build time

tools/
  optimize-images.mjs        sharp pipeline
  optimize-video.mjs         ffmpeg pipeline → WebM + MP4
  validate.mjs               post-build crawler
  serve.mjs                  local preview server

  dist/                        generated output — this is what deploys
```

---

## URL scheme

Albanian is the default and lives at the root. Every other language gets a prefix, and **every language gets its own localized slugs** — not a query string, not a client-side swap.

| Page | sq | en | de | mk | sr |
|---|---|---|---|---|---|
| Home | `/` | `/en/` | `/de/` | `/mk/` | `/sr/` |
| Metalwork | `/punime-me-hekur/` | `/en/metalwork/` | `/de/metallbau/` | `/mk/metalni-raboti/` | `/sr/bravarski-radovi/` |
| Architecture | `/arkitekture/` | `/en/architecture/` | `/de/architektur/` | `/mk/arhitektura/` | `/sr/arhitektura/` |
| Maintenance | `/mirembajtje/` | `/en/maintenance/` | `/de/instandhaltung/` | `/mk/odrzuvanje/` | `/sr/odrzavanje/` |
| Projects | `/menaxhim-projektesh/` | `/en/project-management/` | `/de/projektmanagement/` | `/mk/menadzment-na-proekti/` | `/sr/upravljanje-projektima/` |
| About | `/rreth-nesh/` | `/en/about/` | `/de/ueber-uns/` | `/mk/za-nas/` | `/sr/o-nama/` |
| Contact | `/kontakt/` | `/en/contact/` | `/de/kontakt/` | `/mk/kontakt/` | `/sr/kontakt/` |

36 pages total: 7 × 5 languages, plus a single root `404.html` that Cloudflare serves for every unmatched route.

Old `.html` URLs from the previous site 301 to their new homes — see `_redirects`.

---

## Editing content

**All copy lives in `src/locales/*.json`. Nothing is hardcoded in the templates.**

To change Albanian copy, edit `src/locales/sq.json` and rebuild. To keep the other languages in step, mirror the same key in each of the other four files — the structure is identical across all five, and `validate.mjs` will not catch a stale translation, only a missing key.

### Adding a language

1. Copy `src/locales/en.json` to `src/locales/xx.json`.
2. Set `meta`: `code`, `htmlLang`, `name` (endonym), `nameEn`, `dir`, and `isDefault: false`.
3. Translate the values. Do **not** touch: `brand.name`, `brand.legal`, `brand.since`, any `id`, `image` or `number` field, emails, phone numbers, or team member names.
4. Localize the six `slug` fields (4 services + `about.slug` + `contact.slug`). Lowercase ASCII, hyphens, no diacritics, all distinct.
5. `npm run build`. The language appears in the header switcher, the overlay menu, the footer, the sitemap and every hreflang cluster automatically.

To change which language is the default, move `"isDefault": true` to that locale. The root URLs follow it.

---

## Design system

Everything is a custom property in `:root` at the top of `main.css`.

| Token | Value | Role |
|---|---|---|
| `--paper` | `#F5F4F1` | warm-neutral ground |
| `--void` | `#0B0C0D` | dark section ground |
| `--ink` | `#101112` | body text |
| `--bronze` | `#956633` | the single accent — steel's temper colour (`--bronze-lt` `#C79355` on dark grounds) |

**Type.** One family: **Geist** (variable 100–900), self-hosted, standing in for Rimadesio's commercial Suisse Int'l. Rimadesio pairs it with Times New Roman italic for accents; 2DY takes its contrast from **weight** instead, so there is no second typeface anywhere on the site.

The signature move is `.display` — weight 100, uppercase, tight tracking, `line-height: .92`. The `.serif` class is the headline accent (as in "menduar **mirë**") and is now simply weight 400 in the same family.

**Dark sections.** Add `.invert` to a section. It re-points `--ink`, `--line`, `--paper` etc. to their dark equivalents, and every component inside adapts without a single override.

### Swapping in the real Suisse Int'l

If 2DY licenses Suisse Int'l from Swiss Typefaces, drop the `.woff2` files into `src/assets/fonts/`, add the `@font-face` blocks to `geist.css`, and the stack in `--sans` already lists `"Suisse Int'l"` ahead of Geist — it will take over with no other change.

---

## Motion

| Effect | Where | Notes |
|---|---|---|
| Hero video | `.hero__video` | 8s silent loop behind the headline. The still is the poster and paints first; the video cross-fades in only once it can play, and is dropped entirely on reduced-motion, save-data or 2G. |
| Load sequence | `body.page-ready` | Logo → nav → language → CTA → scroll cue, staggered on arrival. |
| Smooth scroll | `app.js` → `Scroll` | lerped `window.scrollTo`; keeps `position: fixed` and the a11y tree intact. Off on touch (native momentum is better) and off under reduced-motion. |
| Custom cursor | `.cursor` | circle, `mix-blend-mode: difference`, grows on interactive elements, grows further and shows a label on `[data-cursor]`. |
| Reveals | `[data-rise]` `[data-fade]` `[data-clip]` `[data-draw]` | IntersectionObserver. Wrap a group in `[data-stagger="90"]` to cascade children. |
| Parallax | `[data-parallax="0.14"]` | on the image inside a positioned parent. |
| Page transitions | `.veil` | dark panel wipes up on leave, lifts on arrive. |
| Split text | `[data-split]` | per-character stagger; preserves the accessible name via `aria-label`. |
| Velocity stretch | `runParallax()` | scroll speed drives a sub-2% vertical stretch on media — what makes the page read as one continuous surface rather than stacked blocks. |
| **Forge (WebGL)** | `forge.js` + `.forge` | a raymarched steel lattice. Scroll drives the camera through it; the pointer swings the key light. One fragment shader on a full-screen triangle — ~4 KB gzipped instead of the ~150 KB a 3D library would cost. |
| Material tilt | `initMaterialTilt()` | the finish samples rotate toward the pointer in 3D and their sheen sweeps the other way. |
| Magnetic buttons | `initMagnetic()` | buttons and the index arrows lean a few px toward the pointer, capped so a wide button does not travel further than a small one. |

Reveal attributes: `data-rise` (masked line), `data-fade` (lift), `data-scale` (tiles), `data-wipe` (rules/bars), `data-soft` (blur-in), `data-clip` (image reveal), `data-draw` (rule draw). Wrap a group in `data-stagger="80"` to cascade its children.

`prefers-reduced-motion: reduce` disables all of it, including the cursor and the grain.

---

## The Forge section

`src/assets/js/forge.js` renders a repeating steel scaffold with a signed-distance field — no meshes, no textures, no library. It is only loaded on the home page.

It degrades at every level: no WebGL, `prefers-reduced-motion`, or a save-data/2G connection each leave the CSS gradient in `.forge__stage` showing, which is designed to look finished on its own. Resolution is capped at 1.6× DPR (1.25× on phones) and drops to 0.7× if frames actually come back slow. Rendering is paused whenever the section is off screen or the tab is hidden.

Benchmarked at 1.9 ms/frame at 2420×1440 — roughly an eighth of the 16.7 ms budget for 60fps.

To retune the structure, edit `map()` in the shader: `runners` are the members along z, `ties` and `braces` are the cross members. Lighting lives in the block below the raymarch loop.

## Video

The hero plate lives in `src/assets/video/hero.mp4` (the raw generation). `npm run video` re-encodes it to a silent, 1600px-wide **WebM (VP9)** and **MP4 (H.264)** pair in `dist/assets/video/` — 7.3 MB down to 220 KB / 380 KB.

To replace it, drop a new file into `src/assets/video/` under the same name and re-run `npm run video`. Any `.mp4`/`.mov`/`.webm` in that folder gets processed.

## Images

Source PNGs go in `src/assets/img/`. `npm run images` emits AVIF + WebP at 640/1024/1600/2400, a base64 LQIP for blur-up, and records intrinsic dimensions in `manifest.json` so every `<img>` ships `width`/`height` and never shifts layout.

Current set is 14 AI-generated abstract/cinematic frames (Seedream 4.5). **These are placeholders with intent** — they establish the art direction. Replace them with real photography of 2DY's own work as it becomes available: keep the same filename, re-run `npm run images`, done.

The social card (`og.jpg`, 1200×630) and the full favicon set are generated from the same pipeline.

---

## The contact form

`app.js` → `initForm()` composes a `mailto:` draft with every field filled in. It works today with no backend.

Two deliberate behaviours worth knowing, because they look like bugs and are not:

- **The form is never reset after submit.** The browser cannot tell us whether a mail client actually opened. If it did not, the user still has everything they typed.
- **The success message says a draft was *prepared*, not that anything was *sent*.** Same reason.

To wire it to a real endpoint (Formspree, Cloudflare Worker, n8n), replace the `window.location.href = href` block with a `fetch()` POST. The success/error branches, the `aria-disabled` handling and the localized strings under `contact.form` are already in place — and at that point you can legitimately call `form.reset()` on a 200.

---

## Deployment (Cloudflare Pages)

- **Build command:** `npm run all`
- **Output directory:** `dist`
- **Node version:** 20 or newer

`_headers` sets immutable caching for fonts and images, short caching for CSS/JS, and baseline security headers. `_redirects` carries the legacy URL map.

**Before going live**, set the real domain:

```bash
SITE_URL=https://2dy.com npm run all
```

`SITE_URL` feeds every canonical, every hreflang, the sitemap and all JSON-LD. It defaults to the current `pages.dev` address.

---

## SEO

Per page: unique title and description, canonical, reciprocal hreflang across all five languages plus `x-default`, Open Graph (with real `language_TERRITORY` locales) and Twitter cards, and a JSON-LD `@graph` (`Organization`, `LocalBusiness`, `WebSite`, `WebPage`, plus `Service` / `BreadcrumbList` / `AboutPage` / `ContactPage` / `Person` where relevant).

Site-wide: `sitemap.xml` with `xhtml:link` alternates on every entry, `robots.txt`, `site.webmanifest`, and a single root `404.html` marked `noindex` — Cloudflare serves it for every unmatched route, so per-locale 404 directories would only exist as indexable 200 URLs.

Fonts are preloaded **per language**: Macedonian pages preload the Cyrillic subset, Albanian and Serbian also pull `latin-ext`, English and German just `latin`.

`node tools/validate.mjs` enforces most of this on every build, and fails the build on dead links, missing assets, broken JSON-LD, duplicate metadata or a noindex page that still emits a canonical.

### Not done — needs real data

`LocalBusiness` currently declares only `addressCountry: XK`. For local-pack eligibility 2DY needs a real street address and coordinates. Add `address` and `geo` under `contact` in `sq.json` (mirrored untranslated into the other four) and render them into the `PostalAddress` node.

---

## Verified across

Layout is checked at 320 / 360 / 375 / 390 / 768 / 1440 / 1920 px, in all five languages. German is the stress case — it has the longest words, and the hero type scale is set by what `INSTANDHALTUNG` and `PROJEKTMANAGEMENT` need rather than by the Albanian.

Every interactive control is at least 44×44 on touch. Every text/background pair in the palette clears WCAG AA. The overlay menu is a real dialog: everything behind it goes `inert`, focus is trapped, and it carries its own close button.

## Known gaps

- **The photography is generated, not real.** This is the single biggest thing to replace.
- **No project/case-study pages.** The structure supports adding a `projects` collection to the locale files; nothing is built yet because there is no photographed work to fill it.
- **The form has no backend** (see above).
- **The AI assistant widget** from the old site was not carried over — it was a non-functional UI demo.
- **The hero video is generated**, like the stills. Replacing it with real workshop footage is the same one-file swap described above.
- **`LocalBusiness` has no street address or coordinates** (see the SEO note above) — that needs real data from the client before local-pack eligibility is possible.
