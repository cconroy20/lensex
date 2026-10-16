/* Lens physics for the Lensing Explorer.  No drawing here.

   Angles are in units of the Einstein radius theta_E.  The lens equation is
       beta = theta - alpha(theta),     alpha = grad psi,
   and the arrival time (Fermat potential), in units of the delay scale T_*, is
       tau(theta; beta) = |theta - beta|^2 / 2 - psi(theta).
   Images are the stationary points of tau; the Hessian of tau is the Jacobian
       A = d beta / d theta = I - Hess(psi),   mu = 1 / det A.

   Lens models
     point : psi = ln r                                   (theta_E = 1)
     iso   : softened isothermal ellipsoid (Keeton 2001, Sect. 3, alpha = 1;
             Keeton & Kochanek 1998), kappa = (b/2) / sqrt(s^2 + xi^2),
             xi^2 = x^2 + y^2/q^2 along the major axis, with b = 1/sqrt(q) so
             that the singular model has kappa = 1/(2 sqrt(q x^2 + y^2/q)) and
             an Einstein radius near 1 at any q.  q = 1, s = 0 is the SIS.
     plus an external shear psi = (g1 (x^2 - y^2) + 2 g2 x y) / 2, available to both,
     plus any number of subhalos: pseudo-Jaffe clumps (Dalal & Kochanek 2002, Sect. 3)
             kappa = (b/2) [1/r - 1/sqrt(r^2 + a^2)], total mass pi b a Sigma_crit,
             with b their Einstein-radius scale and a their truncation radius.
*/
(function (root) {
"use strict";

// Delay scale: T_* = (1 + z_l) D_l D_s / (c D_ls) * theta_E^2 for theta_E = 1 arcsec,
// z_l = 0.5, z_s = 2, Planck 2018 cosmology (astropy Planck18; see README).
const SCALE = { thetaE_arcsec: 1, zl: 0.5, zs: 2, Tstar_days: 86.0557,
                kpc_per_thetaE: 6.2910, Mpoint_Msun: 2.5159e11, sigmaSIS_kms: 233.99,
                sigmaCrit_Msun_pc2: 2023.5 };

// ------------------------------------------------------------------ the lens
// p = { model: "point" | "iso", s, q, pa (rad), g, gpa (rad), subs: [{x, y, b, a}] }
function makeLens(p) {
  const L = { model: p.model, s: p.s || 0, q: Math.min(1, p.q || 1), pa: p.pa || 0,
              g1: (p.g || 0) * Math.cos(2 * (p.gpa || 0)), g2: (p.g || 0) * Math.sin(2 * (p.gpa || 0)) };
  L.cp = Math.cos(L.pa); L.sp = Math.sin(L.pa);
  L.b = 1 / Math.sqrt(L.q);
  L.e = Math.sqrt(Math.max(0, 1 - L.q * L.q));
  L.subs = (p.subs || []).map(c => ({ x: c.x, y: c.y, b: c.b, a: c.a }));
  L.mainSingular = L.model === "point" || L.s === 0;
  L.singular = L.mainSingular || L.subs.length > 0;
  return L;
}

// atan(e w)/e and atanh(e w)/e, safe as e -> 0
function atanOverE(e, w) {
  const z = e * w;
  return Math.abs(z) < 1e-4 ? w * (1 - z * z / 3) : Math.atan(z) / e;
}
function atanhOverE(e, w) {
  const z = e * w;
  return Math.abs(z) < 1e-4 ? w * (1 + z * z / 3) : Math.atanh(z) / e;
}

// isothermal ellipsoid in its own frame (major axis along x).  out: [ax, ay, pxx, pyy, pxy]
function isoLocal(L, x, y, out, wantH) {
  const q = L.q, s = L.s, b = L.b;
  const psi = Math.sqrt(q * q * (s * s + x * x) + y * y);
  out[0] = b * q * atanOverE(L.e, x / (psi + s));
  out[1] = b * q * atanhOverE(L.e, y / (psi + q * q * s));
  if (wantH) {
    const D = (psi + s) * (psi + s) + (1 - q * q) * x * x;
    out[2] = b * q * (q * q * s * s + y * y + psi * s) / (psi * D);
    out[4] = -b * q * x * y / (psi * D);
    out[3] = b * q * (s * s + x * x + psi * s) / (psi * D);    // trace = 2 kappa = b q / psi
  }
}
// potential of the isothermal ellipsoid in its own frame (zero at the center)
function isoPotLocal(L, x, y) {
  const q = L.q, s = L.s, b = L.b;
  const o = [0, 0];
  isoLocal(L, x, y, o, false);
  let phi = x * o[0] + y * o[1];
  if (s > 0) {
    const psi = Math.sqrt(q * q * (s * s + x * x) + y * y);
    phi += -b * q * s * 0.5 * Math.log((psi + s) * (psi + s) + (1 - q * q) * x * x)
           + b * q * s * Math.log((1 + q) * s);
  }
  return phi;
}

// deflection, and optionally the Hessian of psi, at (x, y), of the main lens and the
// external shear.  out: [ax, ay, pxx, pyy, pxy]
const _loc = new Float64Array(5);
function deflectMain(L, x, y, out, wantH) {
  if (L.model === "point") {
    const r2 = x * x + y * y, r4 = r2 * r2;
    out[0] = x / r2; out[1] = y / r2;
    if (wantH) { out[2] = (y * y - x * x) / r4; out[3] = -out[2]; out[4] = -2 * x * y / r4; }
  } else {
    const c = L.cp, sn = L.sp;
    const xl = c * x + sn * y, yl = -sn * x + c * y;
    isoLocal(L, xl, yl, _loc, wantH);
    out[0] = c * _loc[0] - sn * _loc[1];
    out[1] = sn * _loc[0] + c * _loc[1];
    if (wantH) {                       // H = R^T H' R
      const hxx = _loc[2], hyy = _loc[3], hxy = _loc[4];
      out[2] = c * c * hxx - 2 * c * sn * hxy + sn * sn * hyy;
      out[3] = sn * sn * hxx + 2 * c * sn * hxy + c * c * hyy;
      out[4] = c * sn * (hxx - hyy) + (c * c - sn * sn) * hxy;
    }
  }
  out[0] += L.g1 * x + L.g2 * y;
  out[1] += L.g2 * x - L.g1 * y;
  if (wantH) { out[2] += L.g1; out[3] -= L.g1; out[4] += L.g2; }
  return out;
}

// add the subhalos.  For a circular pseudo-Jaffe clump, with R_a = sqrt(r^2 + a^2),
//   alpha_r = b [1 - r/(R_a + a)],   d alpha_r/dr = -b a / (R_a (R_a + a)),
//   psi = b [r - r^2/(R_a + a) + a ln((a + R_a)/(2a))],   psi(0) = 0
// (the singular isothermal sphere minus the cored one of Keeton 2001, written to avoid
// the cancellation in R_a - a = r^2/(R_a + a)).
function addSubs(L, x, y, out, wantH) {
  for (const c of L.subs) {
    const dx = x - c.x, dy = y - c.y, r2 = dx * dx + dy * dy;
    const r = Math.sqrt(r2), Ra = Math.sqrt(c.a * c.a + r2);
    const f = c.b * (1 / r - 1 / (Ra + c.a));             // alpha_r / r
    out[0] += f * dx; out[1] += f * dy;
    if (wantH) {
      const ap = -c.b * c.a / (Ra * (Ra + c.a));
      out[2] += (ap * dx * dx + f * dy * dy) / r2;
      out[3] += (ap * dy * dy + f * dx * dx) / r2;
      out[4] += (ap - f) * dx * dy / r2;
    }
  }
  return out;
}
function deflect(L, x, y, out, wantH) {
  deflectMain(L, x, y, out, wantH);
  return L.subs.length ? addSubs(L, x, y, out, wantH) : out;
}
function subPotential(c, x, y) {
  const dx = x - c.x, dy = y - c.y, r2 = dx * dx + dy * dy, r = Math.sqrt(r2), Ra = Math.sqrt(c.a * c.a + r2);
  return c.b * (r - r2 / (Ra + c.a) + c.a * Math.log((c.a + Ra) / (2 * c.a)));
}

function potential(L, x, y) {
  let p;
  if (L.model === "point") p = 0.5 * Math.log(x * x + y * y);
  else p = isoPotLocal(L, L.cp * x + L.sp * y, -L.sp * x + L.cp * y);
  p += 0.5 * L.g1 * (x * x - y * y) + L.g2 * x * y;
  for (const c of L.subs) p += subPotential(c, x, y);
  return p;
}

// convergence kappa (for the mass display and the checks)
function kappa(L, x, y) {
  let k = 0;
  if (L.model !== "point") {
    const xl = L.cp * x + L.sp * y, yl = -L.sp * x + L.cp * y;
    k = 0.5 * L.b / Math.sqrt(L.s * L.s + xl * xl + yl * yl / (L.q * L.q));
  }
  for (const c of L.subs) {
    const r2 = (x - c.x) ** 2 + (y - c.y) ** 2;
    k += 0.5 * c.b * (1 / Math.sqrt(r2) - 1 / Math.sqrt(r2 + c.a * c.a));
  }
  return k;
}

// ------------------------------------------------------------------ images
// The image plane is covered by polar grids used for image finding and critical
// curves: one centered on the lens (log-spaced in radius, uniform in angle, so the
// small-radius region is resolved as well as the Einstein ring), and a finer one
// around each subhalo, whose images and critical curves are far smaller than the
// cells of the main grid.
const GR = { rmin: 1e-3, rmax: 6, nr: 200, nphi: 256 };
const GS = { nr: 90, nphi: 120 };
const subDomain = c => Math.min(0.8, Math.max(0.08, 2 * c.a, 12 * c.b));

// One polar block.  The main-lens part of the deflection and Hessian at the nodes depends
// only on the main lens and on the node positions, so an optional cache (one per main
// lens) keeps it while subhalos are added or dragged.
function makeBlock(L, cx, cy, rmin, rmax, nr, np, cache, key) {
  const n = nr * (np + 1);
  const tx = new Float64Array(n), ty = new Float64Array(n);
  const lr0 = Math.log(rmin), dlr = (Math.log(rmax) - lr0) / (nr - 1);
  for (let i = 0; i < nr; i++) {
    const r = Math.exp(lr0 + i * dlr);
    for (let j = 0; j <= np; j++) {
      const ph = 2 * Math.PI * j / np, k = i * (np + 1) + j;
      tx[k] = cx + r * Math.cos(ph); ty[k] = cy + r * Math.sin(ph);
    }
  }
  let M = cache && cache.get(key);
  if (!M) {
    M = new Float64Array(5 * n);
    const o = new Float64Array(5);
    for (let k = 0; k < n; k++) {
      deflectMain(L, tx[k], ty[k], o, true);
      M.set(o, 5 * k);
    }
    if (cache) cache.set(key, M);
  }
  const bx = new Float64Array(n), by = new Float64Array(n), det = new Float64Array(n);
  const o = new Float64Array(5);
  for (let k = 0; k < n; k++) {
    for (let m = 0; m < 5; m++) o[m] = M[5 * k + m];
    if (L.subs.length) addSubs(L, tx[k], ty[k], o, true);
    bx[k] = tx[k] - o[0]; by[k] = ty[k] - o[1];
    det[k] = (1 - o[2]) * (1 - o[3]) - o[4] * o[4];
  }
  return { cx, cy, nr, np, tx, ty, bx, by, det, R: rmax };
}

function buildGrid(L, cache) {
  const blocks = [makeBlock(L, 0, 0, GR.rmin, GR.rmax, GR.nr, GR.nphi, cache, "main")];
  L.subs.forEach((c, k) => {
    const R = subDomain(c);
    const B = makeBlock(L, c.x, c.y, 0.02 * c.b, R, GS.nr, GS.nphi, cache, `sub ${c.x} ${c.y} ${c.b}`);
    B.sub = k;
    blocks.push(B);
  });
  // the cache keys in use, so a caller can drop entries for subhalo positions left behind
  const keys = ["main"].concat(L.subs.map(c => `sub ${c.x} ${c.y} ${c.b}`));
  return { L, blocks, keys };
}

// distance to the nearest singular point (the main center if singular, the subhalo centers)
function singDist(L, x, y) {
  let d = L.mainSingular ? Math.hypot(x, y) : Infinity;
  for (const c of L.subs) d = Math.min(d, Math.hypot(x - c.x, y - c.y));
  return d;
}

// Newton iteration on the lens equation from a starting guess
function newton(L, x, y, b0x, b0y) {
  const o = new Float64Array(5);
  for (let it = 0; it < 50; it++) {
    deflect(L, x, y, o, true);
    const fx = x - o[0] - b0x, fy = y - o[1] - b0y;
    const a11 = 1 - o[2], a22 = 1 - o[3], a12 = -o[4];
    const d = a11 * a22 - a12 * a12;
    if (!isFinite(d) || d === 0) return null;
    const dx = (a22 * fx - a12 * fy) / d, dy = (a11 * fy - a12 * fx) / d;
    let lam = 1;                       // damp steps that would jump across a singular point
    const r = singDist(L, x, y), st = Math.hypot(dx, dy);
    if (st > 0.5 * r) lam = 0.5 * r / st;
    x -= lam * dx; y -= lam * dy;
    if (st < 1e-13 * Math.max(1, Math.hypot(x, y))) break;
  }
  deflect(L, x, y, o, false);
  const res = Math.hypot(x - o[0] - b0x, y - o[1] - b0y);
  return res < 1e-9 ? [x, y] : null;
}

// Classify a stationary point from the Jacobian A = Hess(tau)
function describe(L, x, y, b0x, b0y) {
  const o = new Float64Array(5);
  deflect(L, x, y, o, true);
  const a11 = 1 - o[2], a22 = 1 - o[3], a12 = -o[4];
  const det = a11 * a22 - a12 * a12, tr = a11 + a22;
  const type = det < 0 ? "saddle" : tr > 0 ? "min" : "max";
  const tau = 0.5 * ((x - b0x) * (x - b0x) + (y - b0y) * (y - b0y)) - potential(L, x, y);
  return { x, y, mu: 1 / det, det, tr, type, tau };
}

// All images of a point source at (b0x, b0y): triangle mapping on the grids, then Newton
function findImages(G, b0x, b0y) {
  const L = G.L, found = [];
  const keep = r => {
    if (!r) return;
    const rr = Math.hypot(r[0], r[1]);
    if (rr > 1.5 * GR.rmax) return;
    if (singDist(L, r[0], r[1]) < 1e-9) return;
    for (const f of found) if (Math.hypot(f[0] - r[0], f[1] - r[1]) < 1e-7 * Math.max(1, rr)) return;
    found.push(r);
  };
  for (const B of G.blocks) {
    const { nr, np, tx, ty, bx, by } = B, W = np + 1;
    const tryTri = (a, b, c) => {
      const ax = bx[a], ay = by[a], bxx = bx[b], byy = by[b], cx = bx[c], cy = by[c];
      if (b0x < Math.min(ax, bxx, cx) || b0x > Math.max(ax, bxx, cx) ||
          b0y < Math.min(ay, byy, cy) || b0y > Math.max(ay, byy, cy)) return;
      const d = (byy - cy) * (ax - cx) + (cx - bxx) * (ay - cy);
      if (d === 0) return;
      const l1 = ((byy - cy) * (b0x - cx) + (cx - bxx) * (b0y - cy)) / d;
      const l2 = ((cy - ay) * (b0x - cx) + (ax - cx) * (b0y - cy)) / d;
      const l3 = 1 - l1 - l2, eps = -1e-9;
      if (l1 < eps || l2 < eps || l3 < eps) return;
      keep(newton(L, l1 * tx[a] + l2 * tx[b] + l3 * tx[c], l1 * ty[a] + l2 * ty[b] + l3 * ty[c], b0x, b0y));
    };
    for (let i = 0; i < nr - 1; i++) {
      for (let j = 0; j < np; j++) {
        const k00 = i * W + j, k01 = k00 + 1, k10 = k00 + W, k11 = k10 + 1;
        tryTri(k00, k10, k11);
        tryTri(k00, k11, k01);
      }
    }
  }
  // a non-singular lens center can host an image inside the innermost ring of the
  // main grid when the source sits behind the core: try the center itself as a seed
  if (!L.mainSingular) keep(newton(L, 0.5 * GR.rmin * Math.sign(b0x || 1), 0, b0x, b0y));
  const imgs = found.map(p => describe(L, p[0], p[1], b0x, b0y));
  imgs.sort((u, v) => u.tau - v.tau);
  return imgs;
}

// ------------------------------------------------------------------ critical curves
// Marching squares for det A = 0 on each grid block; the caustics are the same polylines
// mapped through the lens equation.  Where blocks overlap, a cell is left to the block of
// the subhalo (the finer grid): the main block skips cells inside any subhalo's domain,
// and each subhalo block skips cells inside the domain of an earlier one.
function criticalCurves(G) {
  const L = G.L, crit = [], caus = [], o = new Float64Array(5);
  const subsB = G.blocks.filter(B => B.sub !== undefined);
  const covered = (x, y, upto) => {
    for (const B of subsB) {
      if (B.sub >= upto) continue;
      if (Math.hypot(x - B.cx, y - B.cy) < 0.98 * B.R) return true;
    }
    return false;
  };
  for (const B of G.blocks) {
    const { nr, np, tx, ty, det } = B, W = np + 1, segs = [];
    const upto = B.sub === undefined ? Infinity : B.sub;
    const lerp = (a, b) => {
      const t = det[a] / (det[a] - det[b]);
      return [tx[a] + t * (tx[b] - tx[a]), ty[a] + t * (ty[b] - ty[a])];
    };
    for (let i = 0; i < nr - 1; i++) {
      for (let j = 0; j < np; j++) {
        const k = [i * W + j, i * W + j + 1, (i + 1) * W + j + 1, (i + 1) * W + j];
        const pts = [];
        for (let e = 0; e < 4; e++) {
          const a = k[e], b = k[(e + 1) % 4];
          if ((det[a] < 0) !== (det[b] < 0) && isFinite(det[a]) && isFinite(det[b])) pts.push(lerp(a, b));
        }
        if (pts.length < 2) continue;
        if (subsB.length && k.every(m => covered(tx[m], ty[m], upto))) continue;
        if (pts.length === 2) segs.push(pts);
        else { segs.push([pts[0], pts[1]]); segs.push([pts[2], pts[3]]); }
      }
    }
    // chain the segments into polylines
    const key = p => Math.round(p[0] * 1e7) + "," + Math.round(p[1] * 1e7);
    const ends = new Map();
    segs.forEach((sg, n) => {
      for (const e of [0, 1]) {
        const kk = key(sg[e]);
        if (!ends.has(kk)) ends.set(kk, []);
        ends.get(kk).push([n, e]);
      }
    });
    const used = new Uint8Array(segs.length);
    for (let n = 0; n < segs.length; n++) {
      if (used[n]) continue;
      used[n] = 1;
      const line = [segs[n][0], segs[n][1]];
      for (const dir of [1, 0]) {
        for (;;) {
          const tip = dir ? line[line.length - 1] : line[0];
          const cand = (ends.get(key(tip)) || []).find(([m]) => !used[m]);
          if (!cand) break;
          used[cand[0]] = 1;
          const nxt = segs[cand[0]][1 - cand[1]];
          if (dir) line.push(nxt); else line.unshift(nxt);
        }
      }
      if (line.length < (B.sub === undefined ? 4 : 2)) continue;
      crit.push(line);
      caus.push(line.map(p => { deflect(L, p[0], p[1], o, false); return [p[0] - o[0], p[1] - o[1]]; }));
    }
  }
  return { crit, caus, cuts: cutCurves(L) };
}

// At a singular isothermal center (the main SIS/SIE, or a subhalo) the deflection stays
// finite as theta -> center and depends on direction, so the center maps onto a closed
// curve in the source plane (the "cut"): crossing the cut adds or removes one image.
// A point mass has no cut.
function cutCurves(L) {
  const centers = [];
  if (L.model === "iso" && L.s === 0) centers.push([0, 0]);
  for (const c of L.subs) centers.push([c.x, c.y]);
  const o = new Float64Array(5), eps = 1e-9;
  return centers.map(([cx, cy]) => {
    const pts = [];
    for (let j = 0; j <= 360; j++) {
      const ph = 2 * Math.PI * j / 360, x = cx + eps * Math.cos(ph), y = cy + eps * Math.sin(ph);
      deflect(L, x, y, o, false);
      pts.push([x - o[0], y - o[1]]);
    }
    return pts;
  });
}

// Point-lens total magnification, Paczynski (1986)
function pointA(u) { return (u * u + 2) / (u * Math.sqrt(u * u + 4)); }

const Phys = { SCALE, GR, makeLens, deflect, deflectMain, addSubs, potential, kappa, buildGrid, findImages,
               describe, criticalCurves, newton, pointA, subDomain };
if (typeof module !== "undefined" && module.exports) module.exports = Phys;
else root.Phys = Phys;
})(typeof window !== "undefined" ? window : globalThis);
