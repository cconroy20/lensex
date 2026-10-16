// Physics checks for web/physics.js:  node validate.js
// Analytic point-mass and SIS results, internal consistency of the isothermal-ellipsoid
// formulas (deflection = grad psi, Hessian = grad deflection, trace = 2 kappa), the image
// counts predicted by the caustics and the cut, and the cross-check against lenstronomy
// (cases written by crosscheck.py, if present).
"use strict";
const fs = require("fs");
const path = require("path");
const P = require("./web/physics.js");

let nfail = 0, npass = 0;
function check(name, ok, detail) {
  ok ? npass++ : nfail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail !== undefined ? "  --  " + detail : ""}`);
}
const rnd = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const fmt = v => v.toExponential(2);

// ---------------------------------------------------------------- point mass
{
  const L = P.makeLens({ model: "point" }), G = P.buildGrid(L);
  let ePos = 0, eMu = 0, eSum = 0, eA = 0, n2 = true;
  for (const u of [0.05, 0.1, 0.3, 0.5, 1, 1.5, 2, 3]) {
    const ph = 2 * Math.PI * rnd(), bx = u * Math.cos(ph), by = u * Math.sin(ph);
    const im = P.findImages(G, bx, by);
    if (im.length !== 2) { n2 = false; continue; }
    const rp = (u + Math.sqrt(u * u + 4)) / 2, rm = (u - Math.sqrt(u * u + 4)) / 2;   // along the source direction
    const pos = [[rp * Math.cos(ph), rp * Math.sin(ph)], [rm * Math.cos(ph), rm * Math.sin(ph)]];
    const half = (u * u + 2) / (2 * u * Math.sqrt(u * u + 4));
    const mus = [half + 0.5, -(half - 0.5)];
    for (let k = 0; k < 2; k++) {
      const j = im.findIndex(m => Math.hypot(m.x - pos[k][0], m.y - pos[k][1]) < 1e-6);
      if (j < 0) { ePos = Infinity; continue; }
      ePos = Math.max(ePos, Math.hypot(im[j].x - pos[k][0], im[j].y - pos[k][1]));
      eMu = Math.max(eMu, Math.abs(im[j].mu / mus[k] - 1));
    }
    eSum = Math.max(eSum, Math.abs(im[0].mu + im[1].mu - 1));
    eA = Math.max(eA, Math.abs(Math.abs(im[0].mu) + Math.abs(im[1].mu) - P.pointA(u)) / P.pointA(u));
  }
  check("point mass: two images at (u ± sqrt(u^2+4))/2", n2 && ePos < 1e-10, `max error ${fmt(ePos)}`);
  check("point mass: magnifications (u^2+2)/(2u sqrt(u^2+4)) ± 1/2", eMu < 1e-9, `max rel error ${fmt(eMu)}`);
  check("point mass: signed magnifications sum to 1", eSum < 1e-9, `max error ${fmt(eSum)}`);
  check("point mass: total equals Paczynski A(u)", eA < 1e-9, `max rel error ${fmt(eA)}`);
  const cc = P.criticalCurves(G);
  const rc = cc.crit.flat().map(p => Math.hypot(p[0], p[1]));
  const rs = cc.caus.flat().map(p => Math.hypot(p[0], p[1]));
  check("point mass: critical curve is the unit circle", Math.max(...rc.map(r => Math.abs(r - 1))) < 2e-3,
        `|r-1| <= ${fmt(Math.max(...rc.map(r => Math.abs(r - 1))))}`);
  check("point mass: caustic collapses to the lens position", Math.max(...rs) < 5e-3, `max |beta| ${fmt(Math.max(...rs))}`);
  check("point mass: no cut", cc.cuts.length === 0);
}

// ---------------------------------------------------------------- SIS
{
  const L = P.makeLens({ model: "iso", s: 0, q: 1 }), G = P.buildGrid(L);
  let ok = true, ePos = 0, eMu = 0, eDt = 0;
  for (const u of [0.05, 0.2, 0.5, 0.8, 0.95]) {
    const ph = 2 * Math.PI * rnd(), bx = u * Math.cos(ph), by = u * Math.sin(ph);
    const im = P.findImages(G, bx, by);
    if (im.length !== 2) { ok = false; continue; }
    // first arrival = the outer minimum at u+1, then the saddle at u-1 (opposite side)
    const [a, b] = im;
    ePos = Math.max(ePos, Math.hypot(a.x - (u + 1) * Math.cos(ph), a.y - (u + 1) * Math.sin(ph)),
                          Math.hypot(b.x - (u - 1) * Math.cos(ph), b.y - (u - 1) * Math.sin(ph)));
    eMu = Math.max(eMu, Math.abs(a.mu - (1 + u) / u), Math.abs(b.mu + (1 - u) / u));
    eDt = Math.max(eDt, Math.abs((b.tau - a.tau) - 2 * u));
    if (a.type !== "min" || b.type !== "saddle") ok = false;
  }
  check("SIS: images at u+1 (minimum) and u-1 (saddle)", ok && ePos < 1e-10, `max error ${fmt(ePos)}`);
  check("SIS: magnifications (1+u)/u and -(1-u)/u", eMu < 1e-8, `max error ${fmt(eMu)}`);
  check("SIS: time delay 2u (units of T_*)", eDt < 1e-10, `max error ${fmt(eDt)}`);
  let one = true;
  for (const u of [1.05, 1.5, 2.5]) if (P.findImages(G, u, 0).length !== 1) one = false;
  check("SIS: one image for u > 1", one);
  const cc = P.criticalCurves(G);
  const cutr = cc.cuts[0].map(p => Math.hypot(p[0], p[1]));
  check("SIS: cut is the unit circle", Math.max(...cutr.map(r => Math.abs(r - 1))) < 1e-8,
        `|r-1| <= ${fmt(Math.max(...cutr.map(r => Math.abs(r - 1))))} (evaluated 1e-9 from the center)`);
  const o = new Float64Array(5);
  let eS = 0;
  for (let k = 0; k < 50; k++) {
    const x = 4 * rnd() - 2, y = 4 * rnd() - 2, r = Math.hypot(x, y);
    P.deflect(L, x, y, o, false);
    eS = Math.max(eS, Math.abs(o[0] - x / r), Math.abs(o[1] - y / r), Math.abs(P.potential(L, x, y) - r));
  }
  check("q = 1, s = 0 reduces to the SIS (alpha = theta/|theta|, psi = |theta|)", eS < 1e-12, `max error ${fmt(eS)}`);
}

// ---------------------------------------------------------------- isothermal ellipsoid formulas
{
  const cases = [{ s: 0, q: 0.7, pa: 0.3 }, { s: 0.2, q: 0.5, pa: -1.1 }, { s: 0.4, q: 1, pa: 0 },
                 { s: 0.05, q: 0.3, pa: 2.0, g: 0.12, gpa: 0.7 }, { s: 0, q: 0.9999999, pa: 0.5 }];
  let eG = 0, eH = 0, eT = 0, eC = 0, eDiv = 0;
  const o = new Float64Array(5), op = new Float64Array(5), om = new Float64Array(5);
  for (const c of cases) {
    const L = P.makeLens(Object.assign({ model: "iso" }, c));
    for (let k = 0; k < 200; k++) {
      const x = 5 * rnd() - 2.5, y = 5 * rnd() - 2.5;
      if (Math.hypot(x, y) < 0.05) continue;
      const h = 1e-5;
      P.deflect(L, x, y, o, true);
      // deflection = grad psi
      const gx = (P.potential(L, x + h, y) - P.potential(L, x - h, y)) / (2 * h);
      const gy = (P.potential(L, x, y + h) - P.potential(L, x, y - h)) / (2 * h);
      eG = Math.max(eG, Math.abs(gx - o[0]), Math.abs(gy - o[1]));
      // Hessian = grad deflection; symmetric (curl-free)
      P.deflect(L, x + h, y, op, false); P.deflect(L, x - h, y, om, false);
      const axx = (op[0] - om[0]) / (2 * h), ayx = (op[1] - om[1]) / (2 * h);
      P.deflect(L, x, y + h, op, false); P.deflect(L, x, y - h, om, false);
      const axy = (op[0] - om[0]) / (2 * h), ayy = (op[1] - om[1]) / (2 * h);
      eH = Math.max(eH, Math.abs(axx - o[2]), Math.abs(ayy - o[3]), Math.abs(axy - o[4]), Math.abs(ayx - o[4]));
      eC = Math.max(eC, Math.abs(axy - ayx));
      // Laplacian = 2 kappa (the shear is trace-free)
      eT = Math.max(eT, Math.abs(o[2] + o[3] - 2 * P.kappa(L, x, y)));
      eDiv = Math.max(eDiv, Math.abs(axx + ayy - 2 * P.kappa(L, x, y)));
    }
  }
  check("isothermal ellipsoid: deflection = grad psi (finite differences)", eG < 1e-7, `max error ${fmt(eG)}`);
  check("isothermal ellipsoid: analytic Hessian = grad deflection", eH < 1e-6, `max error ${fmt(eH)}`);
  check("isothermal ellipsoid: deflection is curl-free", eC < 1e-6, `max error ${fmt(eC)}`);
  check("isothermal ellipsoid: div alpha = 2 kappa (finite differences)", eDiv < 1e-6, `max error ${fmt(eDiv)}`);
  check("isothermal ellipsoid: trace of Hessian = 2 kappa", eT < 1e-12, `max error ${fmt(eT)}`);
  const L = P.makeLens({ model: "iso", s: 0.3, q: 0.6, pa: 0.4 });
  check("softened model: psi(0) = 0", Math.abs(P.potential(L, 0, 0)) < 1e-14, fmt(P.potential(L, 0, 0)));
  // mass normalization: kappa = 1/(2 sqrt(q x^2 + y^2/q)) for the singular model
  const L2 = P.makeLens({ model: "iso", s: 0, q: 0.6, pa: 0 });
  let eK = 0;
  for (let k = 0; k < 50; k++) {
    const x = 4 * rnd() - 2, y = 4 * rnd() - 2;
    eK = Math.max(eK, Math.abs(P.kappa(L2, x, y) - 0.5 / Math.sqrt(0.6 * x * x + y * y / 0.6)));
  }
  check("singular ellipsoid: kappa = 1/(2 sqrt(q x^2 + y^2/q))", eK < 1e-14, fmt(eK));
}

// ---------------------------------------------------------------- image counts
function inside(poly, x, y) {          // even-odd rule
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distToLines(lines, x, y) {
  let d = Infinity;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const [ax, ay] = l[i - 1], [bx, by] = l[i];
    const vx = bx - ax, vy = by - ay, w = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1);
    const t = Math.max(0, Math.min(1, w));
    d = Math.min(d, Math.hypot(ax + t * vx - x, ay + t * vy - y));
  }
  return d;
}
function countTest(name, spec, N, margin) {
  const L = P.makeLens(spec), G = P.buildGrid(L), cc = P.criticalCurves(G);
  const edges = cc.caus.concat(cc.cuts);
  let bad = 0, tested = 0, oddOK = true, minFirst = true, eqRes = 0, typeOK = true;
  const hist = {};
  for (let k = 0; k < N; k++) {
    const bx = 3 * rnd() - 1.5, by = 3 * rnd() - 1.5;
    if (distToLines(edges, bx, by) < margin) continue;
    tested++;
    // predicted count: 1 + 2 per caustic enclosing the source (+1 inside the cut);
    // a point mass always keeps a second image close to the mass, so it starts at 2
    let pred = L.model === "point" ? 2 : 1;
    for (const c of cc.caus) if (inside(c, bx, by)) pred += 2;
    for (const c of cc.cuts) if (inside(c, bx, by)) pred += 1;
    const im = P.findImages(G, bx, by);
    hist[im.length] = (hist[im.length] || 0) + 1;
    if (im.length !== pred) bad++;
    if (!L.singular && im.length % 2 !== 1) oddOK = false;
    if (im.length && im[0].type !== "min") minFirst = false;
    const o = new Float64Array(5);
    for (const m of im) {
      P.deflect(L, m.x, m.y, o, true);
      eqRes = Math.max(eqRes, Math.hypot(m.x - o[0] - bx, m.y - o[1] - by));
      const a11 = 1 - o[2], a22 = 1 - o[3], d = a11 * a22 - o[4] * o[4];
      const t = d < 0 ? "saddle" : a11 + a22 > 0 ? "min" : "max";
      if (t !== m.type) typeOK = false;
    }
  }
  const h = Object.keys(hist).sort().map(k => `${k}:${hist[k]}`).join(" ");
  check(`${name}: image count = ${L.model === "point" ? 2 : 1} + 2 per enclosing caustic${cc.cuts.length ? " (+1 inside cut)" : ""}`, bad === 0, `${tested} sources, ${bad} mismatches; counts ${h}`);
  if (!L.singular) check(`${name}: odd number of images`, oddOK);
  check(`${name}: first image to arrive is a minimum`, minFirst);
  check(`${name}: lens-equation residual of every image`, eqRes < 1e-10, fmt(eqRes));
  check(`${name}: image types match the Hessian`, typeOK);
}
countTest("cored isothermal sphere (s = 0.3)", { model: "iso", s: 0.3, q: 1 }, 1500, 3e-3);
countTest("SIE + shear (q = 0.7, g = 0.1)", { model: "iso", s: 0, q: 0.7, pa: 0.4, g: 0.1, gpa: 1.3 }, 1500, 3e-3);
countTest("cored SIE + shear (s = 0.1)", { model: "iso", s: 0.1, q: 0.6, pa: 0.2, g: 0.08, gpa: -0.6 }, 1500, 3e-3);
countTest("point mass + shear (Chang-Refsdal)", { model: "point", g: 0.3, gpa: 0.3 }, 1500, 3e-3);


// ---------------------------------------------------------------- subhalos (pseudo-Jaffe)
const subFromMass = (M, x, y) => {               // M in Msun for theta_E = 1 arcsec; a = sqrt(b b_0)
  const b = Math.pow(M / P.SCALE.Mpoint_Msun, 2 / 3);
  return { x, y, b, a: Math.sqrt(b) };
};
{
  const c = subFromMass(1e9, 0.3, -0.2);
  const L = P.makeLens({ model: "point", subs: [c] });      // point mass + one clump
  const L1 = P.makeLens({ model: "iso", s: 0.5, q: 1 });
  // far field of the clump alone: a point mass with theta_E^2 = b a (total mass pi b a Sigma_c)
  const Lc = P.makeLens({ model: "iso", s: 1e3, q: 1, subs: [c] });   // a negligible main lens
  const o = new Float64Array(5), o0 = new Float64Array(5);
  let eFar = 0;
  for (const r of [50, 200]) {
    P.deflect(Lc, c.x + r, c.y, o, false); P.deflectMain(Lc, c.x + r, c.y, o0, false);
    eFar = Math.max(eFar, Math.abs((o[0] - o0[0]) * r / (c.b * c.a) - 1) / (c.a / r));
  }
  check("pseudo-Jaffe clump: far field is a point mass of theta_E^2 = b a (error ~ a/r)", eFar < 2, `max (rel error)/(a/r) ${eFar.toFixed(2)}`);
  check("pseudo-Jaffe clump: psi = 0 at the clump center", Math.abs(P.potential(Lc, c.x, c.y) - P.potential(P.makeLens({ model: "iso", s: 1e3, q: 1 }), c.x, c.y)) < 1e-15);
  check("pseudo-Jaffe clump: a = sqrt(b b_0), M = 1e9 Msun gives b = 0.025, a = 0.16", Math.abs(c.b - 0.0251) < 2e-4 && Math.abs(c.a - 0.158) < 1e-3, `b ${c.b.toFixed(4)}, a ${c.a.toFixed(4)}`);
  void L; void L1;
}
{
  const cases = [
    { model: "iso", s: 0, q: 0.7, pa: 0.4, g: 0.08, gpa: 2.1, subs: [subFromMass(1e9, 0.9, 0.5), subFromMass(1e8, -0.8, 0.7), subFromMass(3e9, 0.1, -1.1)] },
    { model: "point", subs: [subFromMass(1e10, 1.0, 0.1), subFromMass(1e7, -0.6, -0.9)] },
    { model: "iso", s: 0.1, q: 1, subs: [subFromMass(5e8, 0.3, 0.95)] },
  ];
  let eG = 0, eH = 0, eC = 0, eDiv = 0;
  const o = new Float64Array(5), op = new Float64Array(5), om = new Float64Array(5);
  for (const c of cases) {
    const L = P.makeLens(c);
    for (let k = 0; k < 300; k++) {
      const x = 5 * rnd() - 2.5, y = 5 * rnd() - 2.5, h = 1e-6;
      if (Math.hypot(x, y) < 0.05 || L.subs.some(s => Math.hypot(x - s.x, y - s.y) < 0.02)) continue;
      P.deflect(L, x, y, o, true);
      const gx = (P.potential(L, x + h, y) - P.potential(L, x - h, y)) / (2 * h);
      const gy = (P.potential(L, x, y + h) - P.potential(L, x, y - h)) / (2 * h);
      eG = Math.max(eG, Math.abs(gx - o[0]), Math.abs(gy - o[1]));
      P.deflect(L, x + h, y, op, false); P.deflect(L, x - h, y, om, false);
      const axx = (op[0] - om[0]) / (2 * h), ayx = (op[1] - om[1]) / (2 * h);
      P.deflect(L, x, y + h, op, false); P.deflect(L, x, y - h, om, false);
      const axy = (op[0] - om[0]) / (2 * h), ayy = (op[1] - om[1]) / (2 * h);
      eH = Math.max(eH, Math.abs(axx - o[2]), Math.abs(ayy - o[3]), Math.abs(axy - o[4]), Math.abs(ayx - o[4]));
      eC = Math.max(eC, Math.abs(axy - ayx));
      eDiv = Math.max(eDiv, Math.abs(o[2] + o[3] - 2 * P.kappa(L, x, y)), Math.abs(axx + ayy - 2 * P.kappa(L, x, y)));
    }
  }
  check("lens + subhalos: deflection = grad psi", eG < 1e-7, `max error ${fmt(eG)}`);
  check("lens + subhalos: analytic Hessian = grad deflection", eH < 1e-5, `max error ${fmt(eH)}`);
  check("lens + subhalos: curl-free", eC < 1e-5, `max error ${fmt(eC)}`);
  check("lens + subhalos: trace of Hessian and div alpha = 2 kappa", eDiv < 1e-5, `max error ${fmt(eDiv)}`);
}
// Independent image search: a uniform Cartesian triangle grid (spacing 0.0033) with Newton
// refinement, compared with the polar-block finder of physics.js.
function bruteImages(L, srcs, n = 1600, E = 2.6) {
  const d = 2 * E / (n - 1), bx = new Float64Array(n * n), by = new Float64Array(n * n), o = new Float64Array(5);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -E + i * d, y = -E + j * d;
    P.deflect(L, x, y, o, false);
    bx[j * n + i] = x - o[0]; by[j * n + i] = y - o[1];
  }
  return srcs.map(([sx, sy]) => {
    const found = [];
    const tri = (a, b, c) => {
      const ax = bx[a], ay = by[a], bbx = bx[b], bby = by[b], cx = bx[c], cy = by[c];
      if (sx < Math.min(ax, bbx, cx) || sx > Math.max(ax, bbx, cx) || sy < Math.min(ay, bby, cy) || sy > Math.max(ay, bby, cy)) return;
      const D = (bby - cy) * (ax - cx) + (cx - bbx) * (ay - cy);
      if (!D) return;
      const l1 = ((bby - cy) * (sx - cx) + (cx - bbx) * (sy - cy)) / D, l2 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / D;
      if (l1 < -1e-9 || l2 < -1e-9 || 1 - l1 - l2 < -1e-9) return;
      const X = (k) => -E + (k % n) * d, Y = (k) => -E + Math.floor(k / n) * d;
      const r = P.newton(L, l1 * X(a) + l2 * X(b) + (1 - l1 - l2) * X(c), l1 * Y(a) + l2 * Y(b) + (1 - l1 - l2) * Y(c), sx, sy);
      if (r && !found.some(f => Math.hypot(f[0] - r[0], f[1] - r[1]) < 1e-7)) found.push(r);
    };
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const k = j * n + i;
      tri(k, k + 1, k + n + 1); tri(k, k + n + 1, k + n);
    }
    return found;
  });
}
{
  const configs = [
    ["SIE + shear + 6 clumps of 1e9", { model: "iso", s: 0, q: 0.7, pa: 0.4, g: 0.08, gpa: 2.1,
      subs: [[0.9, 0.5], [-0.8, 0.7], [0.1, -1.1], [1.1, -0.3], [-0.4, -0.9], [-1.0, 0.0]].map(([x, y]) => subFromMass(1e9, x, y)) }],
    ["cored sphere + 4 clumps of 1e8", { model: "iso", s: 0.1, q: 1, subs: [[0.7, 0.6], [-0.9, 0.2], [0.2, -0.95], [0.5, -0.5]].map(([x, y]) => subFromMass(1e8, x, y)) }],
    ["point mass + 3 clumps of 1e9", { model: "point", subs: [[1.0, 0.2], [-0.5, 0.8], [0.3, -1.2]].map(([x, y]) => subFromMass(1e9, x, y)) }],
    ["SIE + 1e10 clump on an image", { model: "iso", s: 0, q: 0.8, pa: 0.2, subs: [subFromMass(1e10, 1.12, 0.05)] }],
  ];
  let fastMiss = 0, bruteMiss = 0, nimg = 0, nsrc = 0;
  const hist = {};
  for (const [name, spec] of configs) {
    const L = P.makeLens(spec), G = P.buildGrid(L);
    const srcs = [];
    for (let k = 0; k < 14; k++) { const r = 0.5 * Math.sqrt(rnd()), ph = 2 * Math.PI * rnd(); srcs.push([r * Math.cos(ph), r * Math.sin(ph)]); }
    // targeted sources: the smooth lens maps each clump position onto the source plane at
    // beta_c; sources at and around beta_c put a macro image right on the clump
    const L0 = P.makeLens(Object.assign({}, spec, { subs: [] })), o0 = new Float64Array(5);
    for (const c of L.subs) {
      P.deflect(L0, c.x, c.y, o0, false);
      const bcx = c.x - o0[0], bcy = c.y - o0[1];
      for (let k = 0; k < 4; k++) {
        const r = k === 0 ? 0 : c.b * (0.3 + 1.5 * rnd()), ph = 2 * Math.PI * rnd();
        srcs.push([bcx + r * Math.cos(ph), bcy + r * Math.sin(ph)]);
      }
    }
    const brute = bruteImages(L, srcs);
    srcs.forEach(([sx, sy], k) => {
      nsrc++;
      const fast = P.findImages(G, sx, sy);
      hist[fast.length] = (hist[fast.length] || 0) + 1;
      nimg += fast.length;
      for (const b of brute[k]) if (!fast.some(f => Math.hypot(f.x - b[0], f.y - b[1]) < 1e-6)) {
        fastMiss++; console.log(`   ${name}: fast finder missed image at (${b[0].toFixed(5)}, ${b[1].toFixed(5)}) for source (${sx.toFixed(4)}, ${sy.toFixed(4)})`);
      }
      for (const f of fast) if (!brute[k].some(b => Math.hypot(f.x - b[0], f.y - b[1]) < 1e-6)) bruteMiss++;
    });
  }
  const h = Object.keys(hist).sort((a, b) => a - b).map(k => `${k}:${hist[k]}`).join(" ");
  check("lens + subhalos: no image found by a brute-force Cartesian search is missed", fastMiss === 0,
        `${nsrc} sources, ${nimg} images (counts ${h}); brute force missed ${bruteMiss} that the block grids found`);
}

// ---------------------------------------------------------------- lenstronomy
const xfile = path.join(__dirname, "cache", "lenstronomy_cases.json");
if (fs.existsSync(xfile)) {
  const X = JSON.parse(fs.readFileSync(xfile, "utf8"));
  // lenstronomy's isothermal (NIE) Hessian is a one-sided finite difference of its analytic
  // deflection, good to ~1e-6, so the Hessian and magnifications are graded at that floor.
  // Its deflection and potential are analytic but regularized: round lenses get an
  // ellipticity floor and the "singular" SIE a 1e-10 core, which move them by <~1e-8.  The
  // cored ellipsoid has neither, and there the two codes must agree to rounding.
  const extra = [];
  let eX = 0, eA = 0, eH = 0, eF = 0, eImg = 0, eMu = 0, eDt = 0, nOK = true, ncase = 0, nimg = 0;
  const o = new Float64Array(5);
  for (const c of X.cases) {
    const L = P.makeLens(c.spec), G = P.buildGrid(L);
    const exact = c.spec.model === "iso" && c.spec.s > 0 && c.spec.q < 1;
    for (const pt of c.points) {
      P.deflect(L, pt.x, pt.y, o, true);
      if (exact) eX = Math.max(eX, Math.abs(o[0] - pt.ax), Math.abs(o[1] - pt.ay));
      eA = Math.max(eA, Math.abs(o[0] - pt.ax), Math.abs(o[1] - pt.ay));
      eH = Math.max(eH, Math.abs(o[2] - pt.fxx), Math.abs(o[3] - pt.fyy), Math.abs(o[4] - pt.fxy));
    }
    const d0 = P.potential(L, c.points[0].x, c.points[0].y) - c.points[0].psi;    // up to a constant
    for (const pt of c.points) eF = Math.max(eF, Math.abs(P.potential(L, pt.x, pt.y) - pt.psi - d0));
    for (const src of c.sources) {
      ncase++;
      const im = P.findImages(G, src.bx, src.by);
      // every lenstronomy image must be found; images found here and not by lenstronomy must
      // be genuine roots next to a singular center, where its grid search (min_distance
      // 0.001) does not look
      for (const ref of src.images) if (!im.some(m => Math.hypot(m.x - ref.x, m.y - ref.y) < 1e-6)) {
        nOK = false; console.log("   missed", JSON.stringify(c.spec).slice(0, 60), src.bx, src.by, ref.x, ref.y);
      }
      for (const m of im) if (!src.images.some(ref => Math.hypot(m.x - ref.x, m.y - ref.y) < 1e-6)) {
        P.deflect(L, m.x, m.y, o, false);
        const res = Math.hypot(m.x - o[0] - src.bx, m.y - o[1] - src.by);
        let ds = L.mainSingular ? Math.hypot(m.x, m.y) : Infinity;
        for (const s of L.subs) ds = Math.min(ds, Math.hypot(m.x - s.x, m.y - s.y));
        extra.push([res, ds, m.mu]);
      }
      const t0 = Math.min(...src.images.map(r => r.tau));
      const t0m = Math.min(...im.filter(m => src.images.some(ref => Math.hypot(m.x - ref.x, m.y - ref.y) < 1e-6)).map(m => m.tau));
      for (const ref of src.images) {
        nimg++;
        const m = im.reduce((a, b) => (Math.hypot(a.x - ref.x, a.y - ref.y) < Math.hypot(b.x - ref.x, b.y - ref.y) ? a : b));
        eImg = Math.max(eImg, Math.hypot(m.x - ref.x, m.y - ref.y));
        eMu = Math.max(eMu, Math.abs(m.mu / ref.mu - 1));
        eDt = Math.max(eDt, Math.abs((m.tau - t0m) - (ref.tau - t0)));
      }
    }
  }
  const ncas = X.cases.length;
  check("lenstronomy, cored ellipsoid + shear (no regularization): deflection", eX < 1e-13, `max error ${fmt(eX)}`);
  check(`lenstronomy (${ncas} lenses): deflection at random points`, eA < 2e-8, `max error ${fmt(eA)}`);
  check(`lenstronomy: lensing potential (up to a constant)`, eF < 2e-8, `max error ${fmt(eF)}`);
  check(`lenstronomy: Hessian (its finite-difference floor ~1e-6)`, eH < 1e-5, `max error ${fmt(eH)}`);
  check(`lenstronomy: every image found by lenstronomy's solver is found`, nOK, `${ncase} sources, ${nimg} images`);
  const exOK = extra.every(([res, ds]) => res < 1e-9 && ds < 0.01);
  check("lenstronomy: extra images found here are true roots within 0.01 of a singular center", exOK,
        `${extra.length} extra: ` + extra.map(([res, ds, mu]) => `|mu| ${Math.abs(mu).toFixed(3)} at ${ds.toFixed(4)} (residual ${res.toExponential(0)})`).join(", "));
  check(`lenstronomy: image positions`, eImg < 1e-7, `max error ${fmt(eImg)}`);
  check(`lenstronomy: magnifications (at its Hessian floor)`, eMu < 1e-4, `max rel error ${fmt(eMu)}`);
  check(`lenstronomy: relative time delays (units of T_*)`, eDt < 2e-8, `max error ${fmt(eDt)}`);
  check("lenstronomy: delay scale T_* for theta_E = 1 arcsec", Math.abs(X.Tstar_days / P.SCALE.Tstar_days - 1) < 1e-5,
        `${X.Tstar_days.toFixed(4)} vs ${P.SCALE.Tstar_days} days`);
} else {
  console.log("(no cache/lenstronomy_cases.json; run crosscheck.py for the lenstronomy comparison)");
}

console.log(`\n${npass} passed, ${nfail} failed`);
process.exit(nfail ? 1 : 0);
