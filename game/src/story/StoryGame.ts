import { InputManager } from "../input/InputManager.ts";
import { AudioDirector } from "../audio/AudioDirector.ts";
import { SaveManager } from "../save/SaveManager.ts";
import { CHAPTERS, STORY_WEAPONS, type StoryWeapon } from "./StoryData.ts";
import { StorySimulation } from "./StorySimulation.ts";
import { loadStoryCheckpoint, saveStoryCheckpoint } from "./StorySave.ts";
import { StoryView } from "./StoryView.ts";
import { drawStoryMap, storyDistanceWarning, storyIllustration } from "./StoryPresentation.ts";
import "./story.css";

export class StoryGame {
  readonly sim: StorySimulation;
  readonly view: StoryView;
  private input = new InputManager();
  private audio = new AudioDirector();
  private muted = false;
  private root: HTMLElement;
  private modal: HTMLElement;
  private objective: HTMLElement;
  private stats: HTMLElement;
  private receipt: HTMLElement;
  private message: HTMLElement;
  private warning: HTMLElement;
  private action: HTMLButtonElement;
  private weapons: HTMLElement;
  private map: HTMLCanvasElement;
  private boss: HTMLElement;
  private joystick: HTMLElement;
  private stickKnob: HTMLElement;
  private touch = { x: 0, z: 0, action: false, dodge: false };
  private pointerId: number | null = null;
  private paused = false;
  private frame = 0;
  private lastTime = 0;
  private accumulator = 0;
  private hudClock = 0;
  private modalKey = "";
  private checkpointRef: unknown = null;
  private saveWarning = "";
  private abort = new AbortController();
  private overview = false;
  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.sim = new StorySimulation(71309, new URLSearchParams(location.search).has("storyCapture") ? null : loadStoryCheckpoint());
    this.view = new StoryView(canvas);
    const settings = new SaveManager().data.settings;
    this.audio.setMasterVolume(settings.masterVolume); this.audio.setMusicVolume(settings.musicVolume * 0.55); this.audio.setEffectsVolume(settings.effectsVolume);
    this.input.setDeadZone(settings.gamepadDeadZone);
    uiRoot.innerHTML = `<main class="homeward" aria-label="Iron March Homeward story campaign">
      <header class="homeward-top"><div><span class="homeward-kicker">IRON MARCH / HOMEWARD</span><h1></h1></div><nav><button data-command="map" aria-label="Toggle chapter map">Map</button><button data-command="mute" aria-pressed="false">Mute</button><button data-command="pause">Pause</button></nav></header>
      <section class="homeward-objective" aria-label="Chapter objective"></section><section class="homeward-stats" aria-label="Health and supplies"></section>
      <div class="homeward-boss" aria-label="Silk Queen health"></div><div class="homeward-warning" role="status"></div>
      <div class="homeward-message" role="status"></div><div class="homeward-receipt" role="status" aria-live="polite"></div>
      <figure class="homeward-map"><canvas width="150" height="150" aria-label="Map: cyan is you, gold is objective, white is exit"></canvas><figcaption>You ● · goal ● · exit ●</figcaption></figure>
      <nav class="homeward-weapons" aria-label="Select a weapon"></nav>
      <div class="homeward-weapon-info"></div>
      <div class="homeward-stick" aria-label="Touch movement joystick"><span></span><small>MOVE</small></div>
      <div class="homeward-actions"><button data-command="turret" class="homeward-turret">Select turret · 8 parts</button><button data-command="action" class="homeward-action"></button><button data-command="dodge">Dodge · Space</button></div>
      <p class="homeward-help">WASD / left stick: move · E / Cross: action · B: weapon · Space / Circle: dodge · Auto-fire</p>
      <div class="homeward-modal-host"></div></main>`;
    this.root = uiRoot.querySelector(".homeward")!;
    const query = <T extends HTMLElement>(name: string) => this.root.querySelector<T>(`.homeward-${name}`)!;
    this.modal = query("modal-host"); this.objective = query("objective"); this.stats = query("stats"); this.receipt = query("receipt"); this.message = query("message");
    this.warning = query("warning"); this.action = query<HTMLButtonElement>("action"); this.weapons = query("weapons"); this.map = this.root.querySelector("canvas")!;
    this.boss = query("boss"); this.joystick = query("stick"); this.stickKnob = this.joystick.querySelector("span")!;
    const signal = this.abort.signal;
    this.root.addEventListener("click", this.click, { signal });
    this.joystick.addEventListener("pointerdown", this.stickStart, { signal });
    this.joystick.addEventListener("pointermove", this.stickMove, { signal });
    this.joystick.addEventListener("pointerup", this.stickEnd, { signal });
    this.joystick.addEventListener("pointercancel", this.stickEnd, { signal });
    this.joystick.addEventListener("lostpointercapture", this.stickEnd, { signal });
    document.addEventListener("visibilitychange", this.visibility, { signal });
    window.addEventListener("blur", this.blur, { signal });
    this.modal.addEventListener("keydown", this.trapFocus, { signal });
  }
  async boot(): Promise<void> {
    this.modal.innerHTML = '<section class="homeward-panel"><h2>Preparing Homeward…</h2><p>Assembling the Iron Spider and the farm.</p></section>';
    await this.view.boot(); this.input.attach();
    this.input.onConnectionChange(connected => { if (!connected && this.sim.state.status === "playing") { this.paused = true; this.showModal(); } });
    const capture = new URLSearchParams(location.search).get("storyCapture");
    if (capture && /^[1-4]$/.test(capture)) {
      // Explicit visual-QA route only; normal story progression cannot skip chapters.
      while (this.sim.state.chapter < Number(capture)) { this.sim.state.status = "complete"; this.sim.nextChapter(); }
      this.sim.start(); this.overview = true;
      if (this.sim.state.chapter === 1) for (let i = 0; i < 10; i++) {
        const { spiralPoint } = await import("./StoryMaps.ts"); this.sim.spawn(i % 3 ? "broodling" : "jumper", spiralPoint(i * 0.075), i * 0.075);
      }
      if (this.sim.state.chapter === 4) this.sim.state.progress.rescued = this.sim.state.progress.missing;
      this.paused = true;
    }
    this.showModal(); this.updateHud(); this.frame = requestAnimationFrame(this.render);
    (window as unknown as { __homeward: unknown }).__homeward = {
      sim: this.sim, view: this.view, ready: true,
      start: () => { this.sim.start(); this.paused = false; this.modalKey = ""; this.showModal(); },
      render: () => { this.updateHud(); this.showModal(); this.view.render(this.sim.state, 1 / 60, this.overview); },
      get paused() { return document.querySelector(".homeward-panel") !== null; },
    };
  }
  private click = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button"); if (!button || button.disabled) return;
    const weapon = button.dataset.weapon as StoryWeapon | undefined;
    if (weapon) { this.sim.selectWeapon(weapon); this.updateHud(); return; }
    const command = button.dataset.command;
    if (command === "start" || command === "resume") void this.audio.resume();
    if (command === "start") { this.sim.start(); this.paused = false; }
    else if (command === "continue") { this.sim.nextChapter(); this.paused = false; }
    else if (command === "retry") { this.sim.retry(); this.paused = false; }
    else if (command === "pause") this.paused = !this.paused;
    else if (command === "resume") this.paused = false;
    else if (command === "action") this.touch.action = true;
    else if (command === "dodge") this.touch.dodge = true;
    else if (command === "turret") this.sim.state.selectedAction = this.sim.state.selectedAction === "turret" ? "context" : "turret";
    else if (command === "map") this.root.classList.toggle("homeward-map-open");
    else if (command === "mute") { this.muted = !this.muted; this.audio.setMasterVolume(this.muted ? 0 : new SaveManager().data.settings.masterVolume); button.textContent = this.muted ? "Unmute" : "Mute"; button.setAttribute("aria-pressed", String(this.muted)); }
    else if (command === "volley" || command === "damage" || command === "armor") this.sim.chooseUpgrade(command);
    else if (command === "close-crate") this.sim.closeUpgrade();
    else if (command === "new") { this.sim.state.status = "defeat"; this.sim.checkpoint = new StorySimulation().checkpoint; this.sim.retry(); this.paused = false; }
    else if (command === "expedition") { const url = new URL(location.href); url.searchParams.delete("mode"); url.searchParams.delete("storyCapture"); location.assign(url.toString()); return; }
    if (this.sim.state.status === "playing" && !this.paused) void this.audio.resume();
    this.modalKey = ""; this.showModal(); this.updateHud();
  };
  private stickStart = (event: PointerEvent): void => {
    if (this.pointerId !== null) return; this.pointerId = event.pointerId; this.joystick.setPointerCapture(event.pointerId); this.stickMove(event); event.preventDefault();
  };
  private stickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const rect = this.joystick.getBoundingClientRect(), radius = rect.width * 0.32;
    let x = (event.clientX - rect.left - rect.width / 2) / radius, z = (event.clientY - rect.top - rect.height / 2) / radius;
    const mag = Math.hypot(x, z); if (mag > 1) { x /= mag; z /= mag; }
    this.touch.x = x; this.touch.z = z; this.stickKnob.style.transform = `translate(${x * radius}px, ${z * radius}px)`;
  };
  private stickEnd = (event: PointerEvent): void => { if (event.pointerId !== this.pointerId) return; this.pointerId = null; this.resetTouch(); };
  private resetTouch(): void { this.touch = { x: 0, z: 0, action: false, dodge: false }; this.stickKnob.style.transform = ""; }
  private visibility = (): void => { if (document.hidden) { this.paused = true; this.resetTouch(); this.showModal(); } this.lastTime = 0; this.accumulator = 0; };
  private blur = (): void => { this.paused = true; this.resetTouch(); this.showModal(); };
  private trapFocus = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const buttons = Array.from(this.modal.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")); if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
  };
  private render = (now: number): void => {
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 1 / 60; this.lastTime = now;
    this.input.poll(dt); const input = this.input.snapshot();
    if (input.buttons.pause.pressed) { this.paused = !this.paused; this.modalKey = ""; if (!this.paused) void this.audio.resume(); }
    if (this.modal.querySelector(".homeward-panel")) {
      const buttons = Array.from(this.modal.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const direction = input.buttons.menuDown.pressed || input.buttons.menuRight.pressed ? 1 : input.buttons.menuUp.pressed || input.buttons.menuLeft.pressed ? -1 : 0;
      if (direction && buttons.length) { const at = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement)); buttons[(at + direction + buttons.length) % buttons.length].focus(); }
      if (input.buttons.confirm.pressed && document.activeElement instanceof HTMLButtonElement) document.activeElement.click();
    } else if (!this.paused) {
      if (input.buttons.weaponNext.pressed) this.sim.cycleWeapon();
      if (input.buttons.map.pressed) this.root.classList.toggle("homeward-map-open");
      if (input.buttons.tool.pressed && this.sim.state.chapter === 4) this.sim.state.selectedAction = this.sim.state.selectedAction === "turret" ? "context" : "turret";
      this.touch.action ||= input.buttons.confirm.pressed; this.touch.dodge ||= input.buttons.cancel.pressed;
      this.accumulator = Math.min(0.15, this.accumulator + dt);
      while (this.accumulator >= 1 / 60) {
        const beforeHealth = this.sim.state.player.hp, beforeParts = this.sim.state.progress.shells, beforeKills = this.sim.state.killed, beforeShot = this.sim.state.player.cooldown;
        this.sim.step(1 / 60, { x: Math.abs(this.touch.x) > 0.05 ? this.touch.x : input.leftStick.x, z: Math.abs(this.touch.z) > 0.05 ? this.touch.z : input.leftStick.y, action: this.touch.action, dodge: this.touch.dodge });
        if (this.sim.state.player.cooldown > beforeShot) this.audio.play("shot.player", this.sim.state.player.x, this.sim.state.player.z, 0.45);
        if (this.sim.state.player.hp < beforeHealth) this.audio.play("player.hurt");
        if (this.sim.state.progress.shells > beforeParts) this.audio.play("pickup.scrap", undefined, undefined, 0.6);
        if (this.sim.state.killed > beforeKills) this.audio.play("enemy.death", undefined, undefined, 0.35);
        this.touch.action = false; this.touch.dodge = false; this.accumulator -= 1 / 60;
      }
    } else this.accumulator = 0;
    this.input.endStep(); this.showModal();
    this.audio.setListener(this.sim.state.player.x, this.sim.state.player.z);
    this.audio.setTension(this.sim.state.enemies.length > 8 ? "SWARM" : this.sim.state.enemies.length ? "PROBING" : "QUIET", false);
    if (!this.paused && this.sim.state.status === "playing") this.audio.update(dt);
    this.view.render(this.sim.state, this.paused || this.sim.state.status !== "playing" ? 0 : dt, this.overview);
    this.hudClock += dt; if (this.hudClock >= 0.1) { this.updateHud(); this.hudClock = 0; }
    this.frame = requestAnimationFrame(this.render);
  };
  private showModal(): void {
    const s = this.sim.state;
    if (this.checkpointRef !== this.sim.checkpoint && !new URLSearchParams(location.search).has("storyCapture")) {
      this.checkpointRef = this.sim.checkpoint; this.saveWarning = saveStoryCheckpoint(this.sim.checkpoint) ? "" : "Browser storage is unavailable. Keep this tab open to preserve your chapter retry.";
    }
    const capture = new URLSearchParams(location.search).has("storyCapture");
    const key = capture && s.status === "playing" ? "playing" : this.paused ? "pause" : s.status;
    const id = `${s.chapter}:${key}`; if (id === this.modalKey) return; this.modalKey = id;
    if (key === "playing") { this.modal.innerHTML = ""; return; }
    this.audio.suspend();
    let title = CHAPTERS[s.chapter].title, body = CHAPTERS[s.chapter].briefing, actions = '<button data-command="start">Begin chapter</button>';
    if (key === "complete") { title = `${CHAPTERS[s.chapter].title} · complete`; body = CHAPTERS[s.chapter].ending; actions = '<button data-command="continue">Continue the story</button>'; }
    if (key === "victory") { title = "All nine bells are home"; body = CHAPTERS[4].ending; actions = '<button data-command="new">Play the story again</button><button data-command="expedition">Play Expedition</button>'; }
    if (key === "defeat") { title = "We can still bring them home"; body = s.reason; actions = '<button data-command="retry">Retry this chapter</button><button data-command="expedition">Return to Expedition</button>'; }
    if (key === "pause") { title = "A moment to breathe"; body = "The campaign is paused. Your chapter-start checkpoint keeps the herd and upgrades earned before this chapter. Returning to Expedition does not erase it."; actions = '<button data-command="resume">Resume</button><button data-command="retry">Retry this chapter</button><button data-command="new">Start a new story</button><button data-command="expedition">Return to Expedition</button>'; }
    if (key === "upgrade") {
      title = "Choose one useful upgrade"; body = "This crate grants one upgrade. Closing it leaves the reward here for later.";
      actions = `<button data-command="volley" ${s.progress.volley >= 3 ? "disabled" : ""}>Rifle projectiles: ${s.progress.volley} → ${Math.min(3, s.progress.volley + 1)}</button><button data-command="damage" ${s.progress.damageLevel >= 3 ? "disabled" : ""}>Damage bonus: ${s.progress.damageLevel * 20}% → ${Math.min(3, s.progress.damageLevel + 1) * 20}%</button><button data-command="armor" ${s.progress.armorLevel >= 3 ? "disabled" : ""}>Maximum health: ${s.player.maxHp} → ${s.player.maxHp + 15}</button><button data-command="close-crate">Leave the crate for later</button>`;
    }
    this.resetTouch(); this.accumulator = 0;
    this.modal.innerHTML = `<section class="homeward-panel" role="dialog" aria-modal="true" aria-labelledby="homeward-dialog-title"><span class="homeward-kicker">${CHAPTERS[s.chapter].subtitle}</span>${key === "pause" || key === "upgrade" ? "" : storyIllustration(s.chapter, key === "complete" || key === "victory")}<h2 id="homeward-dialog-title">${title}</h2><p>${body}</p><p class="homeward-ledger">${s.progress.safeAtFarm} safe at the farm · ${s.progress.rescued}/${s.progress.missing} missing cows rescued</p>${this.saveWarning ? `<p>${this.saveWarning}</p>` : ""}<div class="homeward-panel-actions">${actions}</div></section>`;
    this.modal.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }
  private updateHud(): void {
    const s = this.sim.state;
    this.root.querySelector("h1")!.textContent = CHAPTERS[s.chapter].subtitle;
    this.objective.textContent = this.sim.objective();
    this.stats.innerHTML = `<span>Engineer <strong>${Math.ceil(s.player.hp)}/${s.player.maxHp}</strong></span><span>Parts <strong>${s.progress.shells}</strong></span>${s.chapter === 4 ? `<span>Spider <strong>${Math.ceil(s.machine.hp)}/${s.machine.maxHp}</strong></span><span>Fuel <strong>${Math.ceil(s.machine.fuel)}%</strong></span>` : `<span>Herd <strong>${s.chapter === 1 ? s.cows.filter(c => c.status !== "captured").length : s.progress.safeAtFarm} safe</strong></span>`}`;
    const warning = storyDistanceWarning(s); if (this.warning.textContent !== warning) this.warning.textContent = warning;
    this.warning.hidden = !warning;
    this.message.textContent = s.messageTime > 0 ? s.message : ""; this.message.hidden = s.messageTime <= 0;
    const receipt = s.receiptTime > 0 ? s.receipt : ""; if (this.receipt.textContent !== receipt) this.receipt.textContent = receipt; this.receipt.hidden = !receipt;
    this.action.textContent = `${this.sim.actionLabel()}${this.sim.canAct() ? " · E" : ""}`;
    this.action.disabled = !this.sim.canAct();
    this.root.querySelector<HTMLElement>(".homeward-weapon-info")!.textContent = `${STORY_WEAPONS[s.progress.selected].role}${s.progress.selected !== "rifle" ? ` · Heat ${Math.round(s.player.heat * 100)}%` : ""}`;
    this.root.querySelector<HTMLElement>(".homeward-turret")!.hidden = s.chapter !== 4;
    this.root.querySelector<HTMLElement>(".homeward-turret")!.classList.toggle("selected", s.selectedAction === "turret");
    const signature = `${s.progress.weapons.join()}:${s.progress.selected}`;
    if (this.weapons.dataset.signature !== signature) {
      this.weapons.dataset.signature = signature;
      this.weapons.innerHTML = s.progress.weapons.map(w => `<button data-weapon="${w}" aria-pressed="${w === s.progress.selected}" title="${STORY_WEAPONS[w].role}">${STORY_WEAPONS[w].name}</button>`).join("");
    }
    const queen = s.enemies.find(e => e.kind === "queen"); this.boss.hidden = !queen;
    if (queen) this.boss.innerHTML = `<label>Silk Queen · ${Math.ceil(queen.hp)}/${queen.maxHp}</label><meter min="0" max="${queen.maxHp}" value="${queen.hp}"></meter>`;
    drawStoryMap(this.map, s);
  }
  dispose(): void { cancelAnimationFrame(this.frame); this.abort.abort(); this.input.detach(); this.audio.dispose(); this.view.dispose(); this.root.remove(); }
}

export async function startStoryGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<void> {
  const game = new StoryGame(canvas, uiRoot);
  try { await game.boot(); } catch (error) {
    game.dispose(); uiRoot.innerHTML = '<div class="boot-screen"><div class="boot-panel"><h1>Homeward could not start</h1><p>Please reload, or return to Expedition.</p><a href="?">Return to Expedition</a></div></div>'; console.error(error);
  }
}
