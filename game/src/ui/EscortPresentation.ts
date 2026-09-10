import { PLAYER } from "../data/balance.ts";

export type EscortWarningLevel = 0 | 1 | 2;

export function escortWarningLevel(far: boolean, distance: number): EscortWarningLevel {
  return far ? distance >= PLAYER.escortUrgentDistance ? 2 : 1 : 0;
}

export function escortWarningTitle(level: EscortWarningLevel, distance: number): string {
  if (level === 0) return "";
  return `${level === 2 ? "Very far from" : "Far from"} Spider · ${Math.round(distance)} m`;
}
