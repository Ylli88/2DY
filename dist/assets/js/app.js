/* =========================================================================
   2DY — front-end
   Zero dependencies. Everything degrades: with JS off you still get a
   complete, readable, navigable site.
   ========================================================================= */
(() => {
  'use strict';

  const doc = document;
  const root = doc.documentElement;
  const body = doc.body;

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const $ = (sel, ctx = doc) => ctx.querySelector(sel);
  const $$ = (sel, ctx = doc) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const lerp = (a, b, t) => a + (b - a) * t;

  /**
   * Run fn on the next painted frame — but never rely on that alone.
   * requestAnimationFrame is starved in a background tab, and anything that
   * starts life at opacity 0 waiting for it would stay invisible until the
   * tab is focused. Backgrounded loads are ordinary (cmd-click, session
   * restore, prerender), so a timer and a visibility change both race it.
   * fn must be idempotent.
   */
  function nextPaint(fn, fallback = 400) {
    let done = false;
    const once = () => { if (!done) { done = true; fn(); } };
    requestAnimationFrame(() => requestAnimationFrame(once));
    window.setTimeout(once, fallback);
    doc.addEventListener('visibilitychange', once, { once: true });
  }

  /* ---------------------------------------------------------------------
     1. SMOOTH SCROLL
     Wheel is intercepted and eased toward a target via window.scrollTo, so
     position:fixed, sticky headers and the accessibility tree all keep
     working. Touch keeps native momentum — it is better than anything we
     would fake.
     --------------------------------------------------------------------- */
  const Scroll = (() => {
    let target = window.scrollY;
    let current = window.scrollY;
    let running = false;
    let enabled = !REDUCED && FINE_POINTER;
    let raf = null;
    // Last position we wrote ourselves. If the page has moved to somewhere
    // else since, something outside this module scrolled it (find-in-page,
    // a focus jump, the scrollbar, a keyboard PageDown) and we must yield
    // instead of dragging the user back to our own target.
    let lastWritten = -1;

    const maxScroll = () =>
      Math.max(0, doc.body.scrollHeight - window.innerHeight);

    const write = (y) => {
      window.scrollTo(0, y);
      lastWritten = y;
    };

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      target = current = window.scrollY;
      lastWritten = -1;
    }

    function tick() {
      if (lastWritten >= 0 && Math.abs(window.scrollY - lastWritten) > 2) {
        stop();
        onScroll();
        return;
      }

      // 0.085 rather than 0.11: a longer tail, so the page keeps gliding for
      // a beat after the wheel stops instead of arriving abruptly.
      current = lerp(current, target, 0.085);

      if (Math.abs(target - current) < 0.4) {
        current = target;
        running = false;
        write(Math.round(current));
        onScroll();
        raf = null;
        return;
      }

      write(Math.round(current));
      onScroll();
      raf = requestAnimationFrame(tick);
    }

    function start() {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    }

    /**
     * True if the pointer is over something that scrolls on its own — the
     * overlay menu, a textarea with overflow, anything marked
     * data-native-scroll. Walking the ancestors (rather than checking one
     * attribute) means new scrollable UI works without being tagged.
     */
    function overNativeScroller(node, dy) {
      for (let n = node; n && n !== body; n = n.parentElement) {
        if (n.nodeType !== 1) continue;
        if (n.hasAttribute('data-native-scroll')) return true;
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
          const atTop = n.scrollTop <= 0;
          const atBottom = n.scrollTop + n.clientHeight >= n.scrollHeight - 1;
          // Only hand over while it still has room to move in that direction,
          // so the page keeps scrolling once the child bottoms out.
          if ((dy < 0 && !atTop) || (dy > 0 && !atBottom)) return true;
        }
      }
      return false;
    }

    function onWheel(e) {
      if (!enabled) return;
      if (body.classList.contains('menu-open')) return;
      // let the browser handle zoom and horizontal intent
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (overNativeScroller(e.target, e.deltaY)) return;

      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
      target = clamp(target + delta, 0, maxScroll());
      start();
    }

    // Anything that moves the page outside our control resyncs the target.
    function sync() {
      if (!running) {
        target = window.scrollY;
        current = window.scrollY;
      }
    }

    function to(y, instant) {
      target = clamp(y, 0, maxScroll());
      if (instant || !enabled) {
        current = target;
        write(target);
        onScroll();
      } else {
        lastWritten = Math.round(current);
        start();
      }
    }

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', () => {
      target = clamp(target, 0, maxScroll());
      sync();
    }, { passive: true });

    return {
      to,
      get y() { return window.scrollY; },
      disable() { enabled = false; stop(); },
      enable() { enabled = !REDUCED && FINE_POINTER; sync(); },
    };
  })();

  /* ---------------------------------------------------------------------
     2. CUSTOM CURSOR — circle, difference blend
     --------------------------------------------------------------------- */
  function initCursor() {
    if (!FINE_POINTER || REDUCED) return;
    // mix-blend-mode: difference actively fights a user-chosen high-contrast
    // palette, so the cursor is never created there.
    if (window.matchMedia('(forced-colors: active)').matches) return;

    const cur = doc.createElement('div');
    cur.className = 'cursor';
    cur.setAttribute('aria-hidden', 'true');
    const label = doc.createElement('span');
    label.className = 'cursor__label';
    cur.appendChild(label);
    body.appendChild(cur);

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let cx = mx, cy = my;
    let visible = false;

    function render() {
      cx = lerp(cx, mx, 0.19);
      cy = lerp(cy, my, 0.19);
      cur.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    window.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      if (!visible) {
        visible = true;
        body.classList.add('cursor-ready');
      }
    }, { passive: true });

    doc.addEventListener('mouseleave', () => body.classList.remove('cursor-ready'));
    doc.addEventListener('mouseenter', () => body.classList.add('cursor-ready'));

    const HOT = 'a, button, input, textarea, select, summary, [role="button"], label';

    doc.addEventListener('mouseover', (e) => {
      const labelled = e.target.closest('[data-cursor]');
      if (labelled) {
        label.textContent = labelled.dataset.cursor;
        cur.classList.add('is-labelled');
        cur.classList.remove('is-hot');
        return;
      }
      if (e.target.closest(HOT)) {
        cur.classList.add('is-hot');
        cur.classList.remove('is-labelled');
      }
    });

    doc.addEventListener('mouseout', (e) => {
      const stillLabelled = e.relatedTarget && e.relatedTarget.closest?.('[data-cursor]');
      const stillHot = e.relatedTarget && e.relatedTarget.closest?.(HOT);
      if (!stillLabelled) cur.classList.remove('is-labelled');
      if (!stillHot && !stillLabelled) cur.classList.remove('is-hot');
    });
  }

  /* ---------------------------------------------------------------------
     3. REVEALS
     --------------------------------------------------------------------- */
  /**
   * Every reveal variant, in one place. Each of these starts life hidden in
   * CSS and only becomes visible once `.is-in` lands, so anything missing
   * from this list is invisible forever — declare new variants here.
   */
  const REVEAL_SELECTOR =
    '[data-rise], [data-fade], [data-draw], [data-clip], [data-scale], [data-wipe], [data-soft]';

  function initReveals() {
    const items = $$(REVEAL_SELECTOR);
    if (!items.length) return;

    if (REDUCED || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }

    // Stagger anything that declares itself part of a group.
    $$('[data-stagger]').forEach((group) => {
      const step = parseInt(group.dataset.stagger, 10) || 80;
      $$(REVEAL_SELECTOR, group)
        .forEach((el, i) => el.style.setProperty('--d', `${i * step}ms`));
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -9% 0px', threshold: 0.06 });

    const immediate = [];

    items.forEach((el) => {
      // Anything already on screen at load animates immediately rather than
      // waiting for a scroll that may never come.
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) immediate.push(el);
      else io.observe(el);
    });

    if (immediate.length) {
      nextPaint(() => immediate.forEach((el) => el.classList.add('is-in')));
    }

    /* Safety net. Everything above starts at opacity 0 and depends on this
       module to become visible, so any failure here hides real content —
       the worst possible failure mode for a page whose job is to be read.
       If something is still hidden well after load, reveal it regardless.
       A late entrance is a blemish; invisible copy is a broken site. */
    window.setTimeout(() => {
      items.forEach((el) => {
        if (el.classList.contains('is-in')) return;
        const r = el.getBoundingClientRect();
        // Only rescue what is actually on screen — anything below the fold
        // is legitimately still waiting for its observer.
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
      });
    }, 2600);
  }

  /* ---------------------------------------------------------------------
     4. SPLIT TEXT — per-character stagger on the hero
     --------------------------------------------------------------------- */
  function initSplit() {
    if (REDUCED) return;

    $$('[data-split]').forEach((el) => {
      const step = parseFloat(el.dataset.split) || 26;
      const text = el.textContent;
      const frag = doc.createDocumentFragment();
      let n = 0;

      // Preserve the accessible string; only the visual layer is chopped up.
      el.setAttribute('aria-label', text.trim());

      text.split('').forEach((ch) => {
        if (ch === ' ') {
          frag.appendChild(doc.createTextNode(' '));
          return;
        }
        const span = doc.createElement('span');
        span.className = 'char';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = ch;
        span.style.transitionDelay = `${n * step}ms`;
        frag.appendChild(span);
        n++;
      });

      el.textContent = '';
      el.appendChild(frag);
    });
  }

  /* ---------------------------------------------------------------------
     5. PARALLAX
     --------------------------------------------------------------------- */
  const parallax = [];

  /* Scroll velocity, smoothed. Drives a barely-there vertical stretch on the
     media — the thing that makes a smooth-scrolled page feel like one
     continuous surface rather than a stack of static blocks. */
  let velocity = 0;
  let lastY = window.scrollY;

  function initParallax() {
    if (REDUCED) return;
    $$('[data-parallax]').forEach((el) => {
      parallax.push({ el, amount: parseFloat(el.dataset.parallax) || 0.14 });
    });
  }

  function runParallax() {
    const y = window.scrollY;
    const raw = clamp((y - lastY) / 34, -1, 1);
    velocity = lerp(velocity, raw, 0.16);
    lastY = y;

    if (!parallax.length) return;
    const vh = window.innerHeight;

    // Capped hard: past ~1.5% it stops reading as momentum and starts
    // reading as a rendering bug.
    const stretch = 1 + Math.abs(velocity) * 0.015;
    const squash = 1 - Math.abs(velocity) * 0.006;

    parallax.forEach(({ el, amount }) => {
      const host = el.parentElement || el;
      const r = host.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;

      // -1 above the fold … +1 below it
      const progress = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      const shift = -progress * amount * 100;
      el.style.transform =
        `translate3d(0, ${shift.toFixed(2)}px, 0) scale(${(1.14 * squash).toFixed(4)}, ${(1.14 * stretch).toFixed(4)})`;
    });
  }

  /* ---------------------------------------------------------------------
     6. HEADER
     --------------------------------------------------------------------- */
  function initHeader() {
    const hdr = $('.hdr');
    if (!hdr) return;

    const hero = $('.hero');
    let last = window.scrollY;

    function update() {
      const y = window.scrollY;
      // Condense once we clear the hero (or 70vh if there isn't one).
      const trigger = hero ? hero.offsetHeight - 90 : window.innerHeight * 0.7;

      hdr.classList.toggle('is-condensed', y > trigger);

      // Hide on the way down, reveal on the way up — but never over the hero
      // and never while the menu is open.
      const goingDown = y > last && y > trigger + 160;
      if (!body.classList.contains('menu-open')) {
        hdr.classList.toggle('is-hidden', goingDown);
      }

      last = y;
    }

    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ---------------------------------------------------------------------
     7. OVERLAY MENU
     --------------------------------------------------------------------- */
  function initMenu() {
    const burger = $('.burger');
    const menu = $('.menu');
    if (!burger || !menu) return;

    let lastFocus = null;

    // Everything behind the overlay goes inert so it leaves the tab order
    // and the accessibility tree. The burger is the close control and lives
    // in the header, so the header's OTHER children are inerted one by one
    // rather than the header itself (inert is inherited and cannot be
    // lifted on a descendant).
    const behind = () => [
      $('#main'), $('.ftr'),
      $('.hdr .brand'), $('.hdr .nav'), $('.hdr .lang'), $('.hdr__end > .btn'),
    ].filter(Boolean);

    const setInert = (on) => {
      behind().forEach((el) => {
        if (on) {
          el.setAttribute('inert', '');
          el.setAttribute('aria-hidden', 'true');
        } else {
          el.removeAttribute('inert');
          el.removeAttribute('aria-hidden');
        }
      });
    };

    const setOpen = (open) => {
      body.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-hidden', String(!open));

      if (open) {
        lastFocus = doc.activeElement;
        Scroll.disable();
        body.style.overflow = 'hidden';
        setInert(true);
        // stagger the links in
        $$('.menu__link', menu).forEach((l, i) => {
          l.style.transitionDelay = `${120 + i * 60}ms`;
        });
        const first = $('.menu__link', menu);
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 340);
      } else {
        Scroll.enable();
        body.style.overflow = '';
        setInert(false);
        $$('.menu__link', menu).forEach((l) => { l.style.transitionDelay = ''; });
        // inert must be lifted before focus can land back on the burger.
        // Restoring to <body> would strand a keyboard user at the top of
        // the document, so the burger is the floor.
        const back = lastFocus && lastFocus !== body && doc.contains(lastFocus)
          ? lastFocus
          : burger;
        back.focus({ preventScroll: true });
      }
    };

    burger.addEventListener('click', () =>
      setOpen(!body.classList.contains('menu-open'))
    );

    $$('a', menu).forEach((a) =>
      a.addEventListener('click', () => setOpen(false))
    );

    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && body.classList.contains('menu-open')) setOpen(false);
    });

    // Keep Tab inside the dialog. The cycle is the burger (which is the
    // close control, outside the sheet) followed by everything in the sheet.
    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !body.classList.contains('menu-open')) return;
      const inSheet = $$('a, button', menu).filter((el) => el.offsetParent !== null);
      const f = [burger, ...inSheet];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------------------------------------------------------------------
     8. LANGUAGE DROPDOWN
     --------------------------------------------------------------------- */
  function initLang() {
    $$('.lang').forEach((wrap) => {
      const btn = $('.lang__btn', wrap);
      if (!btn) return;

      const close = (restoreFocus) => {
        if (!wrap.classList.contains('is-open')) return;
        // Escape while focus is inside the panel must not drop it to <body>
        if (restoreFocus && wrap.contains(doc.activeElement)) {
          btn.focus({ preventScroll: true });
        }
        wrap.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      };

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = wrap.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', String(open));
      });

      doc.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) close();
      });

      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(true);
      });

      // tabbing out of the panel closes it
      wrap.addEventListener('focusout', (e) => {
        if (!wrap.contains(e.relatedTarget)) close(false);
      });
    });
  }

  /* ---------------------------------------------------------------------
     9. ANCHORS
     --------------------------------------------------------------------- */
  function initAnchors() {
    doc.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (!id || id === '#') return;

      const t = doc.querySelector(id);
      if (!t) return;

      e.preventDefault();
      // parseFloat('clamp(62px, 7vh, 84px)') is NaN — an unregistered custom
      // property returns its literal token, not a resolved value. Measure
      // the header instead; it already has height: var(--hdr-h).
      const hdrEl = $('.hdr');
      const hdrH = hdrEl ? hdrEl.getBoundingClientRect().height : 72;
      const y = t.getBoundingClientRect().top + window.scrollY - hdrH - 12;
      Scroll.to(y);
      history.replaceState(null, '', id);
      t.setAttribute('tabindex', '-1');
      t.focus({ preventScroll: true });
    });
  }

  /* ---------------------------------------------------------------------
     10. PAGE TRANSITIONS
     --------------------------------------------------------------------- */
  function initTransitions() {
    if (REDUCED) return;
    if (!$('.veil')) return;

    // Fade the veil away on arrival.
    body.classList.add('is-entering');
    window.setTimeout(() => body.classList.remove('is-entering'), 900);

    let leaving = false;
    let leaveTimer = null;

    // If navigation never happens — a blocked popup, a cancelled unload, a
    // download that opens in place — the veil must not stay down over the
    // page forever.
    const heal = () => {
      leaving = false;
      if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      body.classList.remove('is-leaving');
    };

    doc.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;

      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (a.target === '_blank' || a.hasAttribute('download') || a.dataset.noTransition !== undefined) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

      let url;
      try { url = new URL(a.href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname) return;

      e.preventDefault();
      if (leaving) return;
      leaving = true;
      body.classList.add('is-leaving');
      leaveTimer = window.setTimeout(() => { location.href = url.href; }, 480);
      // nothing happened after 3s? lift the veil rather than trap the page
      window.setTimeout(() => { if (leaving) heal(); }, 3000);
    });

    window.addEventListener('pagehide', heal);

    // Coming back via bfcache must not leave the veil down.
    window.addEventListener('pageshow', (ev) => {
      if (ev.persisted) heal();
    });
  }

  /* ---------------------------------------------------------------------
     9b. INTRO
     Tracks what is genuinely still loading — the fonts and the hero plate —
     rather than animating a fake timer. Hard-capped at 2.2s so a slow
     connection never turns the entrance into a wall, and shown once per
     session so returning visitors go straight to the page.
     --------------------------------------------------------------------- */
  function initIntro() {
    const intro = $('#intro');
    if (!intro) return;

    const done = () => {
      intro.remove();
      // both classes, or the body keeps a stale intro-done that would
      // pre-clip anything mounted with the .intro class later
      body.classList.remove('intro-active', 'intro-done');
    };

    // Reduced motion, or already seen this session: skip it entirely.
    let seen = false;
    try { seen = sessionStorage.getItem('2dy-intro') === '1'; } catch { /* private mode */ }
    if (REDUCED || seen) { done(); return; }

    try { sessionStorage.setItem('2dy-intro', '1'); } catch { /* ignore */ }

    body.classList.add('intro-active');
    intro.classList.add('is-running');

    const weld = $('.intro__weld', intro);
    const pct = $('.intro__pct', intro);

    let shown = 0;      // what the bar is displaying
    let finished = false;
    const started = performance.now();
    const MIN = 900;    // let the animation read as deliberate
    const MAX = 2200;   // never hold the page longer than this

    /* Real signals, weighted. Each resolves to 0..1. */
    const heroImg = $('.hero__media img');
    const signals = [
      // fonts
      new Promise((res) => {
        if (!doc.fonts) return res();
        doc.fonts.ready.then(res, res);
      }),
      // the hero plate — the thing the visitor is about to look at
      new Promise((res) => {
        if (!heroImg) return res();
        if (heroImg.complete && heroImg.naturalWidth) return res();
        heroImg.addEventListener('load', res, { once: true });
        heroImg.addEventListener('error', res, { once: true });
      }),
    ];

    let landed = 0;
    signals.forEach((p) => p.then(() => { landed++; }));

    function finish() {
      if (finished) return;
      finished = true;
      shown = 100;
      weld.style.width = '100%';
      pct.textContent = '100';
      intro.classList.remove('is-running');
      intro.classList.add('is-done');
      // let the seam visibly cool before lifting
      window.setTimeout(() => {
        body.classList.add('intro-done');
        window.setTimeout(done, 950);
      }, 260);
    }

    function tick(now) {
      const elapsed = now - started;

      // real progress, plus a floor that creeps so it never looks stalled
      const real = (landed / signals.length) * 100;
      const creep = Math.min(88, (elapsed / MAX) * 88);
      const target = Math.max(real, creep);

      shown += (target - shown) * 0.12;
      const v = Math.min(99, Math.round(shown));
      weld.style.width = v + '%';
      pct.textContent = String(v);

      const ready = landed === signals.length && elapsed > MIN;
      if (ready || elapsed > MAX) { finish(); return; }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);

    // rAF is starved in a background tab — never leave the page behind a veil
    window.setTimeout(finish, MAX + 400);
  }

  /* ---------------------------------------------------------------------
     10b. HERO VIDEO
     The poster image is already painted. The video only replaces it once it
     has enough data to play smoothly, and never on reduced-motion or on a
     metered connection.
     --------------------------------------------------------------------- */
  function initHeroVideo() {
    const vid = $('.hero__video');
    if (!vid) return;

    if (REDUCED) { vid.remove(); return; }

    const conn = navigator.connection;
    if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ''))) {
      vid.remove();
      return;
    }

    const reveal = () => vid.classList.add('is-playing');
    if (vid.readyState >= 3) reveal();
    else vid.addEventListener('canplay', reveal, { once: true });

    vid.addEventListener('error', () => vid.remove(), { once: true });

    const play = () => { const p = vid.play(); if (p) p.catch(() => {}); };
    play();

    // Stop decoding while the hero is off-screen — it is a decorative loop,
    // not something anyone scrolls back up to watch.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((e) => (e.isIntersecting ? play() : vid.pause()));
      }, { threshold: 0.05 }).observe(vid);
    }
  }

  /* ---------------------------------------------------------------------
     11. BLUR-UP IMAGES
     --------------------------------------------------------------------- */
  function initImages() {
    $$('img[data-lqip]').forEach((img) => {
      const done = () => {
        img.style.filter = '';
        img.style.transform = '';
        img.removeAttribute('data-lqip');
      };
      if (img.complete && img.naturalWidth) done();
      else img.addEventListener('load', done, { once: true });
    });
  }

  /* ---------------------------------------------------------------------
     12. MARQUEE — duplicate the track so the loop is seamless
     --------------------------------------------------------------------- */
  function initMarquee() {
    $$('.marq').forEach((m) => {
      const track = $('.marq__track', m);
      if (!track || track.dataset.cloned) return;
      track.dataset.cloned = '1';
      // Clone until the strip is at least twice the container, otherwise an
      // ultrawide display outruns the track and shows an empty gap.
      let guard = 0;
      do {
        const clone = track.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        m.appendChild(clone);
      } while (m.scrollWidth < m.clientWidth * 2 && ++guard < 8);
    });
  }

  /* ---------------------------------------------------------------------
     13. INDEX ROW — thumbnail follows the pointer
     --------------------------------------------------------------------- */
  function initIndexPeek() {
    if (!FINE_POINTER || REDUCED) return;

    $$('.idx').forEach((row) => {
      const peek = $('.idx__peek', row);
      if (!peek) return;

      let tx = 0, ty = 0, x = 0, y = 0, active = false, raf = null;

      const loop = () => {
        const prevX = x;
        x = lerp(x, tx, 0.13);
        y = lerp(y, ty, 0.13);
        peek.style.left = `${x}px`;
        peek.style.top = `${y}px`;
        // lean into the direction of travel, like a card held in the hand
        const lean = clamp((x - prevX) * 1.4, -14, 14);
        peek.style.setProperty('--peek-rot', `${lean.toFixed(2)}deg`);
        if (active) raf = requestAnimationFrame(loop);
        else raf = null;
      };

      // Clamp the TARGET, not the eased value, so the motion stays smooth.
      // Half the thumb has to stay inside the row or it is sliced by the
      // viewport edge at the start and end of a wide row.
      const place = (e) => {
        const r = row.getBoundingClientRect();
        const half = peek.offsetWidth / 2 || 150;
        tx = clamp(e.clientX - r.left, half, Math.max(half, r.width - half));
        ty = clamp(e.clientY - r.top, 0, r.height);
      };

      row.addEventListener('mouseenter', (e) => {
        place(e);
        x = tx; y = ty;
        active = true;
        if (!raf) raf = requestAnimationFrame(loop);
      });

      row.addEventListener('mousemove', place);

      row.addEventListener('mouseleave', () => { active = false; });
    });
  }

  /* ---------------------------------------------------------------------
     13a. MAGNETIC BUTTONS
     The button leans a few pixels toward the pointer while it is inside,
     and springs back on leave. Small enough to feel like weight rather
     than a gimmick.
     --------------------------------------------------------------------- */
  function initMagnetic() {
    if (!FINE_POINTER || REDUCED) return;

    $$('.btn, .idx__go').forEach((el) => {
      let raf = null, tx = 0, ty = 0, x = 0, y = 0, active = false;

      const run = () => {
        x = lerp(x, tx, 0.2);
        y = lerp(y, ty, 0.2);
        el.style.setProperty('--mx', `${x.toFixed(2)}px`);
        el.style.setProperty('--my', `${y.toFixed(2)}px`);
        if (active || Math.abs(x) > 0.05 || Math.abs(y) > 0.05) raf = requestAnimationFrame(run);
        else { raf = null; el.style.removeProperty('--mx'); el.style.removeProperty('--my'); }
      };
      const kick = () => { if (!raf) raf = requestAnimationFrame(run); };

      el.addEventListener('pointerenter', () => { active = true; kick(); });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        // capped in px, so a wide button does not slide further than a small one
        tx = Math.max(-7, Math.min(7, (e.clientX - (r.left + r.width / 2)) * 0.28));
        ty = Math.max(-5, Math.min(5, (e.clientY - (r.top + r.height / 2)) * 0.32));
      });
      el.addEventListener('pointerleave', () => { active = false; tx = 0; ty = 0; kick(); });
    });
  }

  /* ---------------------------------------------------------------------
     13b. MATERIAL SAMPLES — 3D tilt + sheen
     The swatch rotates toward the pointer and its highlight sweeps the
     opposite way, so a flat gradient behaves like a slab being turned to
     the light. Pointer-only: on touch the samples stay flat and static.
     --------------------------------------------------------------------- */
  function initMaterialTilt() {
    if (!FINE_POINTER || REDUCED) return;

    $$('.mat').forEach((card) => {
      const sw = $('.mat__sw', card);
      if (!sw) return;

      let raf = null;
      let tx = 0, ty = 0, x = 0, y = 0, active = false;

      const apply = () => {
        x = lerp(x, tx, 0.18);
        y = lerp(y, ty, 0.18);

        sw.style.setProperty('--ry', `${(x * 13).toFixed(2)}deg`);
        sw.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
        // sheen travels against the tilt
        sw.style.setProperty('--sx', `${(-x * 26).toFixed(1)}%`);
        sw.style.setProperty('--sy', `${(y * 20).toFixed(1)}%`);
        sw.style.setProperty('--sheen-a', `${(118 + x * 34).toFixed(0)}deg`);
        card.style.transform = `translateY(${(-Math.abs(x) - Math.abs(y)).toFixed(2)}px)`;

        if (active || Math.abs(x - tx) > 0.001 || Math.abs(y - ty) > 0.001) {
          raf = requestAnimationFrame(apply);
        } else {
          raf = null;
        }
      };

      const kick = () => { if (!raf) raf = requestAnimationFrame(apply); };

      card.addEventListener('pointerenter', () => { active = true; kick(); });

      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        tx = ((e.clientX - r.left) / r.width) * 2 - 1;
        ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      });

      card.addEventListener('pointerleave', () => {
        active = false;
        tx = 0; ty = 0;
        kick();
      });
    });
  }

  /* ---------------------------------------------------------------------
     14. CONTACT FORM
     --------------------------------------------------------------------- */
  function initForm() {
    const form = $('#quote-form');
    if (!form) return;

    const ok = $('.form__msg--ok', form);
    const err = $('.form__msg--err', form);
    const submit = $('button[type="submit"]', form);
    const label = submit ? submit.querySelector('.btn__text') : null;
    const original = label ? label.textContent : '';

    let sending = false;

    const setSending = (on) => {
      sending = on;
      if (!submit) return;
      // aria-disabled rather than .disabled: a disabled button is removed
      // from the tab order, which throws keyboard focus to <body>.
      submit.setAttribute('aria-disabled', String(on));
      if (label) label.textContent = on ? (submit.dataset.sending || original) : original;
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (sending) return;

      ok?.classList.remove('is-on');
      err?.classList.remove('is-on');

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const data = Object.fromEntries(new FormData(form).entries());

      // No backend is wired yet, so compose a fully-populated mail draft.
      // Replace this block with a fetch() POST to a form endpoint and the
      // success/error branches below already do the right thing.
      const to = form.dataset.to || '';
      const subject = `${form.dataset.subject || 'Website'} — ${data.name || ''}`.trim();
      const lines = Object.entries(data)
        .filter(([, v]) => String(v).trim())
        .map(([k, v]) => `${k}: ${v}`);

      const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;

      setSending(true);

      try {
        // Over-long mailto: URLs are silently dropped by some clients, so
        // fall back to a body-less draft rather than appearing to do nothing.
        window.location.href = href.length > 1800
          ? `mailto:${to}?subject=${encodeURIComponent(subject)}`
          : href;
      } catch {
        setSending(false);
        err?.classList.add('is-on');
        return;
      }

      // We cannot observe whether a mail client actually opened, so the
      // message says a draft was prepared — it never claims the message was
      // sent. The form is deliberately NOT reset: if no client opened, the
      // user still has everything they typed.
      window.setTimeout(() => {
        setSending(false);
        ok?.classList.add('is-on');
      }, 700);
    });
  }

  /* ---------------------------------------------------------------------
     15. SCROLL DRIVER
     --------------------------------------------------------------------- */
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      runParallax();
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  /* ---------------------------------------------------------------------
     BOOT
     --------------------------------------------------------------------- */
  function boot() {
    // We are alive, so the inline failsafe is not needed.
    if (window.__jsFailsafe) {
      clearTimeout(window.__jsFailsafe);
      window.__jsFailsafe = null;
    }
    body.classList.add('js');
    initIntro();
    initSplit();
    initCursor();
    initHeader();
    initMenu();
    initLang();
    initAnchors();
    initParallax();
    initHeroVideo();
    initImages();
    initMarquee();
    initIndexPeek();
    initMagnetic();
    initMaterialTilt();
    initForm();
    initReveals();
    initTransitions();
    runParallax();

    // Kick the header/hero entrance on the next frame, so the first painted
    // frame is the "before" state and the transition is actually seen.
    nextPaint(() => body.classList.add('page-ready'));
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
