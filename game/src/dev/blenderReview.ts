import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial, type Object3D } from "three";
import type { Game } from "../core/Game.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import type { MeshForge } from "../art/MeshForge.ts";
import type { Renderer } from "../rendering/Renderer.ts";
import type { CameraController } from "../rendering/CameraController.ts";
import type { VfxSystem } from "../rendering/VfxSystem.ts";

/** Capture-only turntable: these are the same shared meshes used by gameplay. */
function stage(game: Game, world: GameWorld, width: number) {
  const context = game as unknown as {
    forge: MeshForge; renderer: Renderer; camera: CameraController; view: { root: Group }; vfx: VfxSystem;
  };
  world.paused = true;
  context.view.root.visible = false;
  document.getElementById("ui-root")!.style.display = "none";
  const root = new Group(); context.renderer.scene.add(root);
  const floor = new Mesh(new PlaneGeometry(80, 70), new MeshBasicMaterial({ color: 0x485357 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; root.add(floor);
  const { camera, renderer } = context;
  camera.update = () => {}; camera.snapTo = () => {};
  camera.camera.left = -width; camera.camera.right = width;
  camera.camera.top = width / renderer.aspect; camera.camera.bottom = -width / renderer.aspect;
  camera.camera.position.set(0, 32, 34); camera.camera.lookAt(0, 1.4, 0);
  camera.camera.updateProjectionMatrix(); camera.camera.updateMatrixWorld();
  return { ...context, root };
}

function label(root: Group, name: string, x: number, z: number, width = 6): void {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 64;
  const text = canvas.getContext("2d")!;
  text.fillStyle = "#fff3de"; text.font = "28px sans-serif"; text.textAlign = "center";
  text.fillText(name, 256, 44);
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false }));
  sprite.position.set(x, 0.1, z); sprite.scale.set(width, width / 8, 1); root.add(sprite);
}

export function setupBlenderModels(game: Game, world: GameWorld): void {
  const { root, forge } = stage(game, world, 18);
  function add(object: Object3D, name: string, x: number, z: number, scale: number, offset = 2.8) {
    object.position.set(x, 0, z); object.rotation.y = -0.38; object.scale.setScalar(scale); root.add(object);
    label(root, name, x, z + offset);
  }
  ["cottage", "town", "foundry"].forEach((id, i) => {
    add(new Mesh(forge.propGeometry(`house_${id}`), forge.materials.surface), `${id} / occupied house`, (i - 1) * 10, -10, 1);
  });
  ["minion", "warrior", "golem"].forEach((id, i) => {
    add(forge.createEnemy(id).root, `${id} / articulated rig`, (i - 1) * 10, 0, 2.3, 2.3);
  });
  [
    ["Scattergun", forge.createScattergun()], ["Carbine", forge.createGearburstCarbine()],
    ["Rivet rifle", forge.createRivetRifle()], ["Steam flamer", forge.createSteamFlamer()],
    ["Arc projector", forge.createArcProjector()], ["Magnetic launcher", forge.createMagneticLauncher()],
  ].forEach(([name, object], i) => {
    add(object as Object3D, name as string, (i - 2.5) * 5.5, 8.3, 3.6, 3.6);
  });
}

export function setupBlenderEffects(game: Game, world: GameWorld): void {
  const { root, forge, vfx } = stage(game, world, 13);
  const emitters = [
    { name: "Directional muzzle", gun: forge.createScattergun(), emit: (x: number, z: number) => vfx.weaponFlash(x, 1, z, 0, "shotgun") },
    { name: "Steam flame tongues", gun: forge.createSteamFlamer(), emit: (x: number, z: number) => vfx.weaponFlash(x, 1, z, 0, "flamer") },
    { name: "Arc discharge", gun: forge.createArcProjector(), emit: (x: number, z: number) => vfx.weaponFlash(x, 1, z, 0, "arc") },
    { name: "Explosion + smoke", emit: (x: number, z: number) => vfx.explosion(x, z, 3) },
    { name: "Impact sparks", emit: (x: number, z: number) => vfx.impact(x, 1, z, false) },
    { name: "Overload vent", emit: (x: number, z: number) => vfx.overloadVent(x, z, 1) },
  ];
  emitters.forEach(({ name, gun, emit }, i) => {
    const x = (i % 3 - 1) * 8, z = (Math.floor(i / 3) - 0.5) * 10;
    if (gun) { gun.position.set(x, 1, z - 1.3); gun.scale.setScalar(2); root.add(gun); }
    emit(x, z); label(root, name, x, z + 3.3, 7);
  });
  vfx.update(0.06);
  const update = vfx.update.bind(vfx);
  vfx.update = () => update(0); // Freeze this review moment, not the live game.
}
