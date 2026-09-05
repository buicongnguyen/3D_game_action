import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial } from "three";
import type { Game } from "../core/Game.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import type { MeshForge } from "../art/MeshForge.ts";
import type { Renderer } from "../rendering/Renderer.ts";
import type { CameraController } from "../rendering/CameraController.ts";

/** Isolated, labelled contact sheet using the actual cached runtime models. */
export function setupAssetReview(game: Game, world: GameWorld): void {
  const context = game as unknown as { forge: MeshForge; renderer: Renderer; camera: CameraController; view: { root: Group } };
  world.paused = true;
  context.view.root.visible = false;
  document.getElementById("ui-root")!.style.display = "none";
  const { forge, renderer, camera } = context;
  const root = new Group();
  renderer.scene.add(root);
  const floor = new Mesh(new PlaneGeometry(60, 46), new MeshBasicMaterial({ color: 0x4e5658 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.1;
  root.add(floor);
  const props = ["treeConifer", "treeBroadleaf", "treeSpindle", "rock", "ruinedHouse"];
  const items = ["repairKit", "armorPlate", "shockMine", "weaponPart", "pressureCanister"];
  const models = [
    ...props.map((name) => ({ name, object: new Mesh(forge.propGeometry(name), forge.materials.surfaceCheap), scale: 0.8 })),
    ...["minion", "warrior", "golem"].map((name) => ({ name, object: forge.createEnemy(name).root, scale: 1.7 })),
    { name: "turret", object: forge.createTurret().root, scale: 1.5 },
    { name: "crawler", object: forge.createCrawlerTurret().root, scale: 1.5 },
    ...items.map((name) => ({ name, object: forge.createPickup(name, false), scale: 3 })),
  ];
  models.forEach(({ name, object, scale }, index) => {
    const x = (index % 5 - 2) * 7.8;
    const z = (Math.floor(index / 5) - 1) * 9;
    object.position.set(x, 0, z);
    object.scale.setScalar(scale);
    object.rotation.y = -0.35;
    root.add(object);
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 64;
    const text = canvas.getContext("2d")!;
    text.fillStyle = "#f6ecdc";
    text.font = "26px sans-serif";
    text.textAlign = "center";
    text.fillText(name, 192, 43);
    const label = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false }));
    label.position.set(x, 0.1, z + 2.5);
    label.scale.set(6.3, 1.05, 1);
    root.add(label);
  });
  // Capture-only camera; do not modify normal gameplay framing.
  camera.update = () => {};
  camera.snapTo = () => {};
  camera.camera.left = -22;
  camera.camera.right = 22;
  camera.camera.top = 22 / renderer.aspect;
  camera.camera.bottom = -22 / renderer.aspect;
  camera.camera.position.set(0, 32, 30);
  camera.camera.lookAt(0, 1, 0);
  camera.camera.updateProjectionMatrix();
  camera.camera.updateMatrixWorld();
}
