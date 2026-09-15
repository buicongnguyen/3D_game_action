// A story-only entry keeps authored chapter rules separate from the established expedition.
export {};
if (new URLSearchParams(location.search).get("mode") === "story") {
  const { startStoryGame } = await import("./story/StoryGame.ts");
  const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
  const ui = document.querySelector<HTMLElement>("#ui-root");
  if (!canvas || !ui) throw new Error("Missing game canvas or UI root");
  await startStoryGame(canvas, ui);
} else {
  await import("./main.ts");
}
