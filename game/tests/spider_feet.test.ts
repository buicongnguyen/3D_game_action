import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { buildSpider, machineCache } from "../src/art/machines.ts";
import { MaterialLibrary } from "../src/art/materials.ts";
import { animateSpider, captureSpiderRest } from "../src/rendering/AnimationSystem.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { SpiderMovementSystem } from "../src/game/systems/SpiderMovementSystem.ts";

describe("Spider physical foot contacts", () => {
  it("plants all eight feet on Homeward's raised farm plateau", () => {
    const materials = new MaterialLibrary();
    const rig = buildSpider(materials); captureSpiderRest(rig);
    const tip = new Vector3(); rig.root.position.set(0, 6, -2);
    try {
      for (let i = 0; i < 90; i++) animateSpider(rig, 1 / 60, 0, false, true, 1, () => 6);
      rig.root.updateMatrixWorld(true);
      for (const foot of rig.legFoot) {
        tip.set(0, 0, 0.75).applyMatrix4(foot.matrixWorld);
        expect(tip.y).toBeCloseTo(6, 4);
      }
    } finally { materials.dispose(); machineCache.dispose(); }
  });
  it("keeps the feet above ground over the actual maze route", () => {
    const materials = new MaterialLibrary();
    const rig = buildSpider(materials);
    const world = new GameWorld(90);
    const movement = new SpiderMovementSystem();
    world.route.enterSegment("seg.scrapyard");
    world.spider.docked = false;
    world.segmentTime = 100;
    captureSpiderRest(rig);
    const tip = new Vector3();
    try {
      while (world.spider.distanceAlongRoute < world.route.spline!.length) {
        world.spider.fuel = 100;
        movement.update(world, 1 / 30);
        rig.root.position.set(world.spider.x, 0, world.spider.z);
        rig.root.rotation.y = world.spider.heading;
        animateSpider(rig, 1 / 30, world.spider.speed, false, false, 1);
        rig.root.updateMatrixWorld(true);
        let grounded = 0;
        for (const foot of rig.legFoot) {
          tip.set(0, 0, 0.75).applyMatrix4(foot.matrixWorld);
          expect(tip.y).toBeGreaterThan(-0.03);
          expect(Number.isFinite(tip.x + tip.z)).toBe(true);
          if (Math.abs(tip.y) < 0.001) grounded++;
        }
        expect(grounded).toBeGreaterThanOrEqual(4);
      }
    } finally { materials.dispose(); machineCache.dispose(); }
  });
  it.each([30, 60, 120])("keeps hips fixed and planted feet stationary while walking and turning at %i FPS", (fps) => {
    const materials = new MaterialLibrary();
    const rig = buildSpider(materials);
    captureSpiderRest(rig);
    const hips = rig.legs.map((leg) => leg.position.clone());
    const previous = rig.legs.map(() => new Vector3());
    const previousRotations = rig.legs.map(() => new Quaternion());
    const orientation = new Quaternion();
    const contact = new Vector3();
    let contacts = 0;
    try {
      for (let frame = 0; frame < fps * 12; frame++) {
        const speed = frame < fps * 4 ? 1.25 : 2;
        rig.root.rotation.y += 0.12 / fps;
        rig.root.position.x += Math.sin(rig.root.rotation.y) * speed / fps;
        rig.root.position.z += Math.cos(rig.root.rotation.y) * speed / fps;
        animateSpider(rig, 1 / fps, speed, speed === 2, false, 1);
        rig.root.updateMatrixWorld(true);
        let grounded = 0;
        for (let i = 0; i < 8; i++) {
          expect(rig.legs[i].position.distanceTo(hips[i])).toBe(0);
          contact.set(0, 0, 0.75).applyMatrix4(rig.legFoot[i].matrixWorld);
          rig.legFoot[i].getWorldQuaternion(orientation);
          expect(contact.y).toBeGreaterThan(-0.025);
          if (Math.abs(contact.y) < 0.001) {
            grounded++;
            if (frame > 0 && Math.abs(previous[i].y) < 0.001) {
              expect(contact.distanceTo(previous[i])).toBeLessThan(0.015);
              expect(orientation.angleTo(previousRotations[i])).toBeLessThan(0.001);
              contacts++;
            }
          }
          previous[i].copy(contact);
          previousRotations[i].copy(orientation);
        }
        expect(grounded).toBeGreaterThanOrEqual(4);
      }
      expect(contacts).toBeGreaterThan(fps * 10);
    } finally { materials.dispose(); machineCache.dispose(); }
  });

  it("finishes airborne steps on docking and resets contacts after a teleport", () => {
    const materials = new MaterialLibrary();
    const rig = buildSpider(materials);
    captureSpiderRest(rig);
    const contact = new Vector3();
    try {
      for (let frame = 0; frame < 100; frame++) {
        rig.root.position.z += 2 / 60;
        animateSpider(rig, 1 / 60, 2, true, false, 1);
      }
      for (let frame = 0; frame < 180; frame++) animateSpider(rig, 1 / 60, 0, false, true, 1);
      rig.root.updateMatrixWorld(true);
      for (const foot of rig.legFoot) {
        contact.set(0, 0, 0.75).applyMatrix4(foot.matrixWorld);
        expect(contact.y).toBeCloseTo(0, 5);
      }
      rig.root.position.z += 100;
      animateSpider(rig, 1 / 60, 0, false, true, 1);
      rig.root.updateMatrixWorld(true);
      for (const foot of rig.legFoot) {
        contact.set(0, 0, 0.75).applyMatrix4(foot.matrixWorld);
        expect(contact.y).toBeCloseTo(0, 5);
        expect(Math.abs(contact.z - rig.root.position.z)).toBeLessThan(6);
      }
    } finally { materials.dispose(); machineCache.dispose(); }
  });
});
