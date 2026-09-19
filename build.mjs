/* =========================================================================
   2DY — static site generator
   Zero runtime dependencies. Reads src/locales/*.json + the image manifest
   and emits a complete multilingual static site into dist/.

   Every language gets real, separate, crawlable URLs with localized slugs
   and reciprocal hreflang — not a client-side string swap.
   ========================================================================= */
import { readdir, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const SITE = (process.env.SITE_URL || 'https://2dy-website.pages.dev').replace(/\/$/, '');
const BUILT = new Date().toISOString().slice(0, 10);

/* -------------------------------------------------------------------------
   helpers
   ------------------------------------------------------------------------- */
const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
           .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const attr = esc;

function socialLinks() {
  return `<div class="social-links">
    <a href="https://www.facebook.com/profile.php?id=61579275296622&amp;locale=hi_IN" target="_blank" rel="noopener noreferrer"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13.5 22V13.5H16l.5-3h-3V8.7c0-.86.24-1.45 1.48-1.45H16.6V4.6c-.31-.04-1.38-.13-2.64-.13-2.61 0-4.39 1.6-4.39 4.52v1.51H7v3h2.57V22h3.93Z"/></svg><span>Facebook</span></a>
    <a href="https://www.instagram.com/2dy_bi/" target="_blank" rel="noopener noreferrer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg><span>Instagram</span></a>
  </div>`;
}

const json = (o) => JSON.stringify(o, null, 2).replace(/</g, '\\u003c');

/** Interior page ids, in nav order. */
const NAV_ORDER = ['hekur', 'arkitekture', 'mirembajtje', 'projekte', 'about', 'contact'];

let IMAGES = {};
/** Any image referenced by a template but absent from the manifest. Fatal. */
const MISSING_IMAGES = new Set();

/* -------------------------------------------------------------------------
   URLs
   ------------------------------------------------------------------------- */
function slugFor(L, id) {
  if (id === 'home') return '';
  if (id === 'about') return L.about.slug;
  if (id === 'contact') return L.contact.slug;
  if (id === '404') return L.notFound.slug;
  const svc = L.services.find((s) => s.id === id);
  return svc ? svc.slug : id;
}

/** Absolute-from-root path, always with a trailing slash. */
function urlFor(L, id) {
  const prefix = L.meta.isDefault ? '' : `/${L.meta.code}`;
  // The 404 page exists only as the single root 404.html that Cloudflare
  // serves for every unmatched route, so "the same page in another
  // language" is that language's homepage.
  if (id === 'home' || id === '404') return prefix === '' ? '/' : `${prefix}/`;
  return `${prefix}/${slugFor(L, id)}/`;
}

/** Where the file lands on disk. */
function fileFor(L, id) {
  const u = urlFor(L, id);
  return path.join(DIST, u.replace(/^\//, ''), 'index.html');
}

/* -------------------------------------------------------------------------
   <picture> — responsive, modern formats, blur-up, no layout shift
   ------------------------------------------------------------------------- */
function pic(name, opts = {}) {
  const {
    alt = '',
    sizes = '100vw',
    className = '',
    loading = 'lazy',
    fetchpriority,
    parallax,
  } = opts;

  const m = IMAGES[name];
  if (!m) {
    MISSING_IMAGES.add(name);
    return '';
  }

  const set = (ext) =>
    m.widths.map((w) => `/assets/img/${name}-${w}.${ext} ${w}w`).join(', ');

  const fallbackW = m.widths[m.widths.length - 1];

  return `<picture>
      <source type="image/avif" srcset="${set('avif')}" sizes="${attr(sizes)}">
      <source type="image/webp" srcset="${set('webp')}" sizes="${attr(sizes)}">
      <img src="/assets/img/${name}-${fallbackW}.webp"
           alt="${attr(alt)}"
           width="${m.width}" height="${m.height}"
           loading="${loading}" decoding="async"${fetchpriority ? ` fetchpriority="${fetchpriority}"` : ''}
           ${className ? `class="${attr(className)}"` : ''}${parallax ? ` data-parallax="${parallax}"` : ''}
           style="background-image:url('${m.lqip}');background-size:cover;background-position:center">
    </picture>`;
}

/* -------------------------------------------------------------------------
   icons
   ------------------------------------------------------------------------- */
const ICON = {
  arrow: `<svg class="btn__arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1 8h13M9 3l5 5-5 5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  diag: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12L12 4M12 4H5.5M12 4v6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chev: `<svg class="lang__chev" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1 3.5L5 7l4-3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M5 9V1M1.5 4.5L5 1l3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/* -------------------------------------------------------------------------
   structured data
   ------------------------------------------------------------------------- */
function ldOrganization(L) {
  return {
    '@type': 'Organization',
    '@id': `${SITE}/#org`,
    name: L.brand.name,
    legalName: L.brand.legal,
    // One @id means one entity: its url must not vary by locale. The
    // per-language home URL is carried by the WebPage node and hreflang.
    url: `${SITE}/`,
    logo: `${SITE}/assets/img/icon-512.png`,
    image: `${SITE}/assets/img/og.jpg`,
    description: L.home.seo.description,
    foundingDate: L.brand.since,
    email: L.contact.email,
    telephone: L.contact.phoneRaw,
    areaServed: [
      { '@type': 'Country', name: 'Kosovo' },
      { '@type': 'Country', name: 'Albania' },
      { '@type': 'Country', name: 'North Macedonia' },
    ],
    address: { '@type': 'PostalAddress', addressCountry: 'XK' },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'sales',
      telephone: L.contact.phoneRaw,
      email: L.contact.email,
      availableLanguage: ['sq', 'en', 'mk', 'sr', 'de'],
    },
    knowsLanguage: ['sq', 'en', 'mk', 'sr', 'de'],
  };
}

function ldLocalBusiness(L) {
  return {
    // HomeAndConstructionBusiness is the specific subtype Google recognises
    // for this trade; plain LocalBusiness is the generic fallback.
    '@type': 'HomeAndConstructionBusiness',
    '@id': `${SITE}/#business`,
    name: L.brand.name,
    parentOrganization: { '@id': `${SITE}/#org` },
    url: `${SITE}/`,
    image: `${SITE}/assets/img/og.jpg`,
    telephone: L.contact.phoneRaw,
    email: L.contact.email,
    priceRange: '$$',
    address: { '@type': 'PostalAddress', addressCountry: 'XK' },
    areaServed: [
      { '@type': 'Country', name: 'Kosovo' },
      { '@type': 'Country', name: 'Albania' },
      { '@type': 'Country', name: 'North Macedonia' },
    ],
    openingHoursSpecification: [{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
      opens: '08:00',
      closes: '18:00',
    }],
    makesOffer: L.services.map((s) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: s.title, description: s.summary },
    })),
  };
}

function ldBreadcrumb(L, trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: `${SITE}${t.url}`,
    })),
  };
}

function ldService(L, svc) {
  return {
    '@type': 'Service',
    '@id': `${SITE}${urlFor(L, svc.id)}#service`,
    name: svc.title,
    description: svc.summary,
    serviceType: svc.title,
    provider: { '@id': `${SITE}/#org` },
    areaServed: { '@type': 'Country', name: 'Kosovo' },
    url: `${SITE}${urlFor(L, svc.id)}`,
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: svc.title,
      itemListElement: svc.sections.map((sec) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: sec.title },
      })),
    },
  };
}

/* -------------------------------------------------------------------------
   <head>
   ------------------------------------------------------------------------- */
function head(L, ALL, { id, seo, ogImage = 'og.jpg', preloadHero, extraLd = [], noindex = false }) {
  const canonical = `${SITE}${urlFor(L, id)}`;
  const isHome = id === 'home';

  const alternates = ALL.map((O) =>
    `<link rel="alternate" hreflang="${attr(O.meta.htmlLang)}" href="${attr(SITE + urlFor(O, id))}">`
  ).join('\n  ');

  const defaultLocale = ALL.find((O) => O.meta.isDefault) || L;

  // The 404 has no canonical URL of its own — urlFor() resolves it to the
  // homepage so the language switcher works — so it must not claim that
  // URL's identity with a WebPage node or an og:url.
  const graph = [ldOrganization(L), ldLocalBusiness(L), {
    '@type': 'WebSite',
    '@id': `${SITE}/#website`,
    url: `${SITE}/`,
    name: L.brand.name,
    publisher: { '@id': `${SITE}/#org` },
    inLanguage: ALL.map((O) => O.meta.htmlLang),
  }, ...(noindex ? [] : [{
    '@type': 'WebPage',
    '@id': `${canonical}#page`,
    url: canonical,
    name: seo.title,
    description: seo.description,
    isPartOf: { '@id': `${SITE}/#website` },
    about: { '@id': `${SITE}/#org` },
    inLanguage: L.meta.htmlLang,
  }]), ...extraLd];

  const heroM = preloadHero ? IMAGES[preloadHero] : null;
  if (preloadHero && !heroM) MISSING_IMAGES.add(preloadHero);

  return `<!doctype html>
<html lang="${attr(L.meta.htmlLang)}" dir="${attr(L.meta.dir)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">

  <title>${esc(seo.title)}</title>
  <meta name="description" content="${attr(seo.description)}">
  ${seo.keywords ? `<meta name="keywords" content="${attr(seo.keywords)}">` : ''}
${noindex ? '' : `  <link rel="canonical" href="${attr(canonical)}">`}

  <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">
  <meta name="author" content="${attr(L.brand.legal)}">
  <meta name="theme-color" content="#0B0C0D">
  <meta name="format-detection" content="telephone=yes">
${noindex ? '' : `
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${attr(SITE + urlFor(defaultLocale, id))}">`}

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${attr(L.brand.name)}">
  <meta property="og:title" content="${attr(seo.title)}">
  <meta property="og:description" content="${attr(seo.description)}">
${noindex ? '' : `  <meta property="og:url" content="${attr(canonical)}">`}
  <meta property="og:image" content="${attr(`${SITE}/assets/img/${ogImage}`)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${attr(L.brand.name)}: ${attr(L.brand.tagline)}">
  <meta property="og:locale" content="${attr(L.meta.ogLocale)}">
  ${ALL.filter((O) => O.meta.code !== L.meta.code)
      .map((O) => `<meta property="og:locale:alternate" content="${attr(O.meta.ogLocale)}">`)
      .join('\n  ')}

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${attr(seo.title)}">
  <meta name="twitter:description" content="${attr(seo.description)}">
  <meta name="twitter:image" content="${attr(`${SITE}/assets/img/${ogImage}`)}">

  <link rel="icon" href="/assets/img/icon.svg" type="image/svg+xml">
  <link rel="icon" href="/assets/img/icon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">

  <!-- Set synchronously so the reveal states apply before first paint (no
       flash), and so the page stays fully visible if JS never runs. -->
  <script>(function(d){var r=d.documentElement;r.classList.add('js');
    /* Everything under .js starts hidden and waits for app.js. If that
       script never arrives, this un-hides the page rather than leaving a
       blank one. app.js clears the timer on boot. */
    window.__jsFailsafe=setTimeout(function(){r.classList.add('js-failed')},3000);}(document));</script>

  ${(L.meta.fontSubsets || ['geist-latin'])
      .map((s) => `<link rel="preload" href="/assets/fonts/${s}.woff2" as="font" type="font/woff2" crossorigin>`)
      .join('\n  ')}
  <link rel="stylesheet" href="/assets/css/main.css">
  ${heroM ? `<link rel="preload" as="image" fetchpriority="high"
        href="/assets/img/${preloadHero}-1600.avif"
        imagesrcset="${heroM.widths.map((w) => `/assets/img/${preloadHero}-${w}.avif ${w}w`).join(', ')}"
        imagesizes="100vw" type="image/avif">` : ''}

  <script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>
</head>`;
}

/* -------------------------------------------------------------------------
   chrome: header / menu / footer
   ------------------------------------------------------------------------- */
function langSwitch(L, ALL, id, variant = 'hdr') {
  if (variant === 'menu') {
    return `<div class="menu__langs">
        ${ALL.map((O) => `<a href="${attr(urlFor(O, id))}" lang="${attr(O.meta.htmlLang)}" hreflang="${attr(O.meta.htmlLang)}"${O.meta.code === L.meta.code ? ' aria-current="true"' : ''}>${esc(O.meta.code.toUpperCase())}</a>`).join('\n        ')}
      </div>`;
  }

  // These are plain links, not a menu widget — role="menu"/"menuitem" would
  // promise arrow-key navigation we do not implement. The accessible name
  // keeps the visible "SQ" as its first token (SC 2.5.3 Label in Name).
  return `<div class="lang">
        <button class="lang__btn" type="button" aria-expanded="false" aria-controls="lang-menu">
          <span>${esc(L.meta.code.toUpperCase())}</span><span class="sr-only">, ${esc(L.nav.language)}</span>${ICON.chev}
        </button>
        <div class="lang__menu" id="lang-menu">
          ${ALL.map((O) => `<a class="lang__opt" href="${attr(urlFor(O, id))}" lang="${attr(O.meta.htmlLang)}" hreflang="${attr(O.meta.htmlLang)}"${O.meta.code === L.meta.code ? ' aria-current="true"' : ''}><span>${esc(O.meta.name)}</span><span>${esc(O.meta.code.toUpperCase())}</span></a>`).join('\n          ')}
        </div>
      </div>`;
}

/**
 * `solid` renders the header in its condensed, dark-on-paper form from the
 * start — for pages with no hero behind it, where the transparent
 * light-on-dark treatment would be invisible.
 */
function header(L, ALL, id, solid = false, opts = {}) {
  const navItems = NAV_ORDER.filter((n) => n !== 'contact');

  const label = (n) => {
    if (n === 'about') return L.nav.about;
    const svc = L.services.find((s) => s.id === n);
    return svc ? svc.nav : n;
  };

  return `<a class="skip" href="#main">${esc(L.nav.skipToContent)}</a>

  <div class="veil" aria-hidden="true"><span class="veil__mark">${esc(L.brand.name)}</span></div>

  ${opts.intro ? `<div class="intro" id="intro" aria-hidden="true">
    <div class="intro__inner">
      <img class="intro__logo" src="/assets/brand/logo-white.png" alt="" width="134" height="96" fetchpriority="high" decoding="async">
      <div class="intro__seam"><span class="intro__weld"></span></div>
      <span class="intro__pct">0</span>
    </div>
  </div>` : ''}

  <header class="hdr${solid ? ' hdr--solid' : ''}">
    <div class="hdr__inner">
      <a class="brand" href="${attr(urlFor(L, 'home'))}" aria-label="${attr(L.brand.name)}, ${attr(L.nav.home)}">
        <img class="brand__logo" src="/assets/brand/logo-white.png" alt="${attr(L.brand.name)}" width="134" height="96" fetchpriority="high" decoding="async">
      </a>

      <nav class="nav" aria-label="${attr(L.nav.primary)}">
        ${navItems.map((n) => `<a class="nav__link" href="${attr(urlFor(L, n))}"${n === id ? ' aria-current="page"' : ''}>${esc(label(n))}</a>`).join('\n        ')}
      </nav>

      <div class="hdr__end">
        ${langSwitch(L, ALL, id)}
        <a class="btn" href="${attr(urlFor(L, 'contact'))}"${id === 'contact' ? ' aria-current="page"' : ''}>
          <span class="btn__text">${esc(L.ui.requestQuote)}</span>${ICON.arrow}
        </a>
        <button class="burger" type="button" aria-expanded="false" aria-controls="menu" aria-label="${attr(L.nav.menu)}">
          <span></span><span></span>
        </button>
      </div>
    </div>
  </header>

  <div class="menu" id="menu" role="dialog" aria-modal="true" aria-label="${attr(L.nav.menu)}" aria-hidden="true" data-native-scroll>
    <nav class="menu__list" aria-label="${attr(L.nav.menu)}">
      ${['home', ...NAV_ORDER].map((n, i) => {
        const t = n === 'home' ? L.nav.home
                : n === 'about' ? L.nav.about
                : n === 'contact' ? L.nav.contact
                : (L.services.find((s) => s.id === n)?.nav ?? n);
        return `<div class="menu__item">
        <a class="menu__link" href="${attr(urlFor(L, n))}"${n === id ? ' aria-current="page"' : ''}>
          <span class="menu__idx">${String(i).padStart(2, '0')}</span><span>${esc(t)}</span>
        </a>
      </div>`;
      }).join('\n      ')}
    </nav>

    <a class="btn btn--solid menu__cta" href="${attr(urlFor(L, 'contact'))}">
      <span class="btn__text">${esc(L.ui.requestQuote)}</span>${ICON.arrow}
    </a>

    <div class="menu__foot">
      <a href="mailto:${attr(L.contact.email)}">${esc(L.contact.email)}</a>
      <a href="tel:${attr(L.contact.phoneRaw)}">${esc(L.contact.phone)}</a>
      ${langSwitch(L, ALL, id, 'menu')}
    </div>
  </div>`;
}

function footer(L, ALL, id) {
  const year = new Date().getFullYear();

  return `<footer class="ftr">
    <div class="shell">
      <div class="ftr__grid" data-stagger="90">
        <div class="ftr__brand" data-fade>
          <img class="ftr__logo" src="/assets/brand/logo-white.png" alt="${attr(L.brand.name)}" width="134" height="96" loading="lazy" decoding="async">
          <span class="ftr__tag">${esc(L.footer.tagline)}</span>
        </div>

        <div class="ftr__col" data-fade>
          <h2 class="ftr__h">${esc(L.footer.servicesLabel)}</h2>
          ${L.services.map((s) => `<a href="${attr(urlFor(L, s.id))}">${esc(s.title)}</a>`).join('\n          ')}
        </div>

        <div class="ftr__col" data-fade>
          <h2 class="ftr__h">${esc(L.footer.companyLabel)}</h2>
          <a href="${attr(urlFor(L, 'home'))}">${esc(L.nav.home)}</a>
          <a href="${attr(urlFor(L, 'about'))}">${esc(L.nav.about)}</a>
          <a href="${attr(urlFor(L, 'contact'))}">${esc(L.nav.contact)}</a>
        </div>

        <div class="ftr__col" data-fade>
          <h2 class="ftr__h">${esc(L.footer.contactLabel)}</h2>
          <a href="mailto:${attr(L.contact.email)}">${esc(L.contact.email)}</a>
          <a href="tel:${attr(L.contact.phoneRaw)}">${esc(L.contact.phone)}</a>
          <span>${esc(L.contact.hours)}</span>
          ${socialLinks()}
        </div>
      </div>

      <div class="ftr__bar" data-fade>
        <span>&copy; ${year} ${esc(L.brand.legal)}. ${esc(L.footer.rights)}</span>
        <nav class="ftr__langs" aria-label="${attr(L.footer.languageLabel)}">
          ${ALL.map((O) => `<a href="${attr(urlFor(O, id))}" hreflang="${attr(O.meta.htmlLang)}" lang="${attr(O.meta.htmlLang)}"${O.meta.code === L.meta.code ? ' aria-current="true"' : ''}>${esc(O.meta.code.toUpperCase())}</a>`).join('\n          ')}
        </nav>
        <span class="ftr__made">
          <span>${esc(L.brand.madeBy)}</span>
          <img src="/assets/brand/kera.png" alt="Kera" width="120" height="35" loading="lazy" decoding="async">
        </span>
        <a class="totop" href="#top">${ICON.up}<span>${esc(L.footer.backToTop)}</span></a>
      </div>
    </div>
  </footer>`;
}

function tail(opts = {}) {
  return `<div class="grain" aria-hidden="true"></div>
  <script src="/assets/js/app.js" defer></script>${opts.forge ? `
  <script src="/assets/js/forge.js" defer></script>` : ''}
</body>
</html>`;
}

/* -------------------------------------------------------------------------
   shared blocks
   ------------------------------------------------------------------------- */
function ctaBlock(L) {
  return `<section class="section cta invert" id="kontakt">
      <div class="cta__bg" aria-hidden="true">${pic('texture', { alt: '', sizes: '100vw', parallax: '0.1' })}</div>
      <div class="aura" aria-hidden="true"></div>
      <div class="shell" data-stagger="90">
        <div class="cta__inner">
          <span class="eyebrow" data-fade>${esc(L.home.cta.eyebrow)}</span>
          <h2 class="cta__t" data-rise><span>${esc(L.home.cta.title)}</span></h2>
          <p class="cta__b" data-fade>${esc(L.home.cta.body)}</p>
          <a class="btn btn--solid" href="${attr(urlFor(L, 'contact'))}" data-fade>
            <span class="btn__text">${esc(L.ui.startProject)}</span>${ICON.arrow}
          </a>

          <div class="cta__rows" data-fade>
            <div class="cta__row">
              <span class="cta__k">${esc(L.contact.personLabel)}</span>
              <span class="cta__v">${esc(L.contact.person)}</span>
            </div>
            <div class="cta__row">
              <span class="cta__k">${esc(L.ui.email)}</span>
              <span class="cta__v"><a href="mailto:${attr(L.contact.email)}">${esc(L.contact.email)}</a></span>
            </div>
            <div class="cta__row">
              <span class="cta__k">${esc(L.ui.phone)}</span>
              <span class="cta__v"><a href="tel:${attr(L.contact.phoneRaw)}">${esc(L.contact.phone)}</a></span>
            </div>
              ${socialLinks()}
          </div>
        </div>
      </div>
    </section>`;
}

function marquee(L) {
  const items = [...L.services.map((s) => s.title), L.brand.since, L.contact.area];
  return `<div class="marq" aria-hidden="true" data-fade>
      <div class="marq__track">
        ${items.map((i) => `<span class="marq__item">${esc(i)}</span>`).join('\n        ')}
      </div>
    </div>`;
}

function pageHero(L, { kicker, l1, l2, lead, image, trail, compact }) {
  return `<section class="hero hero--page${compact ? ' hero--compact' : ''}" id="top">
      <div class="hero__media" aria-hidden="true">${pic(image, { alt: '', sizes: '100vw', loading: 'eager', fetchpriority: 'high', parallax: '0.12' })}</div>
      <div class="hero__inner">
        ${trail ? `<nav aria-label="${attr(L.nav.breadcrumb)}"><ol class="crumbs">${trail.map((t, i) =>
          i === trail.length - 1
            ? `<li><span aria-current="page">${esc(t.name)}</span></li>`
            : `<li><a href="${attr(t.url)}">${esc(t.name)}</a></li>`
        ).join('')}</ol></nav>` : ''}
        <div class="hero__top">
          <div class="stack">
            <span class="eyebrow" data-fade>${esc(kicker)}</span>
            <h1 class="display display--hero hero__title">
              <span class="line" data-rise><span>${esc(l1)}</span></span>
              <span class="line" data-rise style="--d:110ms"><span>${esc(l2)}</span></span>
            </h1>
          </div>
        </div>
        <div class="hero__foot">
          <p class="lead hero__lead" data-fade style="--d:200ms">${esc(lead)}</p>
          <div class="hero__actions" data-fade style="--d:280ms">
            <a class="btn btn--solid" href="${attr(urlFor(L, 'contact'))}"><span class="btn__text">${esc(L.ui.requestQuote)}</span>${ICON.arrow}</a>
          </div>
        </div>
      </div>
    </section>`;
}

/* -------------------------------------------------------------------------
   PAGE: home
   ------------------------------------------------------------------------- */
function renderHome(L, ALL) {
  const H = L.home;

  return `${head(L, ALL, {
    id: 'home',
    seo: H.seo,
    preloadHero: 'hero',
    extraLd: [ldService(L, L.services[0])],
  })}
<body>
  ${header(L, ALL, 'home', false, { intro: true })}

  <main id="main">
    <section class="hero" id="top">
      <div class="hero__media" aria-hidden="true">
        ${pic('hero', { alt: '', sizes: '100vw', loading: 'eager', fetchpriority: 'high', parallax: '0.12' })}
        <video class="hero__video" muted loop playsinline preload="none"
               tabindex="-1" aria-hidden="true">
          <source src="/assets/video/hero.webm" type="video/webm">
          <source src="/assets/video/hero.mp4" type="video/mp4">
        </video>
      </div>

      <div class="hero__inner">
        <div class="hero__top">
          <div class="stack">
            <span class="eyebrow" data-fade>${esc(H.hero.kicker)}</span>
            <h1 class="display display--hero hero__title">
              <span class="line" data-rise><span>${esc(H.hero.titleLine1)}</span></span>
              <span class="line" data-rise style="--d:110ms"><span>${esc(H.hero.titleLine2)} <em class="serif">${esc(H.hero.titleAccent)}</em></span></span>
            </h1>
          </div>
        </div>

        <div class="hero__foot">
          <p class="lead hero__lead" data-fade style="--d:220ms">${esc(H.hero.lead)}</p>
          <div class="hero__actions" data-fade style="--d:300ms">
            <a class="btn btn--solid" href="${attr(urlFor(L, 'contact'))}"><span class="btn__text">${esc(H.hero.ctaPrimary)}</span>${ICON.arrow}</a>
            <a class="btn" href="#sherbime"><span class="btn__text">${esc(H.hero.ctaSecondary)}</span></a>
          </div>
        </div>
      </div>

      <div class="scroll-cue" aria-hidden="true">
        <span>${esc(L.ui.scroll)}</span>
        <span class="scroll-cue__rail"></span>
      </div>
    </section>

    ${marquee(L)}

    <!-- manifesto -->
    <section class="section">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(H.manifesto.eyebrow)}</span>
            <h2 class="display display--1" data-rise><span>${esc(L.brand.name)} <em class="serif">${esc(L.brand.since)}</em></span></h2>
          </div>
          <div class="shead__r">
            <p class="lead" data-fade>${esc(H.manifesto.statement)}</p>
          </div>
        </div>

        <div class="triad" data-stagger="110">
          ${H.manifesto.columns.map((c) => `<div class="triad__cell" data-soft>
            <h3 class="triad__t">${esc(c.title)}</h3>
            <p class="triad__b">${esc(c.body)}</p>
          </div>`).join('\n          ')}
        </div>
      </div>
    </section>

    <!-- service index -->
    <section class="section section--flush-top" id="sherbime">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(H.servicesIntro.eyebrow)}</span>
            <h2 class="display display--1" data-rise><span>${esc(H.servicesIntro.title)}</span></h2>
          </div>
          <div class="shead__r">
            <p data-fade>${esc(H.servicesIntro.body)}</p>
          </div>
        </div>

        <div class="index" data-stagger="80">
          ${L.services.map((s) => `<a class="idx" data-fade href="${attr(urlFor(L, s.id))}" data-cursor="${attr(L.ui.explore)}">
            <span class="idx__n">${esc(s.number)}</span>
            <span class="idx__t">${esc(s.title)}</span>
            <span class="idx__sum">${esc(s.summary)}</span>
            <span class="idx__go">${ICON.diag}</span>
            <span class="idx__peek" aria-hidden="true">${pic(s.image, { alt: '', sizes: '300px' })}</span>
          </a>`).join('\n          ')}
        </div>
      </div>
    </section>

    <!-- full-bleed band -->
    <section class="band" data-clip>
      <div class="band__media">${pic('workshop', { alt: L.brand.tagline, sizes: '100vw', parallax: '0.16' })}</div>
      <div class="band__inner">
        <h2 class="band__t" data-rise><span>${esc(H.materials.title)}</span></h2>
        <p class="band__b" data-fade>${esc(H.materials.body)}</p>
      </div>
    </section>

    <!-- forge: raymarched steel lattice -->
    <section class="forge" data-forge-section>
      <div class="forge__sticky">
        <div class="forge__stage" data-forge></div>
        <div class="forge__inner">
          <div class="forge__copy" data-stagger="100">
            <span class="eyebrow" data-fade>${esc(H.forge.eyebrow)}</span>
            <h2 class="forge__t" data-rise><span>${esc(H.forge.title)}</span></h2>
            <p class="forge__b" data-fade>${esc(H.forge.body)}</p>
            <span class="forge__hint" data-fade>
              <span class="on-hover">${esc(H.forge.hintHover)}</span>
              <span class="on-touch">${esc(H.forge.hintTouch)}</span>
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- materials -->
    <section class="section">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(H.materials.eyebrow)}</span>
            <h2 class="display display--1" data-rise><span>${esc(H.materials.title)}</span></h2>
          </div>
        </div>

        <div class="mats" data-stagger="80">
          ${H.materials.items.map((m, i) => `<div class="mat" data-scale>
            <span class="mat__sw mat__sw--${['hekur', 'zink', 'boje', 'inox'][i] || 'hekur'}" aria-hidden="true"></span>
            <span class="mat__s">${esc(m.spec)}</span>
            <h3 class="mat__n">${esc(m.name)}</h3>
            <p class="mat__b">${esc(m.body)}</p>
          </div>`).join('\n          ')}
        </div>
      </div>
    </section>

    <!-- process -->
    <section class="section section--flush-top">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(H.process.eyebrow)}</span>
            <h2 class="display display--1" data-rise><span>${esc(H.process.title)}</span></h2>
          </div>
          <div class="shead__r"><p data-fade>${esc(H.process.body)}</p></div>
        </div>

        <ol class="steps" data-stagger="70">
          ${H.process.steps.map((s, i) => `<li class="step" data-soft>
            <span class="step__n">${String(i + 1).padStart(2, '0')}</span>
            <h3 class="step__t">${esc(s.title)}</h3>
            <p class="step__b">${esc(s.body)}</p>
          </li>`).join('\n          ')}
        </ol>
      </div>
    </section>

    ${ctaBlock(L)}
  </main>

  ${footer(L, ALL, 'home')}
  ${tail({ forge: true })}`;
}

/* -------------------------------------------------------------------------
   PAGE: service
   ------------------------------------------------------------------------- */
function renderService(L, ALL, svc) {
  const trail = [
    { name: L.nav.home, url: urlFor(L, 'home') },
    { name: svc.title, url: urlFor(L, svc.id) },
  ];

  return `${head(L, ALL, {
    id: svc.id,
    seo: svc.seo,
    preloadHero: svc.image,
    extraLd: [ldBreadcrumb(L, trail), ldService(L, svc)],
  })}
<body>
  ${header(L, ALL, svc.id)}

  <main id="main">
    ${pageHero(L, {
      kicker: svc.kicker,
      l1: svc.titleLine1,
      l2: svc.titleLine2,
      lead: svc.lead,
      image: svc.image,
      trail,
    })}

    ${marquee(L)}

    <section class="section section--sm">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(L.ui.index)}</span>
            <h2 class="display display--1" data-rise><span>${esc(svc.title)}</span></h2>
          </div>
          <div class="shead__r">
            <p class="lead" data-fade>${esc(svc.summary)}</p>
            <ul class="speclist" style="width:100%">
              ${svc.bullets.map((b) => `<li>${esc(b)}</li>`).join('\n              ')}
            </ul>
          </div>
        </div>
      </div>
    </section>

    <div class="shell">
      ${svc.sections.map((sec) => `<article class="detail" id="${attr(sec.id)}">
        <div class="detail__media" data-clip>${pic(sec.image, {
          alt: `${sec.title}, ${L.brand.name}`,
          sizes: '(max-width: 900px) 100vw, 50vw',
        })}</div>

        <div class="detail__body" data-stagger="90">
          <div class="detail__head">
            <span class="eyebrow" data-fade><span class="num">${esc(sec.number)}</span>&nbsp;&nbsp;${esc(sec.kicker)}</span>
            <h2 class="detail__t" data-rise><span>${esc(sec.title)}</span></h2>
          </div>

          <div class="body-copy" data-fade>
            ${sec.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n            ')}
          </div>

          <ul class="speclist" data-fade>
            ${sec.bullets.map((b) => `<li>${esc(b)}</li>`).join('\n            ')}
          </ul>

          <div data-fade>
            <a class="btn" href="${attr(urlFor(L, 'contact'))}"><span class="btn__text">${esc(L.ui.requestQuote)}</span>${ICON.arrow}</a>
          </div>
        </div>
      </article>`).join('\n      ')}
    </div>

    <!-- other services -->
    <section class="section">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(L.ui.services)}</span>
            <h2 class="display display--2" data-rise><span>${esc(L.home.servicesIntro.title)}</span></h2>
          </div>
        </div>
        <div class="index" data-stagger="80">
          ${L.services.filter((s) => s.id !== svc.id).map((s) => `<a class="idx" data-fade href="${attr(urlFor(L, s.id))}" data-cursor="${attr(L.ui.explore)}">
            <span class="idx__n">${esc(s.number)}</span>
            <span class="idx__t">${esc(s.title)}</span>
            <span class="idx__sum">${esc(s.summary)}</span>
            <span class="idx__go">${ICON.diag}</span>
            <span class="idx__peek" aria-hidden="true">${pic(s.image, { alt: '', sizes: '300px' })}</span>
          </a>`).join('\n          ')}
        </div>
      </div>
    </section>

    ${ctaBlock(L)}
  </main>

  ${footer(L, ALL, svc.id)}
  ${tail()}`;
}

/* -------------------------------------------------------------------------
   PAGE: about
   ------------------------------------------------------------------------- */
function renderAbout(L, ALL) {
  const A = L.about;
  const trail = [
    { name: L.nav.home, url: urlFor(L, 'home') },
    { name: L.nav.about, url: urlFor(L, 'about') },
  ];

  return `${head(L, ALL, {
    id: 'about',
    seo: A.seo,
    preloadHero: 'workshop',
    extraLd: [ldBreadcrumb(L, trail), {
      '@type': 'AboutPage',
      '@id': `${SITE}${urlFor(L, 'about')}#about`,
      mainEntity: { '@id': `${SITE}/#org` },
    }, ...A.team.members.map((m) => ({
      '@type': 'Person',
      name: m.name,
      jobTitle: m.role,
      email: m.email,
      worksFor: { '@id': `${SITE}/#org` },
    }))],
  })}
<body>
  ${header(L, ALL, 'about')}

  <main id="main">
    ${pageHero(L, {
      kicker: A.kicker, l1: A.titleLine1, l2: A.titleLine2,
      lead: A.lead, image: 'workshop', trail,
    })}

    ${marquee(L)}

    <section class="section">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(A.story.eyebrow)}</span>
            <h2 class="display display--1" data-rise><span>${esc(A.story.title)}</span></h2>
          </div>
          <div class="shead__r">
            <div class="body-copy" data-fade>
              ${A.story.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n              ')}
            </div>
          </div>
        </div>

        <div class="shead" style="border-bottom:0;margin-bottom:0;padding-bottom:0">
          <div class="shead__l">
            <p class="eyebrow eyebrow--bare" data-fade>${esc(A.story.expansionIntro)}</p>
          </div>
          <div class="shead__r">
            <ul class="speclist" style="width:100%" data-fade>
              ${A.story.expansion.map((e) => `<li>${esc(e)}</li>`).join('\n              ')}
            </ul>
            <p class="lead" data-fade>${esc(A.story.closing)}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="band" data-clip>
      <div class="band__media">${pic('shkalle', { alt: A.story.title, sizes: '100vw', parallax: '0.16' })}</div>
      <div class="band__inner">
        <h2 class="band__t" data-rise><span>${esc(A.mission.title)}</span></h2>
      </div>
    </section>

    <section class="section">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(A.mission.eyebrow)}</span>
            <h2 class="display display--1" data-rise><span>${esc(A.mission.title)}</span></h2>
          </div>
          <div class="shead__r">
            <div class="body-copy" data-fade><p>${esc(A.mission.body)}</p></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section section--flush-top">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(A.team.eyebrow)}</span>
            <h2 class="display display--1" data-rise><span>${esc(A.team.title)}</span></h2>
          </div>
        </div>

        <div class="team" data-stagger="100">
          ${A.team.members.map((m) => `<div class="member" data-scale>
            <span class="member__r">${esc(m.role)}</span>
            <h3 class="member__n">${esc(m.name)}</h3>
            <a class="member__e" href="mailto:${attr(m.email)}">${esc(m.email)}</a>
          </div>`).join('\n          ')}
        </div>
      </div>
    </section>

    ${ctaBlock(L)}
  </main>

  ${footer(L, ALL, 'about')}
  ${tail()}`;
}

/* -------------------------------------------------------------------------
   PAGE: contact
   ------------------------------------------------------------------------- */
function renderContact(L, ALL) {
  const C = L.contact;
  const F = C.form;
  const trail = [
    { name: L.nav.home, url: urlFor(L, 'home') },
    { name: L.nav.contact, url: urlFor(L, 'contact') },
  ];

  const field = (name, label, control, required) => `<div class="field" data-fade>
            <label class="field__l" for="f-${name}">${esc(label)}${required ? '<sup>*</sup>' : ''}</label>
            <div class="field__c">${control}</div>
          </div>`;

  return `${head(L, ALL, {
    id: 'contact',
    seo: C.seo,
    preloadHero: 'materiale',
    extraLd: [ldBreadcrumb(L, trail), {
      '@type': 'ContactPage',
      '@id': `${SITE}${urlFor(L, 'contact')}#contact`,
      mainEntity: { '@id': `${SITE}/#org` },
    }],
  })}
<body>
  ${header(L, ALL, 'contact')}

  <main id="main">
    ${pageHero(L, {
      kicker: C.kicker, l1: C.titleLine1, l2: C.titleLine2,
      lead: C.lead, image: 'materiale', trail, compact: true,
    })}

    <section class="section">
      <div class="shell">
        <div class="shead">
          <div class="shead__l">
            <span class="eyebrow" data-fade>${esc(L.nav.contact)}</span>
            <h2 class="display display--1" data-rise><span>${esc(F.title)}</span></h2>
          </div>
          <div class="shead__r">
            <div class="stack" style="width:100%">
              <div class="cta__rows" data-fade>
                <div class="cta__row" data-fade>
                  <span class="cta__k">${esc(C.personLabel)}</span>
                  <span class="cta__v">${esc(C.person)}, ${esc(C.role)}</span>
                </div>
                <div class="cta__row" data-fade>
                  <span class="cta__k">${esc(L.ui.email)}</span>
                  <span class="cta__v"><a href="mailto:${attr(C.email)}">${esc(C.email)}</a></span>
                </div>
                <div class="cta__row" data-fade>
                  <span class="cta__k">${esc(L.ui.phone)}</span>
                  <span class="cta__v"><a href="tel:${attr(C.phoneRaw)}">${esc(C.phone)}</a></span>
                </div>
              ${socialLinks()}
                <div class="cta__row" data-fade>
                  <span class="cta__k">${esc(C.hoursLabel)}</span>
                  <span class="cta__v">${esc(C.hours)}</span>
                </div>
                <div class="cta__row" data-fade>
                  <span class="cta__k">${esc(C.areaLabel)}</span>
                  <span class="cta__v">${esc(C.area)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <form class="form" id="quote-form" data-stagger="70"
              action="mailto:${attr(C.email)}" method="post" enctype="text/plain"
              data-to="${attr(C.email)}" data-subject="${attr(L.brand.name)}">
          ${field('name', F.name, `<input id="f-name" name="name" type="text" required autocomplete="name" placeholder="${attr(F.namePlaceholder)}">`, true)}
          ${field('email', F.email, `<input id="f-email" name="email" type="email" required autocomplete="email" placeholder="${attr(F.emailPlaceholder)}">`, true)}
          ${field('phone', F.phone, `<input id="f-phone" name="phone" type="tel" autocomplete="tel" placeholder="${attr(F.phonePlaceholder)}">`)}
          ${field('service', F.service, `<select id="f-service" name="service">
              <option value="">${esc(F.servicePlaceholder)}</option>
              ${L.services.map((s) => `<option value="${attr(s.title)}">${esc(s.title)}</option>`).join('\n              ')}
            </select>`)}
          ${field('location', F.location, `<input id="f-location" name="location" type="text" placeholder="${attr(F.locationPlaceholder)}">`)}
          ${field('message', F.message, `<textarea id="f-message" name="message" rows="5" required placeholder="${attr(F.messagePlaceholder)}"></textarea>`, true)}

          <div class="form__foot" data-fade>
            <p class="form__note">${esc(F.note)}</p>
            <button class="btn btn--solid" type="submit" data-sending="${attr(F.sending)}">
              <span class="btn__text">${esc(F.submit)}</span>${ICON.arrow}
            </button>
          </div>

          <p class="form__msg form__msg--ok" role="status">${esc(F.success)}</p>
          <p class="form__msg form__msg--err" role="alert">${esc(F.error)}</p>
        </form>
      </div>
    </section>

    ${ctaBlock(L)}
  </main>

  ${footer(L, ALL, 'contact')}
  ${tail()}`;
}

/* -------------------------------------------------------------------------
   PAGE: 404
   ------------------------------------------------------------------------- */
function render404(L, ALL) {
  const N = L.notFound;
  return `${head(L, ALL, { id: '404', seo: N.seo, noindex: true })}
<body>
  ${header(L, ALL, '404', true)}
  <main id="main" class="pad-hdr">
    <div class="shell">
      <div class="nf">
        <span class="nf__code">${esc(N.code)}</span>
        <h1 class="display display--2">${esc(N.title)}</h1>
        <p class="lead" style="max-width:38ch">${esc(N.body)}</p>
        <a class="btn btn--solid" href="${attr(urlFor(L, 'home'))}"><span class="btn__text">${esc(N.action)}</span>${ICON.arrow}</a>
      </div>
    </div>
  </main>
  ${footer(L, ALL, '404')}
  ${tail()}`;
}

/* -------------------------------------------------------------------------
   site-level files
   ------------------------------------------------------------------------- */
function sitemap(ALL) {
  const pages = ['home', ...NAV_ORDER];
  const urls = [];

  for (const L of ALL) {
    for (const id of pages) {
      const loc = SITE + urlFor(L, id);
      const alts = ALL.map((O) =>
        `    <xhtml:link rel="alternate" hreflang="${O.meta.htmlLang}" href="${SITE + urlFor(O, id)}"/>`
      ).join('\n');
      const xdefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE + urlFor(ALL.find((O) => O.meta.isDefault), id)}"/>`;

      // No <lastmod>: a uniform build-date on every URL is worse than an
      // absent one, because crawlers learn to distrust the field.
      urls.push(`  <url>
    <loc>${loc}</loc>
    <changefreq>${id === 'home' ? 'weekly' : 'monthly'}</changefreq>
    <priority>${id === 'home' ? '1.0' : id === 'contact' ? '0.9' : '0.8'}</priority>
${alts}
${xdefault}
  </url>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

function robots() {
  return `# 2DY
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
}

function webmanifest(L) {
  return json({
    name: `${L.brand.name}: ${L.brand.tagline}`,
    short_name: L.brand.name,
    description: L.home.seo.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0C0D',
    theme_color: '#0B0C0D',
    lang: L.meta.htmlLang,
    icons: [
      { src: '/assets/img/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/img/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/img/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  });
}

/** Cloudflare Pages headers — caching + baseline security. */
function headers() {
  // Pages are served at clean URLs, so a "/*.html" rule would match nothing.
  // The default below therefore applies to every HTML response, and the more
  // specific /assets/ rules override it for static files.
  //
  // CSS and JS filenames are NOT content-hashed yet, so they get a short TTL
  // plus stale-while-revalidate rather than a year of immutable caching — a
  // deploy must not leave visitors on last week's stylesheet. Fonts and
  // images ARE effectively immutable (their names encode their content), so
  // they keep the long TTL.
  // NOTE: Cloudflare Pages APPENDS the values of every _headers rule that
  // matches, it does not replace. Setting Cache-Control here as well as in
  // the /assets blocks below produced
  //   "max-age=0, must-revalidate, public, max-age=300, ..."
  // and browsers take the first max-age, so nothing was ever cached.
  // HTML is therefore left to Pages' own default, which is already
  // "public, max-age=0, must-revalidate" — exactly what we want.
  return `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/assets/img/*
  Cache-Control: public, max-age=2592000, stale-while-revalidate=604800

/assets/video/*
  Cache-Control: public, max-age=2592000, stale-while-revalidate=604800

/assets/css/*
  Cache-Control: public, max-age=300, stale-while-revalidate=86400

/assets/js/*
  Cache-Control: public, max-age=300, stale-while-revalidate=86400

/assets/brand/*
  Cache-Control: public, max-age=2592000, stale-while-revalidate=604800
`;
}

/** 301s so the old .html URLs keep whatever equity they have. */
function redirects(DEFAULT) {
  const map = {
    '/index.html': urlFor(DEFAULT, 'home'),
    '/sherbime-hekur.html': urlFor(DEFAULT, 'hekur'),
    '/sherbime-arkitekture.html': urlFor(DEFAULT, 'arkitekture'),
    '/sherbime-mirembajtje.html': urlFor(DEFAULT, 'mirembajtje'),
    '/sherbime-projekte.html': urlFor(DEFAULT, 'projekte'),
    '/rreth-nesh.html': urlFor(DEFAULT, 'about'),
  };

  return [
    '# Legacy URLs from the previous site',
    ...Object.entries(map).map(([from, to]) => `${from}  ${to}  301`),
    '',
    '# Convenience',
    `/sq/*  /:splat  301`,
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------------
   main
   ------------------------------------------------------------------------- */
async function main() {
  const t0 = Date.now();

  // manifest
  const manifestPath = path.join(SRC, 'assets', 'img', 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error('\n  Missing image manifest. Run: npm run images\n');
    process.exit(1);
  }
  IMAGES = JSON.parse(await readFile(manifestPath, 'utf8'));

  // locales — default first, then alphabetical
  const localeDir = path.join(SRC, 'locales');
  const files = (await readdir(localeDir)).filter((f) => f.endsWith('.json'));
  const ALL = [];
  for (const f of files) {
    ALL.push(JSON.parse(await readFile(path.join(localeDir, f), 'utf8')));
  }
  ALL.sort((a, b) =>
    a.meta.isDefault ? -1 : b.meta.isDefault ? 1 : a.meta.code.localeCompare(b.meta.code)
  );

  const DEFAULT = ALL.find((L) => L.meta.isDefault);
  if (!DEFAULT) throw new Error('No locale is marked isDefault.');

  // clean html output but keep the generated images
  for (const entry of existsSync(DIST) ? await readdir(DIST) : []) {
    if (entry === 'assets') continue;
    await rm(path.join(DIST, entry), { recursive: true, force: true });
  }
  // cp() merges rather than replaces, so a deleted source file would linger
  // in dist forever and still get deployed. Prune the copied trees first.
  // assets/img is spared — it is owned by the image pipeline, not this script.
  for (const d of ['css', 'js', 'fonts', 'brand']) {
    await rm(path.join(DIST, 'assets', d), { recursive: true, force: true });
  }
  await mkdir(DIST, { recursive: true });

  // static assets
  await cp(path.join(SRC, 'assets', 'css'), path.join(DIST, 'assets', 'css'), { recursive: true });
  await cp(path.join(SRC, 'assets', 'js'), path.join(DIST, 'assets', 'js'), { recursive: true });
  await cp(path.join(SRC, 'assets', 'fonts'), path.join(DIST, 'assets', 'fonts'), { recursive: true });
  await cp(path.join(SRC, 'assets', 'brand'), path.join(DIST, 'assets', 'brand'), { recursive: true });

  // pages
  let count = 0;
  const write = async (file, html) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html, 'utf8');
    count++;
  };

  for (const L of ALL) {
    await write(fileFor(L, 'home'), renderHome(L, ALL));
    for (const svc of L.services) {
      await write(fileFor(L, svc.id), renderService(L, ALL, svc));
    }
    await write(fileFor(L, 'about'), renderAbout(L, ALL));
    await write(fileFor(L, 'contact'), renderContact(L, ALL));

    console.log(`  ${L.meta.code}  ${L.meta.name.padEnd(12)} ${L.services.length + 3} pages`);
  }

  // Cloudflare Pages serves this one file for every unmatched route, so
  // per-locale 404 directories would only ever exist as indexable 200 URLs.
  await writeFile(path.join(DIST, '404.html'), render404(DEFAULT, ALL), 'utf8');

  // site files
  await writeFile(path.join(DIST, 'sitemap.xml'), sitemap(ALL), 'utf8');
  await writeFile(path.join(DIST, 'robots.txt'), robots(), 'utf8');
  await writeFile(path.join(DIST, 'site.webmanifest'), webmanifest(DEFAULT), 'utf8');
  await writeFile(path.join(DIST, '_headers'), headers(), 'utf8');
  await writeFile(path.join(DIST, '_redirects'), redirects(DEFAULT), 'utf8');

  // A page that silently lost its artwork looks fine in the build log and
  // broken in the browser, so treat it as a build failure.
  if (MISSING_IMAGES.size) {
    console.error(
      `\n  Build failed — ${MISSING_IMAGES.size} image(s) referenced but not in the manifest:\n` +
      [...MISSING_IMAGES].map((n) => `    · ${n}`).join('\n') +
      `\n\n  Add the source file to src/assets/img/ and run: npm run images\n`
    );
    process.exit(1);
  }

  console.log(
    `\n  ${count} pages · ${ALL.length} languages · ${Date.now() - t0}ms` +
    `\n  ${SITE}\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
