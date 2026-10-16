/* The page: state, controls and drawing.  All of the lens physics is in physics.js. */
(function () {
"use strict";

window.addEventListener("error", ev => {
  const e = document.getElementById("err");
  e.hidden = false;
  e.textContent = String(ev.message) + (ev.filename ? "\n" + ev.filename + ":" + ev.lineno : "");
});

const P = window.Phys;
const FONT = 'Charter, "PT Serif", Palatino, Georgia, "DejaVu Serif", serif';
const C = { ink: "#1a1a1a", lab: "#3b3733", muted: "#6a6560", frame: "#cfc8bd",
            bg: "#0e1729", crit: "#58C4FF", mass: "rgba(214,222,240,0.55)", mark: "#ffffff",
            halo: "rgba(6,11,24,0.9)", unl: "rgba(255,255,255,0.75)",
            sub: "rgba(214,222,255,0.45)", subDot: "#dfe6ff" };
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const DEG = Math.PI / 180;
const EI = 2.5;                      // half-width of the full sky field (theta_E)
const TYPE = { min: "minimum", saddle: "saddle", max: "maximum" };
const FW_OFF = -2.05;                // telescope-resolution slider positions below this mean a perfect telescope
const FW_DEF = Math.log10(0.05);     // default resolution: 0.05 arcsec FWHM

// ------------------------------------------------------------------ state
function defaults() {
  return { model: "cored", core: 0.1, coreE: 0, q: 0.7, pa: 30, g: 0.08, gpa: 120,
           bx: 0.2, by: 0.08, type: "pt", R: 0.08, inc: 0,
           crit: true, marks: true, unl: false, mass: false, zs: 1.25,
           nsub: 0, lm: 9, seed: 1, subs: [], showSubs: true, zi: EI, cix: 0, ciy: 0, son: true, fw: FW_DEF };
}
let S = defaults();
const NUMKEYS = ["core", "coreE", "q", "pa", "g", "gpa", "bx", "by", "R", "inc", "zs",
                 "nsub", "lm", "seed", "zi", "cix", "ciy", "fw"];

function mainSpec() {
  switch (S.model) {
    case "point": return { model: "point" };
    case "sis": return { model: "iso", s: 0, q: 1 };
    case "cored": return { model: "iso", s: S.core, q: 1 };
    default: return { model: "iso", s: S.coreE, q: S.q, pa: S.pa * DEG, g: S.g, gpa: S.gpa * DEG };
  }
}
// Subhalos: pseudo-Jaffe clumps of mass M = pi b a Sigma_crit, tidally truncated at
// a = sqrt(b b_0) with b_0 = theta_E = 1 (Dalal & Kochanek 2002), so M / M_E = b^(3/2),
// where M_E = pi Sigma_crit theta_E^2 is the mass inside the Einstein radius.
function subParams() {
  const b = Math.pow(Math.pow(10, S.lm) / P.SCALE.Mpoint_Msun, 2 / 3);
  return { b, a: Math.sqrt(b) };
}
function spec() {
  const sp = mainSpec();
  if (S.nsub > 0) { const { b, a } = subParams(); sp.subs = S.subs.slice(0, S.nsub).map(([x, y]) => ({ x, y, b, a })); }
  return sp;
}
// clump positions: area-uniform in the annulus 0.5-1.5 theta_E, where the images form;
// position k depends only on (seed, k), so adding clumps keeps the earlier ones in place
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function subPos(seed, k) {
  const r = mulberry(seed * 7919 + k * 104729 + 1);
  const rad = Math.sqrt(0.25 + 2 * r()), ph = 2 * Math.PI * r();
  return [+(rad * Math.cos(ph)).toFixed(4), +(rad * Math.sin(ph)).toFixed(4)];
}
function ensureSubs() { while (S.subs.length < S.nsub) S.subs.push(subPos(S.seed, S.subs.length)); }
const view = () => ({ cx: S.cix, cy: S.ciy, E: S.zi });
const zoomed = () => S.zi < EI - 1e-9 || S.cix !== 0 || S.ciy !== 0;

function saveHash() {
  clearTimeout(saveHash.t);
  saveHash.t = setTimeout(() => {
    const d = defaults(), parts = [];
    for (const k of Object.keys(d)) {
      if (k === "subs" || S[k] === d[k]) continue;
      parts.push(k + "=" + (typeof S[k] === "number" ? +S[k].toFixed(4) : S[k]));
    }
    if (S.nsub > 0) parts.push("subs=" + S.subs.slice(0, S.nsub).map(p => p.map(v => +v.toFixed(3)).join(",")).join(";"));
    try { history.replaceState(null, "", parts.length ? "#" + parts.join("&") : location.pathname + location.search); }
    catch (e) { /* some embedded viewers refuse replaceState */ }
  }, 250);
}
function loadHash() {
  const h = location.hash.slice(1);
  if (!h) return;
  for (const kv of h.split("&")) {
    const [k, v] = kv.split("=");
    if (!(k in S)) continue;
    if (k === "subs") {
      S.subs = v.split(";").map(p => p.split(",").map(parseFloat)).filter(p => p.length === 2 && p.every(isFinite));
      continue;
    }
    if (NUMKEYS.includes(k)) { const x = parseFloat(v); if (isFinite(x)) S[k] = x; }
    else if (typeof S[k] === "boolean") S[k] = v === "true";
    else S[k] = decodeURIComponent(v);
  }
  if (!["point", "sis", "cored", "ell"].includes(S.model)) S.model = "cored";
  if (!["pt", "disk", "gal"].includes(S.type)) S.type = "disk";
  S.nsub = clamp(Math.round(S.nsub), 0, 20);
  S.zi = clamp(S.zi, 0.04, EI);
  ensureSubs();
}

// ------------------------------------------------------------------ text helpers
function num(v, d = 3) {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e4 || a < 1e-3) {
    const e = Math.floor(Math.log10(a)), m = v / Math.pow(10, e);
    return m.toFixed(d - 1) + " × 10<sup>" + String(e).replace("-", "−") + "</sup>";
  }
  let s = v.toFixed(Math.max(0, d - 1 - Math.floor(Math.log10(a))));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace("-", "−");
}
const sgn = (v, d) => (v >= 0 ? "+" : "") + num(v, d);
function days(t) {
  if (t < 0.05) return t === 0 ? "0" : (t * 24).toFixed(1) + " hr";
  if (t < 10) return t.toFixed(1) + " d";
  if (t < 1000) return t.toFixed(0) + " d";
  return (t / 365.25).toFixed(1) + " yr";
}
const pos = (x, y) => `(${num(x, 2)}, ${num(y, 2)})`;

// a tiny markup for canvas labels: *...* italic, _{...} subscript, ^{...} superscript
function mk(s) {
  const parts = [];
  let it = false, mode = "", buf = "";
  const push = () => { if (buf) parts.push({ t: buf, it, sup: mode === "sup", sub: mode === "sub" }); buf = ""; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ((ch === "^" || ch === "_") && s[i + 1] === "{") { push(); mode = ch === "^" ? "sup" : "sub"; i++; continue; }
    if (ch === "}" && mode) { push(); mode = ""; continue; }
    if (ch === "*") { push(); it = !it; continue; }
    buf += ch;
  }
  push();
  return parts;
}
function rich(ctx, s, x, y, align, size, color) {
  const parts = mk(s), small = Math.round(size * 0.72);
  const fnt = p => `${p.it ? "italic " : ""}${p.sup || p.sub ? small : size}px ${FONT}`;
  const ws = parts.map(p => { ctx.font = fnt(p); return ctx.measureText(p.t).width; });
  const w = ws.reduce((a, v) => a + v, 0);
  let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = color;
  parts.forEach((p, i) => {
    ctx.font = fnt(p);
    ctx.fillText(p.t, cx, y + (p.sup ? -size * 0.42 : p.sub ? size * 0.24 : 0));
    cx += ws[i];
  });
  return w;
}

// ------------------------------------------------------------------ colors
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function ramp(stops, n) {
  const lut = new Uint8ClampedArray(3 * n), cs = stops.map(s => [s[0], hex(s[1])]);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let k = 0;
    while (k < cs.length - 2 && t > cs[k + 1][0]) k++;
    const [t0, c0] = cs[k], [t1, c1] = cs[k + 1], f = clamp((t - t0) / (t1 - t0), 0, 1);
    for (let j = 0; j < 3; j++) lut[3 * i + j] = Math.round(c0[j] + f * (c1[j] - c0[j]));
  }
  return lut;
}
// source brightness: navy sky through amber to cream
const LUT_SRC = ramp([[0, "#0e1729"], [0.3, "#4f3328"], [0.62, "#d07f2c"], [0.85, "#FFB547"], [1, "#FFF1D0"]], 256);
// ------------------------------------------------------------------ the source
// brightness 0..1 at offset (dx, dy) from the source center, in theta_E
// The disk and the galaxy are thin disks seen at inclination S.inc (0 = face-on); the
// projected axis ratio is sqrt(cos^2 i + q0^2 sin^2 i), with an intrinsic thickness q0 = 0.1.
const Q0 = 0.1;
function axisRatio() { const c = Math.cos(S.inc * DEG); return Math.sqrt(c * c + Q0 * Q0 * (1 - c * c)); }
function sourceFn() {
  const R = S.R, w = Math.max(0.006, 0.05 * R), q = axisRatio();
  const soft = d => clamp(d / w + 0.5, 0, 1);
  if (S.type === "disk") return (dx, dy) => soft(R - Math.sqrt(dx * dx + (dy / q) * (dy / q)));   // major axis horizontal
  // galaxy: exponential disk with three bright knots, major axis at 29 degrees
  const ca = Math.cos(0.5), sa = Math.sin(0.5), h = 0.32 * R;
  const knots = [[0.48, 0.32], [-0.36, 0.76], [0.05, -1.0]].map(([u, v]) => [u * R, v * R * q]);
  const s2 = 2 * (0.13 * R) * (0.13 * R);
  return (dx, dy) => {
    const u = ca * dx + sa * dy, v = -sa * dx + ca * dy;
    const re = Math.sqrt(u * u + (v / q) * (v / q));
    if (re > 3.2 * R) return 0;
    let b = 0.82 * Math.exp(-re / h);
    for (const [ku, kv] of knots) b += 0.55 * Math.exp(-((u - ku) * (u - ku) + (v - kv) * (v - kv)) / s2);
    return Math.min(1, b);
  };
}

// ------------------------------------------------------------------ lens caches
// ------------------------------------------------------------------ telescope view
// A Gaussian point-spread function of full width at half maximum FWHM (arcsec, = theta_E
// here).  Lensing conserves surface brightness, so the ideal sky shows magnification only as
// image area; once the PSF is wider than an image, the peak brightness tracks the flux.
// A point source is drawn as one PSF per image, with flux |mu| from the image finder.
const HEAD = 1.25;                   // display headroom above the brightest smooth-lens image
const isPt = () => S.type === "pt";
const psfOn = () => isPt() || S.fw > FW_OFF;
const fwhm = () => (S.fw > FW_OFF ? Math.pow(10, S.fw) : 0.01);
// sky brightness over the current view at resolution N, as { arr, M } (M <= N after the
// downsampling that keeps the blur kernel short); raw: the ray-traced sky, if already made
function skyBright(N, ent, imgs, raw) {
  const { cx, cy, E } = view(), d = 2 * E / N, sig = fwhm() / 2.3548;
  if (isPt()) {
    const s = Math.max(sig, 0.6 * d), arr = new Float32Array(N * N), R = Math.ceil(4 * s / d);
    for (const m of imgs) {
      const ic = (m.x - cx + E) / d - 0.5, jc = (cy + E - m.y) / d - 0.5, a = Math.abs(m.mu);
      for (let j = Math.max(0, Math.floor(jc - R)); j <= Math.min(N - 1, Math.ceil(jc + R)); j++)
        for (let i = Math.max(0, Math.floor(ic - R)); i <= Math.min(N - 1, Math.ceil(ic + R)); i++)
          arr[j * N + i] += a * Math.exp(-((i - ic) ** 2 + (j - jc) ** 2) * d * d / (2 * s * s));
    }
    return { arr, M: N };
  }
  if (!raw) {
    const { bx, by } = skyMap(N, ent), f = sourceFn();
    raw = new Float32Array(N * N);
    for (let n = 0; n < N * N; n++) raw[n] = isFinite(bx[n]) ? f(bx[n] - S.bx, by[n] - S.by) : 0;
  }
  return psfOn() ? blur(raw, N, sig / d) : { arr: raw, M: N };
}
// separable Gaussian blur of an N x N array with sigma sp pixels, after averaging k x k blocks
// so that the kernel stays a few pixels wide; flux is conserved apart from light leaving the field
function blur(src, N, sp) {
  const k = Math.max(1, Math.floor(sp / 3)), M = Math.ceil(N / k), a = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    let sum = 0, cnt = 0;
    for (let jj = j * k; jj < Math.min(N, j * k + k); jj++)
      for (let ii = i * k; ii < Math.min(N, i * k + k); ii++) { sum += src[jj * N + ii]; cnt++; }
    a[j * M + i] = sum / cnt;
  }
  const sg = sp / k, R = Math.max(1, Math.ceil(3 * sg)), w = new Float32Array(2 * R + 1);
  let wt = 0;
  for (let t = -R; t <= R; t++) wt += (w[t + R] = Math.exp(-t * t / (2 * sg * sg)));
  for (let t = 0; t <= 2 * R; t++) w[t] /= wt;
  const tmp = new Float32Array(M * M), out = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    let acc = 0;
    for (let t = -R; t <= R; t++) { const ii = i + t; if (ii >= 0 && ii < M) acc += w[t + R] * a[j * M + ii]; }
    tmp[j * M + i] = acc;
  }
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    let acc = 0;
    for (let t = -R; t <= R; t++) { const jj = j + t; if (jj >= 0 && jj < M) acc += w[t + R] * tmp[jj * M + i]; }
    out[j * M + i] = acc;
  }
  return { arr: out, M };
}
// the brightness of the brightest point of the smooth lens's sky (the display scale is
// fixed by the smooth lens, so switching the subhalos on and off compares like with like)
let refCache = { k: "", v: 1 };
function brightRef(N) {
  if (!psfOn()) return 1;
  if (isPt()) return Math.max(1e-9, ...IMG0.map(m => Math.abs(m.mu)));
  const { cx, cy, E } = view();
  const k = [E0.key, N, cx, cy, E, S.type, S.R, S.bx, S.by, S.fw].join(" ");
  if (refCache.k !== k) {
    const { arr } = skyBright(N, E0, IMG0);
    let mx = 0;
    for (let n = 0; n < arr.length; n++) if (arr[n] > mx) mx = arr[n];
    refCache = { k, v: mx || 1 };
  }
  return refCache.v;
}

// Two lenses are kept: the smooth main lens (E0) and, when subhalos exist, the main lens
// plus the subhalos (EC).  The panels show the one chosen by the on/off switch (cur); the
// effect panel and the image table compare the two.  Keeping both makes the switch instant.
let E0 = null, EC = null, cur = null;
let L = null, G = null, CC = null, IMG = [], IMG0 = [], IMGC = [];
const cacheMain = {};                // arrays of the main lens alone, shared by both lenses
let gridCache = new Map();           // main-lens deflections at the image-finding grid nodes
function entry(sp, key) {
  const Lx = P.makeLens(sp), Gx = P.buildGrid(Lx, gridCache);
  return { key, L: Lx, G: Gx, CC: P.criticalCurves(Gx), arr: {} };
}
function updateLens() {
  let changed = false;
  const ms = mainSpec(), mkey = JSON.stringify(ms);
  if (!E0 || E0.key !== mkey) {
    gridCache = new Map();
    for (const k of Object.keys(cacheMain)) delete cacheMain[k];
    E0 = entry(ms, mkey); EC = null; changed = true;
  }
  if (S.nsub > 0) {
    const cs = spec(), ckey = JSON.stringify(cs);
    if (!EC || EC.key !== ckey) {
      EC = entry(cs, ckey); changed = true;
      for (const k of [...gridCache.keys()]) if (!EC.G.keys.includes(k)) gridCache.delete(k);
    }
  } else if (EC) { EC = null; changed = true; }
  const want = EC && S.son ? EC : E0;
  if (want !== cur) { cur = want; changed = true; }
  L = cur.L; G = cur.G; CC = cur.CC;
  return changed;
}
function updateImages() {
  IMG0 = P.findImages(E0.G, S.bx, S.by);
  IMGC = EC ? P.findImages(EC.G, S.bx, S.by) : IMG0;
  IMG = cur === EC ? IMGC : IMG0;
}
// keep one view per resolution in a cache object
function store(obj, prefix, k, v) {
  for (const kk of Object.keys(obj)) if (kk.startsWith(prefix) && kk !== k) delete obj[kk];
  return (obj[k] = v);
}

// source-plane position of each sky pixel, at resolution N, over the current sky view.
// The main lens is cached separately, so moving a subhalo only re-adds the clumps.
function skyMap(N, ent = cur) {
  const { cx, cy, E } = view(), k = `sky ${N} ${cx} ${cy} ${E}`;
  if (ent.arr[k]) return ent.arr[k];
  const d = 2 * E / N, o = new Float64Array(5);
  let M = cacheMain[k];
  if (!M) {
    const bx = new Float32Array(N * N), by = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      const y = cy + E - (j + 0.5) * d;
      for (let i = 0; i < N; i++) {
        const x = cx - E + (i + 0.5) * d;
        P.deflectMain(ent.L, x, y, o, false);
        bx[j * N + i] = x - o[0]; by[j * N + i] = y - o[1];
      }
    }
    M = store(cacheMain, `sky ${N} `, k, { bx, by });
  }
  if (!ent.L.subs.length) return store(ent.arr, `sky ${N} `, k, M);
  const bx = Float32Array.from(M.bx), by = Float32Array.from(M.by);
  for (let j = 0; j < N; j++) {
    const y = cy + E - (j + 0.5) * d;
    for (let i = 0; i < N; i++) {
      const x = cx - E + (i + 0.5) * d;
      o[0] = 0; o[1] = 0;
      P.addSubs(ent.L, x, y, o, false);
      bx[j * N + i] -= o[0]; by[j * N + i] -= o[1];
    }
  }
  return store(ent.arr, `sky ${N} `, k, { bx, by });
}
function massGrid() {
  const { cx, cy, E } = view(), k = `mass ${cx} ${cy} ${E}`;
  if (cur.arr[k]) return cur.arr[k];
  const n = 240, kap = new Float64Array(n * n), d = 2 * E / (n - 1);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) kap[j * n + i] = P.kappa(L, cx - E + i * d, cy + E - j * d);
  return store(cur.arr, "mass ", k, { n, kap });
}

// marching squares on a square grid spanning [cx-E, cx+E] x [cy-E, cy+E] (row 0 at the top);
// calls seg(x0,y0,x1,y1)
function contour(f, n, E, level, seg, cx = 0, cy = 0) {
  const d = 2 * E / (n - 1);
  const X = i => cx - E + i * d, Y = j => cy + E - j * d;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = f[j * n + i] - level, b = f[j * n + i + 1] - level;
      const c = f[(j + 1) * n + i + 1] - level, e = f[(j + 1) * n + i] - level;
      if (!(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(e))) continue;
      const pts = [];
      if ((a < 0) !== (b < 0)) pts.push([X(i + a / (a - b)), Y(j)]);
      if ((b < 0) !== (c < 0)) pts.push([X(i + 1), Y(j + b / (b - c))]);
      if ((c < 0) !== (e < 0)) pts.push([X(i + 1 - c / (c - e)), Y(j + 1)]);
      if ((e < 0) !== (a < 0)) pts.push([X(i), Y(j + 1 - e / (e - a))]);
      if (pts.length >= 2) seg(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
      if (pts.length === 4) seg(pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
    }
  }
}

// ------------------------------------------------------------------ canvas helpers
function fit(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, dpr };
}
// a square plot box with room for tick labels on the left and below
function plotBox(w, h) {
  const ml = 48, mb = 42, mt = 6, mr = 8;
  const side = Math.floor(Math.min(w - ml - mr, h - mt - mb));
  return { x0: ml + Math.floor((w - ml - mr - side) / 2), y0: mt, side };
}
// a 1-2-5 tick step giving about five ticks across the panel
function tickStep(E) {
  const raw = 2 * E / 4.5, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function frameAndTicks(ctx, b, cx, cy, E, xl, yl) {
  const { x0, y0, side } = b, st = tickStep(E), dec = Math.max(0, Math.ceil(-Math.log10(st) - 1e-9));
  ctx.strokeStyle = C.frame; ctx.lineWidth = 1;
  ctx.strokeRect(x0 - 0.5, y0 - 0.5, side + 1, side + 1);
  ctx.fillStyle = C.lab; ctx.font = `13px ${FONT}`;
  const lab = v => (Math.abs(v) < st * 1e-6 ? "0" : v.toFixed(dec).replace("-", "−"));
  for (let v = Math.ceil((cx - E) / st) * st; v <= cx + E + 1e-9 * E; v += st) {
    const px = x0 + (v - cx + E) / (2 * E) * side;
    ctx.beginPath(); ctx.moveTo(px, y0 + side); ctx.lineTo(px, y0 + side + 4); ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(lab(v), px, y0 + side + 6);
  }
  for (let v = Math.ceil((cy - E) / st) * st; v <= cy + E + 1e-9 * E; v += st) {
    const py = y0 + (cy + E - v) / (2 * E) * side;
    ctx.beginPath(); ctx.moveTo(x0 - 4, py); ctx.lineTo(x0, py); ctx.stroke();
    ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(lab(v), x0 - 7, py);
  }
  rich(ctx, xl, x0 + side / 2, y0 + side + 36, "center", 15, C.lab);
  ctx.save(); ctx.translate(16, y0 + side / 2); ctx.rotate(-Math.PI / 2);
  rich(ctx, yl, 0, 0, "center", 15, C.lab); ctx.restore();
}
function polyline(ctx, pts, map) {
  ctx.beginPath();
  pts.forEach((p, i) => { const [x, y] = map(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
}
// image marker: circle (minimum), diamond (saddle), triangle (maximum)
function markerPath(ctx, type, x, y, r) {
  ctx.beginPath();
  if (type === "min") ctx.arc(x, y, r, 0, 2 * Math.PI);
  else if (type === "saddle") { ctx.moveTo(x, y - 1.3 * r); ctx.lineTo(x + 1.3 * r, y); ctx.lineTo(x, y + 1.3 * r); ctx.lineTo(x - 1.3 * r, y); ctx.closePath(); }
  else { ctx.moveTo(x, y - 1.35 * r); ctx.lineTo(x + 1.2 * r, y + 0.85 * r); ctx.lineTo(x - 1.2 * r, y + 0.85 * r); ctx.closePath(); }
}
// rr: a larger, thinner marker that rings a point-source image instead of covering the image
function drawMarker(ctx, type, x, y, label, hl, rr) {
  const r = rr ? (hl ? rr + 2 : rr) : hl ? 9 : 7;
  markerPath(ctx, type, x, y, r);
  ctx.lineWidth = rr ? (hl ? 3 : 2) : hl ? 4 : 2.8; ctx.strokeStyle = C.halo; ctx.stroke();
  markerPath(ctx, type, x, y, r);
  ctx.lineWidth = rr ? (hl ? 1.8 : 1) : hl ? 2.2 : 1.3; ctx.strokeStyle = rr ? "rgba(255,255,255,0.75)" : C.mark; ctx.stroke();
  if (label) {
    ctx.font = `${hl ? "bold " : ""}14px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 3.5; ctx.strokeStyle = C.halo; ctx.strokeText(label, x + r + 3, y - r);
    ctx.fillStyle = C.mark; ctx.fillText(label, x + r + 3, y - r);
  }
}
const off = document.createElement("canvas");
function blit(ctx, b, img, N) {
  off.width = N; off.height = N;
  off.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, b.x0, b.y0, b.side, b.side);
}

// ------------------------------------------------------------------ source plane
let boxS = null;
// the source center in canvas pixels, and the radius within which the pointer grabs the source
function srcPx() {
  const b = boxS, E = S.zs;
  return [b.x0 + (S.bx + E) / (2 * E) * b.side, b.y0 + (E - S.by) / (2 * E) * b.side];
}
function srcHitPx() {
  const ext = isPt() ? 0 : (S.type === "gal" ? 1.3 : 1.05) * S.R;
  return Math.max(12, ext / (2 * S.zs) * boxS.side + 6);
}
function drawSource() {
  const cv = $("cvS"), { ctx, w, h, dpr } = fit(cv), b = plotBox(w, h), E = S.zs;
  boxS = b;
  if (b.side < 40) return;
  const map = (x, y) => [b.x0 + (x + E) / (2 * E) * b.side, b.y0 + (E - y) / (2 * E) * b.side];
  if (isPt()) { ctx.fillStyle = C.bg; ctx.fillRect(b.x0, b.y0, b.side, b.side); }
  else {
    const N = Math.min(640, Math.round(b.side * dpr)), img = new ImageData(N, N), f = sourceFn();
    const d = 2 * E / N, px = img.data;
    for (let j = 0; j < N; j++) {
      const y = E - (j + 0.5) * d - S.by;
      for (let i = 0; i < N; i++) {
        const v = f(-E + (i + 0.5) * d - S.bx, y), k = 3 * Math.round(v * 255), m = 4 * (j * N + i);
        px[m] = LUT_SRC[k]; px[m + 1] = LUT_SRC[k + 1]; px[m + 2] = LUT_SRC[k + 2]; px[m + 3] = 255;
      }
    }
    blit(ctx, b, img, N);
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(b.x0, b.y0, b.side, b.side); ctx.clip();
  if (S.crit) {
    ctx.strokeStyle = C.crit; ctx.lineWidth = 1.6; ctx.lineJoin = "round";
    for (const c of CC.caus) {
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const p of c) { xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
      if (Math.max(xmax - xmin, ymax - ymin) < 0.01) {          // a caustic that has shrunk to a point
        const [cx, cy] = map((xmin + xmax) / 2, (ymin + ymax) / 2);
        ctx.fillStyle = C.crit; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
      } else polyline(ctx, c, map);
    }
    ctx.setLineDash([6, 5]);
    for (const c of CC.cuts) polyline(ctx, c, map);
    ctx.setLineDash([]);
  }
  const hot = hoverSrc || dragS;
  if (isPt()) {                        // a point source: a small glowing dot, larger under the pointer
    const [sx, sy] = map(S.bx, S.by), rg = hot ? 13 : 9, g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rg);
    g.addColorStop(0, "#FFFFFF"); g.addColorStop(0.35, hot ? "#FFD27A" : "#FFB547"); g.addColorStop(1, "rgba(255,181,71,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, rg, 0, 2 * Math.PI); ctx.fill();
  }
  if (hot) {                           // a glowing ring marks the source as movable
    const [sx, sy] = map(S.bx, S.by);
    ctx.save(); ctx.shadowColor = "rgba(255,236,200,0.95)"; ctx.shadowBlur = 10;
    ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(sx, sy, srcHitPx() - 2, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
  }
  // the lens position
  const [lx, ly] = map(0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(lx - 6, ly); ctx.lineTo(lx + 6, ly); ctx.moveTo(lx, ly - 6); ctx.lineTo(lx, ly + 6); ctx.stroke();
  ctx.restore();
  frameAndTicks(ctx, b, 0, 0, E, "*β*_{x} / *θ*_{E}", "*β*_{y} / *θ*_{E}");
  $("sSub").innerHTML = E === 1.25 ? "" : `field ±${+E.toFixed(2)} θ<sub>E</sub>`;
}

// ------------------------------------------------------------------ sky
let boxI = null, skyFlux = { lensed: 0, unlensed: 0 }, skyLast = null;
function pxOf(b, x, y) {
  const { cx, cy, E } = view();
  return [b.x0 + (x - cx + E) / (2 * E) * b.side, b.y0 + (cy + E - y) / (2 * E) * b.side];
}
const skyToPx = (x, y) => pxOf(boxI, x, y);
const subsList = () => (EC ? EC.L.subs : []);
// subhalos: truncation radius (dotted) and center; hollow while the subhalos are switched off
function drawSubs(ctx, map, side, E) {
  if (!S.showSubs) return;
  subsList().forEach((c, k) => {
    const [qx, qy] = map(c.x, c.y), ra = c.a / (2 * E) * side, hot = k === hs || k === dragSub;
    if (hot) {                         // under the pointer: a glow, a solid truncation circle, a larger dot
      const g = ctx.createRadialGradient(qx, qy, 0, qx, qy, 16);
      g.addColorStop(0, "rgba(225,232,255,0.75)"); g.addColorStop(1, "rgba(225,232,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(qx, qy, 16, 0, 2 * Math.PI); ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = "rgba(235,240,255,0.9)";
      ctx.beginPath(); ctx.arc(qx, qy, ra, 0, 2 * Math.PI); ctx.stroke();
    } else {
      ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.strokeStyle = S.son ? C.sub : "rgba(214,222,255,0.22)";
      ctx.beginPath(); ctx.arc(qx, qy, ra, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.arc(qx, qy, hot ? 5.5 : 3.6, 0, 2 * Math.PI);
    if (S.son || hot) { ctx.fillStyle = hot ? "#ffffff" : C.subDot; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.halo; ctx.stroke(); }
    else { ctx.lineWidth = 1.3; ctx.strokeStyle = "rgba(223,230,255,0.65)"; ctx.stroke(); }
  });
}
function drawSky() {
  const cv = $("cvI"), { ctx, w, h, dpr } = fit(cv), b = plotBox(w, h);
  boxI = b;
  if (b.side < 40) return;
  const { cx, cy, E } = view();
  const Nfull = Math.min(800, Math.round(b.side * dpr)), N = draft ? Math.round(Nfull / 2) : Nfull;
  const d = 2 * E / N, f = sourceFn();
  let fl = 0, fu = 0, raw = null;
  if (!isPt()) {                       // the ideal sky: each pixel traced back to the source
    const { bx, by } = skyMap(N);
    raw = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      const yu = cy + E - (j + 0.5) * d - S.by;
      for (let i = 0; i < N; i++) {
        const n = j * N + i, X = bx[n], Y = by[n];
        const v = isFinite(X) ? f(X - S.bx, Y - S.by) : 0;
        raw[n] = v; fl += v; fu += f(cx - E + (i + 0.5) * d - S.bx, yu);
      }
    }
  }
  skyFlux = isPt() || zoomed() ? null : { lensed: fl, unlensed: fu };
  const sb = psfOn() ? skyBright(N, cur, IMG, raw) : { arr: raw, M: N };
  const scale = psfOn() ? 1 / (HEAD * brightRef(N)) : 1, M = sb.M, img = new ImageData(M, M), px = img.data;
  for (let n = 0; n < M * M; n++) {
    const k = 3 * Math.round(clamp(sb.arr[n] * scale, 0, 1) * 255), m = 4 * n;
    px[m] = LUT_SRC[k]; px[m + 1] = LUT_SRC[k + 1]; px[m + 2] = LUT_SRC[k + 2]; px[m + 3] = 255;
  }
  skyLast = { arr: sb.arr, M, scale, cx, cy, E, rawSum: fl, sum: sb.arr.reduce((a, v) => a + v, 0) * (N / M) * (N / M) };
  blit(ctx, b, img, M);
  const map = skyToPx, seg = (x0, y0, x1, y1) => { const a = map(x0, y0), c = map(x1, y1); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); };
  ctx.save();
  ctx.beginPath(); ctx.rect(b.x0, b.y0, b.side, b.side); ctx.clip();
  if (S.mass) {
    const { n, kap } = massGrid();
    ctx.strokeStyle = C.mass; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (const lev of [0.5, 1, 2, 4]) contour(kap, n, E, lev, seg, cx, cy);
    ctx.stroke(); ctx.setLineDash([]);
    if (L.model === "point") { const [qx, qy] = map(0, 0); ctx.fillStyle = C.mass; ctx.beginPath(); ctx.arc(qx, qy, 3, 0, 2 * Math.PI); ctx.fill(); }
  }
  if (S.crit) {
    ctx.strokeStyle = C.crit; ctx.lineWidth = 1.6; ctx.lineJoin = "round";
    for (const c of CC.crit) polyline(ctx, c, map);
  }
  if (S.unl && isPt()) {               // the unlensed position of a point source
    const [qx, qy] = map(S.bx, S.by);
    ctx.strokeStyle = C.unl; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(qx, qy, 7, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  } else if (S.unl) {                  // outline of the unlensed source
    const N2 = 160, sd = 2 * E / (N2 - 1), g = new Float64Array(N2 * N2);
    for (let j = 0; j < N2; j++) for (let i = 0; i < N2; i++) g[j * N2 + i] = f(cx - E + i * sd - S.bx, cy + E - j * sd - S.by);
    ctx.strokeStyle = C.unl; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    contour(g, N2, E, S.type === "gal" ? 0.12 : 0.5, seg, cx, cy);
    ctx.stroke(); ctx.setLineDash([]);
  }
  const [lx, ly] = map(0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(lx - 6, ly); ctx.lineTo(lx + 6, ly); ctx.moveTo(lx, ly - 6); ctx.lineTo(lx, ly + 6); ctx.stroke();
  drawSubs(ctx, map, b.side, E);
  const rr = isPt() ? clamp(1.4 * fwhm() / (2 * E) * b.side, 10, 30) : 0;
  if (S.marks) IMG.forEach((m, i) => { const [x, y] = map(m.x, m.y); drawMarker(ctx, m.type, x, y, String(i + 1), i === hl, rr); });
  ctx.restore();
  frameAndTicks(ctx, b, cx, cy, E, "*θ*_{x} / *θ*_{E}", "*θ*_{y} / *θ*_{E}");
  $("iSub").innerHTML = zoomed() ? `zoom ×${num(EI / E, 2)}` : "";
}

// ------------------------------------------------------------------ image pairs
// Pair the images with subhalos (IMGC) with the images of the smooth lens (IMG0): same type,
// closest pairs first, within 0.5 theta_E.  cOf: clumpy index -> smooth image; sOf: the reverse.
function pairUp() {
  const pairs = [], cOf = new Map(), sOf = new Map();
  IMGC.forEach((m, i) => IMG0.forEach((m0, j) => {
    const d = Math.hypot(m.x - m0.x, m.y - m0.y);
    if (m.type === m0.type && d < 0.5) pairs.push([d, i, j]);
  }));
  pairs.sort((u, v) => u[0] - v[0]);
  for (const [, i, j] of pairs) if (!cOf.has(i) && !sOf.has(j)) { cOf.set(i, IMG0[j]); sOf.set(j, IMGC[i]); }
  return { cOf, sOf };
}

// ------------------------------------------------------------------ main loop
let draft = false, draftTimer = 0, hl = -1, queued = false, frameMs = 0;
function redraw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const t0 = performance.now();
    if (updateLens()) updateImages();
    drawSource();
    drawSky();
    frameMs = performance.now() - t0;
  });
}
function setSource(x, y) {
  S.bx = x; S.by = y;
  if (psfOn() && !isPt()) {            // the blurred extended sky is drawn twice: draft while dragging
    draft = true; clearTimeout(draftTimer); draftTimer = setTimeout(() => { draft = false; redraw(); }, 220);
  }
  updateImages();
  syncControls();
  saveHash();
  redraw();
}
function lensChanged() {
  draft = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { draft = false; redraw(); }, 220);
  updateLens(); updateImages();
  syncControls(); saveHash(); redraw();
}

// ------------------------------------------------------------------ controls
const SL = {
  sCore: { get: () => (S.model === "ell" ? S.coreE : S.core), set: v => { if (S.model === "ell") S.coreE = v; else S.core = v; },
           fmt: v => v.toFixed(2) + " θ<sub>E</sub>" },
  sQ: { get: () => S.q, set: v => { S.q = v; }, fmt: v => v.toFixed(2) },
  sPA: { get: () => S.pa, set: v => { S.pa = v; }, fmt: v => v.toFixed(0) + "°" },
  sG: { get: () => S.g, set: v => { S.g = v; }, fmt: v => v.toFixed(3) },
  sGPA: { get: () => S.gpa, set: v => { S.gpa = v; }, fmt: v => v.toFixed(0) + "°" },
  sR: { get: () => Math.log10(S.R), set: v => { S.R = +Math.pow(10, v).toFixed(4); },
        fmt: v => `${num(Math.pow(10, v), 2)} θ<sub>E</sub> (${num(1000 * Math.pow(10, v), 2)} mas)` },
  sInc: { get: () => S.inc, set: v => { S.inc = v; },
          fmt: v => `${v.toFixed(0)}°` + (v < 0.5 ? " (face-on)" : v > 89.5 ? " (edge-on)" : "") },
  sFW: { get: () => S.fw, set: v => { S.fw = v; },
         fmt: v => (v > FW_OFF ? `${num(Math.pow(10, v), 2)}″ FWHM` : isPt() ? "0.01″ (minimum)" : "perfect") },
};
const VAL = { sCore: "vCore", sQ: "vQ", sPA: "vPA", sG: "vG", sGPA: "vGPA", sR: "vR", sInc: "vInc", sFW: "vFW" };
function syncControls() {
  document.body.className = "m-" + S.model + " s-" + S.type;
  for (const id of Object.keys(SL)) { $(id).value = SL[id].get(); $(VAL[id]).innerHTML = SL[id].fmt(SL[id].get()); }
  $("sCore").min = S.model === "cored" ? 0.02 : 0;
  const mb = { point: "mPoint", sis: "mSIS", cored: "mCored", ell: "mEll" };
  for (const [m, id] of Object.entries(mb)) $(id).setAttribute("aria-pressed", S.model === m);
  for (const [t, id] of [["pt", "tPt"], ["disk", "tDisk"], ["gal", "tGal"]]) $(id).setAttribute("aria-pressed", S.type === t);
  $("sOn").setAttribute("aria-pressed", S.son); $("sOff").setAttribute("aria-pressed", !S.son);
  $("blink").textContent = blinkTimer ? "Stop" : "Blink";
  $("cCrit").checked = S.crit; $("cMarks").checked = S.marks; $("cUnl").checked = S.unl; $("cMass").checked = S.mass;
  $("vB").innerHTML = `${pos(S.bx, S.by)}, |β| = ${num(Math.hypot(S.bx, S.by), 2)}`;
  $("sN").value = S.nsub; $("vN").textContent = S.nsub;
  $("sM").value = S.lm; $("vM").innerHTML = num(Math.pow(10, S.lm), 2) + " M<sub>☉</sub>";
  $("cSubs").checked = S.showSubs;
  const { b, a } = subParams(), mtot = S.nsub * Math.pow(10, S.lm);
  $("readSub").innerHTML = [
    ["<i>b</i>, <i>a</i>", `${num(1000 * b, 2)} mas, ${num(a, 2)} θ<sub>E</sub>`],
    ["Total", S.nsub ? `${num(mtot, 2)} M<sub>☉</sub> (${num(100 * mtot / P.SCALE.Mpoint_Msun, 2)}%)` : "—"],
  ].map(([k, v]) => `<div class="rd"><span>${k}</span><b>${v}</b></div>`).join("");
  $("readSub").children[0].title = "The clump's Einstein radius b (in mas for θ_E = 1″; b = 0.025 θ_E for 10⁹ solar masses) and the tidal truncation radius a = √(b θ_E).";
  $("readSub").children[1].title = "Total subhalo mass, and as a percentage of the projected mass inside the Einstein radius of the main lens (2.5 × 10^11 Msun for these units).";
}
$("sN").addEventListener("input", e => { S.nsub = +e.target.value; ensureSubs(); lensChanged(); });
$("sM").addEventListener("input", e => { S.lm = +e.target.value; lensChanged(); });
$("reshuffle").addEventListener("click", () => {
  S.seed += 1; S.subs = []; if (!S.nsub) S.nsub = 6; ensureSubs();
  draft = false; updateLens(); updateImages(); syncControls(); saveHash(); redraw();
});
for (const id of Object.keys(SL)) {
  $(id).addEventListener("input", e => {
    SL[id].set(parseFloat(e.target.value));
    if (id === "sR" || id === "sInc" || id === "sFW") { syncControls(); saveHash(); redraw(); } else lensChanged();
  });
}
for (const [m, id] of [["point", "mPoint"], ["sis", "mSIS"], ["cored", "mCored"], ["ell", "mEll"]])
  $(id).addEventListener("click", () => { S.model = m; draft = false; updateLens(); updateImages(); syncControls(); saveHash(); redraw(); });
for (const [t, id] of [["pt", "tPt"], ["disk", "tDisk"], ["gal", "tGal"]])
  $(id).addEventListener("click", () => {
    S.type = t;
    if (t === "pt" && S.fw <= FW_OFF) S.fw = FW_DEF;        // a point needs a PSF to be seen
    syncControls(); saveHash(); redraw();
  });
let blinkTimer = 0;
function stopBlink() { clearInterval(blinkTimer); blinkTimer = 0; }
function setOn(v) { S.son = v; updateLens(); updateImages(); syncControls(); saveHash(); redraw(); }
$("sOn").addEventListener("click", () => { stopBlink(); setOn(true); });
$("sOff").addEventListener("click", () => { stopBlink(); setOn(false); });
$("blink").addEventListener("click", () => {
  if (blinkTimer) { stopBlink(); setOn(true); return; }
  if (!S.nsub) { S.nsub = 6; ensureSubs(); }
  blinkTimer = setInterval(() => setOn(!S.son), 750);
  setOn(!S.son);
});
for (const [k, id] of [["crit", "cCrit"], ["marks", "cMarks"], ["unl", "cUnl"], ["mass", "cMass"], ["showSubs", "cSubs"]])
  $(id).addEventListener("change", e => { S[k] = e.target.checked; saveHash(); redraw(); });
$("reset").addEventListener("click", () => { stopBlink(); S = defaults(); hl = -1; draft = false; updateLens(); updateImages(); syncControls(); saveHash(); redraw(); });

// source plane: drag to move the source, scroll to zoom, double-click to reset the zoom
function toSource(ev) {
  const r = $("cvS").getBoundingClientRect(), b = boxS, E = S.zs;
  const x = -E + (ev.clientX - r.left - b.x0) / b.side * 2 * E;
  const y = E - (ev.clientY - r.top - b.y0) / b.side * 2 * E;
  return [clamp(x, -E, E), clamp(y, -E, E)];
}
// The source brightens under the pointer and can be grabbed and moved from where it was
// taken hold of; a press elsewhere moves the source to the pointer.
let dragS = false, hoverSrc = false, grab = [0, 0];
function onSource(ev) {
  if (!boxS) return false;
  const r = $("cvS").getBoundingClientRect(), [sx, sy] = srcPx();
  return Math.hypot(ev.clientX - r.left - sx, ev.clientY - r.top - sy) <= srcHitPx();
}
function setHoverSrc(h) { if (h !== hoverSrc) { hoverSrc = h; redraw(); } }
$("cvS").addEventListener("pointerdown", ev => {
  const [x, y] = toSource(ev);
  grab = onSource(ev) ? [S.bx - x, S.by - y] : [0, 0];
  dragS = true; $("cvS").setPointerCapture(ev.pointerId); $("cvS").style.cursor = "grabbing"; $("tip").hidden = true;
  setSource(x + grab[0], y + grab[1]);
});
$("cvS").addEventListener("pointermove", ev => {
  if (dragS) { const [x, y] = toSource(ev); setSource(x + grab[0], y + grab[1]); return; }
  const h = onSource(ev);
  $("cvS").style.cursor = h ? "grab" : "";
  setHoverSrc(h);
});
const endS = () => { if (dragS) { dragS = false; $("cvS").style.cursor = hoverSrc ? "grab" : ""; redraw(); } };
$("cvS").addEventListener("pointerup", endS);
$("cvS").addEventListener("pointercancel", endS);
$("cvS").addEventListener("pointerleave", () => { if (!dragS) { setHoverSrc(false); $("tip").hidden = true; } });
$("cvS").addEventListener("wheel", ev => {
  ev.preventDefault();
  S.zs = clamp(S.zs * Math.exp(ev.deltaY * 0.0015), 0.25, 2.5);
  saveHash(); redraw();
}, { passive: false });
$("cvS").addEventListener("dblclick", () => { S.zs = 1.25; saveHash(); redraw(); });

// sky: hover an image marker for its numbers; drag a subhalo; scroll to zoom about the
// pointer; double-click to reset the view
function nearestImage(ev) {
  if (!S.marks || !boxI) return -1;
  const r = $("cvI").getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  let best = -1, bd = 14;
  IMG.forEach((m, i) => { const q = skyToPx(m.x, m.y), dd = Math.hypot(q[0] - mx, q[1] - my); if (dd < bd) { bd = dd; best = i; } });
  return best;
}
function showTip(ev, i) {
  const tip = $("tip");
  if (i < 0) { tip.hidden = true; return; }
  const m = IMG[i], T = P.SCALE.Tstar_days;
  const rows = [["Image", `${i + 1}, ${TYPE[m.type]}`], ["Position, θ", pos(m.x, m.y)], ["Magnification, μ", sgn(m.mu, 3)]];
  if (EC) {                            // the same image for the other lens (smooth, or with the clumps)
    const { cOf, sOf } = pairUp(), on = cur === EC, o = on ? cOf.get(i) : sOf.get(i);
    rows.push([on ? "μ, smooth lens" : "μ, with subhalos", o ? sgn(o.mu, 3) : on ? "none (new image)" : "none (lost)"]);
    if (o) rows.push([on ? "Flux change from the subhalos" : "Flux change with the subhalos",
                      "×" + (on ? Math.abs(m.mu / o.mu) : Math.abs(o.mu / m.mu)).toFixed(2)],
                     ["Shift from the subhalos", num(1000 * Math.hypot(o.x - m.x, o.y - m.y), 2) + " mas"]);
  }
  rows.push(["Parity", m.mu > 0 ? "same as the source" : "mirror-reversed"],
            ["Arrives after image 1", i === 0 ? "—" : days((m.tau - IMG[0].tau) * T)]);
  tip.innerHTML = rows.map(([a, v]) => `<div class="r"><span>${a}</span><b>${v}</b></div>`).join("");
  tip.hidden = false;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, ev.clientX + 14) + "px";
  tip.style.top = Math.max(8, ev.clientY - hgt - 10) + "px";
}
function setHL(i) { if (i !== hl) { hl = i; redraw(); } }
let dragSub = -1, hs = -1;
function setHS(k) { if (k !== hs) { hs = k; redraw(); } }
function toSky(ev) {
  const r = $("cvI").getBoundingClientRect(), b = boxI, { cx, cy, E } = view();
  return [cx - E + (ev.clientX - r.left - b.x0) / b.side * 2 * E, cy + E - (ev.clientY - r.top - b.y0) / b.side * 2 * E];
}
function nearestSub(ev) {
  if (!S.showSubs || !boxI) return -1;
  const r = $("cvI").getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  let best = -1, bd = 14;
  subsList().forEach((c, k) => { const [qx, qy] = skyToPx(c.x, c.y), d = Math.hypot(qx - mx, qy - my); if (d < bd) { bd = d; best = k; } });
  return best;
}
function endSub() { if (dragSub >= 0) { dragSub = -1; draft = false; $("cvI").style.cursor = hs >= 0 ? "grab" : ""; redraw(); } }
{
  const cv = $("cvI");
  cv.addEventListener("pointerdown", ev => {
    const k = nearestSub(ev);
    if (k < 0) return;
    dragSub = k; cv.setPointerCapture(ev.pointerId); cv.style.cursor = "grabbing"; $("tip").hidden = true;
    redraw();
  });
  cv.addEventListener("pointermove", ev => {
    if (dragSub >= 0) {
      const [x, y] = toSky(ev);
      S.subs[dragSub] = [+x.toFixed(4), +y.toFixed(4)];
      lensChanged();
      return;
    }
    const k = nearestSub(ev);
    cv.style.cursor = k >= 0 ? "grab" : "";
    setHS(k);
    if (k >= 0) { $("tip").hidden = true; setHL(-1); return; }   // a clump: brightened, no caption
    const i = nearestImage(ev);
    showTip(ev, i); setHL(i);
  });
  cv.addEventListener("pointerleave", () => { $("tip").hidden = true; setHL(-1); setHS(-1); });
  cv.addEventListener("pointerup", endSub);
  cv.addEventListener("pointercancel", endSub);
  cv.addEventListener("wheel", ev => {
    ev.preventDefault();
    const [x, y] = toSky(ev), E = S.zi, E2 = clamp(E * Math.exp(ev.deltaY * 0.0015), 0.04, EI);
    if (E2 >= EI - 1e-9) { S.zi = EI; S.cix = 0; S.ciy = 0; }
    else { S.zi = E2; S.cix = +(x - (x - S.cix) * E2 / E).toFixed(5); S.ciy = +(y - (y - S.ciy) * E2 / E).toFixed(5); }
    draft = true; clearTimeout(draftTimer); draftTimer = setTimeout(() => { draft = false; redraw(); }, 220);
    saveHash(); redraw();
  }, { passive: false });
  cv.addEventListener("dblclick", () => { S.zi = EI; S.cix = 0; S.ciy = 0; saveHash(); redraw(); });
}

window.addEventListener("resize", redraw);

// ------------------------------------------------------------------ start
loadHash();
updateLens(); updateImages();
syncControls();
redraw();
window.__lensex = { S: () => S, images: () => IMG, images0: () => IMG0, imagesC: () => IMGC, flux: () => skyFlux, lens: () => L,
                    clumpy: () => (EC ? EC.L : null), frameMs: () => frameMs,
                    hover: () => ({ source: hoverSrc, sub: hs, cursorS: $("cvS").style.cursor, cursorI: $("cvI").style.cursor }),
                    sky: () => skyLast && { M: skyLast.M, scale: skyLast.scale, sum: skyLast.sum, rawSum: skyLast.rawSum },
                    // displayed sky brightness (before the color scale) at sky position (x, y)
                    skyAt: (x, y) => { const q = skyLast, i = Math.floor((x - q.cx + q.E) / (2 * q.E) * q.M), j = Math.floor((q.cy + q.E - y) / (2 * q.E) * q.M);
                                       return q.arr[j * q.M + i]; },
                    // displayed sky light summed within radius r of (x, y), in units of the full-field pixel
                    skySum: (x, y, r) => { const q = skyLast, d = 2 * q.E / q.M; let t = 0;
                                           for (let j = 0; j < q.M; j++) for (let i = 0; i < q.M; i++) {
                                             const px = q.cx - q.E + (i + 0.5) * d, py = q.cy + q.E - (j + 0.5) * d;
                                             if (Math.hypot(px - x, py - y) < r) t += q.arr[j * q.M + i]; }
                                           return t * d * d; } };
})();
