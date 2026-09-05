# Spider leg movement review and correction

## Causes

- The previous animation translated hip attachment points vertically and along the hull, instead of keeping them attached to the chassis.
- Independent sine-wave joint angles did not solve toward ground contacts. Feet could slide, penetrate or lift with the body.
- The alternating-group expression did not match the builder's interleaved left/right pair ordering.
- Stride cadence contained a fixed rate unrelated to distance travelled, and exaggerated body motion amplified the mismatch.

## Implemented correction

- Added `SpiderLegSolver`: persistent world-space planted contacts and two-bone inverse kinematics using the actual femur/tibia lengths and hip coordinates from the model builder.
- Hips remain at their authored local positions. Knees bend toward the target, and foot orientation is compensated so the claw contacts point down regardless of hull sway or heading.
- Correct alternating groups, 60% stance / 40% swing, 0.65-metre clearance, and cadence proportional to speed with a 4.5-metre cycle distance.
- Only one four-leg group may be airborne at a time, including gear changes. A floating-point touchdown boundary is snapped to completion so landing cannot slide one extra frame.
- Swing targets follow the new heading while airborne; planted targets and sole orientation stay fixed during turns. Airborne steps finish on stopping/docking. Large teleports reset contacts near the new position.
- Reduced hull bob/roll; dock crouch blends vertically and the leg solver compensates for it.
- No changes to Spider movement speed, navigation, damage, stage progression or combat rules. No additional meshes, materials or draw calls. Solver state is allocated once per rig and held in a WeakMap; scratch math objects are reused.

## Verification

- Full validation/typecheck/build and **356 tests across 28 files** pass.
- Actual generated rig tested at 30, 60 and 120 FPS through walking, turning and a speed change: fixed hips, grounded contacts stationary within tolerance, no below-ground contact tips and at least four feet planted.
- Traversed the complete authored maze route using the actual SpiderMovementSystem; finite foot transforms, no contact-tip penetration and at least four grounded feet throughout.
- Docking and teleport contact recovery tests pass.
- The browser stress suite reached 209 enemies with no counted pool exhaustion or sampled saturation; [performance report](spider-gait-review/performance.json). These short SwiftShader measurements are not a real-device FPS guarantee.
- Recorded 180 frames each of march and overdrive/fallback gameplay; both takes contain 180 distinct frames. Sampled motion frames were visually inspected. Large recordings remain local under `graphics-review/docs/spider-gait-review/motion/`.

This is a kinematic ground-contact gait, not a rigid-body dynamics simulation. Contacts use the current gameplay road plane at Y=0; arbitrary terrain-height sampling, obstacle-aware foot placement and physical load distribution are not implemented. Physical-device FPS still requires hardware testing.

The fix is pending commit/deployment together with the preceding asset improvements; the public site remains on its previous build until deployment.
