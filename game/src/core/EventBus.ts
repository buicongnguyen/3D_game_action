/**
 * Typed, deterministic event bus.
 *
 * Events are queued during a tick and drained in a fixed point in the system
 * order, never dispatched immediately. That keeps system ordering explicit and
 * stops a listener from mutating state halfway through another system's loop.
 *
 * Presentation-only listeners (audio, VFX, HUD) subscribe here; simulation
 * systems read the drained array directly.
 */

import type { GameEvent, GameEventType } from "./events.ts";

type Listener = (event: GameEvent) => void;

export class EventBus {
  /** Events queued this tick, drained by `drain()`. */
  private queue: GameEvent[] = [];
  /** Double buffer so a handler can safely emit while draining. */
  private draining: GameEvent[] = [];
  private listeners = new Map<GameEventType, Listener[]>();
  private anyListeners: Listener[] = [];
  /** Events emitted this tick, kept for the debug overlay. */
  private lastDrainCount = 0;

  emit(event: GameEvent): void {
    this.queue.push(event);
  }

  on<T extends GameEventType>(
    type: T,
    listener: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void {
    let list = this.listeners.get(type);
    if (!list) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(listener as Listener);
    return () => this.off(type, listener);
  }

  off<T extends GameEventType>(
    type: T,
    listener: (event: Extract<GameEvent, { type: T }>) => void,
  ): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const index = list.indexOf(listener as Listener);
    if (index >= 0) list.splice(index, 1);
  }

  onAny(listener: Listener): () => void {
    this.anyListeners.push(listener);
    return () => {
      const index = this.anyListeners.indexOf(listener);
      if (index >= 0) this.anyListeners.splice(index, 1);
    };
  }

  /**
   * Dispatches every queued event to its listeners and returns the drained
   * array. The array is owned by the bus and is valid only until the next
   * drain, so callers must not retain it.
   */
  drain(): readonly GameEvent[] {
    // Swap buffers first: a listener that emits targets the next tick, which
    // keeps drain() finite and the ordering deterministic.
    const batch = this.queue;
    this.queue = this.draining;
    this.queue.length = 0;
    this.draining = batch;
    this.lastDrainCount = batch.length;

    for (let i = 0; i < batch.length; i++) {
      const event = batch[i];
      const list = this.listeners.get(event.type);
      if (list) {
        for (let j = 0; j < list.length; j++) list[j](event);
      }
      for (let j = 0; j < this.anyListeners.length; j++) this.anyListeners[j](event);
    }
    return batch;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get eventsLastTick(): number {
    return this.lastDrainCount;
  }

  clear(): void {
    this.queue.length = 0;
    this.draining.length = 0;
    this.lastDrainCount = 0;
  }

  /** Drops every subscription. Used when tearing down a run. */
  removeAllListeners(): void {
    this.listeners.clear();
    this.anyListeners.length = 0;
  }
}
