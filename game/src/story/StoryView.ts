import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, PlaneGeometry, Quaternion, RingGeometry, SphereGeometry, Vector3, type Material } from "three";
import { MeshForge } from "../art/MeshForge.ts";
import type { PuppetRig } from "../art/characters.ts";
import type { SpiderRig } from "../art/machines.ts";
import { Renderer } from "../rendering/Renderer.ts";
import { animateHumanoid, animateSpider, captureRigRest, captureSpiderRest, createPuppetState } from "../rendering/AnimationSystem.ts";
import { CHAPTERS, STORY_ENEMIES, type Chapter, type Point } from "./StoryData.ts";
import { CELL, groundHeight, HILL_LAUNCH, HOME_LENGTH, homePoint, MAZE, MAZE_CRATES, MAZE_EXIT, MAZE_PEN, MAZE_SIZE, spiralPoint, SPIRAL_JUMP } from "./StoryMaps.ts";
import type { StoryState } from "./StoryState.ts";

const UP = new Vector3(0, 1, 0);
const tmpA = new Vector3(), tmpB = new Vector3(), tmpQ = new Quaternion();
class Instances {
  mesh: InstancedMesh;
  count = 0;
  private dummy = new Object3D();
  private color = new Color();
  constructor(root: Group, geometry: BufferGeometry, material: Material, readonly cap: number) {
    this.mesh = new InstancedMesh(geometry, material, cap); this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; root.add(this.mesh);
  }
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, heading = 0, rotation?: Quaternion): void {
    if (this.count >= this.cap) return;
    this.dummy.position.set(x, y, z); this.dummy.scale.set(sx, sy, sz);
    if (rotation) this.dummy.quaternion.copy(rotation); else this.dummy.rotation.set(0, heading, 0);
    this.dummy.updateMatrix(); this.mesh.setMatrixAt(this.count, this.dummy.matrix); this.mesh.setColorAt(this.count, this.color.setHex(color)); this.count++;
  }
  line(a: Vector3, b: Vector3, radius: number, color: number): void {
    const length = a.distanceTo(b); if (length < 1e-6) return;
    tmpQ.setFromUnitVectors(UP, tmpB.copy(b).sub(a).normalize());
    this.add((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, radius, length, radius, color, 0, tmpQ);
  }
  finish(): void { this.mesh.count = this.count; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; this.count = 0; }
  dispose(): void { this.mesh.dispose(); }
}

export class StoryView {
  readonly renderer: Renderer;
  readonly camera = new OrthographicCamera(-25, 25, 20, -20, 0.1, 400);
  readonly forge = new MeshForge();
  private root = new Group();
  private terrain = new Group();
  private actors = new Group();
  private chapter: Chapter | 0 = 0;
  private engineer!: PuppetRig;
  private spider!: SpiderRig;
  private guns: Object3D[] = [];
  private anim = createPuppetState(0);
  private bodies!: Instances;
  private limbs!: Instances;
  private details!: Instances;
  private markers!: Instances;
  private beams!: Instances;
  private rocks!: Instances;
  private flames!: Instances;
  private dynamic: Instances[] = [];
  private terrainInstances: Instances[] = [];
  private ownedGeometry: BufferGeometry[] = [];
  private terrainGeometry: BufferGeometry[] = [];
  private ownedMaterials: Material[] = [];
  private terrainMaterials: Material[] = [];
  private focus = new Vector3();
  private first = true;
  private readonly contactHeight = (x: number, z: number) => groundHeight(this.chapter || 1, x, z);
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, { preserveDrawingBuffer: new URLSearchParams(location.search).has("storyCapture") });
    this.renderer.scene.add(this.root); this.root.add(this.terrain, this.actors);
    // Instanced contact and terrain shading provide the low-cost story baseline.
    this.renderer.renderer.shadowMap.enabled = false;
    this.renderer.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.scene.fog = null;
  }
  async boot(): Promise<void> {
    this.forge.build(); await this.forge.loadBlenderLibrary();
    this.engineer = this.forge.createEngineer(); captureRigRest(this.engineer); this.actors.add(this.engineer.root);
    this.spider = this.forge.createSpider(); captureSpiderRest(this.spider); this.actors.add(this.spider.root);
    this.guns = [this.forge.createRivetRifle(), this.forge.createArcProjector(), this.forge.createMagneticLauncher(), this.forge.createSteamFlamer()];
    for (const gun of this.guns) { gun.position.set(0, -0.2, 0.25); this.engineer.forearmR.add(gun); }
    const solid = new MeshStandardMaterial({ roughness: 0.85, metalness: 0.12 });
    const glow = new MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide });
    this.ownedMaterials.push(solid, glow);
    const sphere = new SphereGeometry(1, 10, 7), cylinder = new CylinderGeometry(1, 1, 1, 6), box = new BoxGeometry(1, 1, 1), ring = new RingGeometry(0.83, 1, 28);
    ring.rotateX(-Math.PI / 2); this.ownedGeometry.push(sphere, cylinder, box, ring);
    this.bodies = new Instances(this.actors, sphere, solid, 150);
    this.limbs = new Instances(this.actors, cylinder, solid, 1000);
    this.details = new Instances(this.actors, box, solid, 300);
    this.markers = new Instances(this.actors, ring, glow, 100);
    this.beams = new Instances(this.actors, cylinder, glow, 180);
    this.rocks = new Instances(this.actors, this.forge.propGeometry("rock"), this.forge.materials.surface, 10);
    this.flames = new Instances(this.actors, this.forge.effectGeometry("flame") ?? sphere, glow, 96);
    this.dynamic = [this.bodies, this.limbs, this.details, this.markers, this.beams, this.rocks, this.flames];
  }
  private terrainMesh(geometry: BufferGeometry, color: number): Mesh {
    const material = new MeshStandardMaterial({ color, roughness: 1, side: DoubleSide });
    this.terrainMaterials.push(material); this.terrainGeometry.push(geometry);
    const mesh = new Mesh(geometry, material); this.terrain.add(mesh); return mesh;
  }
  private ribbon(points: Point[], width: number, chapter: Chapter, color: number): void {
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i], before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
      const dx = after.x - before.x, dz = after.z - before.z, d = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) { const x = p.x + dz / d * width * side, z = p.z - dx / d * width * side; vertices.push(x, groundHeight(chapter, x, z) + 0.055, z); }
      if (i) { const a = i * 2; indices.push(a - 2, a, a - 1, a - 1, a, a + 1); }
    }
    const geo = new BufferGeometry(); geo.setAttribute("position", new Float32BufferAttribute(vertices, 3)); geo.setIndex(indices); geo.computeVertexNormals(); this.terrainMesh(geo, color);
  }
  private build(chapter: Chapter): void {
    for (const instances of this.terrainInstances) instances.dispose(); this.terrainInstances.length = 0;
    for (const geo of this.terrainGeometry) geo.dispose(); this.terrainGeometry.length = 0;
    for (const material of this.terrainMaterials) material.dispose(); this.terrainMaterials.length = 0;
    this.terrain.clear(); this.chapter = chapter; this.first = true;
    this.renderer.scene.background = new Color(chapter === 3 ? 0x667284 : 0xabc5b8);
    const backdrop = new PlaneGeometry(500, 500); backdrop.rotateX(-Math.PI / 2); backdrop.translate(0, -0.08, 0);
    this.terrainMesh(backdrop, CHAPTERS[chapter].color);
    const centerZ = chapter === 4 ? -28 : 0;
    const ground = new PlaneGeometry(108, chapter === 4 ? 168 : 108, 100, chapter === 4 ? 140 : 100); ground.rotateX(-Math.PI / 2); ground.translate(0, 0, centerZ);
    const position = ground.getAttribute("position"), colors: number[] = [], color = new Color();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i); position.setY(i, groundHeight(chapter, x, z));
      color.setHex(CHAPTERS[chapter].color).multiplyScalar(0.9 + Math.sin(x * 0.42) * Math.cos(z * 0.53) * 0.07); colors.push(color.r, color.g, color.b);
    }
    ground.setAttribute("color", new Float32BufferAttribute(colors, 3)); ground.computeVertexNormals();
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1 }); this.terrainMaterials.push(material); this.terrainGeometry.push(ground);
    this.terrain.add(new Mesh(ground, material));
    if (chapter === 1) {
      this.ribbon(Array.from({ length: 301 }, (_, i) => spiralPoint(i / 300)), 1.8, chapter, 0xc7ad7d);
      // Thin bank edges explain why the stone follows the spiral rather than falling sideways.
      const bank = Array.from({ length: 301 }, (_, i) => { const p = spiralPoint(i / 300), r = Math.hypot(p.x, p.z); return { x: p.x * (r + 2) / r, z: p.z * (r + 2) / r }; });
      this.ribbon(bank, 0.2, chapter, 0x887e66);
    } else if (chapter === 4) this.ribbon(Array.from({ length: 160 }, (_, i) => homePoint(i / 159 * HOME_LENGTH)), 5.8, chapter, 0xc7b38b);
    if (chapter === 2) {
      const geo = new BoxGeometry(CELL - 0.12, 2.1, CELL - 0.12); this.terrainGeometry.push(geo);
      const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 1 }); this.terrainMaterials.push(mat);
      const walls = new Instances(this.terrain, geo, mat, 225); this.terrainInstances.push(walls);
      for (let i = 0; i < MAZE.length; i++) if (MAZE[i]) walls.add((i % MAZE_SIZE - 7) * CELL, 1.05, (Math.floor(i / MAZE_SIZE) - 7) * CELL, 1, 1, 1, i % 3 ? 0x567464 : 0x698173);
      walls.finish();
    }
    const trees = new Instances(this.terrain, this.forge.propGeometry("treeBroadleaf"), this.forge.materials.surface, 70);
    const rocks = new Instances(this.terrain, this.forge.propGeometry("rockB"), this.forge.materials.surface, 45);
    const houses = new Instances(this.terrain, this.forge.propGeometry("house_cottage"), this.forge.materials.surface, 8);
    this.terrainInstances.push(trees, rocks, houses);
    for (let i = 0; i < 64; i++) {
      let x: number, z: number;
      if (chapter === 4) { x = (i % 2 ? 1 : -1) * (19 + Math.sin(i * 2.4) * 5); z = 36 - Math.floor(i / 2) * 4; }
      else { const angle = i * Math.PI * 2 / 64; const radius = chapter === 1 ? 39 + Math.sin(i * 4) * 3 : chapter === 2 ? 43 : 39; x = Math.cos(angle) * radius; z = Math.sin(angle) * radius; }
      const scale = 0.8 + (i % 4) * 0.13;
      if (chapter !== 3 || i % 3 === 0) trees.add(x, groundHeight(chapter, x, z), z, scale, scale, scale, 0xffffff, i * 0.9);
      if (i % 2 === 0) rocks.add(x * 0.93, groundHeight(chapter, x * 0.93, z), z, 0.8, 0.8, 0.8, 0xc5beaa, i);
    }
    if (chapter === 1) houses.add(-7, groundHeight(1, -7, -5), -5, 1, 1, 1, 0xffe2af);
    if (chapter === 3) { houses.add(-19, 0, -18, 1.1, 1.1, 1.1, 0xd9bfc8); houses.add(21, 0, -15, 0.9, 0.9, 0.9, 0xc9c6dc); }
    if (chapter === 4) { houses.add(-13, 0, -88, 1.3, 1.3, 1.3, 0xffdfaf); houses.add(13, 0, -88, 1.1, 1.1, 1.1, 0xffd0b0); }
    trees.finish(); rocks.finish(); houses.finish();
  }
  render(s: StoryState, dt: number, overview = false): void {
    if (!this.engineer) return;
    if (this.chapter !== s.chapter) this.build(s.chapter);
    const p = s.player, m = s.machine;
    this.engineer.root.position.set(p.x, 0, p.z); this.engineer.root.rotation.y = p.heading;
    animateHumanoid(this.engineer, this.anim, dt, s.status === "playing" ? p.speed : 0, 6.5, false);
    this.engineer.root.position.y += groundHeight(s.chapter, p.x, p.z);
    if (s.progress.armorLevel > 0) this.details.add(p.x, groundHeight(s.chapter, p.x, p.z) + 1.1, p.z, 0.75, 0.4, 0.55, 0xc4ae79, p.heading);
    this.guns.forEach((gun, i) => { gun.visible = i === ["rifle", "laser", "rocket", "flame"].indexOf(s.progress.selected); });
    this.spider.root.position.set(m.x, groundHeight(s.chapter, m.x, m.z), m.z); this.spider.root.rotation.y = m.heading;
    animateSpider(this.spider, dt, m.speed, false, s.chapter !== 4 || m.speed === 0, m.hp > 0 ? 0.7 : 0, this.contactHeight);
    this.spider.root.visible = s.chapter !== 2;
    this.markers.add(p.x, groundHeight(s.chapter, p.x, p.z) + 0.06, p.z, 1.15, 1, 1.15, p.invincible > 0 ? 0xffffff : 0x77ffff);
    if (s.chapter !== 2) this.markers.add(m.x, groundHeight(s.chapter, m.x, m.z) + 0.07, m.z, 5.5, 1, 5.5, 0x56ceb0);
    for (const e of s.enemies) this.enemy(s, e);
    if (s.chapter === 1) {
      for (const [i, cow] of s.cows.entries()) if (cow.status !== "captured") {
        this.cow(cow.x, groundHeight(1, cow.x, cow.z), cow.z, i * 0.4, cow.status === "webbed");
        if (cow.status === "webbed") this.markers.add(cow.x, 6.08, cow.z, 1.1, 1, 1.1, 0xffc04a);
      }
      this.markers.add(HILL_LAUNCH.x, 6.12, HILL_LAUNCH.z, 2.1, 1, 2.1, 0xffce65);
      this.details.add(HILL_LAUNCH.x, 6.7, HILL_LAUNCH.z, 1.4, 1.3, 1.5, 0x615a45);
      for (let i = 0; i < 9; i++) { const t = 1 - i * 0.045, q = spiralPoint(t); this.markers.add(q.x, groundHeight(1, q.x, q.z) + 0.12, q.z, 0.35, 1, 0.35, 0xe9d58a); }
      for (const stone of s.stones) { const q = spiralPoint(stone.t); this.rocks.add(q.x, groundHeight(1, q.x, q.z) + 0.1, q.z, stone.size * 1.7, stone.size * 1.7, stone.size * 1.7, 0xc5c1ad, stone.t * 60); }
      this.fence(-1, 6, 4.3, 11, 7);
    }
    if (s.chapter === 2) {
      this.markers.add(MAZE_PEN.x, 0.08, MAZE_PEN.z, 1.5, 1, 1.5, s.penOpen ? 0x78edb6 : 0xffd578);
      if (!s.penOpen) this.cow(MAZE_PEN.x, 0, MAZE_PEN.z, 1, true);
      this.markers.add(MAZE_EXIT.x, 0.1, MAZE_EXIT.z, 1.5, 1, 1.5, 0x7ceccc);
      for (let i = 0; i < MAZE_CRATES.length; i++) if (!s.crates[i]) {
        const q = MAZE_CRATES[i]; this.details.add(q.x, 0.65, q.z, 1.3, 1.3, 1.3, 0xbd874e);
        this.details.add(q.x, 1.34, q.z, 1.35, 0.12, 0.23, 0xffd989); this.markers.add(q.x, 0.06, q.z, 1.1, 1, 1.1, 0xffd578);
      }
    }
    if (s.chapter === 3) {
      this.fence(0, 0, -23, 7, 5); this.cow(-1, 0, -23, 0, true); this.cow(1, 0, -23, 1, true);
      this.markers.add(0, 0.1, -23, 3.2, 1, 3.2, s.bossDefeated ? 0x8fffb4 : 0xffd27a);
      if (!s.bossDefeated && s.queenPhase === "warning") this.markers.add(s.slam.x, 0.12, s.slam.z, 5.5, 1, 5.5, 0xffb348);
      if (!s.bossDefeated) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; this.bodies.add(Math.cos(a) * 9, 0.8, -10 + Math.sin(a) * 9, 0.9, 1.1, 0.8, 0xcfc8cb); }
    }
    if (s.chapter === 4) {
      const aboard = s.status === "victory" ? 0 : s.progress.rescued;
      for (let i = 0; i < aboard; i++) {
        const lx = -1.3 + i % 2 * 2.6, lz = -1.8 + Math.floor(i / 2) * 1.1;
        const x = m.x + Math.cos(m.heading) * lx + Math.sin(m.heading) * lz, z = m.z - Math.sin(m.heading) * lx + Math.cos(m.heading) * lz;
        this.cow(x, 3.05, z, m.heading, false, 0.55);
      }
      this.markers.add(0, 0.06, 28 - HOME_LENGTH, 6, 1, 6, 0xffe3a3);
      if (s.status === "victory") for (let i = 0; i < 9; i++) this.cow(-8 + i % 5 * 3, 0, -92 + Math.floor(i / 5) * 3, i * 0.2);
    }
    for (const drop of s.pickups) {
      const y = groundHeight(s.chapter, drop.x, drop.z) + 0.45;
      this.details.add(drop.x, y, drop.z, drop.kind === "supply" ? 1 : 0.45, drop.kind === "supply" ? 0.8 : 0.3, 0.6, drop.kind === "supply" ? 0x69cca9 : 0xe2c889, s.time * 0.8);
      this.markers.add(drop.x, y - 0.4, drop.z, 0.6, 1, 0.6, drop.kind === "supply" ? 0x6eeac1 : 0xeacb87);
    }
    for (const projectile of s.projectiles) {
      const y = groundHeight(s.chapter, projectile.x, projectile.z) + 1.1;
      this.beams.line(tmpA.set(projectile.x, y, projectile.z), new Vector3(projectile.x - projectile.dx * (projectile.rocket ? 0.8 : 1.2), y, projectile.z - projectile.dz * (projectile.rocket ? 0.8 : 1.2)), projectile.rocket ? 0.15 : 0.055, projectile.rocket ? 0xff9857 : 0xffe7a5);
    }
    for (const effect of s.effects) {
      const h = groundHeight(s.chapter, effect.x, effect.z);
      if (effect.kind === "blast" || effect.kind === "web") this.markers.add(effect.x, h + 0.13, effect.z, effect.radius, 1, effect.radius, effect.kind === "web" ? 0xdcc7e9 : 0xffb369);
      else if (effect.kind === "flame") {
        const age = 1 - effect.life / effect.maxLife;
        for (let i = 0; i < 4; i++) {
          const t = Math.min(1, (i + age) / 4), x = effect.x + (effect.toX - effect.x) * t, z = effect.z + (effect.toZ - effect.z) * t;
          const size = (0.4 + t * 0.65) * (1 - age * 0.5);
          this.flames.add(x, groundHeight(s.chapter, x, z) + 0.9 + age * 0.4, z, size, size, size * 1.6, i < 2 ? 0xffd17b : 0xff893c, Math.atan2(effect.toX - effect.x, effect.toZ - effect.z));
        }
      } else this.beams.line(tmpA.set(effect.x, h + 1, effect.z), new Vector3(effect.toX, groundHeight(s.chapter, effect.toX, effect.toZ) + 1, effect.toZ), effect.radius, 0x77eeff);
    }
    for (const turret of s.turrets) {
      this.details.add(turret.x, 0.45, turret.z, 1.4, 0.8, 1.4, 0x667f79);
      this.bodies.add(turret.x, 1.1, turret.z, 0.7, 0.5, 0.7, 0xbba976);
      this.details.add(turret.x, 1.2, turret.z - 0.75, 0.25, 0.25, 1.3, 0x596264);
    }
    for (const batch of this.dynamic) batch.finish();
    const aspect = this.renderer.aspect;
    const halfHeight = overview ? Math.max(s.chapter === 4 ? 69 : 43, 43 / aspect) : aspect < 0.8 ? 24 : aspect > 1.8 ? 20 : 24;
    const halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth; this.camera.right = halfWidth; this.camera.top = halfHeight; this.camera.bottom = -halfHeight; this.camera.updateProjectionMatrix();
    const target = new Vector3(overview ? 0 : p.x, overview ? 0 : groundHeight(s.chapter, p.x, p.z), overview ? (s.chapter === 4 ? -28 : 0) : p.z);
    if (this.first) { this.focus.copy(target); this.first = false; } else this.focus.lerp(target, 1 - Math.exp(-dt * 8));
    // North stays up: the maze entrance is screen-bottom-left and exit top-right.
    this.camera.position.set(this.focus.x, this.focus.y + 55, this.focus.z + 32);
    this.camera.lookAt(this.focus); this.camera.updateMatrixWorld();
    this.renderer.updateShadowFocus(this.focus.x, this.focus.z); this.renderer.render(this.camera);
  }
  private cow(x: number, y: number, z: number, heading: number, webbed = false, size = 1): void {
    const pos = (lx: number, lz: number) => ({ x: x + (Math.cos(heading) * lx + Math.sin(heading) * lz) * size, z: z + (-Math.sin(heading) * lx + Math.cos(heading) * lz) * size });
    this.bodies.add(x, y + 0.85 * size, z, 0.65 * size, 0.55 * size, 0.95 * size, webbed ? 0xc4b6d4 : 0xfff4df, heading);
    const head = pos(0, 0.93); this.bodies.add(head.x, y + size, head.z, 0.43 * size, 0.4 * size, 0.45 * size, 0x5a4540, heading);
    const nose = pos(0, 1.25); this.bodies.add(nose.x, y + 0.88 * size, nose.z, 0.36 * size, 0.19 * size, 0.2 * size, 0xe4aaa0, heading);
    for (const lx of [-0.42, 0.42]) for (const lz of [-0.58, 0.58]) { const p = pos(lx, lz); this.details.add(p.x, y + 0.28 * size, p.z, 0.16 * size, 0.56 * size, 0.17 * size, 0x66534a, heading); }
    for (const lx of [-0.4, 0.4]) { const p = pos(lx, 0.98); this.details.add(p.x, y + 1.22 * size, p.z, 0.33 * size, 0.12 * size, 0.17 * size, 0xead7b4, heading); }
    const patch = pos(-0.38, -0.2); this.bodies.add(patch.x, y + 1.17 * size, patch.z, 0.3 * size, 0.1 * size, 0.4 * size, 0x775947, heading);
    const bell = pos(0, 0.7); this.details.add(bell.x, y + 0.6 * size, bell.z, 0.2 * size, 0.2 * size, 0.15 * size, 0xffcc59, heading);
  }
  private enemy(s: StoryState, e: StoryState["enemies"][number]): void {
    const def = STORY_ENEMIES[e.kind], humanoid = e.kind === "husk" || e.kind === "stitcher";
    const jump = e.jump > 0 && e.jump < 1 ? Math.sin((1 - e.jump) * Math.PI) * 4 : 0;
    const h = groundHeight(s.chapter, e.x, e.z) + jump, scale = e.kind === "queen" ? 3.4 : e.kind === "shellback" ? 1.25 : 0.85;
    if (humanoid) {
      this.details.add(e.x, h + 1.15, e.z, 0.65, 0.9, 0.4, def.color, e.heading);
      this.bodies.add(e.x, h + 1.92, e.z, 0.3, 0.34, 0.3, 0xefeddd);
      for (const side of [-1, 1]) {
        const swing = Math.sin(s.time * 5 + e.id) * side * 0.3;
        this.limbs.line(tmpA.set(e.x + side * 0.22, h + 0.9, e.z), new Vector3(e.x + side * 0.25, h + 0.12, e.z + swing), 0.11, def.color);
        this.limbs.line(tmpA.set(e.x + side * 0.4, h + 1.5, e.z), new Vector3(e.x + side * 0.55, h + 0.9, e.z + 0.2), 0.1, def.color);
      }
      this.bodies.add(e.x, h + 1.4, e.z + 0.25, 0.28, 0.22, 0.25, e.kind === "stitcher" ? 0xb463d8 : 0x8bc95d);
      if (e.kind === "stitcher") for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1;
        this.limbs.line(tmpA.set(e.x, h + 1.4, e.z + 0.25), new Vector3(e.x + side * 0.65, h + 1.2 + Math.floor(i / 2) * 0.5, e.z + 0.4), 0.055, 0x7d4592);
      }
    } else {
      this.bodies.add(e.x, h + 0.8 * scale, e.z, 0.7 * scale, 0.53 * scale, 0.96 * scale, def.color, e.heading);
      const headX = e.x + Math.sin(e.heading) * 0.8 * scale, headZ = e.z + Math.cos(e.heading) * 0.8 * scale;
      this.bodies.add(headX, h + 0.65 * scale, headZ, 0.48 * scale, 0.4 * scale, 0.48 * scale, 0x343238);
      for (const side of [-1, 1]) this.details.add(headX + Math.cos(e.heading) * side * 0.19 * scale + Math.sin(e.heading) * 0.35 * scale, h + 0.85 * scale, headZ - Math.sin(e.heading) * side * 0.19 * scale + Math.cos(e.heading) * 0.35 * scale, 0.11 * scale, 0.11 * scale, 0.11 * scale, 0xffaa75);
      for (let i = 0; i < 8; i++) {
        const side = i % 2 ? 1 : -1, row = Math.floor(i / 2), angle = e.heading + side * (0.65 + row * 0.55);
        const stride = Math.sin(s.time * (e.kind === "queen" ? 1.5 : 7) + row * Math.PI + side) * 0.15;
        const kx = e.x + Math.sin(angle) * 1.18 * scale, kz = e.z + Math.cos(angle) * 1.18 * scale;
        const fx = e.x + Math.sin(angle + stride) * 1.8 * scale, fz = e.z + Math.cos(angle + stride) * 1.8 * scale;
        this.limbs.line(tmpA.set(e.x, h + 0.65 * scale, e.z), new Vector3(kx, h + 1.2 * scale, kz), 0.075 * scale, def.color);
        this.limbs.line(tmpA.set(kx, h + 1.2 * scale, kz), new Vector3(fx, groundHeight(s.chapter, fx, fz) + jump + 0.05, fz), 0.055 * scale, 0x423c43);
      }
      if (e.kind === "queen") this.bodies.add(e.x, h + 1.3 * scale, e.z, 0.5, 0.4, 0.7, s.queenPhase === "open" ? 0xffd46d : 0x87467e);
      if (e.jump >= 1) { const landing = spiralPoint(e.jumpFrom + SPIRAL_JUMP); this.markers.add(landing.x, groundHeight(1, landing.x, landing.z) + 0.1, landing.z, 1.7, 1, 1.7, 0x66ffff); }
    }
    if (e.burn > 0) this.markers.add(e.x, h + 0.1, e.z, scale, 1, scale, 0xff934b);
  }
  private fence(x: number, y: number, z: number, width: number, depth: number): void {
    for (const side of [-1, 1]) {
      this.details.add(x, y + 0.7, z + side * depth / 2, width, 0.15, 0.15, 0xd2b789);
      this.details.add(x + side * width / 2, y + 0.7, z, 0.15, 0.15, depth, 0xd2b789);
      for (const end of [-1, 1]) this.details.add(x + side * width / 2, y + 0.5, z + end * depth / 2, 0.18, 1, 0.18, 0x917552);
    }
  }
  screenPosition(p: Point): { x: number; y: number } {
    const point = new Vector3(p.x, groundHeight(this.chapter || 1, p.x, p.z), p.z).project(this.camera);
    return { x: (point.x + 1) / 2 * this.renderer.viewportWidth, y: (1 - point.y) / 2 * this.renderer.viewportHeight };
  }
  dispose(): void {
    for (const batch of [...this.dynamic, ...this.terrainInstances]) batch.dispose();
    for (const geo of [...this.ownedGeometry, ...this.terrainGeometry]) geo.dispose();
    for (const mat of this.ownedMaterials) mat.dispose();
    for (const mat of this.terrainMaterials) mat.dispose();
    this.root.removeFromParent(); this.forge.dispose(); this.renderer.dispose();
  }
}
