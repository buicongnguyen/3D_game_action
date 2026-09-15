/** Real headless Edge smoke/capture checks for the authored Homeward campaign. */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const base = process.argv.find(a => a.startsWith("--url="))?.slice(6) ?? "http://127.0.0.1:4246/";
const out = path.resolve(process.argv.find(a => a.startsWith("--out="))?.slice(6) ?? "../docs/homeward-review");
const browser = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!browser) throw Error("Edge not found");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(os.tmpdir(), "iron-march-story-"));
const debugPort = 10000 + Math.floor(Math.random() * 20000);
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--no-sandbox", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, base + "?mode=story&storyCapture=1"], { windowsHide: true, stdio: "ignore" });
let socket; const report = { captures: [], checks: [], performance: null, errors: [] };
try {
  let target;
  for (let i = 0; i < 150 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === "page" && t.url.includes("mode=story")); } catch {}
    if (!target) await delay(200);
  }
  if (!target) throw Error("Browser target unavailable");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map(); let sequence = 0;
  socket.addEventListener("message", event => {
    const m = JSON.parse(event.data);
    if (m.method === "Runtime.exceptionThrown") report.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") report.errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
    if (!m.id) return; const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression).catch(() => false)) return; await delay(150); } throw Error(`Timed out: ${expression}\n${JSON.stringify(report.errors)}\n${await evaluate('document.body.innerText')}`); };
  await send("Runtime.enable"); await send("Page.enable"); await mkdir(out, { recursive: true });
  for (const [label, width, height] of [["desktop", 1280, 720], ["portrait", 390, 844], ["landscape", 844, 390]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const chapter of [1, 2, 3, 4]) {
      await send("Page.navigate", { url: `${base}?mode=story&storyCapture=${chapter}` });
      await wait(`window.__homeward?.ready && window.__homeward.sim.state.chapter === ${chapter}`);
      await evaluate("window.__homeward.render()"); await delay(250);
      const layout = await evaluate(`(() => {
        const assert = (v,m) => { if(!v) throw Error(m); };
        const rect = document.querySelector('.homeward-action').getBoundingClientRect();
        assert(rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, 'Action button outside viewport');
        assert(document.documentElement.scrollWidth <= innerWidth, 'Horizontal page overflow');
        assert(window.__homeward.view.forge.blenderAssetCount > 0, 'Blender assets not loaded');
        return {calls:window.__homeward.view.renderer.info.calls, triangles:window.__homeward.view.renderer.info.triangles};
      })()`);
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      const file = `${label}-chapter-${chapter}.png`; await writeFile(path.join(out, file), Buffer.from(screenshot.data, "base64"));
      report.captures.push({ file, ...layout }); console.log(`${file}: ${layout.calls} calls / ${layout.triangles} triangles`);
    }
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}?mode=story` }); await wait("window.__homeward?.ready && !location.search.includes('storyCapture')");
  await evaluate("document.querySelector('[data-command=start]').click()");
  await wait("window.__homeward.sim.state.status === 'playing' && !document.querySelector('.homeward-panel')");
  for (const [label, width, height] of [["desktop",1280,720],["portrait",390,844],["landscape",844,390]]) {
    await send("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:false});
    await delay(200); await evaluate("window.__homeward.render()");
    const shot = await send("Page.captureScreenshot", {format:"png"});
    await writeFile(path.join(out, `${label}-gameplay.png`), Buffer.from(shot.data,"base64"));
  }
  await send("Emulation.setDeviceMetricsOverride", {width:1280,height:720,deviceScaleFactor:1,mobile:false});
  const x = await evaluate("window.__homeward.sim.state.player.x");
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyD", key: "d" }); await delay(700);
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyD", key: "d" });
  const moved = await evaluate(`window.__homeward.sim.state.player.x > ${x + 1}`); if (!moved) throw Error("Keyboard movement failed"); report.checks.push("Real keyboard movement");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true }); await delay(100);
  const stick = await evaluate("(() => {const r=document.querySelector('.homeward-stick').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
  const beforeTouch = await evaluate("window.__homeward.sim.state.player.x");
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: stick.x, y: stick.y, id: 1 }] });
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: stick.x + 30, y: stick.y, id: 1 }] }); await delay(550);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  if (!await evaluate(`window.__homeward.sim.state.player.x > ${beforeTouch + 0.7}`)) throw Error("Touch joystick failed");
  const afterTouch = await evaluate("window.__homeward.sim.state.player.x"); await delay(250);
  if (!await evaluate(`Math.abs(window.__homeward.sim.state.player.x - ${afterTouch}) < 0.15`)) throw Error("Touch movement stuck after release");
  report.checks.push("Real touch joystick movement and release");
  await evaluate("Object.assign(window.__homeward.sim.state.player,{x:9,z:0}); window.__homeward.render(); document.querySelector('[data-command=action]').click()");
  await wait("window.__homeward.sim.state.stones.length === 1"); report.checks.push("Single touch/click action launches stone");
  await evaluate("document.querySelector('[data-command=pause]').click()");
  const time = await evaluate("window.__homeward.sim.state.time"); await delay(350);
  if (await evaluate(`window.__homeward.sim.state.time !== ${time}`)) throw Error("Simulation advances while paused"); report.checks.push("Pause freezes simulation");
  await evaluate("document.querySelector('[data-command=resume]').click()");
  // Chapter transitions use actual objective interactions. Combat is resolved deterministically for this traversal test.
  const traversal = await evaluate(`(() => {
    const sim = window.__homeward.sim, assert = (v,m) => {if(!v)throw Error(m)};
    for(let i=0;i<16000&&sim.state.status==='playing';i++){sim.step(1/60);for(const e of [...sim.state.enemies])sim.hit(e,10000)}
    assert(sim.state.status==='complete','Hill incomplete'); sim.nextChapter(); sim.start();
    Object.assign(sim.state.player,{x:-16,z:16});sim.act();window.__homeward.render();
    assert(sim.state.status==='upgrade','Crate did not open');document.querySelector('[data-command=volley]').click();assert(sim.state.progress.volley===2,'Crate UI did not grant multishot');
    Object.assign(sim.state.player,{x:0,z:0});sim.act();assert(sim.state.penOpen,'Pen not freed');
    Object.assign(sim.state.player,{x:24,z:-24});sim.act();assert(sim.state.status==='complete','Maze exit failed');sim.nextChapter();sim.start();
    sim.hit(sim.state.enemies.find(e=>e.kind==='queen'),100000);Object.assign(sim.state.player,{x:0,z:-23});sim.act();assert(sim.state.status==='complete','Queen rescue failed');sim.nextChapter();sim.start();
    assert(sim.state.progress.safeAtFarm+sim.state.progress.rescued===9,'Cow ledger does not balance');
    sim.state.spawned=44;for(let i=0;i<16000&&sim.state.status==='playing';i++)sim.step(1/60);
    assert(sim.state.status==='victory','Home gate never completes');window.__homeward.render();return {safe:sim.state.progress.safeAtFarm,rescued:sim.state.progress.rescued};
  })()`);
  report.checks.push({ completeCampaignTraversal: traversal, note: "Scripted combat resolution; objective actions and full escort distance simulated" });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.__homeward.render()"); await delay(100);
  const ending = await send("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(out, "desktop-ending.png"), Buffer.from(ending.data, "base64"));
  report.performance = await evaluate(`(() => {
    const sim=window.__homeward.sim;sim.retry();sim.start();sim.state.spawned=44;sim.state.machine.distance=0;sim.state.player.invincible=10000;
    for(let i=0;i<48;i++)sim.spawn('broodling',{x:30+i%6,z:10+Math.floor(i/6)});
    const samples=[];for(let i=0;i<600;i++){const t=performance.now();sim.step(1/60);samples.push(performance.now()-t)}samples.sort((a,b)=>a-b);
    return {steps:600,medianMs:samples[300],p95Ms:samples[570],maxMs:samples[599],environment:'Headless Edge / SwiftShader; simulation CPU only, not physical-phone FPS'};
  })()`);
  const origin = await evaluate("performance.timeOrigin");
  await send("Page.reload", {}); await wait(`window.__homeward?.ready && performance.timeOrigin !== ${origin}`);
  const resumed = await evaluate("({chapter:window.__homeward.sim.state.chapter,volley:window.__homeward.sim.state.progress.volley,status:window.__homeward.sim.state.status})");
  if (resumed.chapter !== 4 || resumed.volley !== 2 || resumed.status !== "briefing") throw Error(`Checkpoint reload failed: ${JSON.stringify(resumed)}`);
  report.checks.push("Reload restores chapter 4 and earned multishot, ready at briefing");
  await send("Page.navigate", {url:base});
  await wait("!!document.querySelector('.boot-story-link')");
  const storyLink = await evaluate("document.querySelector('.boot-story-link').getAttribute('href')");
  if (!storyLink.includes('mode=story')) throw Error('Missing Expedition entry to story');
  await evaluate("document.querySelector('.boot-story-link').click()");
  await wait("window.__homeward?.ready && window.__homeward.sim.state.chapter === 4");
  report.checks.push("Original loading screen offers working Story entry without resetting checkpoint");
  if (report.errors.length) throw Error(report.errors.join("\n"));
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.checks)); console.log(JSON.stringify(report.performance));
} finally {
  if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ id: 999999, method: "Browser.close" })); await delay(500); }
  socket?.close(); child.kill();
  // Only the uniquely created browser profile in the OS temp folder is removed.
  const resolved = path.resolve(profile), temp = path.resolve(os.tmpdir());
  if (resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith("iron-march-story-")) await rm(resolved, { recursive: true, force: true }).catch(() => {});
}
