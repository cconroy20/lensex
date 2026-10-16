// Screenshot a page state:  node shot.js "<url with #hash>" out.png [width] [height]
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const [url, out, W = "1440", H = "1300"] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", PORT = 9339;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const prof = fs.mkdtempSync("/tmp/lensex-shot-");
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
    `--window-size=${W},${H}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let tabs = null;
  for (let i = 0; i < 50 && !tabs; i++) { await sleep(200); try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch (e) {} }
  const ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0; const pend = new Map();
  ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(2500);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(out, Buffer.from(r.result.data, "base64"));
  ws.close(); chrome.kill(); process.exit(0);
})();
