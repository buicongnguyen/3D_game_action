import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  NeutralToneMapping,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Camera,
} from "three";
import { CAMERA, PERFORMANCE } from "../data/balance.ts";
import { ENV, LIGHT, TRAIL_ACCENT, TRAIL_FOG } from "../art/palette.ts";

/**
 * Renderer, scene and lighting.
 *
 * The lighting rig is deliberately minimal: one shadow-casting directional key,
 * one hemisphere bounce, one unshadowed cold fill, and ambient. Three lights
 * is the whole budget. Every glow in the game — the furnace, muzzle flashes,
 * enemy eyes, the pressure network — is an emissive material or an additive
 * sprite, never a real light. That is what keeps 130 enemies and a dozen
 * simultaneous explosions inside a 120-draw-call budget.
 *
 * The fog colour tracks the Trail state, so the world visibly cools and then
 * reddens as the horde closes. It is the cheapest danger cue in the game and it
 * costs no HUD space.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly sun: DirectionalLight;

  private readonly fog: Fog;
  private readonly targetFog = new Color();
  private readonly currentFog = new Color();
  private readonly targetMood = new Color();
  private readonly baseFill = new Color(LIGHT.fillColor);
  private readonly baseAmbient = new Color(LIGHT.ambientColor);
  private readonly baseHemiSky = new Color(LIGHT.hemiSky);
  private moodStrength = 0;
  private readonly fill: DirectionalLight;
  private readonly ambient: AmbientLight;
  private readonly hemisphere: HemisphereLight;
  private resizeObserver: ResizeObserver | null = null;
  private width = 1;
  private height = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: { preserveDrawingBuffer?: boolean } = {},
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      stencil: false,
      // Off in play: the browser is free to discard the back buffer after
      // compositing, which is faster. On for visual QA, where a screenshot is
      // taken outside the frame that drew it and would otherwise capture a
      // buffer the compositor has already thrown away.
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Neutral rather than ACES. ACES has a long toe designed to tame blown
    // highlights in photographic HDR; against flat-shaded art with a
    // deliberately dark limited palette it has nothing to tame and simply
    // crushes the midtones. Measured on the ACES build, the entire 3D frame sat
    // in a ~35-code luminance band - the lit corridor was 48.9 against a forest
    // floor of 43.5, so the path the player has to follow was separated from
    // the trees by hue alone.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = LIGHT.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in three 0.185 and silently falls back to
    // this anyway, with a console warning. Asking for it directly keeps the
    // console clean and makes the actual filter explicit.
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(ENV.fog, 1);

    this.currentFog.setHex(ENV.fog);
    this.targetFog.copy(this.currentFog);
    this.fog = new Fog(this.currentFog.getHex(), ENV.fogNear, ENV.fogFar);
    this.scene.fog = this.fog;
    this.scene.background = this.currentFog.clone();

    this.sun = new DirectionalLight(LIGHT.sunColor, LIGHT.sunIntensity);
    this.sun.position.set(...LIGHT.sunPosition);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(LIGHT.shadowMapSize, LIGHT.shadowMapSize);
    this.sun.shadow.bias = LIGHT.shadowBias;
    this.sun.shadow.normalBias = LIGHT.shadowNormalBias;
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -LIGHT.shadowExtent;
    shadowCamera.right = LIGHT.shadowExtent;
    shadowCamera.top = LIGHT.shadowExtent;
    shadowCamera.bottom = -LIGHT.shadowExtent;
    shadowCamera.near = 1;
    shadowCamera.far = 220;
    shadowCamera.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemisphere = new HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity);
    this.scene.add(this.hemisphere);

    this.fill = new DirectionalLight(LIGHT.fillColor, LIGHT.fillIntensity);
    this.fill.position.set(...LIGHT.fillPosition);
    this.fill.castShadow = false;
    this.scene.add(this.fill);

    this.ambient = new AmbientLight(LIGHT.ambientColor, LIGHT.ambientIntensity);
    this.scene.add(this.ambient);

    this.applySize();
    this.observeResize();
  }

  private observeResize(): void {
    const parent = this.canvas.parentElement ?? document.body;
    this.resizeObserver = new ResizeObserver(() => this.applySize());
    this.resizeObserver.observe(parent);
    window.addEventListener("resize", this.applySize);
  }

  /** Fires after the drawing buffer is reallocated, which also clears it. */
  onResized: (() => void) | null = null;

  private applySize = (): void => {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, CAMERA.maxDevicePixelRatio);
    // Resizing reallocates and clears the drawing buffer, so a no-op resize is
    // not free: it throws away a frame that may be the one about to be read.
    if (width === this.width && height === this.height && dpr === this.appliedPixelRatio) return;

    this.width = width;
    this.height = height;
    this.appliedPixelRatio = dpr;
    // Capping DPR at 1.5 is the single biggest fill-rate lever on an integrated
    // GPU; a 2x retina buffer costs nearly twice the pixels for no readable gain
    // at this camera distance.
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.onResized?.();
  };

  private appliedPixelRatio = 0;

  get aspect(): number {
    return this.width / this.height;
  }

  get viewportWidth(): number {
    return this.width;
  }

  get viewportHeight(): number {
    return this.height;
  }

  /**
   * Keeps the shadow frustum tight around the action. A fixed world-space
   * shadow camera would either waste almost all of its 2048 texels on empty
   * ground or clip the spider's shadow the moment the run moved past 100 m.
   */
  updateShadowFocus(x: number, z: number): void {
    const offset = LIGHT.sunPosition;
    this.sun.position.set(x + offset[0], offset[1], z + offset[2]);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Shifts the whole scene toward the Trail state's mood.
   *
   * Fog alone was not enough, and worse, it was actively incoherent: fog is a
   * function of depth, so during Pursuit the ground at frame centre stayed
   * byte-identical to its unthreatened colour while the same material further
   * away turned red. A reviewer measured exactly that — one asset rendering as
   * two materials in a single frame. The lighting moves too, so the shift is
   * global and the world reads as one place under one sky.
   */
  setTrailMood(trailState: string, dt: number): void {
    // Eased against elapsed time, not against how often this happens to be
    // called. A fixed per-call step made the transition frame-rate dependent
    // and left it barely started in a capture, which renders only a handful of
    // frames — the feature was effectively invisible in every screenshot.
    const blend = 1 - Math.pow(2, -dt / MOOD_HALF_LIFE);

    this.targetFog.setHex(TRAIL_FOG[trailState] ?? ENV.fog);
    this.currentFog.lerp(this.targetFog, blend);
    this.fog.color.copy(this.currentFog);
    if (this.scene.background instanceof Color) {
      this.scene.background.copy(this.currentFog);
    }
    this.renderer.setClearColor(this.currentFog, 1);

    // The mood target is the accent pulled well toward white before it is ever
    // used as a light colour. Lerping a light straight at a saturated red
    // multiplies its red and *divides* its blue - measured at the old weights,
    // ambient red went up 17x while ambient blue fell to 0.6x. The cold fill is
    // exactly what separates a bone-white skeleton from brown ground, so that
    // crushed the horde into the floor: bone-vs-ground Weber contrast fell from
    // 0.656 to 0.038, and body and ground pixels came out byte-identical. A
    // desaturated target keeps the hue shift while leaving every channel alive.
    this.targetMood.setHex(TRAIL_ACCENT[trailState] ?? ENV.fog).lerp(MOOD_WHITE, 0.4);
    // Spread across the whole ramp rather than saved for the last step.
    //
    // Applied only at HEAVY and PURSUIT, the ground moved by a CIE76 delta of
    // 2.5 across the entire 0-93 threat range - under the ~2.3 just-noticeable
    // difference, so the world said nothing at all - and then jumped about 17 in
    // one step. Escalation is meant to be felt before it is read off the HUD.
    this.moodStrength += ((MOOD_BY_STATE[trailState] ?? 0) - this.moodStrength) * blend;

    // Tint the fill and the ambient, never the key. Moving the key would change
    // which faces are lit and break the silhouette read the whole palette rests
    // on; moving the bounce only changes the colour of the air.
    //
    // These weights are held down deliberately. At 0.55/0.65/0.4 toward a pure
    // red, the Pursuit frame washed out so far that foliage and open ground
    // became the same colour and the same brightness: measured green-minus-red
    // separation fell from 28 to 3, and the readable foliage fraction of the
    // playfield from 47% to 1%. That is the one frame where the player is
    // running and most needs to see what is solid and what is not. Menace is
    // worth less than knowing where to run, so the rest of the pressure is
    // carried by fog and exposure, which do not flatten the terrain's own hue
    // relationships.
    this.fill.color.copy(this.baseFill).lerp(this.targetMood, this.moodStrength * 0.22);
    this.ambient.color.copy(this.baseAmbient).lerp(this.targetMood, this.moodStrength * 0.24);
    this.hemisphere.color.copy(this.baseHemiSky).lerp(this.targetMood, this.moodStrength * 0.15);
    this.renderer.toneMappingExposure =
      LIGHT.toneMappingExposure * (1 - this.moodStrength * 0.12);
  }

  render(camera: Camera): void {
    this.renderer.render(this.scene, camera);
  }

  get info() {
    const render = this.renderer.info.render;
    const memory = this.renderer.info.memory;
    return {
      calls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      budgetMs: PERFORMANCE.frameBudgetMs,
    };
  }

  dispose(): void {
    window.removeEventListener("resize", this.applySize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer.dispose();
  }
}

/** Seconds for the Trail mood to close half the gap to its target. */
const MOOD_HALF_LIFE = 0.8;

/** Desaturation target for the mood tint; see `setTrailMood`. */
const MOOD_WHITE = new Color(0xffffff);

/** How far the world leans into the Trail accent, per state. */
const MOOD_BY_STATE: Record<string, number> = {
  QUIET: 0,
  PROBING: 0.18,
  SWARM: 0.4,
  HEAVY: 0.68,
  PURSUIT: 1,
};

/** Shared scratch, so callers never allocate a Vector3 per frame. */
export const scratchVector = new Vector3();
