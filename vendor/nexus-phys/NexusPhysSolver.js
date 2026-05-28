/**
 * NexusPhysSolver — automatic MMD physics tuning + environment collision.
 */
import {
  Box3,
  Quaternion,
  Vector3,
} from 'three';
import { getAmmo } from '../ammo/ammo-init.js';

/** Environment colliders use bit 16 — outside PMX groups 0–15. */
export const ENV_COLLISION_GROUP = 16;
export const ENV_COLLISION_MASK = 0xffff;

const _v3 = { x: 0, y: 0, z: 0 };

function ammoVec3(x, y, z) {
  const Ammo = getAmmo();
  const v = new Ammo.btVector3(x, y, z);
  return v;
}

function destroyAmmo(obj) {
  if (obj) getAmmo().destroy(obj);
}

function classifyBone(name = '') {
  if (/髪|毛|hair|ツイン|twin|ponytail|Ahoge|あほ|サイド|side|前髪|後髪|横髪|脇/i.test(name)) return 'hair';
  if (/スカート|skirt|フリル|frill|プリーツ|pleat/i.test(name)) return 'skirt';
  if (/コート|coat|マフラー|muffler|ケープ|cape|披|ジャケット|jacket|ワンピ|dress|服|衣|袖|襟|ネクタイ|tie|リボン|ribbon|スカーフ|scarf/i.test(name)) return 'coat';
  if (/胸|乳|bust/i.test(name)) return 'soft';
  return 'other';
}

export function analyzeMMDPhysics(physics, mesh) {
  const out = {
    bodyCount: 0,
    constraintCount: 0,
    dynamic: 0,
    kinematic: 0,
    hair: 0,
    skirt: 0,
    coat: 0,
    soft: 0,
    other: 0,
    maxGroupIndex: 0,
    complexity: 0,
  };
  if (!physics) return out;

  out.bodyCount = physics.bodies?.length || 0;
  out.constraintCount = physics.constraints?.length || 0;

  for (const w of physics.bodies || []) {
    const p = w.params || {};
    if (p.type === 0) out.kinematic++;
    else out.dynamic++;
    if (p.groupIndex > out.maxGroupIndex) out.maxGroupIndex = p.groupIndex;
    const cat = classifyBone(w.bone?.name || '');
    out[cat]++;
  }

  out.complexity = out.bodyCount + out.constraintCount * 0.6 + out.hair * 0.4 + out.skirt * 0.3;
  return out;
}

/**
 * Recommend MMD-safe simulation parameters from model analysis.
 */
export function computeAutoTune(analysis) {
  const a = analysis || {};
  const tune = {
    rate: 65,
    substeps: 3,
    swing: 0,
    wind: 0,
    warmup: 24,
    velScale: 1,
    stablePhys: true,
    preset: 'default',
    note: 'MMD default (1/65 s, 3 sub)',
  };

  if (a.bodyCount > 180 || a.constraintCount > 280) {
    tune.warmup = 36;
    tune.velScale = 0.88;
    tune.note = 'Heavy rig — lower vel cap, longer warmup';
  }
  if (a.hair > 70) {
    tune.swing = 0;
    tune.velScale = Math.min(tune.velScale, 0.78);
    tune.warmup = Math.max(tune.warmup, 40);
    tune.note = 'Dense hair — strict velocity cap';
  }
  if (a.skirt > 35) {
    tune.velScale = Math.min(tune.velScale, 0.85);
    tune.warmup = Math.max(tune.warmup, 32);
  }
  if (a.complexity > 420) {
    tune.rate = 65;
    tune.substeps = 3;
    tune.warmup = 48;
    tune.velScale = Math.min(tune.velScale, 0.72);
    tune.note = 'Very complex PMX — conservative solver';
  }
  if (a.bodyCount < 40 && a.constraintCount < 60) {
    tune.warmup = 12;
    tune.velScale = 1;
    tune.note = 'Light model — fast warmup';
  }

  tune.preset = 'auto';
  return tune;
}

export function applyAutoTuneToState(S, tune) {
  if (!S || !tune) return;
  S.stablePhys = tune.stablePhys !== false;
  S.physicsRate = tune.rate;
  S.physicsSubsteps = tune.substeps;
  S.physicsSwing = tune.swing;
  S.physicsWind = tune.wind;
  S.physicsWarmup = tune.warmup;
  S.physVelScale = tune.velScale;
  S.physAutoNote = tune.note || '';
}

/** Patch MMD dynamic bodies so they collide with environment group. */
export function patchMMDEnvCollision(physics) {
  if (!physics?.bodies) return;
  let Ammo;
  try { Ammo = getAmmo(); } catch (_) { return; }
  const envBit = 1 << ENV_COLLISION_GROUP;
  for (const w of physics.bodies) {
    if (!w.body) continue;
    try {
      const handle = w.body.getBroadphaseHandle();
      if (!handle) continue;
      handle.set_m_collisionFilterMask(handle.get_m_collisionFilterMask() | envBit);
    } catch (_) { /* older ammo build */ }
  }
}

export const CLOTH_HAIR_CATS = new Set(['hair', 'skirt', 'coat', 'soft']);
const _DRIFT_CAT_MUL = { hair: 0.28, skirt: 0.30, coat: 0.32, soft: 0.28, other: 0.32 };

/**
 * MMD-safe strict collision — preserves PMX groupTarget masks (critical for hair/skirt).
 * Never remove/re-add rigid bodies (breaks constraints on complex rigs).
 */
export function applyStrictMMDCollision(physics, world) {
  if (!physics?.bodies || !world) return { ok: false, bodies: 0 };
  let Ammo;
  try { Ammo = getAmmo(); } catch (_) { return { ok: false, bodies: 0 }; }

  try {
    const solverInfo = world.getSolverInfo();
    solverInfo.set_m_numIterations(18);
  } catch (_) {}

  const envBit = 1 << ENV_COLLISION_GROUP;
  let n = 0;

  for (const w of physics.bodies) {
    if (!w.body) continue;
    const p = w.params || {};
    const cat = classifyBone(w.bone?.name || '');

    try {
      const handle = w.body.getBroadphaseHandle();
      if (handle) {
        const mask = handle.get_m_collisionFilterMask() | envBit;
        handle.set_m_collisionFilterMask(mask);
      }
    } catch (_) {}

    if (p.type !== 0 && (cat === 'skirt' || cat === 'coat')) {
      const radius = Math.max(p.width || 0.02, 0.015);
      try {
        w.body.setCcdMotionThreshold(0.004);
        w.body.setCcdSweptSphereRadius(radius * 0.35);
      } catch (_) {}
    }

    n++;
  }

  patchMMDEnvCollision(physics);
  physics._strictCollision = true;
  return { ok: true, bodies: n };
}

export class CollisionEnvironment {
  constructor(world) {
    this.world = world;
    this._entries = [];
    this.floorY = 0;
  }

  dispose() {
    if (!this.world) return;
    let Ammo;
    try { Ammo = getAmmo(); } catch (_) { return; }
    for (const e of this._entries) {
      try {
        this.world.removeRigidBody(e.body);
        Ammo.destroy(e.body);
        if (e.shape) Ammo.destroy(e.shape);
        if (e.motionState) Ammo.destroy(e.motionState);
      } catch (_) {}
    }
    this._entries.length = 0;
  }

  /** Infinite static floor at Y (Bullet plane normal +Y, offset = -y). */
  setFloor(y = 0) {
    this.dispose();
    if (!this.world) return;
    const Ammo = getAmmo();
    this.floorY = y;
    const normal = ammoVec3(0, 1, 0);
    const shape = new Ammo.btStaticPlaneShape(normal, -y);
    destroyAmmo(normal);

    const transform = new Ammo.btTransform();
    transform.setIdentity();
    const motionState = new Ammo.btDefaultMotionState(transform);
    const inertia = ammoVec3(0, 0, 0);
    const info = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, inertia);
    destroyAmmo(inertia);
    const body = new Ammo.btRigidBody(info);
    body.setFriction(0.94);
    body.setRestitution(0.04);
    this.world.addRigidBody(body, 1 << ENV_COLLISION_GROUP, ENV_COLLISION_MASK);
    this._entries.push({ body, shape, motionState });
  }

  /** Soft invisible box walls around the model (prevents runaway bodies). */
  setContainmentBox(box, padding = 0.35) {
    if (!box || !this.world) return;
    const Ammo = getAmmo();
    const cx = (box.min.x + box.max.x) * 0.5;
    const cy = (box.min.y + box.max.y) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const hx = (box.max.x - box.min.x) * 0.5 + padding;
    const hy = (box.max.y - box.min.y) * 0.5 + padding;
    const hz = (box.max.z - box.min.z) * 0.5 + padding;
    const thick = 0.08;
    const walls = [
      { p: [cx, cy, box.max.z + hz + thick], s: [hx * 2, hy * 2, thick] },
      { p: [cx, cy, box.min.z - hz - thick], s: [hx * 2, hy * 2, thick] },
      { p: [box.max.x + hx + thick, cy, cz], s: [thick, hy * 2, hz * 2] },
      { p: [box.min.x - hx - thick, cy, cz], s: [thick, hy * 2, hz * 2] },
    ];
    for (const w of walls) {
      const half = ammoVec3(w.s[0] * 0.5, w.s[1] * 0.5, w.s[2] * 0.5);
      const shape = new Ammo.btBoxShape(half);
      destroyAmmo(half);
      const tr = new Ammo.btTransform();
      tr.setIdentity();
      const o = ammoVec3(w.p[0], w.p[1], w.p[2]);
      tr.setOrigin(o);
      destroyAmmo(o);
      const ms = new Ammo.btDefaultMotionState(tr);
      const inertia = ammoVec3(0, 0, 0);
      const info = new Ammo.btRigidBodyConstructionInfo(0, ms, shape, inertia);
      destroyAmmo(inertia);
      const body = new Ammo.btRigidBody(info);
      body.setFriction(0.5);
      body.setRestitution(0.02);
      this.world.addRigidBody(body, 1 << ENV_COLLISION_GROUP, ENV_COLLISION_MASK);
      this._entries.push({ body, shape, motionState: ms });
    }
  }

  configureForMesh(mesh, opts = {}) {
    if (!mesh) return;
    const box = new Box3().setFromObject(mesh);
    const pad = opts.padding ?? 0.4;
    const floorY = opts.floorY ?? Math.min(0, box.min.y - 0.015);
    this.setFloor(floorY);
    if (opts.containment !== false) this.setContainmentBox(box, pad);
  }
}

export function measurePhysicsDrift(physics, mesh, bonePos, bodyPos, sizeVec) {
  if (!physics?.bodies || !mesh) return { maxDrift: 0, threshold: 1, unstable: false };
  const box = new Box3().setFromObject(mesh);
  const size = box.getSize(sizeVec);
  const thresh = Math.max(size.y, size.x, size.z) * 0.32;
  let maxD = 0;
  for (const w of physics.bodies) {
    if (!w.body || w.params?.type === 0 || !w.bone) continue;
    let d = 0;
    if (typeof w.measureBoneBodyDrift === 'function') d = w.measureBoneBodyDrift();
    else {
      w.bone.getWorldPosition(bonePos);
      const o = w.body.getCenterOfMassTransform().getOrigin();
      bodyPos.set(o.x(), o.y(), o.z());
      d = bonePos.distanceTo(bodyPos);
    }
    if (d > maxD) maxD = d;
  }
  return { maxDrift: maxD, threshold: thresh, unstable: maxD > thresh };
}

export function collectPhysicsStats(physics, mesh, bonePos, bodyPos, sizeVec) {
  const drift = measurePhysicsDrift(physics, mesh, bonePos, bodyPos, sizeVec);
  let maxVel = 0;
  let dynamic = 0;
  for (const w of physics?.bodies || []) {
    if (!w.body || w.params?.type === 0) continue;
    dynamic++;
    const lv = w.body.getLinearVelocity();
    const v = Math.sqrt(lv.x() * lv.x() + lv.y() * lv.y() + lv.z() * lv.z());
    if (v > maxVel) maxVel = v;
  }
  return {
    bodies: physics?.bodies?.length || 0,
    constraints: physics?.constraints?.length || 0,
    dynamic,
    maxDrift: drift.maxDrift,
    driftThreshold: drift.threshold,
    unstable: drift.unstable,
    maxVelocity: maxVel,
  };
}

/**
 * Short stability probe — run after model load (sync bone sample + physics steps).
 */
export function runStabilityProbe(physics, mesh, syncBonesFn, stepFn, steps = 16) {
  if (!physics || !mesh) return { stable: true, maxDrift: 0 };
  const bp = new Vector3();
  const bb = new Vector3();
  const sz = new Vector3();
  let maxDrift = 0;
  for (let i = 0; i < steps; i++) {
    if (typeof syncBonesFn === 'function') syncBonesFn(mesh);
    if (typeof stepFn === 'function') stepFn(1 / 65);
    const m = measurePhysicsDrift(physics, mesh, bp, bb, sz);
    if (m.maxDrift > maxDrift) maxDrift = m.maxDrift;
    if (m.unstable) return { stable: false, maxDrift, strike: i };
  }
  return { stable: true, maxDrift };
}

export class PhysicsAutoSolver {
  constructor() {
    this.enabled = true;
    this.collision = null;
    this.profile = null;
    this.tune = null;
    this.stats = null;
    this.probe = null;
    this._softBoost = 0;
    this._monitorTick = 0;
    this.buffer = new PhysicsLookaheadBuffer(PHYS_BUFFER_FRAMES);
    this.rewindGuard = new ClothHairRewindGuard();
    this.rolling = new RollingLookaheadScheduler(this.buffer, 8);
  }

  reset() {
    this.profile = null;
    this.tune = null;
    this.stats = null;
    this.probe = null;
    this._softBoost = 0;
    if (this.buffer) this.buffer.reset();
    if (this.rewindGuard) this.rewindGuard.reset();
    if (this.rolling) this.rolling.reset();
    if (this.collision) {
      this.collision.dispose();
      this.collision = null;
    }
  }

  ensureCollision(world, mesh, opts) {
    if (!world || !mesh || opts?.floor === false) {
      if (this.collision) this.collision.dispose();
      this.collision = null;
      return null;
    }
    if (!this.collision) this.collision = new CollisionEnvironment(world);
    this.collision.configureForMesh(mesh, opts);
    return this.collision;
  }

  analyze(physics, mesh) {
    this.profile = analyzeMMDPhysics(physics, mesh);
    this.tune = computeAutoTune(this.profile);
    if (this.probe && !this.probe.stable) {
      this.tune.velScale = Math.min(this.tune.velScale, 0.65);
      this.tune.warmup = Math.max(this.tune.warmup, 48);
      this.tune.substeps = 3;
      this.tune.rate = 65;
      this.tune.note = 'Probe unstable — extra conservative tuning';
    }
    return { profile: this.profile, tune: this.tune };
  }

  monitor(physics, mesh, bonePos, bodyPos, sizeVec, onSoftRecover) {
    if (!this.enabled || !physics) return;
    if (++this._monitorTick % 24 !== 0) return;
    this.stats = collectPhysicsStats(physics, mesh, bonePos, bodyPos, sizeVec);
    if (!this.stats.unstable) {
      this._softBoost = Math.max(0, this._softBoost - 0.05);
      return;
    }
    this._softBoost = Math.min(1, this._softBoost + 0.2);
    if (typeof onSoftRecover === 'function') onSoftRecover(physics, this.stats, this._softBoost);
  }
}

// ---------------------------------------------------------------------------
// 120-frame lookahead buffer + iterative auto-tuning + smooth display helpers
// ---------------------------------------------------------------------------
export const PHYS_BUFFER_FRAMES = 120;

/** Iteratively softens simulation when drift/explosion is detected during buffer build. */
export class IterativeAutoTuner {
  constructor() {
    this.baseVelScale = 1;
    this.velMul = 1;
    this.dampMul = 1;
    this.iterations = 0;
    this.maxIterations = 18;
    this.stableStreak = 0;
    this.peakDrift = 0;
  }

  reset(baseVelScale = 1) {
    this.baseVelScale = baseVelScale;
    this.velMul = 1;
    this.dampMul = 1;
    this.iterations = 0;
    this.stableStreak = 0;
    this.peakDrift = 0;
  }

  get velScale() {
    return this.baseVelScale * this.velMul;
  }

  /** @returns {boolean} true if adjusted and can retry */
  feedback(drift) {
    if (!drift) return false;
    if (drift.maxDrift > this.peakDrift) this.peakDrift = drift.maxDrift;
    if (!drift.unstable) {
      this.stableStreak++;
      return false;
    }
    this.stableStreak = 0;
    this.velMul *= 0.86;
    this.dampMul = Math.min(3, this.dampMul * 1.14);
    this.iterations++;
    return this.iterations < this.maxIterations;
  }

  applyToPhysics(physics) {
    if (!physics) return;
    physics._velScale = this.velScale;
    physics._dampMul = this.dampMul;
    if (!physics.bodies) return;
    for (const w of physics.bodies) {
      if (!w.body || w.params?.type === 0) continue;
      const p = w.params;
      const lin = Math.max(0.05, (p.positionDamping ?? 0.2) * this.dampMul);
      const ang = Math.max(0.05, (p.rotationDamping ?? 0.2) * this.dampMul);
      w.body.setDamping(lin, ang);
    }
  }
}

/** Micro-corrections between hidden pre-sim steps (no visible snap). */
export function stabilizeSimulationStep(physics, drift, tuner, hooks = {}) {
  if (!physics) return;
  if (drift?.unstable && typeof hooks.zeroVel === 'function') hooks.zeroVel(physics);
  const thresh = drift?.threshold ?? 1;
  if (drift && drift.maxDrift > thresh * 0.35) {
    for (const w of physics.bodies || []) {
      if (!w.body || !w.bone) continue;
      if (w.params?.type === 1 && typeof w.updateFromBone === 'function') w.updateFromBone();
      else if (w.params?.type === 2 && typeof w.updateFromBone === 'function') w.updateFromBone();
    }
  }
  if (tuner) tuner.applyToPhysics(physics);
  if (typeof hooks.gentleSync === 'function') hooks.gentleSync(physics);
}

/**
 * Async 120-frame pre-simulation with iterative tuning.
 * While building, live physics on animHelper should be disabled (hooks.setPhysicsEnabled).
 */
export class PhysicsLookaheadBuffer {
  constructor(frames = PHYS_BUFFER_FRAMES) {
    this.frames = frames;
    this.progress = 0;
    this.ready = false;
    this.building = false;
    this.displayBlend = 0;
    this.tuner = new IterativeAutoTuner();
    this.token = 0;
    this.lastStats = null;
  }

  cancel() {
    this.token++;
    this.building = false;
  }

  reset() {
    this.cancel();
    this.progress = 0;
    this.ready = false;
    this.displayBlend = 0;
    this.tuner.reset();
    this.lastStats = null;
  }

  start(ctx) {
    this.cancel();
    this.building = true;
    const rolling = !!ctx.rolling;
    if (!rolling) {
      this.ready = false;
      this.progress = 0;
      this.displayBlend = 0;
    }
    const token = ++this.token;
    const dt = ctx.dt ?? (1 / 65);
    const chunk = rolling ? (ctx.chunkSize ?? 12) : (ctx.chunkSize ?? 6);
    const targetFrames = rolling ? (ctx.frames ?? 60) : (ctx.frames ?? this.frames);
    this.tuner.reset(ctx.baseVelScale ?? 1);
    let frame = 0;

    if (typeof ctx.setPhysicsEnabled === 'function') ctx.setPhysicsEnabled(false);
    if (typeof ctx.onStart === 'function') ctx.onStart({ rolling, frames: targetFrames });

    const stepChunk = () => {
      if (token !== this.token || ctx.physics !== ctx.getPhysics?.()) {
        this.building = false;
        if (typeof ctx.setPhysicsEnabled === 'function') ctx.setPhysicsEnabled(true);
        return;
      }
      try {
        for (let i = 0; i < chunk && frame < targetFrames; i++) {
          if (typeof ctx.syncBones === 'function') ctx.syncBones(ctx.mesh);
          if (typeof ctx.preStep === 'function') ctx.preStep(ctx.physics);
          this.tuner.applyToPhysics(ctx.physics);
          if (typeof ctx.step === 'function') ctx.step(ctx.physics, dt);
          const drift = typeof ctx.measureDrift === 'function'
            ? ctx.measureDrift(ctx.physics, ctx.mesh)
            : { unstable: false, maxDrift: 0, threshold: 1 };
          this.lastStats = drift;
          stabilizeSimulationStep(ctx.physics, drift, this.tuner, ctx);
          if (drift.unstable) this.tuner.feedback(drift);
          frame++;
          this.progress = frame;
        }
      } catch (e) {
        console.warn('[PhysBuffer] build stopped:', e?.message || e);
        this.building = false;
        if (typeof ctx.setPhysicsEnabled === 'function') ctx.setPhysicsEnabled(true);
        if (typeof ctx.onComplete === 'function') ctx.onComplete({ ok: false, error: e, rolling });
        return;
      }

      if (typeof ctx.onProgress === 'function') {
        ctx.onProgress(frame, targetFrames, this.tuner, { rolling });
      }

      if (frame < targetFrames) {
        requestAnimationFrame(stepChunk);
      } else {
        this.building = false;
        this.ready = true;
        if (!rolling) this.displayBlend = 0;
        if (typeof ctx.setPhysicsEnabled === 'function') ctx.setPhysicsEnabled(true);
        if (typeof ctx.zeroVel === 'function') ctx.zeroVel(ctx.physics);
        if (typeof ctx.gentleSync === 'function') ctx.gentleSync(ctx.physics);
        if (typeof ctx.onComplete === 'function') {
          ctx.onComplete({ ok: true, tuner: this.tuner, stats: this.lastStats, rolling });
        }
      }
    };
    requestAnimationFrame(stepChunk);
  }

  tickBlend(dt) {
    if (!this.ready || this.displayBlend >= 1) return;
    this.displayBlend = Math.min(1, this.displayBlend + dt * 2.2);
  }
}

/** Cap per-frame bone rotation delta — removes post-sim jitter without visible pops. */
export function smoothPhysicsBones(mesh, physics, displayBlend, smoothState, quatPool) {
  if (!mesh?.skeleton || !physics?.bodies || displayBlend <= 0.01 || displayBlend >= 0.98) return;
  const smooth = 1 - Math.min(0.94, 0.55 + displayBlend * 0.35);
  const maxAngle = 0.05 + displayBlend * 0.16;
  const qa = quatPool.a;
  const qb = quatPool.b;

  for (const w of physics.bodies) {
    if (!w.bone || w.params?.type === 0) continue;
    const bone = w.bone;
    const key = bone.uuid;
    let prev = smoothState.get(key);
    if (!prev) {
      smoothState.set(key, bone.quaternion.clone());
      continue;
    }
    qa.copy(bone.quaternion);
    prev.slerp(qa, 1 - smooth);
    const dot = Math.abs(prev.dot(qa));
    const angle = 2 * Math.acos(Math.min(1, dot));
    if (angle > maxAngle) prev.slerp(qa, maxAngle / Math.max(angle, 1e-5));
    bone.quaternion.copy(prev);
  }
  mesh.skeleton.update();
}

export function clearPhysicsSmoothState(smoothState) {
  smoothState.clear();
}

// ---------------------------------------------------------------------------
// Cloth/hair rewind guard — archive poses, detect scrub/loop jumps, recover
// ---------------------------------------------------------------------------

/** Per-body cloth/hair drift with category-specific thresholds. */
export function measureClothHairAnomaly(physics, mesh, classifyFn, bonePos, bodyPos, sizeVec) {
  if (!physics?.bodies || !mesh) {
    return { anomalous: false, worst: null, maxDrift: 0, stuck: 0, penetrated: 0 };
  }
  const box = new Box3().setFromObject(mesh);
  const size = box.getSize(sizeVec);
  const base = Math.max(size.y, size.x, size.z);
  let maxDrift = 0;
  let stuck = 0;
  let penetrated = 0;
  let worst = null;

  for (const w of physics.bodies) {
    if (!w.body || !w.bone || w.params?.type === 0) continue;
    const cat = typeof classifyFn === 'function' ? classifyFn(w) : classifyBone(w.bone?.name || '');
    if (!CLOTH_HAIR_CATS.has(cat)) continue;

    let d = 0;
    if (typeof w.measureBoneBodyDrift === 'function') d = w.measureBoneBodyDrift();
    else {
      w.bone.getWorldPosition(bonePos);
      const o = w.body.getCenterOfMassTransform().getOrigin();
      bodyPos.set(o.x(), o.y(), o.z());
      d = bonePos.distanceTo(bodyPos);
    }

    const thresh = base * (_DRIFT_CAT_MUL[cat] ?? _DRIFT_CAT_MUL.other);
    if (d > maxDrift) maxDrift = d;
    if (d > thresh) {
      stuck++;
      if (!worst || d > worst.drift) worst = { wrapper: w, cat, drift: d, threshold: thresh };
    }

    const o = w.body.getCenterOfMassTransform().getOrigin();
    if (o.y() < box.min.y - thresh * 0.35) penetrated++;
  }

  return {
    anomalous: (stuck >= 4 && worst && worst.drift > worst.threshold * 1.4)
      || penetrated >= 2
      || (worst && worst.drift > base * 0.38),
    worst,
    maxDrift,
    stuck,
    penetrated,
  };
}

export class ClothHairRewindGuard {
  constructor(maxSnapshots = 140) {
    this.maxSnapshots = maxSnapshots;
    this.snapshots = [];
    this.lastTime = -1;
    this.recoverCooldown = 0;
    this.lastRecoverReason = '';
    this._reasonAge = 0;
  }

  reset() {
    this.snapshots.length = 0;
    this.lastTime = -1;
    this.recoverCooldown = 0;
    this.lastRecoverReason = '';
    this._reasonAge = 0;
  }

  /** Detect timeline scrub / loop jump between consecutive frames. */
  trackTime(animTime, maxFrameDelta = 0.14) {
    const prev = this.lastTime;
    this.lastTime = animTime;
    if (prev < 0) return { seeked: false, delta: 0, backward: false };
    const delta = animTime - prev;
    const seeked = Math.abs(delta) > maxFrameDelta;
    return { seeked, delta, backward: delta < -maxFrameDelta * 0.35 };
  }

  /** Explicit seek (timeline drag, keyboard scrub). */
  noteSeek(targetTime) {
    const prev = this.lastTime >= 0 ? this.lastTime : targetTime;
    this.lastTime = targetTime;
    const delta = targetTime - prev;
    return { seeked: Math.abs(delta) > 0.02, delta, backward: delta < -0.02 };
  }

  captureSnapshot(animTime, physics, classifyFn) {
    if (!physics?.bodies || this.recoverCooldown > 0) return;
    const bucket = Math.round(animTime * 4) / 4;
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && Math.abs(last.time - bucket) < 0.12) return;

    const bones = [];
    for (const w of physics.bodies) {
      if (!w.bone) continue;
      const cat = typeof classifyFn === 'function' ? classifyFn(w) : classifyBone(w.bone?.name || '');
      if (!CLOTH_HAIR_CATS.has(cat)) continue;
      bones.push({
        uuid: w.bone.uuid,
        q: w.bone.quaternion.toArray(),
        cat,
        type: w.params?.type ?? 1,
      });
    }
    if (!bones.length) return;

    this.snapshots.push({ time: bucket, bones });
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
  }

  findNearestSnapshot(animTime) {
    if (!this.snapshots.length) return null;
    let best = this.snapshots[0];
    let bestD = Math.abs(best.time - animTime);
    for (const s of this.snapshots) {
      const d = Math.abs(s.time - animTime);
      if (d < bestD) { best = s; bestD = d; }
    }
    return bestD < 2.5 ? best : null;
  }

  /**
   * Restore hair/cloth after scrub, loop rewind, or penetration.
   * Uses archived bone pose + body reset + optional mini-buffer.
   */
  recover(animTime, physics, mesh, hooks = {}) {
    if (!physics?.bodies || !mesh) return false;
    const reason = hooks.reason || 'recover';
    const hardSeek = /scrub|seek|rewind|loop/.test(reason);
    this.recoverCooldown = hardSeek ? 60 : 90;
    this.lastRecoverReason = reason;
    this._reasonAge = 120;

    if (typeof hooks.syncBones === 'function') hooks.syncBones(mesh);

    if (hardSeek) {
      const snap = this.findNearestSnapshot(animTime);
      if (snap) {
        const boneMap = new Map();
        for (const b of mesh.skeleton?.bones || []) boneMap.set(b.uuid, b);
        for (const entry of snap.bones) {
          const bone = boneMap.get(entry.uuid);
          if (bone && entry.q?.length === 4) bone.quaternion.fromArray(entry.q);
        }
        if (mesh.skeleton) mesh.skeleton.update();
        mesh.updateMatrixWorld(true);
      }
    }

    const classifyFn = hooks.classifyFn;
    const anomaly = hooks.anomaly;
    const resetLimit = anomaly?.worst ? anomaly.worst.threshold * 1.6 : Infinity;
    let resetCount = 0;

    for (const w of physics.bodies) {
      if (!w.body || !w.bone) continue;
      const cat = typeof classifyFn === 'function' ? classifyFn(w) : classifyBone(w.bone?.name || '');
      if (!CLOTH_HAIR_CATS.has(cat)) continue;

      let drift = 0;
      if (typeof w.measureBoneBodyDrift === 'function') drift = w.measureBoneBodyDrift();

      if (w.params?.type === 0) {
        if (typeof w.updateFromBone === 'function') w.updateFromBone();
      } else if (hardSeek && typeof w.reset === 'function') {
        if (resetCount < 12 && (drift > resetLimit || !anomaly)) {
          w.reset();
          resetCount++;
        }
      }
    }

    if (typeof hooks.zeroVel === 'function') hooks.zeroVel(physics);
    if (typeof hooks.gentleSync === 'function') hooks.gentleSync(physics);

    if (hardSeek && typeof hooks.startMiniBuffer === 'function') {
      hooks.startMiniBuffer({ rolling: true, frames: 30 });
    }
    return true;
  }

  tickCooldown() {
    if (this.recoverCooldown > 0) this.recoverCooldown--;
    if (this._reasonAge > 0) {
      this._reasonAge--;
      if (this._reasonAge <= 0) this.lastRecoverReason = '';
    }
  }

  checkAnomaly(physics, mesh, classifyFn, bonePos, bodyPos, sizeVec, hooks = {}) {
    if (this.recoverCooldown > 0) return false;
    const a = measureClothHairAnomaly(physics, mesh, classifyFn, bonePos, bodyPos, sizeVec);
    if (!a.anomalous) return false;
    const reason = a.penetrated >= 2 ? 'penetration' : 'stuck';
    return this.recover(this.lastTime, physics, mesh, { ...hooks, reason, anomaly: a });
  }
}

/** Background buffer refresh every N seconds while animation plays. */
export class RollingLookaheadScheduler {
  constructor(buffer, intervalSec = 8) {
    this.buffer = buffer;
    this.intervalSec = intervalSec;
    this.accum = 0;
    this.enabled = true;
    this.lastRollAt = 0;
  }

  reset() {
    this.accum = 0;
    this.lastRollAt = 0;
  }

  setInterval(sec) {
    this.intervalSec = Math.max(3, Math.min(30, sec));
  }

  tick(dt, ctx = {}) {
    if (!this.enabled || !ctx.animPlaying || !ctx.bufferEnabled) return;
    if (this.buffer?.building) return;
    this.accum += dt;
    if (this.accum < this.intervalSec) return;
    this.accum = 0;
    this.lastRollAt = performance.now();
    if (typeof ctx.startRollingBuffer === 'function') ctx.startRollingBuffer();
  }
}
