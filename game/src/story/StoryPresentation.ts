import { CHAPTERS, type Chapter } from "./StoryData.ts";
import { HILL_LAUNCH, MAZE, MAZE_CRATES, MAZE_EXIT, MAZE_PEN, MAZE_SIZE } from "./StoryMaps.ts";
import type { StoryState } from "./StoryState.ts";

export function storyDistanceWarning(s: StoryState): string {
  if (s.chapter !== 4 || s.status !== "playing") return "";
  const dx = s.machine.x - s.player.x, dz = s.machine.z - s.player.z, distance = Math.hypot(dx, dz);
  if (distance < 32) return "";
  const direction = `${dz < -5 ? "north" : dz > 5 ? "south" : ""}${Math.abs(dx) > 5 ? `${Math.abs(dz) > 5 ? "-" : ""}${dx > 0 ? "east" : "west"}` : ""}`;
  return `Spider ${Math.round(distance)} m ${direction} · You can keep exploring`;
}
/** Original code-native story illustrations. No network image dependency or raster download. */
export function storyIllustration(chapter: Chapter, ending = false): string {
  const cow = (x: number, y: number, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-18 4v13m25-13v13" stroke="#584e47" stroke-width="5"/><ellipse rx="23" ry="13" fill="#fff0d2"/><ellipse cx="-6" cy="-2" rx="8" ry="7" fill="#896747"/><ellipse cx="24" cy="-3" rx="11" ry="10" fill="#fff0d2"/><ellipse cx="29" cy="1" rx="8" ry="5" fill="#d9a29b"/><circle cx="26" cy="-7" r="2" fill="#263a3b"/><path d="M19-12l-2-7m11 7 3-7" stroke="#dfcd9b" stroke-width="3"/></g>`;
  const spider = (x: number, y: number, scale: number, color: string) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-16 0-42 12-52 32M-10 4-22 23-28 40M16 0 42 12 52 32M10 4 22 23 28 40" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/><ellipse rx="29" ry="19" fill="${color}"/><rect x="-19" y="-26" width="38" height="25" rx="7" fill="#8b805f"/><circle cx="17" cy="-3" r="6" fill="#90e8d6"/></g>`;
  const colors = chapter === 3 ? ["#383f58", "#8d7a91", "#706678"] : ["#a9cfc4", "#d7e2c2", "#83a16b"];
  let scene = `<path d="M0 135Q130 55 230 130Q410 20 640 115V200H0Z" fill="${colors[2]}"/>`;
  if (chapter === 1) scene += `<path d="M195 165C410 180 458 126 347 122C217 116 226 95 339 96C404 96 386 76 334 80" fill="none" stroke="#e4ce96" stroke-width="11"/>${spider(340, 76, 0.8, "#716c53")}${cow(288, 80, 0.6)}${cow(253, 85, 0.5)}`;
  if (chapter === 2) scene += `<path d="M70 150V60h70v55h70V45h70v65h80V45h65v75h70V60h60v100M110 165v-20h100m105 15v-30h90m60 20h90" fill="none" stroke="#405f57" stroke-width="15" stroke-linejoin="round"/>${cow(347, 106, 0.6)}<path d="M48 162 80 162M558 35l12-12 12 12" stroke="#ffe2a1" stroke-width="5" fill="none"/>`;
  if (chapter === 3) scene += `<path d="M30 175 110 50 178 165M467 169l81-130 80 140" fill="#59556b"/>${spider(340, 106, 1.6, "#775381")}${cow(112, 153, 0.7)}${cow(161, 151, 0.6)}<path d="M82 124h105v47H82Z" stroke="#dac3a9" fill="none" stroke-width="4"/>`;
  if (chapter === 4) scene += `<path d="M85 126v-47h70v47M76 79l44-39 45 39" fill="#f5d9a4" stroke="#83725b" stroke-width="5"/>${spider(345, 118, 1.25, "#716c53")}${cow(326, 77, 0.6)}${cow(369, 77, 0.6)}${cow(215, 149, 0.7)}`;
  if (chapter === 1 && ending) scene += `${spider(527, 130, 0.6, "#57435d")}${cow(522, 113, 0.45)}<path d="M490 117l60 12M490 121l60 4" stroke="#e9daef" fill="none"/>`;
  return `<svg class="homeward-illustration" viewBox="0 0 640 185" role="img" aria-label="${CHAPTERS[chapter].title}: ${ending ? "chapter ending" : "story illustration"}"><defs><linearGradient id="homeward-sky" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="640" height="185" rx="14" fill="url(#homeward-sky)"/><circle cx="543" cy="38" r="20" fill="#f9e7aa"/>${scene}</svg>`;
}
export function drawStoryMap(canvas: HTMLCanvasElement, s: StoryState): void {
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const w = canvas.width; ctx.clearRect(0, 0, w, w); ctx.fillStyle = "#183a34"; ctx.fillRect(0, 0, w, w);
  if (s.chapter === 2) {
    const cell = w / MAZE_SIZE; ctx.fillStyle = "#789383";
    for (let i = 0; i < MAZE.length; i++) if (MAZE[i]) ctx.fillRect(i % MAZE_SIZE * cell, Math.floor(i / MAZE_SIZE) * cell, cell, cell);
  }
  const dot = (x: number, z: number, color: string, radius = 3) => {
    const extent = s.chapter === 2 ? 60 : s.chapter === 4 ? 150 : 90;
    const px = (x / extent + 0.5) * w, py = ((z + (s.chapter === 4 ? 28 : 0)) / extent + 0.5) * w;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
  };
  if (s.chapter === 2) {
    dot(MAZE_PEN.x, MAZE_PEN.z, s.penOpen ? "#88ffc1" : "#ffcc72"); dot(MAZE_EXIT.x, MAZE_EXIT.z, "#ffffff");
    for (const [i, p] of MAZE_CRATES.entries()) if (!s.crates[i]) dot(p.x, p.z, "#e6ae68", 2);
  } else if (s.chapter === 1) { dot(HILL_LAUNCH.x, HILL_LAUNCH.z, "#ffcc72", 4); for (const c of s.cows) if (c.status !== "captured") dot(c.x, c.z, "#ffffff", 2); }
  else if (s.chapter === 3) dot(0, -23, "#ffcc72", 4);
  if (s.chapter !== 2) dot(s.machine.x, s.machine.z, "#72d5a6", 4);
  for (const e of s.enemies) dot(e.x, e.z, "#e99183", 1.5);
  dot(s.player.x, s.player.z, "#68f9ff", 3.5);
}
