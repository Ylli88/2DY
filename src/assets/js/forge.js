/* =========================================================================
   2DY — "Forge": a raymarched steel lattice.

   A single full-screen quad and one fragment shader. No geometry buffers, no
   model loading, no library — the structure is defined mathematically, so the
   whole thing costs a few KB instead of the ~150KB gzipped a 3D library would.

   Scroll drives the camera forward through the lattice; the pointer swings
   the key light across the steel. Everything degrades: no WebGL, reduced
   motion, or a save-data connection all leave the static poster in place.
   ========================================================================= */
(() => {
  'use strict';

  // The stage is the sticky pane the canvas fills; the section is the tall
  // scroll track behind it. Progress must be read from the SECTION — the
  // stage is stuck to the viewport and its rect barely moves.
  const host = document.querySelector('[data-forge]');
  const section = document.querySelector('[data-forge-section]') || host;
  if (!host) return;

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection;
  const SAVE_DATA = conn && (conn.saveData || /2g/.test(conn.effectiveType || ''));

  if (SAVE_DATA) return; // leave the CSS fallback showing

  /* ---------------------------------------------------------------- shaders */
  const VERT = `
    attribute vec2 p;
    void main(){ gl_Position = vec4(p, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;

    uniform vec2  uRes;
    uniform float uTime;
    uniform float uScroll;   // 0..1 progress through the section
    uniform vec2  uPointer;  // -1..1, smoothed

    const vec3 STEEL  = vec3(0.085, 0.088, 0.094);
    const vec3 BRONZE = vec3(0.78,  0.50,  0.21);
    const vec3 COOL   = vec3(0.42,  0.52,  0.62);

    float sdBox(vec3 p, vec3 b){
      vec3 q = abs(p) - b;
      return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
    }

    // A repeating scaffold: long members running down z, cross members
    // bracing them on a coarser grid.
    float map(vec3 p){
      vec3 a = p;
      a.xy = mod(a.xy + 2.0, 4.0) - 2.0;
      float runners = sdBox(a, vec3(0.17, 0.17, 60.0));

      vec3 b = p;
      b.x = mod(b.x + 2.0, 4.0) - 2.0;
      b.z = mod(b.z + 3.0, 6.0) - 3.0;
      float ties = sdBox(b, vec3(0.12, 40.0, 0.12));

      vec3 c = p;
      c.y = mod(c.y + 2.0, 4.0) - 2.0;
      c.z = mod(c.z + 3.0, 6.0) - 3.0;
      float braces = sdBox(c, vec3(40.0, 0.10, 0.10));

      return min(runners, min(ties, braces));
    }

    vec3 normalAt(vec3 p){
      vec2 e = vec2(0.0015, 0.0);
      return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
      ));
    }

    void main(){
      vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

      // Camera: forward along z, nudged by the pointer.
      float travel = uScroll * 34.0 + uTime * 0.22;
      vec3 ro = vec3(uPointer.x * 0.9, 0.55 + uPointer.y * 0.5, travel);

      vec3 rd = normalize(vec3(uv, 1.25));
      // gentle look-around
      float yaw = uPointer.x * 0.16;
      float cy = cos(yaw), sy = sin(yaw);
      rd.xz = mat2(cy, -sy, sy, cy) * rd.xz;

      float t = 0.0;
      float hit = 0.0;
      for (int i = 0; i < 78; i++){
        vec3 pos = ro + rd * t;
        float d = map(pos);
        if (d < 0.0015){ hit = 1.0; break; }
        t += d * 0.86;
        if (t > 42.0) break;
      }

      vec3 col = vec3(0.0);

      if (hit > 0.5){
        vec3 pos = ro + rd * t;
        vec3 n   = normalAt(pos);
        vec3 v   = -rd;

        // Key light swings with the pointer; fill stays put.
        vec3 key  = normalize(vec3(0.55 + uPointer.x * 0.8, 0.85, -0.35 + uPointer.y * 0.4));
        vec3 fill = normalize(vec3(-0.6, 0.35, 0.5));

        float kd = max(dot(n, key), 0.0);
        float fd = max(dot(n, fill), 0.0);

        // Tight specular — this is what makes it read as metal.
        vec3  h  = normalize(key + v);
        float sp = pow(max(dot(n, h), 0.0), 88.0);

        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);

        col  = STEEL;
        col += BRONZE * kd * 0.92;      // warm key, the temper colour
        col += COOL  * fd * 0.22;       // cool fill
        col += BRONZE * sp * 2.1;       // hot highlight along machined edges
        col += COOL  * fres * 0.44;     // rim

        // mill-scale mottling so the surfaces are not plastic-smooth
        float grain = fract(sin(dot(floor(pos.xy * 26.0), vec2(12.99, 78.23))) * 43758.5);
        col *= 0.90 + grain * 0.20;

        // fog into the void
        col *= exp(-t * 0.062);
      }

      // vignette
      float vig = 1.0 - 0.5 * dot(uv, uv);
      col *= vig;

      // fine film grain, matching the rest of the site
      float fg = fract(sin(dot(gl_FragCoord.xy, vec2(12.99, 78.23)) + uTime) * 43758.5);
      col += (fg - 0.5) * 0.022;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `;

  /* ------------------------------------------------------------------ setup */
  const canvas = document.createElement('canvas');
  canvas.className = 'forge__canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true,
  });

  if (!gl) return; // CSS fallback stays

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('forge:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('forge:', gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uScroll = gl.getUniformLocation(prog, 'uScroll');
  const uPointer = gl.getUniformLocation(prog, 'uPointer');

  host.appendChild(canvas);
  host.classList.add('is-live');

  /* ------------------------------------------------------------------ state */
  let W = 0, H = 0;

  /* Raymarching is fragment-bound: resolution costs more than everything
     else combined. Phones get a lower ceiling — at that physical size the
     extra pixels are invisible, and their GPUs are an order of magnitude
     slower than the desktop this was tuned on. `quality` drops once if
     frames actually come in slow, and never climbs back. */
  let quality = 1;
  const COARSE = matchMedia('(hover: none), (pointer: coarse)').matches;
  const DPR = () =>
    Math.min(window.devicePixelRatio || 1, COARSE ? 1.25 : 1.6) * quality;

  function resize() {
    const r = host.getBoundingClientRect();
    const d = DPR();
    const w = Math.max(1, Math.round(r.width * d));
    const h = Math.max(1, Math.round(r.height * d));
    if (w === W && h === H) return;
    W = w; H = h;
    canvas.width = W;
    canvas.height = H;
    gl.viewport(0, 0, W, H);
  }

  let scroll = 0, scrollTarget = 0;
  let px = 0, py = 0, ptx = 0, pty = 0;
  let visible = false;
  let raf = null;
  let t0 = null;

  function readScroll() {
    const r = section.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    // 0 when the section's top reaches the viewport top, 1 when its bottom
    // does — i.e. exactly the window during which the sticky pane is pinned.
    scrollTarget = span > 0 ? Math.min(Math.max(-r.top / span, 0), 1) : 0;
  }

  let slowFrames = 0;
  let lastFrame = 0;

  function frame(now) {
    if (t0 === null) t0 = now;
    const time = (now - t0) / 1000;

    // If this device cannot hold ~30fps, halve the resolution once and
    // stop measuring. Better a softer image than a stuttering page.
    if (quality === 1 && lastFrame) {
      if (now - lastFrame > 34) slowFrames++;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 24) {
        quality = 0.7;
        W = H = 0; // force resize() to rebuild the buffer
        resize();
      }
    }
    lastFrame = now;

    scroll += (scrollTarget - scroll) * 0.075;
    px += (ptx - px) * 0.055;
    py += (pty - py) * 0.055;

    gl.uniform2f(uRes, W, H);
    gl.uniform1f(uTime, REDUCED ? 0 : time);
    gl.uniform1f(uScroll, scroll);
    gl.uniform2f(uPointer, px, py);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    raf = visible ? requestAnimationFrame(frame) : null;
  }

  function start() {
    if (raf || !visible) return;
    t0 = null;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  /* --------------------------------------------------------------- listeners */
  window.addEventListener('resize', () => { resize(); readScroll(); }, { passive: true });
  window.addEventListener('scroll', readScroll, { passive: true });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return; // touch scrolls, it does not aim
    const r = host.getBoundingClientRect();
    ptx = ((e.clientX - r.left) / r.width) * 2 - 1;
    pty = -(((e.clientY - r.top) / r.height) * 2 - 1);
    ptx = Math.max(-1.6, Math.min(1.6, ptx));
    pty = Math.max(-1.6, Math.min(1.6, pty));
  }, { passive: true });

  host.addEventListener('pointerleave', () => { ptx = 0; pty = 0; });

  doc_visibility();
  function doc_visibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });
  }

  // Only render while the section is actually on screen.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        visible = e.isIntersecting;
        if (visible) { resize(); readScroll(); start(); } else stop();
      });
    }, { rootMargin: '120px' }).observe(section);
  } else {
    visible = true;
    resize(); readScroll(); start();
  }

  // Paint one frame immediately so the section is never an empty black box,
  // even before it scrolls into view or if rAF is starved.
  resize();
  readScroll();
  gl.uniform2f(uRes, W, H);
  gl.uniform1f(uTime, 0);
  gl.uniform1f(uScroll, scrollTarget);
  gl.uniform2f(uPointer, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
  gl.canvas.addEventListener('webglcontextrestored', () => { resize(); start(); });
})();
