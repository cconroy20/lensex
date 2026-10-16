// Drive the page in headless Chrome and check that each interaction does what it should:
// dragging the source, the lens models and sliders, the source shapes, the display toggles,
// hover tooltips on the image markers, rotating the arrival-time surface, the contour view,
// the URL hash, and the phone-width layout.  Reading the code does not catch a dead handler;
// driving it does.
//   python3 web/serve.py 8791 &   then   node uitest.js [url] [outdir]
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const URL0 = process.argv[2] || "http://localhost:8791/";
const OUT = process.argv[3] || path.join(__dirname, "cache", "shots");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9337;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(name, ok, detail) {
  if (!ok) fails++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail !== undefined ? "  --  " + detail : ""}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync("/tmp/lensex-chrome-");
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`, "--window-size=1440,1300", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let tabs = null;
  for (let i = 0; i < 50 && !tabs; i++) {
    await sleep(200);
    try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch (e) { /* not up yet */ }
  }
  const page = tabs.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(JSON.stringify(m.params.args));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text + " " + (m.params.entry.url || ""));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
  // full-page shots resize the viewport, which re-lays out the page and ends any hover state;
  // hover shots therefore capture the viewport only
  const shot = async (name, viewportOnly = false) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !viewportOnly });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
  };
  const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const rect = async sel => ev(`(r => ({x: r.left, y: r.top, w: r.width, h: r.height}))(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
  const scrollTo = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block: "center"})`); await sleep(120); };
  const setRange = async (sel, v) => { await ev(`(e => { e.value = ${v}; e.dispatchEvent(new Event("input", {bubbles: true})); })(document.querySelector(${JSON.stringify(sel)}))`); await sleep(350); };
  const clickSel = async sel => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await sleep(250); };
  const imgs = async () => ev(`window.__lensex.images().map(m => m.type)`);
  // canvas pixel statistics: fraction of bright pixels in the sky panel
  const brightFrac = async sel => ev(`(() => { const c = document.querySelector(${JSON.stringify(sel)}), g = c.getContext("2d");
      const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150) n++; return n / (d.length / 4); })()`);
  // drag in the source plane from one theta_E position to another
  const dragSource = async (x0, y0, x1, y1, steps = 8) => {
    await scrollTo("#cvS");
    const r = await rect("#cvS");
    const box = await ev(`(() => { const c = document.querySelector("#cvS"); const w = c.clientWidth, h = c.clientHeight;
        const side = Math.floor(Math.min(w - 56, h - 48)); return { x0: 48 + Math.floor((w - 56 - side) / 2), y0: 6, side }; })()`);
    const E = await ev(`window.__lensex.S().zs`);
    const toPx = (x, y) => [r.x + box.x0 + (x + E) / (2 * E) * box.side, r.y + box.y0 + (E - y) / (2 * E) * box.side];
    let [px, py] = toPx(x0, y0);
    await mouse("mousePressed", px, py);
    for (let k = 1; k <= steps; k++) {
      [px, py] = toPx(x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps);
      await mouse("mouseMoved", px, py); await sleep(40);
    }
    await mouse("mouseReleased", px, py);
    await sleep(250);
  };

  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
  await send("Page.navigate", { url: URL0 });
  await sleep(1800);

  // ---------------------------------------------------------------- default state
  check("no errors on load", errors.length === 0, errors.join(" | "));
  const t0 = await imgs();
  check("default (cored lens, source near the axis): minimum, saddle, maximum", t0.join(",") === "min,saddle,max", t0.join(","));
  const Sd = await ev(`window.__lensex.S()`);
  check("default: a point source seen at 0.05\" resolution", Sd.type === "pt" && Math.abs(Sd.fw - Math.log10(0.05)) < 1e-9 && /0\.05″ FWHM/.test(await ev(`document.getElementById("vFW").textContent`)));
  check("no image count on the sky panel", (await ev(`document.getElementById("iSub").textContent`)) === "");
  check("two panels only (source plane and sky)", (await ev(`document.querySelectorAll(".panel").length`)) === 2 && (await ev(`document.getElementById("cvT")`)) === null);
  // layout: the two panels and all the controls fit in one screen, with no scrolling
  for (const [W, H, model] of [[1440, 900, "mCored"], [1280, 800, "mCored"], [1440, 900, "mEll"], [1280, 800, "mEll"]]) {
    await clickSel("#" + model);
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const lay = await ev(`(() => { const c = document.querySelector(".controls").getBoundingClientRect(), p = document.querySelector(".panels").getBoundingClientRect();
        return { bottom: c.bottom + window.scrollY, panelsBottom: p.bottom + window.scrollY, sw: document.documentElement.scrollWidth }; })()`);
    check(`${W} x ${H}, ${model.slice(1)}: the controls end inside the window`, lay.bottom <= H && lay.panelsBottom < lay.bottom && lay.sw <= W, `controls end at ${lay.bottom.toFixed(0)} px`);
    const cvs = await ev(`[...document.querySelectorAll("canvas")].map(c => [c.clientWidth, c.clientHeight])`);
    check(`${W} x ${H}, ${model.slice(1)}: the two canvases are equal squares of at least 400 px`, cvs.length === 2 && cvs[0][0] === cvs[1][0] && cvs[0][0] === cvs[0][1] && cvs[0][0] >= 400, JSON.stringify(cvs));
    if (W === 1440 && model === "mEll") await shot("layout_1440x900.png");
    if (W === 1280 && model === "mEll") await shot("layout_1280x800.png");
  }
  await clickSel("#mCored");
  await send("Emulation.clearDeviceMetricsOverride");
  await sleep(500);
  check("the Images box is gone", (await ev(`document.getElementById("tbImg")`)) === null);
  await shot("default.png");
  // the tests of the extended-source rendering below use a disk and a perfect telescope
  await clickSel("#tDisk");
  await setRange("#sFW", -2.3);
  const bf0 = await brightFrac("#cvI");
  check("sky panel shows lensed light", bf0 > 0.005, (100 * bf0).toFixed(2) + "% bright pixels");

  // ---------------------------------------------------------------- drag the source
  // hovering the source brightens the source and offers a grab; a grab moves the source without a jump
  {
    await scrollTo("#cvS");
    const r = await rect("#cvS");
    const box = await ev(`(() => { const c = document.querySelector("#cvS"); const w = c.clientWidth, h = c.clientHeight;
        const side = Math.floor(Math.min(w - 56, h - 48)); return { x0: 48 + Math.floor((w - 56 - side) / 2), y0: 6, side }; })()`);
    const S0 = await ev(`window.__lensex.S()`), E = S0.zs, k = box.side / (2 * E);
    const px = r.x + box.x0 + (S0.bx + E) * k, py = r.y + box.y0 + (E - S0.by) * k;
    await move(px + 40, py + 40); await sleep(80);
    const away = await ev(`window.__lensex.hover()`);
    await move(px + 4, py); await sleep(120);
    const over = await ev(`window.__lensex.hover()`), tipS = await ev(`document.getElementById("tip").hidden`);
    check("hovering the source highlights the source, with a grab cursor and no caption", !away.source && over.source && over.cursorS === "grab" && tipS, JSON.stringify(over));
    await shot("hover_source.png", true);
    await mouse("mousePressed", px + 4, py);
    for (let s = 1; s <= 5; s++) { await mouse("mouseMoved", px + 4 + 12 * s, py - 6 * s); await sleep(40); }
    await mouse("mouseReleased", px + 64, py - 30); await sleep(150);
    const S9 = await ev(`window.__lensex.S()`);
    check("grabbing the source moves the source by the drag, without a jump to the pointer",
          Math.abs(S9.bx - (S0.bx + 60 / k)) < 0.004 && Math.abs(S9.by - (S0.by + 30 / k)) < 0.004,
          `Δβ = (${(S9.bx - S0.bx).toFixed(4)}, ${(S9.by - S0.by).toFixed(4)}) vs (${(60 / k).toFixed(4)}, ${(30 / k).toFixed(4)})`);
    await move(5, 5); await sleep(60);
  }
  await dragSource(0.5, 0.3, 0.9, 0.5);
  const S1 = await ev(`window.__lensex.S()`);
  check("dragging moves the source", Math.abs(S1.bx - 0.9) < 0.02 && Math.abs(S1.by - 0.5) < 0.02, `β = (${S1.bx.toFixed(3)}, ${S1.by.toFixed(3)})`);
  const t1 = await imgs();
  check("source far off axis: one image", t1.length === 1 && t1[0] === "min", t1.join(","));
  check("position readout follows the source", /0\.9/.test(await ev(`document.getElementById("vB").textContent`)));
  check("URL hash records the source", /bx=0\.9/.test(await ev(`location.hash`)), await ev(`location.hash`));
  const fmsDrag = await ev(`window.__lensex.frameMs()`);
  check("source drag: frame time (cored lens, disk source)", fmsDrag < 150, fmsDrag.toFixed(0) + " ms");
  await dragSource(0.9, 0.5, 0.05, 0.02);

  // ---------------------------------------------------------------- models
  await clickSel("#mPoint");
  const tp = await imgs();
  check("point mass: two images (minimum, saddle)", tp.join(",") === "min,saddle", tp.join(","));
  check("point mass: no lens sliders shown", (await ev(`getComputedStyle(document.querySelector("#sCore").parentElement).display`)) === "none");
  const fx = await ev(`window.__lensex.flux()`);
  check("point mass near alignment: extended flux magnified", fx.lensed / fx.unlensed > 3, (fx.lensed / fx.unlensed).toFixed(2));
  await shot("point.png");
  await clickSel("#mSIS");
  check("SIS: two images", (await imgs()).join(",") === "min,saddle");
  await clickSel("#mEll");
  const te = await imgs();
  check("ellipse + shear, source near center: quad (two minima, two saddles)",
        te.length === 4 && te.filter(t => t === "min").length === 2 && te.filter(t => t === "saddle").length === 2, te.join(","));
  check("ellipse: axis-ratio slider shown", (await ev(`getComputedStyle(document.querySelector("#sQ").parentElement).display`)) !== "none");
  await shot("ellipse_quad.png");
  await setRange("#sCore", 0.12);
  const fmsLens = await ev(`window.__lensex.frameMs()`);
  check("lens slider: frame time after the full-resolution redraw", fmsLens < 400, fmsLens.toFixed(0) + " ms");
  const tc = await imgs();
  check("cored ellipse: five images (odd)", tc.length === 5, tc.join(","));
  await setRange("#sCore", 0);
  await setRange("#sQ", 1); await setRange("#sG", 0);
  check("q = 1 and no shear: back to two images", (await imgs()).length === 2, (await imgs()).join(","));
  await setRange("#sQ", 0.7); await setRange("#sG", 0.08);

  // ---------------------------------------------------------------- shapes and toggles
  check("the F source is gone", (await ev(`document.getElementById("tF")`)) === null);
  for (const [idd, name] of [["#tGal", "galaxy"], ["#tDisk", "disk"]]) {
    await clickSel(idd);
    const bf = await brightFrac("#cvS");
    check(`source shape ${name} renders`, bf > 0.0005, (100 * bf).toFixed(3) + "%");
    if (name === "galaxy") { await dragSource(0.05, 0.02, 0.1, 0.05, 4); const fg = await ev(`window.__lensex.frameMs()`);
      check("source drag: frame time (galaxy source)", fg < 200, fg.toFixed(0) + " ms"); }
  }
  // inclination: edge-on, the disk covers ~0.1 of its face-on area
  await move(5, 5); await sleep(150);          // off the source, so no hover ring is counted
  // bright pixels inside the plot box only (the frame and tick marks are light gray)
  const brightIn = async sel => ev(`(() => { const c = document.querySelector(${JSON.stringify(sel)}), g = c.getContext("2d"), dpr = c.width / c.clientWidth;
      const w = c.clientWidth, h = c.clientHeight, side = Math.floor(Math.min(w - 56, h - 48)), x0 = 48 + Math.floor((w - 56 - side) / 2), y0 = 6;
      const d = g.getImageData(Math.ceil((x0 + 2) * dpr), Math.ceil((y0 + 2) * dpr), Math.floor((side - 4) * dpr), Math.floor((side - 4) * dpr)).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150) n++; return n; })()`);
  const bfFace = await brightIn("#cvS");
  await setRange("#sInc", 90);
  const bfEdge = await brightIn("#cvS");
  check("inclination: an edge-on disk shrinks to ~0.1 of its face-on area", bfEdge / bfFace > 0.05 && bfEdge / bfFace < 0.2 && /edge-on/.test(await ev(`document.getElementById("vInc").textContent`)),
        `area ratio ${(bfEdge / bfFace).toFixed(3)}`);
  await setRange("#sInc", 60);
  await shot("disk_inclined.png");
  check("inclination is kept in the URL hash", /inc=60/.test(await ev(`location.hash`)));
  await setRange("#sInc", 0);
  await setRange("#sR", Math.log10(0.3));
  check("size slider (logarithmic) updates the readout", /0\.3 θ/.test(await ev(`document.getElementById("vR").textContent`)), await ev(`document.getElementById("vR").textContent`));
  for (const c of ["#cUnl", "#cMass"]) await clickSel(c);
  await shot("toggles.png");
  check("no errors after toggles", errors.length === 0, errors.join(" | "));
  for (const c of ["#cUnl", "#cMass"]) await clickSel(c);
  await setRange("#sR", Math.log10(0.1));

  // ---------------------------------------------------------------- hover tooltips
  const hover = async sel => {
    await scrollTo(sel);
    const r = await rect(sel);
    const pts = await ev(`window.__lensex.images().map(m => [m.x, m.y])`);
    let hits = 0;
    for (const [x, y] of pts) {
      if (sel === "#cvI") {
        const box = await ev(`(() => { const c = document.querySelector("#cvI"); const w = c.clientWidth, h = c.clientHeight;
            const side = Math.floor(Math.min(w - 56, h - 48)); return { x0: 48 + Math.floor((w - 56 - side) / 2), y0: 6, side }; })()`);
        await move(r.x + box.x0 + (x + 2.5) / 5 * box.side, r.y + box.y0 + (2.5 - y) / 5 * box.side);
      }
      await sleep(80);
      const t = await ev(`document.getElementById("tip").hidden ? "" : document.getElementById("tip").textContent`);
      if (/Magnification/.test(t)) hits++;
    }
    await move(5, 5);
    return [hits, pts.length];
  };
  const [hI, nI] = await hover("#cvI");
  check("hovering each image marker in the sky shows its numbers", hI === nI, `${hI}/${nI}`);

  // ---------------------------------------------------------------- subhalos
  await dragSource(0.1, 0.05, 0.05, 0.02);
  await setRange("#sN", 6);
  const ns = await ev(`window.__lensex.lens().subs.length`);
  check("subhalo slider adds six clumps to the lens", ns === 6, String(ns));
  await shot("subhalos.png");
  // drag clump 1 next to the brightest saddle image and compare its magnification with the smooth lens
  const skyPx = async (x, y) => ev(`(() => { const c = document.querySelector("#cvI"), r = c.getBoundingClientRect(), S = window.__lensex.S();
      const w = c.clientWidth, h = c.clientHeight, side = Math.floor(Math.min(w - 56, h - 48)), x0 = 48 + Math.floor((w - 56 - side) / 2), y0 = 6;
      return [r.left + x0 + (${x} - S.cix + S.zi) / (2 * S.zi) * side, r.top + y0 + (S.ciy + S.zi - ${y}) / (2 * S.zi) * side]; })()`);
  await scrollTo("#cvI");
  const img0 = await ev(`window.__lensex.images().filter(m => m.type === "saddle").sort((a, b) => Math.abs(b.mu) - Math.abs(a.mu))[0]`);
  const sub0 = await ev(`window.__lensex.lens().subs[0]`);
  {
    const [hx, hy] = await skyPx(sub0.x, sub0.y);
    await move(hx + 3, hy); await sleep(120);
    const hv = await ev(`window.__lensex.hover()`), tipC = await ev(`document.getElementById("tip").hidden`);
    check("hovering a clump brightens the clump, with a grab cursor and no caption", hv.sub === 0 && hv.cursorI === "grab" && tipC, JSON.stringify(hv));
    await shot("hover_clump.png", true);
    await move(5, 5); await sleep(60);
  }
  const tx = img0.x + 0.04 * img0.x / Math.hypot(img0.x, img0.y), ty = img0.y + 0.04 * img0.y / Math.hypot(img0.x, img0.y);
  let [px, py] = await skyPx(sub0.x, sub0.y);
  await mouse("mousePressed", px, py);
  const [qx, qy] = await skyPx(tx, ty);
  for (let k = 1; k <= 10; k++) { await mouse("mouseMoved", px + (qx - px) * k / 10, py + (qy - py) * k / 10); await sleep(40); }
  const fmsSub = await ev(`window.__lensex.frameMs()`);
  await mouse("mouseReleased", qx, qy);
  await sleep(400);
  const sNew = await ev(`window.__lensex.lens().subs[0]`);
  check("dragging a clump in the sky moves the clump", Math.hypot(sNew.x - tx, sNew.y - ty) < 0.02, `(${sNew.x.toFixed(3)}, ${sNew.y.toFixed(3)}) vs (${tx.toFixed(3)}, ${ty.toFixed(3)})`);
  check("clump drag: frame time (6 clumps, draft resolution)", fmsSub < 200, fmsSub.toFixed(0) + " ms");
  const pair = await ev(`(() => { const I = window.__lensex.images(), I0 = window.__lensex.images0();
      const t = I0.filter(m => m.type === "saddle").sort((a, b) => Math.abs(b.mu) - Math.abs(a.mu))[0];
      const m = I.filter(m => m.type === "saddle").sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
      return [m.mu, t.mu, I.length, I0.length]; })()`);
  check("clump next to a saddle image changes its magnification (flux-ratio anomaly)", Math.abs(pair[0] / pair[1] - 1) > 0.1,
        `μ ${pair[0].toFixed(2)} vs smooth ${pair[1].toFixed(2)}; ${pair[2]} images vs ${pair[3]} smooth`);
  await shot("subhalo_on_image.png");
  {
    const [hx, hy] = await skyPx(pair[0] === pair[0] ? (await ev(`window.__lensex.images().filter(m => m.type === "saddle").sort((a, b) => Math.hypot(a.x - ${img0.x}, a.y - ${img0.y}) - Math.hypot(b.x - ${img0.x}, b.y - ${img0.y}))[0].x`)) : 0,
                                 await ev(`window.__lensex.images().filter(m => m.type === "saddle").sort((a, b) => Math.hypot(a.x - ${img0.x}, a.y - ${img0.y}) - Math.hypot(b.x - ${img0.x}, b.y - ${img0.y}))[0].y`));
    await clickSel("#cSubs");                // hide the clump markers so the image, not the clump, is under the pointer
    await move(hx, hy); await sleep(150);
    const tt = await ev(`document.getElementById("tip").hidden ? "" : document.getElementById("tip").textContent`);
    await move(5, 5);
    await clickSel("#cSubs");
    check("image tooltip compares with the smooth lens (μ, flux change, shift)", /μ, smooth lens/.test(tt) && /Flux change/.test(tt) && /mas/.test(tt), tt.slice(0, 120));
  }
  // on/off and blink
  const muOn = await ev(`window.__lensex.images().map(m => m.mu.toFixed(4)).join()`);
  await clickSel("#sOff");
  const offL = await ev(`window.__lensex.lens().subs.length`), muOff = await ev(`window.__lensex.images().map(m => m.mu.toFixed(4)).join()`);
  check("switching the subhalos off shows the smooth lens", offL === 0 && muOn !== muOff && (await ev(`window.__lensex.clumpy().subs.length`)) === 6);
  await shot("subhalos_off.png");
  await clickSel("#sOn");
  check("switching back on restores the clumps", (await ev(`window.__lensex.lens().subs.length`)) === 6);
  await clickSel("#blink");
  const seen = new Set();
  for (let k = 0; k < 10; k++) { seen.add(await ev(`window.__lensex.S().son`)); await sleep(200); }
  check("blink alternates on and off", seen.size === 2);
  await clickSel("#blink");
  // telescope view: a point source, each image a PSF whose flux is |mu|
  await clickSel("#tPt");
  check("point source: the telescope view switches on (0.05\")", Math.abs((await ev(`window.__lensex.S().fw`)) - Math.log10(0.05)) < 1e-9 && (await ev(`getComputedStyle(document.querySelector("#sR").parentElement).display`)) === "none");
  check("blink is stopped before the flux test", (await ev(`document.getElementById("blink").textContent`)) === "Blink" && (await ev(`window.__lensex.S().son`)) === true);
  const fluxPair = async () => ev(`(() => { const X = window.__lensex, I = X.images(), I0 = X.images0();
      const t = I0.filter(m => m.type === "saddle").sort((a, b) => Math.abs(b.mu) - Math.abs(a.mu))[0];
      const m = I.filter(m => m.type === "saddle").sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
      return { x: m.x, y: m.y, mu: m.mu, x0: t.x, y0: t.y, mu0: t.mu }; })()`);
  const fp = await fluxPair();
  const fOn = await ev(`window.__lensex.skySum(${fp.x}, ${fp.y}, 0.11)`);
  await clickSel("#sOff");
  const fOff = await ev(`window.__lensex.skySum(${fp.x0}, ${fp.y0}, 0.11)`);
  const sOff = await ev(`window.__lensex.sky().scale`);
  await shot("point_off.png");
  await clickSel("#sOn");
  const sOn = await ev(`window.__lensex.sky().scale`);
  check("telescope view: the same brightness scale with the subhalos on and off", Math.abs(sOn / sOff - 1) < 1e-9);
  check("telescope view: an image's light tracks its flux (subhalos on/off)", Math.abs((fOn / fOff) / Math.abs(fp.mu / fp.mu0) - 1) < 0.03,
        `light ratio ${(fOn / fOff).toFixed(3)} vs |μ| ratio ${Math.abs(fp.mu / fp.mu0).toFixed(3)}`);
  await shot("point_on.png");
  // an extended source through the telescope: blurring conserves the light
  await clickSel("#tDisk");
  await setRange("#sR", Math.log10(0.05));
  await setRange("#sFW", -1);
  const sk = await ev(`window.__lensex.sky()`);
  check("telescope view: blurring an extended source conserves the light", Math.abs(sk.sum / sk.rawSum - 1) < 0.02, `blurred/ideal ${(sk.sum / sk.rawSum).toFixed(4)}`);
  check("resolution readout", /0\.1″ FWHM/.test(await ev(`document.getElementById("vFW").textContent`)), await ev(`document.getElementById("vFW").textContent`));
  await shot("disk_psf.png");
  await clickSel("#tGal");
  await dragSource(0.05, 0.02, 0.1, 0.04, 4);
  const fBlur = await ev(`window.__lensex.frameMs()`);
  check("telescope view: source-drag frame time (galaxy, 0.1\" blur, 6 clumps)", fBlur < 250, fBlur.toFixed(0) + " ms");
  await clickSel("#tDisk");
  await setRange("#sFW", -2.3);
  check("perfect telescope readout", (await ev(`document.getElementById("vFW").textContent`)) === "perfect");
  await setRange("#sR", Math.log10(0.1));
  check("no errors in the telescope view", errors.length === 0, errors.join(" | "));
  check("stopping the blink leaves the subhalos on", (await ev(`window.__lensex.S().son`)) === true && (await ev(`document.getElementById("blink").textContent`)) === "Blink");
  // zoom the sky onto that image
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: qx, y: qy, deltaX: 0, deltaY: -900 });
  await sleep(500);
  const zi = await ev(`window.__lensex.S().zi`);
  check("scrolling zooms the sky about the pointer", zi < 0.7, `half-width ${zi.toFixed(3)} θ_E`);
  await shot("subhalo_zoom.png");
  check("no errors with subhalos", errors.length === 0, errors.join(" | "));
  const hashSub = await ev(`location.hash`);
  check("URL hash records the clump positions", /nsub=6/.test(hashSub) && /subs=/.test(hashSub));
  await send("Page.navigate", { url: URL0.replace(/#.*$/, "") + hashSub });
  await sleep(1500);
  const S5 = await ev(`window.__lensex.S()`), L5 = await ev(`window.__lensex.lens().subs`);
  check("clump positions restored from the hash", L5.length === 6 && Math.hypot(L5[0].x - sNew.x, L5[0].y - sNew.y) < 2e-3 && S5.zi < 0.7);
  await scrollTo("#cvI");
  const rI = await rect("#cvI");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rI.x + rI.w / 2, y: rI.y + rI.h / 2, button: "left", clickCount: 2 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rI.x + rI.w / 2, y: rI.y + rI.h / 2, button: "left", clickCount: 2 });
  await sleep(300);
  check("double-click resets the sky view", (await ev(`window.__lensex.S().zi`)) === 2.5);
  const before6 = await ev(`JSON.stringify(window.__lensex.S().subs.slice(0, 6))`);
  await clickSel("#reshuffle");
  check("reshuffle moves the clumps", before6 !== (await ev(`JSON.stringify(window.__lensex.S().subs.slice(0, 6))`)));
  await setRange("#sN", 20);
  await dragSource(0.05, 0.02, 0.12, 0.06, 4);
  const f20 = await ev(`window.__lensex.frameMs()`);
  check("20 clumps: source-drag frame time", f20 < 150, f20.toFixed(0) + " ms");
  await setRange("#sM", 10);
  const f20m = await ev(`window.__lensex.frameMs()`);
  check("20 clumps of 1e10: lens change frame time", f20m < 600, f20m.toFixed(0) + " ms");
  await shot("subhalos_20.png");
  check("no errors with 20 clumps", errors.length === 0, errors.join(" | "));
  await setRange("#sN", 0);
  await setRange("#sM", 9);

  // ---------------------------------------------------------------- hash round trip and reset
  const hash2 = await ev(`location.hash`);
  await send("Page.navigate", { url: URL0.replace(/#.*$/, "") + hash2 });
  await sleep(1500);
  const S3 = await ev(`window.__lensex.S()`);
  check("state restored from the URL hash", S3.model === "ell" && S3.type === "disk", `${S3.model}, ${S3.type}`);
  await clickSel("#reset");
  const S4 = await ev(`window.__lensex.S()`);
  check("reset returns to the defaults", S4.model === "cored" && S4.type === "pt" && Math.abs(S4.fw - Math.log10(0.05)) < 1e-9 && (await ev(`location.hash`)) === "");

  // ---------------------------------------------------------------- phone width
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  const sw = await ev(`document.documentElement.scrollWidth`);
  check("phone width: no horizontal scroll", sw <= 390, `scrollWidth ${sw}`);
  await shot("phone.png");
  check("no errors at the end", errors.length === 0, errors.join(" | "));

  console.log(`\n${fails ? fails + " FAILED" : "all passed"}; screenshots in ${OUT}`);
  ws.close(); chrome.kill();
  process.exit(fails ? 1 : 0);
})();
