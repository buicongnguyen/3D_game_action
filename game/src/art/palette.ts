/**
 * The single authored palette for Marcha de Ferro.
 *
 * Cohesion comes from one rule, applied everywhere: the world is cold and
 * desaturated, and everything the player owns or must react to is warm and
 * saturated. That contrast is what keeps a 130-enemy screen readable, and it
 * is why no mesh anywhere in the project may invent its own colour.
 *
 * Hue lanes
 *   - environment  cold blue-greens, low chroma, low value spread
 *   - player       warm brass/gold, and the lightest warm mass on screen. The
 *                  ground is warm too, so chroma alone never separated him from
 *                  it - see PLAYER_COLORS.coat.
 *   - network      cyan; anything to do with pressure and service radius
 *   - hostile      bone white bodies with a crimson threat accent
 *   - hazard       orange-red, reserved for overload, explosion and defeat
 */

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const ENV = {
  /**
   * Sky and fog. Fog distances are measured from the CAMERA, not from the
   * player, and an orthographic camera sits a long way back so its near plane
   * clears the scene. `fogNear` therefore has to start just in front of the
   * focal plane (see `CAMERA.distance`) or the whole world renders as solid fog.
   */
  fog: 0x1d2630,
  fogNear: 84,
  fogFar: 236,
  skyTop: 0x27333f,
  skyBottom: 0x151b22,

  /**
   * Ground values were lifted from the original 0x33422f / 0x4a4234 pair after
   * a measured review: the corridor read at luminance 48.9 against a forest
   * floor of 43.5, five codes apart, so the path the player must follow was
   * distinguished by hue alone. The corridor is now decisively the brightest
   * large surface in the frame, which is what makes "which way is forward"
   * answerable at a glance and without a minimap.
   */
  groundBase: 0x4a5c42,
  groundDark: 0x36452e,
  groundLight: 0x5c6e4c,
  /** The trodden route surface; warmer and brighter so the corridor reads. */
  path: 0x6b5f4a,
  pathEdge: 0x554a39,

  rock: 0x4b5058,
  rockDark: 0x353a41,

  treeTrunk: 0x3b3128,
  treeTrunkDark: 0x2b241d,
  foliageDeep: 0x2c3d2b,
  foliageMid: 0x3a4f33,
  foliageLight: 0x4a613c,
  /** Cursed/bare foliage; a colder, sicker green for dead stands. */
  foliageCursed: 0x2f4038,

  grass: 0x44562f,
  bush: 0x354627,

  ruinStone: 0x565b5e,
  ruinStoneDark: 0x3d4245,
  rustMetal: 0x6b4a33,
  rustMetalDark: 0x4a3324,
} as const;

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export const LIGHT = {
  /**
   * Key light: warm, high, and on the CAMERA's side of the scene.
   *
   * The camera is fixed at a 45-degree yaw looking from +X +Z, so the key has
   * to sit in that same quadrant or every surface facing the player is a
   * shadowed one. It is swung about 35 degrees off the view axis, which is what
   * gives chamfers a lit face and a dark face instead of flat frontal light.
   */
  sunColor: 0xffd9a8,
  sunIntensity: 2.6,
  sunPosition: [52, 62, 16] as const,

  /** Sky/ground bounce. Cold above, warm-earth below. */
  hemiSky: 0x8aa6c2,
  hemiGround: 0x4a3d26,
  hemiIntensity: 1.05,

  /**
   * Cold rim from the far side. This is what separates a silhouette from the
   * fog behind it, and it is the reason the horde reads as bodies rather than
   * as a dark mass.
   */
  fillColor: 0x7fa4c4,
  fillIntensity: 0.7,
  fillPosition: [-38, 24, -34] as const,

  ambientIntensity: 0.3,
  ambientColor: 0x33435a,

  shadowMapSize: 3072,
  /**
   * Orthographic shadow camera half-extent, in metres.
   *
   * Must cover the visible ground, not just the play area. At 42 it covered
   * neither: shadows simply stopped partway across the frame and left a
   * razor-straight boundary running corner to corner, which three reviewers
   * independently measured. The camera's own `cullRadius` reaches roughly 70 m
   * at maximum zoom-out, so this has to clear that with a margin.
   */
  shadowExtent: 78,
  shadowBias: -0.0009,
  shadowNormalBias: 0.028,

  toneMappingExposure: 1.22,
} as const;

// ---------------------------------------------------------------------------
// Player and allied machinery
// ---------------------------------------------------------------------------

export const PLAYER_COLORS = {
  /**
   * The engineer's coat: the brightest warm mass on screen.
   *
   * It used to be the most saturated one instead, at 0xd8792a, and saturation
   * was the wrong axis. Measured over the exact set of pixels this value paints,
   * the coat read 1.37:1 against the ground beneath him in the march frame - the
   * lowest-contrast actor in a frame where the enemies he has to be told apart
   * from measure 3.4-5.9:1. It was never short of hue; it was short of LIGHT,
   * sitting near-isoluminant on a warm brown ground and differing from it in
   * chroma alone. So the value is lifted up the brass/gold lane the player
   * already owns rather than pushed further round the wheel. Under this scene's
   * light it renders around (195, 145, 55) and measures 3.12:1 on march, 3.11 on
   * pursuit, 3.57 on lastshot and 3.79 on placement, against 3:1 as the floor.
   */
  coat: 0xffec8c,
  /**
   * The coat's shade: trim and the breaks between masses, not the garment body.
   *
   * At 0xa5551a it was doing far more than that. Measured on the march frame,
   * 59% of the engineer's visible coat area carried the shade - the hat brim,
   * the hem and the hips included - so the tone authored for shadow was most of
   * what the camera actually saw, and the coat's own value was a minority. The
   * body of the coat is now one value (see `engineerParts`) and this is left to
   * the yoke, the cuffs, the sleeves and the crown, which is about a quarter of
   * him. Kept a real step below the coat, but nowhere near the step it was.
   */
  coatDark: 0xecbc6a,
  trouser: 0x3e4a55,
  boot: 0x272e35,
  skin: 0xc9976a,
  /** Brass fittings, goggles, tool heads. */
  brass: 0xd9a441,
  brassDark: 0x9a6f24,
  steel: 0x7d858c,
  steelDark: 0x525a61,
  /** Rim/outline colour used when the player is occluded. */
  silhouette: 0xffc978,
  glow: 0xffb457,
} as const;

export const SPIDER_COLORS = {
  hull: 0x4c4a46,
  hullDark: 0x33322f,
  hullLight: 0x66625b,
  plate: 0x5a5147,
  brass: 0xc39338,
  brassDark: 0x8a6420,
  /** The furnace: the warmest, brightest thing in the scene. */
  furnace: 0xff7a1c,
  furnaceHot: 0xffd08a,
  legJoint: 0x3a3835,
  legShell: 0x57544f,
  pipe: 0x6d5f4d,
  glass: 0x8fd4e8,
} as const;

export const STRUCTURE_COLORS = {
  turretBody: 0xb5702a,
  turretBodyDark: 0x7d4a17,
  turretBarrel: 0x50565c,
  turretBarrelHot: 0xff8a3c,
  relayBody: 0x2f6f86,
  relayAccent: 0x4fd6ff,
  barricadeWood: 0x6a5334,
  barricadeWoodDark: 0x4a3a24,
  barricadeMetal: 0x6d7278,
  mineShell: 0x8c3b32,
  mineLight: 0xff5a4f,
  /** Common base plate shared by every deployed structure, for family feel. */
  footing: 0x45464a,
  footingDark: 0x2f3033,
} as const;

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export const ENEMY_COLORS = {
  bone: 0xd6cfba,
  boneDark: 0xa79f8a,
  boneShadow: 0x7d7666,
  /** Eye sockets and the threat accent; the only red in the hostile lane. */
  ember: 0xff4438,
  emberDim: 0xa02a20,
  rag: 0x4a4438,
  ragDark: 0x322e26,
  rustArmor: 0x6a5138,
  rustArmorDark: 0x47341f,
  /** Golem-only: mossy, heavier stone-bone. */
  golemStone: 0x8b8874,
  golemStoneDark: 0x605e4f,
  golemCore: 0x59ff9d,
} as const;

// ---------------------------------------------------------------------------
// Feedback and UI-in-world
// ---------------------------------------------------------------------------

export const FEEDBACK = {
  valid: 0x6de26d,
  unpowered: 0xf2c14a,
  invalid: 0xff4d4d,

  /** Pressure network rings and links. */
  network: 0x4fd6ff,
  networkDim: 0x1d5e73,

  damage: 0xff5a4f,
  heal: 0x6de26d,
  fuel: 0x4fd6ff,
  scrap: 0xd9a441,
  xp: 0xb388ff,

  muzzle: 0xffd48a,
  muzzleCore: 0xfff4d6,
  impact: 0xffb066,
  explosion: 0xff8a3c,
  explosionCore: 0xfff0c4,
  bloodBone: 0xe8e0cc,

  lastShot: 0xff3b2f,
  pursuit: 0xff2d1f,

  /** Ground decal under a structure that is about to be left behind. */
  warningPulse: 0xffa53c,
} as const;

// ---------------------------------------------------------------------------
// HUD (mirrored in hud.css as custom properties; keep the two in step)
// ---------------------------------------------------------------------------

export const HUD = {
  panel: "rgba(16, 21, 27, 0.82)",
  panelEdge: "rgba(216, 178, 106, 0.28)",
  text: "#e8e2d4",
  textDim: "#9aa0a6",
  health: "#e2604f",
  core: "#8fd4e8",
  fuel: "#4fd6ff",
  scrap: "#d9a441",
  xp: "#b388ff",
  trailQuiet: "#6b7f8c",
  trailProbing: "#8fae6b",
  trailSwarm: "#e0b64a",
  trailHeavy: "#e07d3c",
  trailPursuit: "#ff3b2f",
} as const;

/** Trail-state accent, used by the HUD bar and the world lighting shift. */
export const TRAIL_ACCENT: Record<string, number> = {
  QUIET: 0x6b7f8c,
  PROBING: 0x8fae6b,
  SWARM: 0xe0b64a,
  HEAVY: 0xe07d3c,
  PURSUIT: 0xff3b2f,
};

/**
 * Fog colour per Trail state. The world visibly cools and then reddens as the
 * horde closes, which is a readable danger cue that costs no HUD space.
 */
export const TRAIL_FOG: Record<string, number> = {
  QUIET: 0x1d2630,
  PROBING: 0x1e2830,
  SWARM: 0x24272c,
  HEAVY: 0x2b2427,
  PURSUIT: 0x3a1f1e,
};
