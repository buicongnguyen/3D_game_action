import type { StructureCategory, StructureKind } from "../core/types.ts";
import { STRUCTURES } from "./balance.ts";

export interface BlueprintDefinition {
  kind: StructureKind;
  name: string;
  /**
   * Name for the blueprint bar, which is a narrow tile. Two of the four full
   * names were being ellipsis-truncated at both viewports, so the chip that
   * exists to identify a blueprint could not.
   */
  shortName: string;
  /** One-line purpose, shown in the radial. */
  summary: string;
  category: StructureCategory;
  cost: number;
  /** Glyph rendered in the radial slice and the blueprint bar. */
  icon: string;
  /** Accent colour used by the ghost, the radial and the HUD chip. */
  accent: number;
  /** Placement footprint radius used for collision validation. */
  radius: number;
  /** True when the structure consumes pressure and can run dry. */
  usesPressure: boolean;
}

export const BLUEPRINTS: Record<StructureKind, BlueprintDefinition> = {
  rivetTurret: {
    kind: "rivetTurret",
    name: "Rivet Turret",
    shortName: "TURRET",
    summary: "Sustained fire. 30 s pressure buffer. Foldable.",
    category: "foldable",
    cost: STRUCTURES.rivetTurret.cost,
    icon: "◈",
    accent: 0xffb03a,
    radius: STRUCTURES.rivetTurret.radius,
    usesPressure: true,
  },
  relay: {
    kind: "relay",
    name: "Pressure Relay",
    shortName: "RELAY",
    summary: "Extends the service network. Foldable.",
    category: "foldable",
    cost: STRUCTURES.relay.cost,
    icon: "◉",
    accent: 0x4fd6ff,
    radius: STRUCTURES.relay.radius,
    usesPressure: true,
  },
  barricade: {
    kind: "barricade",
    name: "Decoy Barricade",
    shortName: "BARRICADE",
    summary: "Blocks and attracts. Cheap, anchored, disposable.",
    category: "anchored",
    cost: STRUCTURES.barricade.cost,
    icon: "▤",
    accent: 0x9ad14b,
    radius: STRUCTURES.barricade.radius,
    usesPressure: false,
  },
  mine: {
    kind: "mine",
    name: "Frag Mine",
    shortName: "MINE",
    summary: "One explosion. Anchored.",
    category: "anchored",
    cost: STRUCTURES.mine.cost,
    icon: "✸",
    accent: 0xff5a4f,
    radius: STRUCTURES.mine.radius,
    usesPressure: false,
  },
};

/**
 * The four radial slots for the vertical slice. Order is the radial order,
 * starting at the top and going clockwise.
 */
export const SLICE_LOADOUT: readonly StructureKind[] = ["rivetTurret", "relay", "barricade", "mine"];

export function getBlueprint(kind: StructureKind): BlueprintDefinition {
  return BLUEPRINTS[kind];
}

/** Config lookup that keeps the union narrow for the caller. */
export function getStructureConfig(kind: StructureKind) {
  return STRUCTURES[kind];
}
