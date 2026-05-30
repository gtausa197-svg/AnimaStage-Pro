/**
 * MMD character skeleton, animation, physics colliders, and motion helpers.
 */
import * as THREE from 'three';
import { initAmmo, getAmmo } from './vendor/ammo/ammo-init.js';
import { MMDPhysicsHelper } from 'three/addons/animation/MMDPhysics.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';

export function createCharacterMotionSystem(deps) {
  const {
    showError,
    getSettings,
    getScene,
    isCaptureActive = () => false,
    getTransformControls = () => null,
    isTcDragging = () => false,
    escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    getAnimListEl = () => null,
    getVmdNameEl = () => null,
    getRenderer = () => null,
    getCamera = () => null,
    refreshSceneTransformAttach = () => {},
    onMarkAmmoBroken = null,
  } = deps;

  const getS = getSettings;

  let pendingModelFile = null;
  const loadedVmdFiles = [];

  const animHelper = new MMDAnimationHelper({
  afterglow: 2.0,
  resetPhysicsOnLoop: true,
});
  animHelper.onBeforePhysics = (mesh) => {
  if (mesh !== currentMesh) return;
  applyWindForce(performance.now() * 0.001);
};

  // Disable arm IK — VMD FK + Grant twist bones drive arms naturally.
  const _ARM_IK_NAME = /腕|ひじ|肘|肩|手|arm|elbow|hand|shoulder|Arm|Elbow|Hand|Shoulder/i;

  function getAnimHelperObjects(helper, mesh) {
  if (helper?.objects?.get) return helper.objects.get(mesh);
  if (typeof helper?.get === 'function') return helper.get(mesh);
  return null;
}

  function isArmIkChain(ik, bones) {
  const idxs = [ik.target, ik.effector, ...(ik.links?.map(l => l.index) ?? [])];
  for (const i of idxs) {
    if (_ARM_IK_NAME.test(bones[i]?.name ?? '')) return true;
  }
  return false;
}

  function patchIkSolverForArmFix(ikSolver) {
  if (!ikSolver || ikSolver._armIkFixPatched) return;
  ikSolver._armIkFixPatched = true;
  const origUpdateOne = ikSolver.updateOne.bind(ikSolver);
  ikSolver.updateOne = function (ik) {
    if (!ik || ik.active === false) return this;
    return origUpdateOne(ik);
  };
  ikSolver.update = function () {
    const iks = this.iks;
    for (let i = 0, il = iks.length; i < il; i++) {
      const ik = iks[i];
      if (ik.active !== false) origUpdateOne(ik);
    }
    return this;
  };
}

  function applyIKFixOnly(mesh, helper) {
  if (!mesh?.skeleton?.bones) return;

  const mmd = mesh.geometry?.userData?.MMD;
  if (mmd?.format === 'pmx') {
    helper.configuration.pmxAnimation = true;
  }

  const objects = getAnimHelperObjects(helper, mesh);
  const ikSolver = objects?.ikSolver;

  if (ikSolver?.iks?.length) {
    patchIkSolverForArmFix(ikSolver);
    for (const ik of ikSolver.iks) {
      if (ik.active === undefined) ik.active = true;
      // Раніше тут було ik.active = false для рук — це ламало деформацію
      // плеча у VMD, які керують руками через IK target (左腕ＩＫ).
      // Тепер усі IK залишаються активними як у стандартному MMD.
    }
  }

  mesh.skeleton.update();
  mesh.updateMatrixWorld(true);

  configureArmPhysicsForAnimation(mesh, helper);
  // makeArmLimbCollidersKinematic(mesh, helper);
  // ↑ PMX-моделі вже задають kinematic через params.type = 0.
  // Ручне втручання збиває Bullet motion state і зміщує капсули рук.
}

  const _TORSO_PHYSICS_NAME = /胸|乳|breast|bust|torso|上半身|abdomen|腹|鎖骨|锁骨/i;

  function getPhysicsBoneName(body, mesh) {
  return body.bone?.name ?? mesh.skeleton?.bones?.[body.params?.boneIndex]?.name ?? '';
}

  function isAccessoryPhysicsBody(body) {
  const rbName = `${body.params?.name || ''} ${body.params?.englishName || ''}`.toLowerCase();
  if (/skirt|penis|ribbon|chain|cape|wing|cloth|accessory|服|ペ|装飾|チェーン|リボン|羽|マフ|スカ|ボール|ball|jewel|宝石/.test(rbName)) {
    return true;
  }
  // Dynamic spheres are usually clothing/accessory chain nodes, not limb hitboxes.
  if (body.params?.shapeType === 0 && body.params?.type !== 0) return true;
  return false;
}

  function isMainArmLimbCollider(body, mesh) {
  if (isAccessoryPhysicsBody(body)) return false;

  const shapeType = body.params?.shapeType;
  if (shapeType !== 1 && shapeType !== 2) return false;

  const boneName = getPhysicsBoneName(body, mesh);
  const rbName = `${body.params?.name || ''} ${body.params?.englishName || ''}`.toLowerCase();

  if (/arm|elbow|forearm|upper.?arm|upperarm|lowerarm|ひじ|肘|上腕/.test(rbName)) return true;
  if (/[左右]?腕/.test(boneName) && !/捩/.test(boneName) && !/IK|ＩＫ/i.test(boneName)) return true;
  if (/ひじ|肘/.test(boneName)) return true;
  if (/上腕/.test(boneName)) return true;
  if (/arm|elbow|forearm|upperarm/i.test(boneName.toLowerCase())) return true;
  return false;
}

  function applyKinematicToArmLimbBody(body, zeroInertia, zeroVel) {
  const ammoBody = body.body;
  if (!ammoBody) return;

  ammoBody.setMassProps(0, zeroInertia);
  ammoBody.updateInertiaTensor();
  ammoBody.setLinearVelocity(zeroVel);
  ammoBody.setAngularVelocity(zeroVel);
  ammoBody.setCollisionFlags(ammoBody.getCollisionFlags() | 2);
  ammoBody.setActivationState(4);
}

  function makeArmLimbCollidersKinematic(mesh, helper) {
  const mmdState = typeof helper?.get === 'function'
    ? helper.get(mesh)
    : getAnimHelperObjects(helper, mesh);
  if (!mmdState?.physics?.bodies?.length) return;

  const Ammo = getAmmo();
  if (!Ammo) return;

  mesh.skeleton?.update();
  mesh.updateMatrixWorld(true);

  const zeroInertia = new Ammo.btVector3(0, 0, 0);
  const zeroVel = new Ammo.btVector3(0, 0, 0);
  const limbBodies = [];

  for (const body of mmdState.physics.bodies) {
    if (!isMainArmLimbCollider(body, mesh)) continue;
    applyKinematicToArmLimbBody(body, zeroInertia, zeroVel);
    limbBodies.push(body);
  }

  for (const body of limbBodies) {
    body.updateFromBone?.();
  }

  Ammo.destroy(zeroInertia);
  Ammo.destroy(zeroVel);
}

  function syncArmLimbCollidersFromBones(mesh) {
  const physics = getMeshPhysics();
  if (!physics?.bodies?.length) return;

  mesh.skeleton?.update();
  mesh.updateMatrixWorld(true);

  for (const body of physics.bodies) {
    if (!isMainArmLimbCollider(body, mesh)) continue;
    body.updateFromBone?.();
  }
}

  // Body-limb colliders (arms, legs, twist, spine/neck/head) — anything that is a
  // rigid capsule/box bound to a skeletal limb bone, excluding cloth/accessory
  // chains. Used to snap colliders back onto bones while manually posing so the
  // dynamic capsules on W-bone PMX models (Sour Miku / TDA) don't drift off-axis.
  const _LIMB_COLLIDER_BONE = /腕|肩|ひじ|肘|上腕|手首|手捩|腕捩|捩|足|ひざ|膝|足首|つま先|上半身|下半身|首|頭|spine|neck|head|arm|elbow|wrist|shoulder|leg|knee|ankle|toe|thigh|calf|hip/i;

  function isPosableLimbCollider(body, mesh) {
  if (isAccessoryPhysicsBody(body)) return false;
  const shapeType = body.params?.shapeType;
  if (shapeType !== 1 && shapeType !== 2) return false; // box / capsule only
  const boneName = getPhysicsBoneName(body, mesh);
  if (/IK|ＩＫ/i.test(boneName)) return false;
  return _LIMB_COLLIDER_BONE.test(boneName);
}

  let _limbSnapZero = null;

  // Snap a rigid body onto its bone regardless of dynamics type. RigidBody.reset()
  // calls _setTransformFromBone() unconditionally (unlike updateFromBone(), which
  // is a no-op for dynamic bodies), so this also re-aligns the dynamic arm/leg
  // capsules on W-bone PMX models. Velocity is zeroed so the sim can't fling them.
  function snapBodyToBone(body) {
  if (typeof body?.reset !== 'function') return;
  if (body.params?.boneIndex === -1) return; // free body, not bound to a bone
  body.reset();
  const ab = body.body;
  const Ammo = getAmmo();
  if (ab && Ammo) {
    if (!_limbSnapZero) _limbSnapZero = new Ammo.btVector3(0, 0, 0);
    ab.setLinearVelocity(_limbSnapZero);
    ab.setAngularVelocity(_limbSnapZero);
    ab.activate();
  }
}

  // Re-align limb capsules (arms/legs/twist) to the current bone pose. Used after
  // a manual transform so the colliders track the bones we just moved.
  function syncLimbCollidersFromBones(mesh) {
  const target = mesh || currentMesh;
  if (!target?.skeleton) return;
  const physics = animHelper.objects.get(target)?.physics || null;
  if (!physics?.bodies?.length) return;

  target.skeleton.update();
  target.updateMatrixWorld(true);

  for (const body of physics.bodies) {
    if (!isPosableLimbCollider(body, target)) continue;
    snapBodyToBone(body);
  }
}

  // While posing, we must NOT step the sim for the active model: dynamic arm/leg
  // capsules would drive (deform) the bones via _updateBones() and drift off-axis.
  // Instead, pin every bone-bound collider onto the posed skeleton each frame so
  // the bones stay exactly as posed and the debug capsules sit on the limbs.
  function holdCollidersOnPose(mesh, physics) {
  if (!mesh?.skeleton || !physics?.bodies?.length) return;
  mesh.skeleton.update();
  mesh.updateMatrixWorld(true);
  for (const body of physics.bodies) {
    snapBodyToBone(body);
  }
}

  function debugArmBodies() {
  const physics = getMeshPhysics();
  if (!physics) { console.log('no physics'); return; }
  if (!currentMesh?.skeleton) { console.log('no mesh'); return; }

  console.group('=== ARM RIGID BODIES ===');
  for (const body of physics.bodies) {
    const boneName = getPhysicsBoneName(body, currentMesh);
    if (!/腕|肩|ひじ|肘|arm|elbow|shoulder/i.test(boneName)) continue;

    const bone = currentMesh.skeleton.bones[body.params.boneIndex];
    const bonePos = bone ? bone.getWorldPosition(new THREE.Vector3()) : null;
    const bodyPos = body.body ? physBodyOrigin(body.body) : null;

    console.log({
      boneName,
      rbName: body.params.name,
      pmxType: body.params.type,
      shapeType: body.params.shapeType,
      mass: body.params.mass,
      isMainArm: isMainArmLimbCollider(body, currentMesh),
      bonePos: bonePos && `${bonePos.x.toFixed(2)}, ${bonePos.y.toFixed(2)}, ${bonePos.z.toFixed(2)}`,
      bodyPos: bodyPos && `${bodyPos.x.toFixed(2)}, ${bodyPos.y.toFixed(2)}, ${bodyPos.z.toFixed(2)}`,
      hasOffset: !!body.boneOffsetForm,
    });
  }
  console.groupEnd();
}
window.debugArmBodies = debugArmBodies;

  function debugArmIK() {
  const objects = animHelper?.objects.get(currentMesh);
  const ikSolver = objects?.ikSolver;
  if (!ikSolver?.iks) { console.log('no IK solver'); return; }
  const bones = currentMesh.skeleton.bones;
  console.group('=== ARM IK CHAINS ===');
  for (const ik of ikSolver.iks) {
    const targetName = bones[ik.target]?.name || '';
    const effectorName = bones[ik.effector]?.name || '';
    if (!/腕|肩|ひじ|肘|手|arm/i.test(targetName + effectorName)) continue;
    console.log({
      target: targetName,
      effector: effectorName,
      active: ik.active,
      links: ik.links.map(l => bones[l.index]?.name),
    });
  }
  console.groupEnd();
}
window.debugArmIK = debugArmIK;

  function debugArmDeform() {
  if (!currentMesh?.skeleton) { console.log('no mesh'); return; }
  const bones = currentMesh.skeleton.bones;
  const grants = currentMesh.geometry?.userData?.MMD?.grants || [];
  console.group('=== ARM DEFORM / GRANT ===');
  console.log('grants total:', grants.length);
  const armRe = /腕|肩|ひじ|肘|手首|捩/;
  for (const g of grants) {
    const bn = bones[g.index]?.name || '?';
    if (!armRe.test(bn)) continue;
    console.log({
      bone: bn,
      grantParent: bones[g.parentIndex]?.name || '?',
      ratio: g.ratio,
      affectRotation: g.affectRotation,
      affectPosition: g.affectPosition,
      isLocal: g.isLocal,
    });
  }
  for (const b of bones) {
    if (!armRe.test(b.name)) continue;
    const q = b.quaternion;
    const restIdentity = Math.abs(q.x) < 1e-4 && Math.abs(q.y) < 1e-4 && Math.abs(q.z) < 1e-4;
    console.log({ bone: b.name, parent: b.parent?.name || '(root)', restIdentityRot: restIdentity });
  }
  console.groupEnd();
}
window.debugArmDeform = debugArmDeform;

  function updateRigidBodyCollisionFilter(physics, body, newTarget) {
  if (newTarget === body.params.groupTarget) return;
  body.params.groupTarget = newTarget;
  physics.world.removeRigidBody(body.body);
  physics.world.addRigidBody(body.body, 1 << body.params.groupIndex, newTarget);
}

  function configureArmPhysicsForAnimation(mesh, helper) {
  const mmdState = typeof helper?.get === 'function'
    ? helper.get(mesh)
    : getAnimHelperObjects(helper, mesh);
  const physics = mmdState?.physics;
  if (!physics?.bodies?.length || !physics.world) return;

  const torsoGroups = new Set();
  const armGroups = new Set();

  for (const body of physics.bodies) {
    const boneName = getPhysicsBoneName(body, mesh);
    if (_TORSO_PHYSICS_NAME.test(boneName)) torsoGroups.add(body.params.groupIndex);
    if (isMainArmLimbCollider(body, mesh)) armGroups.add(body.params.groupIndex);
  }

  if (torsoGroups.size === 0) torsoGroups.add(0);

  for (const body of physics.bodies) {
    if (!isMainArmLimbCollider(body, mesh)) continue;
    let target = body.params.groupTarget;
    for (const g of torsoGroups) target &= ~(1 << g);
    updateRigidBodyCollisionFilter(physics, body, target);
  }

  for (const body of physics.bodies) {
    const boneName = getPhysicsBoneName(body, mesh);
    if (!_TORSO_PHYSICS_NAME.test(boneName)) continue;
    let target = body.params.groupTarget;
    for (const g of armGroups) target &= ~(1 << g);
    updateRigidBodyCollisionFilter(physics, body, target);
  }
}

  function freezeTwistBones(mesh) {
  if (!mesh || !mesh.skeleton) return;
  mesh.skeleton.bones.forEach(bone => {
    const name = bone.name;
    if (name.includes('捩') || name.toLowerCase().includes('twist')) {
      bone.quaternion.set(0, 0, 0, 1);
    }
  });
  mesh.updateMatrixWorld(true);
}

  let ammoReady = false;
  let ammoPhysicsBroken = false;
  let physDebugHelper = null;

  function markAmmoBroken(reason) {
  if (ammoPhysicsBroken) return;
  ammoPhysicsBroken = true;
  ammoReady = false;
  if (getS()) getS().physics = false;
  const cb = document.getElementById('cPhysics');
  if (cb) cb.checked = false;
  console.warn('[Ammo] Bullet disabled for this session:', reason);
}

  function physBodyOrigin(body) {
  const tr = body.getCenterOfMassTransform();
  const o = tr.getOrigin();
  return { x: o.x(), y: o.y(), z: o.z() };
}

  function physBodyLinvel(body) {
  const v = body.getLinearVelocity();
  return { x: v.x(), y: v.y(), z: v.z() };
}

  function physBodyAngvel(body) {
  const v = body.getAngularVelocity();
  return { x: v.x(), y: v.y(), z: v.z() };
}

  function physBodySetLinvel(body, v, wake) {
  const Ammo = getAmmo();
  const lv = new Ammo.btVector3(v.x, v.y, v.z);
  body.setLinearVelocity(lv);
  Ammo.destroy(lv);
  if (wake !== false) body.activate(true);
}

  function physBodySetAngvel(body, v, wake) {
  const Ammo = getAmmo();
  const av = new Ammo.btVector3(v.x, v.y, v.z);
  body.setAngularVelocity(av);
  Ammo.destroy(av);
  if (wake !== false) body.activate(true);
}

  function physBodyAddForce(body, f, wake) {
  const Ammo = getAmmo();
  const fv = new Ammo.btVector3(f.x, f.y, f.z);
  body.applyCentralForce(fv);
  Ammo.destroy(fv);
  if (wake !== false) body.activate(true);
}

  function physBodyWake(body) {
  body.activate(true);
}
  let currentMesh = null;
  const loadedAnims = []; // {name, clip} pairs
  let activeAnimIdx = -1;
  let animPlaying = false;
  let animSpeed = 1.0;

  // Single-animation install — always remove/re-add so clips never stack on the skeleton.
  let _animInstallToken = 0;

  function resetAnimGuardState() {
  _animInstallToken++;
}

  function resetMeshBindPose(mesh) {
  if (!mesh?.skeleton) return;
  if (typeof mesh.pose === 'function') mesh.pose();
  else applyRestPose();
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
}

  function clearAnimMixerState(mesh) {
  const objects = animHelper?.objects.get(mesh);
  if (!objects) return;
  delete objects.backupBones;
  delete objects.sortedBonesData;
  objects.looped = false;
  objects.activeClip = null;
}
  // ---------------------------------------------------------------------------
  // Physics helpers
  //
  // MMDAnimationHelper.add() forwards its params to MMDPhysics, which exposes
  // `unitStep` (simulation dt in seconds), `maxStepNum` (substep cap per frame),
  // `gravity` (Vector3), and `warmup` (frames pre-simulated when adding).
  //
  // MMDPhysics default: unitStep 1/65 s, maxStepNum 3 (see three.js MMDPhysics.js).
  // Authors tune PMX rigid bodies/constraints for that step — higher rates explode hair/skirt.
  // ---------------------------------------------------------------------------
  function effectivePhysRate() {
  return getS().stablePhys ? 65 : clampPhysRate(getS().physicsRate);
}
  function effectivePhysSub() {
  return getS().stablePhys ? 3 : clampPhysSub(getS().physicsSubsteps);
}

  function physicsConfig(extra = {}) {
  syncPhysSafety();
  const wantPhysics = ammoReady && getS().physics && !ammoPhysicsBroken;
  return Object.assign({
    physics: wantPhysics,
    warmup: wantPhysics ? getS().physicsWarmup : 0,
    unitStep: 1 / effectivePhysRate(),
    maxStepNum: effectivePhysSub(),
    gravity: new THREE.Vector3(0, -98 * getS().physicsGravity, 0),
  }, extra);
}

  // Bullet — remove rigid bodies/constraints when swapping models.
  function disposeMMDPhysics(physics) {
  if (!physics?.world || !ammoReady) return;
  const world = physics.world;
  let Ammo;
  try { Ammo = getAmmo(); } catch (_) { return; }

  for (let i = physics.constraints.length - 1; i >= 0; i--) {
    const c = physics.constraints[i];
    const constraint = c?.constraint || c?.joint;
    if (!constraint) continue;
    try {
      world.removeConstraint(constraint);
      Ammo.destroy(constraint);
    } catch (e) {
      console.warn('[Ammo] removeConstraint failed:', e?.message || e);
    }
    c.constraint = null;
    c.joint = null;
  }
  physics.constraints.length = 0;

  for (let i = physics.bodies.length - 1; i >= 0; i--) {
    const w = physics.bodies[i];
    if (!w?.body) continue;
    try {
      world.removeRigidBody(w.body);
      Ammo.destroy(w.body);
    } catch (e) {
      console.warn('[Ammo] removeRigidBody failed:', e?.message || e);
    }
    w.body = null;
  }
  physics.bodies.length = 0;

  try {
    Ammo.destroy(world);
  } catch (e) {
    console.warn('[Ammo] destroy world failed:', e?.message || e);
  }
  physics.world = null;
}

  function disposeMeshPhysics(mesh) {
  if (!mesh) return;
  const obj = animHelper.objects.get(mesh);
  if (obj?.physics) {
    disposeMMDPhysics(obj.physics);
    obj.physics = null;
  }
}

  function stopMeshMixer(mesh) {
  const objects = animHelper?.objects.get(mesh);
  if (!objects?.mixer) return;
  const mixer = objects.mixer;
  try {
    mixer.stopAllAction();
    if (objects.activeClip) mixer.uncacheClip(objects.activeClip);
    mixer.uncacheRoot(mesh);
  } catch (_) {}
  objects.mixer = null;
  objects.activeClip = null;
}

  // Replace clip on a registered mesh — bind-pose reset + single mixer (keeps Bullet bodies).
  function replaceModelAnimation(entry, opts = {}) {
  const mesh = opts.mesh || currentMesh;
  const objects = animHelper?.objects.get(mesh);
  if (!mesh || !entry?.clip || !objects) return false;
  if (animHelper.meshes.indexOf(mesh) < 0) return false;

  stopMeshMixer(mesh);
  resetMeshBindPose(mesh);

  objects.mixer = new THREE.AnimationMixer(mesh);
  const action = objects.mixer.clipAction(entry.clip);
  action.reset();
  action.play();
  objects.activeClip = entry.clip;
  clearAnimMixerState(mesh);

  return true;
}

  // Full clean install when mesh is not yet registered with animHelper.
  function installModelAnimation(entry, opts = {}) {
  const mesh = opts.mesh || currentMesh;
  if (!mesh || !entry?.clip || !animHelper) return false;
  if (replaceModelAnimation(entry, { mesh, hardPhysics: !!opts.hardPhysics })) return true;

  const token = ++_animInstallToken;

  animHelperRemoveMesh(mesh);
  if (token !== _animInstallToken) return false;

  resetMeshBindPose(mesh);

  animHelperAddMesh(mesh, physicsConfig({
    animation: entry.clip,
    animationWarmup: false,
  }));
  if (token !== _animInstallToken) return false;

  const objects = animHelper.objects.get(mesh);
  if (objects) objects.activeClip = entry.clip;

  clearAnimMixerState(mesh);

  const act = getActionForMesh(mesh);
  if (act) {
    act.reset();
    act.time = 0;
    act.paused = false;
    act.play();
  }
  return true;
}

  function getActionForMesh(mesh) {
  if (!mesh || !animHelper) return null;
  const obj = animHelper.objects.get(mesh);
  const acts = obj?.mixer?._actions;
  if (!acts || acts.length === 0) return null;
  return acts[0];
}

  function playAnimOnMesh(mesh, animsArray, idx, opts = {}) {
  if (!mesh || idx < 0 || idx >= animsArray.length) return;
  BONE.playing = false;
  const entry = animsArray[idx];
  if (!installModelAnimation(entry, { hardPhysics: !!opts.hardPhysics, mesh })) return;
  applyIKFixOnly(mesh, animHelper);
  const physics = animHelper.objects.get(mesh)?.physics;
  if (physics && getS().physics) {
    animHelper.update(0);
    physics.reset();
  }
  if (mesh === currentMesh) {
    animPlaying = true;
    activeAnimIdx = idx;
    syncStablePhysUI();
    refreshAnimList();
  }
  return entry.clip.duration;
}

  function updateMultiCharacterMotion(states, dt, opts = {}) {
  const S = getS();
  const {
    tlRegEl,
    tlLoopEl,
  } = opts;

  if (BONE.playing && currentMesh?.skeleton) {
    BONE.time += dt * animSpeed;
    if (BONE.time > BONE.duration) BONE.time = 0;
    applyBoneAnimTime(BONE.time);
    refreshBoneTimelineUI();
    return;
  }

  if (!animHelper || !states?.length) return;

  // Multi-character physics throttle. Bullet cost scales with the number of
  // simulated models; two cloth/hair-heavy PMX models can easily blow the
  // frame budget. Cap the per-frame substep catch-up so a dropped frame can't
  // trigger a death-spiral (each model would otherwise try to run up to
  // maxStepNum extra steps). With a single model we keep the configured value.
  if (S.physics && ammoReady && !ammoPhysicsBroken) {
    const physMeshes = [];
    for (const s of states) {
      if (!s.mesh) continue;
      const ph = animHelper.objects.get(s.mesh)?.physics;
      if (ph) physMeshes.push(ph);
    }
    if (physMeshes.length >= 2) {
      for (const ph of physMeshes) if (ph.maxStepNum > 2) ph.maxStepNum = 2;
    } else if (physMeshes.length === 1) {
      const want = effectivePhysSub();
      if (physMeshes[0].maxStepNum !== want) physMeshes[0].maxStepNum = want;
    }
  }

  const anyWithAnim = states.some(s => s.mesh && s.activeAnimIdx >= 0);
  const anyPlaying = states.some(s => s.mesh && s.activeAnimIdx >= 0 && s.animPlaying);

  if (anyWithAnim) {
    if (anyPlaying) animHelper.update(dt * animSpeed);
    else animHelper.update(0);

    for (const s of states) {
      if (!s.mesh || s.activeAnimIdx < 0) continue;
      const act = getActionForMesh(s.mesh);
      if (!act) continue;
      act.paused = !s.animPlaying;
      if (tlRegEl?.checked && s.loopOut > s.loopIn) {
        if (act.time >= s.loopOut) act.time = s.loopIn;
      }
      act.loop = tlLoopEl?.checked ? THREE.LoopRepeat : THREE.LoopOnce;
      act.clampWhenFinished = !tlLoopEl?.checked;
    }
  } else if (S.physics && ammoReady && !ammoPhysicsBroken) {
    for (const s of states) {
      if (!s.mesh) continue;
      const physics = animHelper.objects.get(s.mesh)?.physics;
      if (!physics) continue;
      if (BONE.enabled && s.mesh === currentMesh) {
        // Posing the active model: hold colliders on the posed bones instead of
        // simulating, so dynamic limb capsules can't deform the bones or drift.
        holdCollidersOnPose(s.mesh, physics);
      } else {
        animHelper.onBeforePhysics(s.mesh);
        physics.update(dt);
      }
    }
  }
}

  function animHelperRemoveMesh(mesh) {
  if (!mesh) return;
  // Each step is isolated: a failure freeing Bullet rigid bodies (Ammo can
  // throw) must NOT prevent the later steps — most importantly it must not stop
  // the caller from detaching the mesh from the scene graph, or a "removed"
  // model keeps being rendered (shadow + volumetric depth passes), leaving its
  // polygons in the scene and tanking FPS.
  try { stopMeshMixer(mesh); } catch (e) { console.warn('stopMeshMixer failed', e); }
  try { disposeMeshPhysics(mesh); } catch (e) { console.warn('disposeMeshPhysics failed', e); }
  try { if (mesh === currentMesh) setPhysDebugHelper(false); } catch (_) {}
  try { animHelper.remove(mesh); } catch (_) { /* mesh was not registered */ }
}

  function removeScenePlaceholder() {
  const placeholder = getScene().getObjectByName('placeholder');
  if (!placeholder) return;
  placeholder.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => m.dispose());
    }
  });
  getScene().remove(placeholder);
}

  function disposeLoadedMesh(mesh) {
  if (!mesh) return;
  animHelperRemoveMesh(mesh);
  // Detach from whatever the actual parent is (normally the scene). Relying on
  // scene.remove() alone fails if the mesh was ever reparented, and any earlier
  // throw must not skip this — so it runs unconditionally here.
  if (mesh.parent) mesh.parent.remove(mesh);
  else getScene().remove(mesh);
  if (mesh === currentMesh) currentMesh = null;
  mesh.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton && typeof o.skeleton.dispose === 'function') {
      try { o.skeleton.dispose(); } catch (_) {}
    }
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        for (const k of ['map','envMap','normalMap','roughnessMap','metalnessMap','aoMap','gradientMap','matcap','emissiveMap','alphaMap','bumpMap','displacementMap']) {
          if (m[k] && typeof m[k].dispose === 'function') m[k].dispose();
        }
        m.dispose();
      });
    }
  });
}

  // Warmup used to run synchronously inside animHelper.add and could freeze the
  // viewport for seconds while Bullet rigid bodies/constraints initialize.
  function animHelperAddMesh(mesh, cfg) {
  let useCfg = cfg;
  if (ammoPhysicsBroken || !ammoReady || !getS().physics) {
    useCfg = Object.assign({}, cfg, { physics: false, warmup: 0 });
  }
  try {
    animHelper.add(mesh, useCfg);
    applyIKFixOnly(mesh, animHelper);
    applySwing();
    applyPhysicsLive();
  } catch (e) {
    const msg = String(e?.message || e);
    if (/out of memory|\bOOM\b|WebAssembly|wasm.*(fail|error|oom)|unreachable|RuntimeError/i.test(msg)) {
      markAmmoBroken(e);
      animHelperRemoveMesh(mesh);
      try {
        animHelper.add(mesh, Object.assign({}, cfg, { physics: false, warmup: 0 }));
        applyIKFixOnly(mesh, animHelper);
        showError('Physics disabled (Ammo crash). Model loaded without cloth/hair sim — refresh to retry.');
      } catch (e2) {
        showError('Failed to init animation: ' + (e2.message || e2));
        throw e2;
      }
    } else {
      throw e;
    }
  }
}

  // Full physics restart — destroy old Bullet state, recreate from PMX, snap to bind pose.
  function restartPhysics() {
  if (!currentMesh || !animHelper) return;

  const animEntry = activeAnimIdx >= 0 ? loadedAnims[activeAnimIdx] : null;
  const animTime = saveAnimationPoseSnapshot();
  const wasPlaying = animPlaying;

  setPhysDebugHelper(false);
  animHelperRemoveMesh(currentMesh);
  clearAnimMixerState(currentMesh);

  const cfg = physicsConfig();
  if (animEntry?.clip) {
    cfg.animation = animEntry.clip;
    cfg.animationWarmup = false;
  }

  animHelperAddMesh(currentMesh, cfg);

  const objects = animHelper.objects.get(currentMesh);
  if (objects && animEntry?.clip) objects.activeClip = animEntry.clip;

  restoreAnimationPoseSnapshot(animTime);

  const act = currentAction();
  if (act) {
    act.paused = !wasPlaying;
    if (!act.isRunning()) act.play();
  }
  animPlaying = wasPlaying;

  // Evaluate bones at current pose, then reset all rigid bodies to PMX offsets.
  animHelper.update(0);
  if (currentMesh.skeleton) currentMesh.skeleton.update();
  currentMesh.updateMatrixWorld(true);

  const physics = getMeshPhysics();
  if (physics) {
    physics.reset();
    applyPhysicsLive();
  }
  _physWindSmoothed = 0;

  if (getS().physDebugHelper) setPhysDebugHelper(true);
}

  // Remove + re-add when toggling physics on/off.
  function rebuildPhysics() {
  restartPhysics();
}

  // ---------------------------------------------------------------------------
  // Physics — stock three.js MMDPhysics + Ammo.js
  // ---------------------------------------------------------------------------
  const PHYS_LIMITS = {
  rateMin: 50,
  rateMax: 80,
  subMin: 2,
  subMax: 20,
  swingMax: 0.55,
};

  let _physWindSmoothed = 0;

  function clampPhysRate(r) {
  return Math.min(PHYS_LIMITS.rateMax, Math.max(PHYS_LIMITS.rateMin, Math.round(r)));
}
  function clampPhysSub(s) {
  return Math.min(PHYS_LIMITS.subMax, Math.max(PHYS_LIMITS.subMin, Math.round(s)));
}

  function getMeshPhysics() {
  if (!currentMesh) return null;
  return animHelper.objects.get(currentMesh)?.physics || null;
}

  function syncPhysSafety() {
  getS().physicsRate = clampPhysRate(getS().physicsRate);
  getS().physicsSubsteps = clampPhysSub(getS().physicsSubsteps);
  getS().physicsSwing = Math.min(PHYS_LIMITS.swingMax, Math.max(0, getS().physicsSwing));
  getS().physicsWind = Math.min(12, Math.max(0, getS().physicsWind));
  getS().physicsWarmup = Math.min(120, Math.max(0, Math.round(getS().physicsWarmup)));
}

  function applyPhysicsLive() {
  syncPhysSafety();
  const physics = getMeshPhysics();
  if (!physics) return;
  physics.unitStep = 1 / effectivePhysRate();
  physics.maxStepNum = effectivePhysSub();
  if (physics.world) {
    physics.setGravity(new THREE.Vector3(0, -98 * getS().physicsGravity, 0));
  }
  applySwing();
}

  function saveAnimationPoseSnapshot() {
  const act = currentAction();
  return act ? act.time : null;
}

  function restoreAnimationPoseSnapshot(t) {
  if (t == null) return;
  const act = currentAction();
  if (act) act.time = t;
}

  function applySafePhysDefaults() {
  getS().physicsRate = 65;
  getS().physicsSubsteps = 4;
  getS().physicsGravity = 1.0;
  getS().physicsWarmup = 60;
  getS().physicsSwing = 0;
  getS().physicsWind = 0;
  getS().stablePhys = true;
  _physWindSmoothed = 0;
  const cStable = document.getElementById('cStablePhys');
  if (cStable) cStable.checked = true;
  const setUI = (rId, vId, val, fmt) => {
    const r = document.getElementById(rId);
    const v = document.getElementById(vId);
    if (r) r.value = val;
    if (v) v.value = fmt(val);
  };
  setUI('rPhysRate', 'vPhysRate', 65, x => x.toFixed(0));
  setUI('rPhysSub', 'vPhysSub', 4, x => x.toFixed(0));
  setUI('rGrav', 'vGrav', 1, x => x.toFixed(2));
  setUI('rWarmup', 'vWarmup', 60, x => x.toFixed(0));
  setUI('rSwing', 'vSwing', 0, x => x.toFixed(2));
  setUI('rWind', 'vWind', 0, x => x.toFixed(1));
  const qual = document.getElementById('physQual');
  if (qual) qual.value = 'default';
  syncStablePhysUI();
}

  function syncStablePhysUI() {
  const lock = getS().stablePhys;
  const rRate = document.getElementById('rPhysRate');
  const vRate = document.getElementById('vPhysRate');
  const rSub = document.getElementById('rPhysSub');
  const vSub = document.getElementById('vPhysSub');
  const qual = document.getElementById('physQual');
  if (rRate) {
    rRate.disabled = lock;
    if (lock) {
      rRate.value = '65';
      if (vRate) vRate.value = '65';
    } else {
      rRate.value = String(getS().physicsRate);
      if (vRate) vRate.value = getS().physicsRate.toFixed(0);
    }
  }
  if (rSub) {
    rSub.disabled = lock;
    if (lock) {
      rSub.value = '3';
      if (vSub) vSub.value = '3';
    } else {
      rSub.value = String(getS().physicsSubsteps);
      if (vSub) vSub.value = getS().physicsSubsteps.toFixed(0);
    }
  }
  if (qual) {
    qual.disabled = lock;
    if (lock) qual.value = 'default';
  }
  applyPhysicsLive();
}

  function setPhysDebugHelper(on) {
  getS().physDebugHelper = !!on;
  if (physDebugHelper) {
    getScene().remove(physDebugHelper);
    physDebugHelper = null;
  }
  if (!on) return;
  const physics = getMeshPhysics();
  if (!physics || !currentMesh) return;
  physDebugHelper = new MMDPhysicsHelper(currentMesh, physics);
  physDebugHelper.visible = true;
  getScene().add(physDebugHelper);
}

  function applySwing() {
  if (!currentMesh) return;
  const physics = getMeshPhysics();
  if (!physics?.bodies) return;
  const sw = Math.min(PHYS_LIMITS.swingMax, Math.max(0, getS().physicsSwing));
  for (const wrapper of physics.bodies) {
    const p = wrapper.params;
    if (!p || !wrapper.body || p.type === 0) continue;
    const linOrig = p.positionDamping !== undefined ? p.positionDamping : 0.0;
    const angOrig = p.rotationDamping !== undefined ? p.rotationDamping : 0.0;
    const lin = Math.max(0.04, linOrig * (1 - sw));
    const ang = Math.max(0.04, angOrig * (1 - sw));
    wrapper.body.setDamping(lin, ang);
  }
}

  function applyWindForce(time) {
  if (!currentMesh || !ammoReady) return;
  _physWindSmoothed += (getS().physicsWind - _physWindSmoothed) * 0.05;
  if (_physWindSmoothed <= 0.0001) return;
  const physics = getMeshPhysics();
  if (!physics?.bodies) return;
  const wBase = _physWindSmoothed;
  const fx = wBase * (Math.sin(time * 0.5) + 0.15 * Math.sin(time * 2.0));
  const fz = wBase * (Math.cos(time * 0.4) + 0.15 * Math.cos(time * 1.8));
  for (const wrapper of physics.bodies) {
    if (!wrapper.params || wrapper.params.type === 0 || !wrapper.body) continue;
    const w = wBase * 0.15;
    const scale = w / Math.max(wBase, 0.001);
    physBodyAddForce(wrapper.body, { x: fx * scale, y: 0, z: fz * scale }, true);
  }
}

  function waitFrames(n = 1) {
  return new Promise((resolve) => {
    let left = n;
    const step = () => { if (--left <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

  async function waitForMeshPhysics(maxFrames = 180) {
  for (let i = 0; i < maxFrames; i++) {
    if (!currentMesh) return false;
    if (!getS().physics || ammoPhysicsBroken) return true;
    if (getMeshPhysics()) return true;
    await waitFrames(1);
  }
  return !!getMeshPhysics();
}

  function refreshAnimList() {
    const el = getAnimListEl();
    if (!el) return;
    el.innerHTML = '';
    if (loadedAnims.length === 0) {
      el.innerHTML = '<div class="note" style="text-align:center; padding:6px;">no animations loaded</div>';
      return;
    }
    loadedAnims.forEach((a, i) => {
      const div = document.createElement('div');
      div.className = 'anim-item' + (i === activeAnimIdx ? ' active' : '');
      div.innerHTML = `<span>${escapeHtml(a.name)}</span><span>${i === activeAnimIdx ? '▶' : ''}</span>`;
      div.addEventListener('click', () => playAnim(i));
      el.appendChild(div);
    });
  }

  function currentDuration() {
    if (activeAnimIdx < 0 || !loadedAnims[activeAnimIdx]) return 0;
    return loadedAnims[activeAnimIdx].clip.duration;
  }

  function playAnim(idx, opts = {}) {
  if (idx < 0 || idx >= loadedAnims.length || !currentMesh) return;
  BONE.playing = false;
  const entry = loadedAnims[idx];
  if (!installModelAnimation(entry, { hardPhysics: !!opts.hardPhysics })) return;
  applyIKFixOnly(currentMesh, animHelper);
  const physics = getMeshPhysics();
  if (physics && getS().physics) {
    animHelper.update(0);
    physics.reset();
  }
  animPlaying = true;
  activeAnimIdx = idx;
  syncStablePhysUI();
  refreshAnimList();
  return entry.clip.duration;
}
  // ===========================================================================
  // BONE ANIMATION — lightweight pose/keyframe editor for MMD skeletons
  // ===========================================================================
  const BONE_STORAGE_PREFIX = 'mmd_rtx_boneanim_';
  const BONE_PRESETS = [
  { label: 'Root', match: 'センター' },
  { label: 'Body', match: '上半身' },
  { label: 'Head', match: '頭' },
  { label: 'Neck', match: '首' },
  { label: 'L arm', match: '左腕' },
  { label: 'R arm', match: '右腕' },
  { label: 'L leg', match: '左足' },
  { label: 'R leg', match: '右足' },
  ];

  const BONE = {
  enabled: false,
  selected: null,
  filter: '',
  duration: 10,
  time: 0,
  playing: false,
  keys: [],
  restPose: {},
  modelKey: '',
  transformMode: 'rotate',
  space: 'local',
  autoPose: true,
  autoPoseStrength: 0.35,
  mirrorPose: false,
  autoKey: false,
  dragSnapshot: null,
  modelOpacity: 1,
  focusDimOthers: true,
  otherBoneOpacity: 0.45,
  anatomy: null,
};

  const boneTreeCollapsed = new Set();

  const BONE_REGION_LABELS = {
  root: '🌳 Root',
  spine: '🧍 Torso',
  head: '😀 Head',
  armL: '💪 Left arm',
  armR: '💪 Right arm',
  legL: '🦵 Left leg',
  legR: '🦵 Right leg',
  ik: '🎯 IK',
  finger: '🖐 Fingers',
  accessory: '✨ Accessories',
  other: '🦴 Other',
};

  const BONE_REGION_ICONS = {
  root: '🌳', spine: '🧍', head: '😀', armL: '💪', armR: '💪',
  legL: '🦵', legR: '🦵', ik: '🎯', finger: '🖐', accessory: '✨', other: '🦴',
};

  const BONE_INFO_RULES = [
  { match: /全ての親|^mother$/i, region: 'root', role: 'Master parent bone', desc: 'Root of the MMD hierarchy. The entire body hangs below it. Usually not animated directly.' },
  { match: /センター|^center$/i, region: 'root', role: 'Center (global position)', desc: 'Moves the whole character in space. Main root for positioning the model.' },
  { match: /グルーブ|groove/i, region: 'spine', role: 'Groove — torso tilt', desc: 'Helper bone for tilting the center without moving the feet in the scene.' },
  { match: /腰|^waist$/i, region: 'spine', role: 'Waist / lower torso', desc: 'Lower torso. Side bends and torso rotation from the pelvis.' },
  { match: /上半身2|upper.?body.?2/i, region: 'spine', role: 'Upper torso (2)', desc: 'Extra chest segment — more flexibility in the upper body.' },
  { match: /上半身|upper.?body/i, region: 'spine', role: 'Upper torso', desc: 'Chest and abdomen. Torso twist, forward/back bend.' },
  { match: /下半身|lower.?body/i, region: 'spine', role: 'Lower torso / pelvis', desc: 'Pelvis. Legs attach here; hip rotation for walking and dancing.' },
  { match: /首|neck/i, region: 'head', role: 'Neck', desc: 'Connects head to torso. Head tilt and turn.' },
  { match: /頭|head(?!phone)/i, region: 'head', role: 'Head', desc: 'Rotates the whole head — nods and turns.' },
  { match: /目|眼|eye/i, region: 'head', role: 'Eyes', desc: 'Gaze direction, blinking (often with morphs). May be left/right.' },
  { match: /眉|brow/i, region: 'head', role: 'Eyebrows', desc: 'Facial expression — surprise, anger, sadness, etc.' },
  { match: /口|唇|mouth|lip/i, region: 'head', role: 'Mouth / lips', desc: 'Lip movement for speech or expressions (often with morphs).' },
  { match: /歯|牙|teeth/i, region: 'head', role: 'Teeth', desc: 'Small mouth movements for expression detail.' },
  { match: /舌|tongue/i, region: 'head', role: 'Tongue', desc: 'Extra mouth detail.' },
  { match: /照|凉|shadow/i, region: 'accessory', role: 'Shadow / helper', desc: 'Utility bone for shadow or effect on the model, not part of the body.' },
  { match: /左.*肩|shoulder.*l/i, region: 'armL', role: 'Left shoulder', desc: 'Raises/lowers the arm, rotates the shoulder forward/back.' },
  { match: /右.*肩|shoulder.*r/i, region: 'armR', role: 'Right shoulder', desc: 'Raises/lowers the arm, rotates the shoulder forward/back.' },
  { match: /左.*腕|left.*arm/i, region: 'armL', role: 'Left upper arm', desc: 'Shoulder to elbow. Main motion for swings and gestures with the left arm.' },
  { match: /右.*腕|right.*arm/i, region: 'armR', role: 'Right upper arm', desc: 'Shoulder to elbow. Main motion for swings and gestures with the right arm.' },
  { match: /左.*ひじ|左.*肘|left.*elbow/i, region: 'armL', role: 'Left elbow', desc: 'Bends/extends the forearm relative to the upper arm.' },
  { match: /右.*ひじ|右.*肘|right.*elbow/i, region: 'armR', role: 'Right elbow', desc: 'Bends/extends the forearm relative to the upper arm.' },
  { match: /左.*手首|left.*wrist/i, region: 'armL', role: 'Left wrist', desc: 'Hand rotation, palm tilt.' },
  { match: /右.*手首|right.*wrist/i, region: 'armR', role: 'Right wrist', desc: 'Hand rotation, palm tilt.' },
  { match: /左.*手(?!首|袋)|left.*hand/i, region: 'armL', role: 'Left hand', desc: 'General hand motion; child bones are the fingers.' },
  { match: /右.*手(?!首|袋)|right.*hand/i, region: 'armR', role: 'Right hand', desc: 'General hand motion; child bones are the fingers.' },
  { match: /左.*指|left.*finger|親指.*左|人差.*左/i, region: 'finger', role: 'Left hand fingers', desc: 'Individual finger bending for grips and gestures.' },
  { match: /右.*指|right.*finger|親指.*右|人差.*右/i, region: 'finger', role: 'Right hand fingers', desc: 'Individual finger bending for grips and gestures.' },
  { match: /指|thumb/i, region: 'finger', role: 'Finger segment', desc: 'Finger bone — usually three per finger (根/中/先).' },
  { match: /左.*足(?!首|ＩＫ|IK)|left.*leg|left.*foot(?!.*ik)/i, region: 'legL', role: 'Left thigh / leg', desc: 'Upper leg from pelvis to knee. Walking, squatting, kicks.' },
  { match: /右.*足(?!首|ＩＫ|IK)|right.*leg|right.*foot(?!.*ik)/i, region: 'legR', role: 'Right thigh / leg', desc: 'Upper leg from pelvis to knee. Walking, squatting, kicks.' },
  { match: /左.*ひざ|左.*膝|left.*knee/i, region: 'legL', role: 'Left knee', desc: 'Bends/extends the lower leg.' },
  { match: /右.*ひざ|右.*膝|right.*knee/i, region: 'legR', role: 'Right knee', desc: 'Bends/extends the lower leg.' },
  { match: /左.*足首|left.*ankle/i, region: 'legL', role: 'Left ankle', desc: 'Foot rotation, toe up/down tilt.' },
  { match: /右.*足首|right.*ankle/i, region: 'legR', role: 'Right ankle', desc: 'Foot rotation, toe up/down tilt.' },
  { match: /左.*つま先|left.*toe/i, region: 'legL', role: 'Left toes', desc: 'Small toe motion for balance and walk detail.' },
  { match: /右.*つま先|right.*toe/i, region: 'legR', role: 'Right toes', desc: 'Small toe motion for balance and walk detail.' },
  { match: /左.*足ＩＫ|左.*足IK|leg.*ik.*l|foot.*ik.*l/i, region: 'ik', role: 'Left leg IK', desc: 'Inverse kinematics — sets foot position in space; the leg chain adjusts automatically.' },
  { match: /右.*足ＩＫ|右.*足IK|leg.*ik.*r|foot.*ik.*r/i, region: 'ik', role: 'Right leg IK', desc: 'Inverse kinematics — sets foot position in space; the leg chain adjusts automatically.' },
  { match: /左.*腕ＩＫ|左.*腕IK|arm.*ik.*l/i, region: 'ik', role: 'Left arm IK', desc: 'Sets hand position in space; elbow and shoulder follow.' },
  { match: /右.*腕ＩＫ|右.*腕IK|arm.*ik.*r/i, region: 'ik', role: 'Right arm IK', desc: 'Sets hand position in space; elbow and shoulder follow.' },
  { match: /ＩＫ|(?<![足腕])IK(?![足腕])/i, region: 'ik', role: 'IK target', desc: 'Inverse kinematics utility bone — end point of a limb chain.' },
  { match: /ネクタイ|tie|リボン|ribbon|スカート|skirt|チャ|受|捩|twist|補|欠|dumm/i, region: 'accessory', role: 'Accessory / helper', desc: 'Clothing or helper bone (skirt, ribbon, physics).' },
  { match: /左/i, region: 'armL', role: 'Left side', desc: 'Bone on the left side of the body or an accessory.' },
  { match: /右/i, region: 'armR', role: 'Right side', desc: 'Bone on the right side of the body or an accessory.' },
  ];

  function getBoneRegion(name) {
  if (/左/.test(name) && /足|脚|ひざ|足首|つま先|ＩＫ|IK/.test(name)) return 'legL';
  if (/右/.test(name) && /足|脚|ひざ|足首|つま先|ＩＫ|IK/.test(name)) return 'legR';
  if (/左/.test(name) && /腕|肩|手|指|ひじ|肘/.test(name)) return 'armL';
  if (/右/.test(name) && /腕|肩|手|指|ひじ|肘/.test(name)) return 'armR';
  if (/ＩＫ|IK/.test(name)) return 'ik';
  if (/目|眼|眉|口|唇|頭|首|歯|舌|照|凉/.test(name)) return 'head';
  if (/指/.test(name)) return 'finger';
  if (/センター|グルーブ|腰|上半身|下半身|全て|mother/i.test(name)) {
    return /腰|上半身|下半身|グルーブ/i.test(name) ? 'spine' : 'root';
  }
  if (/ネクタイ|スカート|リボン|チャ|照|受|捩|補|欠|dumm/i.test(name)) return 'accessory';
  return 'other';
}

  function lookupBoneInfo(name) {
  for (const r of BONE_INFO_RULES) {
    if (r.match.test(name)) {
      return { role: r.role, desc: r.desc, region: r.region || getBoneRegion(name) };
    }
  }
  return {
    role: 'Skeleton bone',
    desc: 'Part of the model rig. Rotation deforms the mesh around the joint.',
    region: getBoneRegion(name),
  };
}

  function getBoneTreeRoots() {
  if (!BONE.anatomy) return getBoneNames().slice(0, 1);
  const roots = BONE.anatomy.order.filter(n => !BONE.anatomy.parentOf[n]);
  return roots.length ? roots : getBoneNames().slice(0, 1);
}

  function boneTreeMatchesFilter(name, filter) {
  if (!filter) return true;
  const f = filter.toLowerCase();
  const info = lookupBoneInfo(name);
  return name.toLowerCase().includes(f)
    || info.role.toLowerCase().includes(f)
    || info.desc.toLowerCase().includes(f)
    || (BONE_REGION_LABELS[info.region] || '').toLowerCase().includes(f);
}

  function buildBoneTreeHtml(name, depth, filter) {
  const children = BONE.anatomy?.childOf?.[name] || [];
  const info = lookupBoneInfo(name);
  const hasChildren = children.length > 0;
  const filterActive = !!filter;
  const expanded = filterActive || !boneTreeCollapsed.has(name);
  const childParts = children.map(c => buildBoneTreeHtml(c, depth + 1, filter)).filter(Boolean);
  const selfMatch = boneTreeMatchesFilter(name, filter);
  if (filter && !selfMatch && childParts.length === 0) return '';

  const icon = BONE_REGION_ICONS[info.region] || '🦴';
  const sel = name === BONE.selected ? ' sel' : '';
  const key = boneHasAnyKey(name) ? ' has-key' : '';
  const toggleCls = hasChildren ? '' : ' empty';
  const toggleChar = expanded ? '▼' : '▶';
  const childBlock = hasChildren
    ? `<div class="be-children${expanded ? '' : ' collapsed'}">${childParts.join('')}</div>`
    : '';

  return `<div class="be-node" data-bone="${escapeHtml(name)}">
    <div class="be-row${sel}${key}" title="${escapeHtml(info.role)}">
      <span class="be-toggle${toggleCls}">${toggleChar}</span>
      <span class="be-icon">${icon}</span>
      <span class="be-name">${escapeHtml(name)}</span>
      <span class="be-role">${escapeHtml(info.role)}</span>
    </div>${childBlock}</div>`;
}

  function updateBoneDetailPanel() {
  const box = document.getElementById('boneDetail');
  if (!box) return;
  if (!BONE.selected) {
    box.innerHTML = '<div class="note" style="text-align:center;">Select a bone in the tree to see its role and connections</div>';
    return;
  }
  const name = BONE.selected;
  const info = lookupBoneInfo(name);
  const parent = BONE.anatomy?.parentOf?.[name];
  const children = BONE.anatomy?.childOf?.[name] || [];
  const chain = getAnatomyChainToRoot(name);
  const regionLbl = BONE_REGION_LABELS[info.region] || info.region;
  let html = `<div class="be-d-name">${escapeHtml(name)}</div>`;
  html += `<div class="be-d-role">${escapeHtml(regionLbl)} · ${escapeHtml(info.role)}</div>`;
  html += `<div class="be-d-desc">${escapeHtml(info.desc)}</div>`;
  html += '<div class="be-d-meta">';
  html += parent
    ? `↑ Parent: <span style="color:#aaa;">${escapeHtml(parent)}</span><br>`
    : '↑ Parent: <span style="color:#666;">none (root)</span><br>';
  if (children.length) {
    const shown = children.slice(0, 8).map(c => escapeHtml(c)).join(', ');
    const more = children.length > 8 ? ` … +${children.length - 8}` : '';
    html += `↓ Children (${children.length}): <span style="color:#aaa;">${shown}${more}</span><br>`;
  } else {
    html += '↓ Children: <span style="color:#666;">none (terminal bone)</span><br>';
  }
  html += `⛓ Chain to root: <span style="color:#888;">${chain.map(escapeHtml).join(' → ')}</span>`;
  if (boneHasAnyKey(name)) html += '<br>⭐ Has keyframe on timeline';
  html += '</div>';
  box.innerHTML = html;
}

  function scrollBoneTreeToSelection() {
  if (!BONE.selected) return;
  const node = document.querySelector(`#boneTree .be-node[data-bone="${CSS.escape(BONE.selected)}"] .be-row`);
  node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

  function refreshBoneExplorerUI() {
  const explorer = document.getElementById('boneExplorer');
  const tree = document.getElementById('boneTree');
  const stats = document.getElementById('boneExplorerStats');
  if (!explorer || !tree) return;

  const names = getBoneNames();
  if (stats) {
    if (!names.length) {
      stats.textContent = 'Load a model to explore the skeleton';
    } else {
      const roots = getBoneTreeRoots();
      stats.textContent = `${names.length} bones · ${roots.length} root${roots.length === 1 ? '' : 's'} · click to select in editor`;
    }
  }

  if (!names.length) {
    tree.innerHTML = '<div class="note" style="padding:12px;text-align:center;color:#666;">No skeleton</div>';
    updateBoneDetailPanel();
    return;
  }

  const filter = BONE.filter || '';
  const roots = getBoneTreeRoots();
  tree.innerHTML = roots.map(r => buildBoneTreeHtml(r, 0, filter)).join('') || '<div class="note" style="padding:12px;text-align:center;color:#666;">No matches</div>';
  updateBoneDetailPanel();
  if (BONE.selected) scrollBoneTreeToSelection();
}

  function syncBoneExplorerSelection() {
  const explorer = document.getElementById('boneExplorer');
  if (!explorer || explorer.classList.contains('hidden')) return;
  document.querySelectorAll('#boneTree .be-row').forEach(row => {
    const node = row.closest('.be-node');
    row.classList.toggle('sel', node?.dataset?.bone === BONE.selected);
  });
  updateBoneDetailPanel();
  scrollBoneTreeToSelection();
}

  function setBoneExplorerOpen(open) {
  const el = document.getElementById('boneExplorer');
  if (!el) return;
  const show = open ?? el.classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  if (show) refreshBoneExplorerUI();
}

  let boneVisualRoot = null;            // THREE.Group named 'VisualRig'
  const boneVisualMap = new Map();      // boneName -> { joint, pick, jointMat, bone, baseR }
  const boneVisualLines = [];           // { line, geo, fromBone, toBone }
  let boneVisualScale = 0.05;
  let _rigHoverName = null;
  // Deform W-bone pairs: { w: THREE.Bone (e.g. 右腕W), base: THREE.Bone (右腕) }.
  // The skin + capsules are bound to the W bones; MMD drives them from the base
  // bones via grant/append. We replicate that during manual posing.
  let wBonePairs = [];

  // Cascadeur-style rig: standard humanoid joints -> candidate PMX/English bone
  // names (first match wins). The upper-arm bone (左腕/右腕) is preferred over the
  // collar bone (左肩/右肩) as the selectable "shoulder" joint because rotating it
  // is what actually poses the arm.
  const RIG_JOINTS = [
    { id: 'hips',      aliases: ['下半身', 'センター', 'hips', 'pelvis', 'lower body'] },
    { id: 'spine',     aliases: ['上半身2', '上半身', 'spine', 'chest', 'upper body'] },
    { id: 'neck',      aliases: ['首', 'neck'] },
    { id: 'head',      aliases: ['頭', 'head'] },
    { id: 'collarL',   aliases: ['左肩', 'shoulder_L', 'left shoulder'] },
    { id: 'shoulderL', aliases: ['左腕', 'arm_L', 'left arm'] },
    { id: 'elbowL',    aliases: ['左ひじ', '左肘', 'elbow_L', 'left elbow'] },
    { id: 'wristL',    aliases: ['左手首', 'wrist_L', 'left wrist'] },
    { id: 'collarR',   aliases: ['右肩', 'shoulder_R', 'right shoulder'] },
    { id: 'shoulderR', aliases: ['右腕', 'arm_R', 'right arm'] },
    { id: 'elbowR',    aliases: ['右ひじ', '右肘', 'elbow_R', 'right elbow'] },
    { id: 'wristR',    aliases: ['右手首', 'wrist_R', 'right wrist'] },
    { id: 'hipL',      aliases: ['左足', 'leg_L', 'left leg'] },
    { id: 'kneeL',     aliases: ['左ひざ', '左膝', 'knee_L', 'left knee'] },
    { id: 'ankleL',    aliases: ['左足首', 'ankle_L', 'left ankle'] },
    { id: 'toeL',      aliases: ['左つま先', '左足先EX', 'toe_L', 'left toe'] },
    { id: 'hipR',      aliases: ['右足', 'leg_R', 'right leg'] },
    { id: 'kneeR',     aliases: ['右ひざ', '右膝', 'knee_R', 'right knee'] },
    { id: 'ankleR',    aliases: ['右足首', 'ankle_R', 'right ankle'] },
    { id: 'toeR',      aliases: ['右つま先', '右足先EX', 'toe_R', 'right toe'] },
  ];
  // Ordered anchor chains. Bones *between* two consecutive anchors (twist bones
  // 腕捩/手捩, deform bones, etc.) are auto-included by walking the real skeleton
  // hierarchy, so the rig "connects all sub-bones in the limbs".
  const RIG_CHAINS = [
    ['hips', 'spine', 'neck', 'head'],
    ['spine', 'collarL', 'shoulderL', 'elbowL', 'wristL'],
    ['spine', 'collarR', 'shoulderR', 'elbowR', 'wristR'],
    ['hips', 'hipL', 'kneeL', 'ankleL', 'toeL'],
    ['hips', 'hipR', 'kneeR', 'ankleR', 'toeR'],
  ];
  const RIG_COLOR = {
    base: 0x35d07f,   // clean Cascadeur green
    hover: 0xff8a3d,  // orange highlight on hover
    sel: 0xffd23d,    // yellow selected
    line: 0x2f8f5b,   // muted green connectors
  };
  const boneGizmoProxy = new THREE.Object3D();
  boneGizmoProxy.name = 'boneGizmoProxy';
  getScene().add(boneGizmoProxy);

  let _bonePickSuppressUntil = 0;
  let _bonePickPointer = null;
  let _boneTransformRaf = 0;

  const BONE_VIS = {
  matPick: null,
  jointGeo: null,
  pickGeo: null,
  lineMat: null,
};

  const _boneQ = new THREE.Quaternion();
  const _boneQa = new THREE.Quaternion();
  const _boneQb = new THREE.Quaternion();
  const _boneQc = new THREE.Quaternion();
  const _boneQd = new THREE.Quaternion();
  const _boneEuler = new THREE.Euler();
  const _boneVec = new THREE.Vector3();
  const _boneVec2 = new THREE.Vector3();
  const _boneVec3 = new THREE.Vector3();
  const _boneMat = new THREE.Matrix4();
  const _ndc = new THREE.Vector2();
  const _ray = new THREE.Raycaster();

  const BONE_LIMIT_RULES = [
  { match: /センター|全ての親|mother/i, max: 26 },
  { match: /グルーブ|腰/i, max: 30 },
  { match: /上半身2/i, max: 36 },
  { match: /上半身/i, max: 40 },
  { match: /首|neck/i, max: 44 },
  { match: /頭|head/i, max: 50 },
  { match: /肩/i, max: 75 },
  { match: /ひじ|肘/i, max: 118 },
  { match: /手首|手|指/i, max: 62 },
  { match: /腕/i, max: 88 },
  { match: /ひざ|膝/i, max: 108 },
  { match: /足首|つま先|ＩＫ|IK/i, max: 45 },
  { match: /足/i, max: 68 },
  { match: /.*/, max: 72 },
  ];
  const BONE_TRANSLATE_HINT = /センター|グルーブ|ＩＫ|IK|全ての親|mother/i;

  function clearBoneSystem() {
  BONE.selected = null;
  BONE.keys = [];
  BONE.restPose = {};
  BONE.time = 0;
  BONE.playing = false;
  BONE.modelKey = '';
  BONE.dragSnapshot = null;
  wBonePairs = [];
  _poseGrantMesh = null;
  _poseCorrMesh = null;
  updateSkeletonHelper();
  refreshBoneListUI();
  refreshBoneTimelineUI();
  refreshBonePropsUI();
  refreshBoneExplorerUI();
}

  function initBoneSystem(mesh, modelName = '') {
  BONE.keys = [];
  BONE.time = 0;
  BONE.playing = false;
  BONE.restPose = {};
  BONE.selected = null;
  BONE.modelKey = modelName || 'model';
  if (!mesh?.skeleton) {
    refreshBoneListUI();
    refreshBoneExplorerUI();
    return;
  }
  mesh.skeleton.bones.forEach(b => {
    BONE.restPose[b.name] = {
      q: b.quaternion.toArray(),
      p: b.position.toArray(),
    };
  });
  buildBoneAnatomy(mesh);
  loadBoneAnimSaved();
  refreshBoneListUI();
  refreshBoneTimelineUI();
  refreshBonePropsUI();
  buildBonePresetButtons();
  boneTreeCollapsed.clear();
  refreshBoneExplorerUI();
}

  function buildBonePresetButtons() {
  const box = document.getElementById('bonePresets');
  if (!box) return;
  box.innerHTML = '';
  BONE_PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = p.label;
    btn.title = p.match;
    btn.onclick = () => selectBoneByMatch(p.match);
    box.appendChild(btn);
  });
}

  function selectBoneByMatch(fragment) {
  if (!currentMesh?.skeleton) return;
  const bone = currentMesh.skeleton.bones.find(b => b.name.includes(fragment));
  if (bone) selectBone(bone.name);
  else showError('Bone not found: ' + fragment);
}

  function getBoneNames() {
  if (!currentMesh?.skeleton) return [];
  return currentMesh.skeleton.bones.map(b => b.name);
}

  function boneHasAnyKey(name) {
  return BONE.keys.some(k => k.pose[name]);
}

  function refreshBoneListUI() {
  const list = document.getElementById('boneList');
  if (!list) return;
  const names = getBoneNames();
  const f = (BONE.filter || '').toLowerCase();
  list.innerHTML = '';
  if (names.length === 0) {
    list.innerHTML = '<div class="note" style="padding:8px;text-align:center;">Load a model first</div>';
    return;
  }
  names.filter(n => !f || n.toLowerCase().includes(f)).forEach(name => {
    const div = document.createElement('div');
    div.className = 'bone-item' + (name === BONE.selected ? ' sel' : '') + (boneHasAnyKey(name) ? ' has-key' : '');
    div.textContent = name;
    div.onclick = () => selectBone(name, false);
    list.appendChild(div);
  });
}

  function refreshBoneTimelineUI() {
  const dur = BONE.duration;
  const lbl = document.getElementById('boneTimeLbl');
  if (lbl) lbl.textContent = `${BONE.time.toFixed(2)} / ${dur.toFixed(2)} s · ${BONE.keys.length} keys`;
  const marker = document.getElementById('boneMarker');
  if (marker) marker.style.left = (Math.max(0, Math.min(1, BONE.time / dur)) * 100) + '%';
  const ticks = document.getElementById('boneKeyTicks');
  if (ticks) {
    ticks.innerHTML = '';
    BONE.keys.forEach(k => {
      const t = document.createElement('div');
      t.className = 'bone-tl-key';
      t.style.left = (Math.max(0, Math.min(1, k.t / dur)) * 100) + '%';
      ticks.appendChild(t);
    });
  }
}

  function selectBone(name, fromViewport = false) {
  if (!name) return;
  if (fromViewport && !canPickBoneNow()) return;
  BONE.selected = name;
  refreshBoneListUI();
  refreshBonePropsUI();
  refreshSceneTransformAttach();
  updateSkeletonHelper();
  updatePremiumBoneVisuals();
  suggestBoneTransformMode(name);
  syncBoneExplorerSelection();
}

  function getBoneByName(name) {
  return currentMesh?.skeleton?.getBoneByName(name) || null;
}

  function setBoneTransformMode(mode) {
  BONE.transformMode = mode;
  getTransformControls().setMode(mode);
  ['btnBoneMove', 'btnBoneRot', 'btnBoneScale'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active',
      (id === 'btnBoneMove' && mode === 'translate') ||
      (id === 'btnBoneRot' && mode === 'rotate') ||
      (id === 'btnBoneScale' && mode === 'scale'));
  });
}

  function setBoneSpace(local) {
  BONE.space = local ? 'local' : 'world';
  getTransformControls().space = BONE.space;
  const btn = document.getElementById('btnBoneLocal');
  if (btn) {
    btn.classList.toggle('active', local);
    btn.textContent = local ? 'Local' : 'World';
  }
}

  function suggestBoneTransformMode(name) {
  if (!name) return;
  if (BONE_TRANSLATE_HINT.test(name)) setBoneTransformMode('translate');
  else if (BONE.transformMode === 'translate') setBoneTransformMode('rotate');
}

  function snapshotAllBones() {
  const snap = {};
  if (!currentMesh?.skeleton) return snap;
  currentMesh.updateMatrixWorld(true);
  for (const b of currentMesh.skeleton.bones) {
    b.updateWorldMatrix(true, false);
    snap[b.name] = {
      quaternion: b.quaternion.toArray(),
      position: b.position.toArray(),
      scale: b.scale.toArray(),
      worldPos: b.getWorldPosition(new THREE.Vector3()).toArray(),
    };
  }
  return snap;
}

  function storeBoneDragSnapshot() {
  BONE.dragSnapshot = snapshotAllBones();
}

  function getMirrorBoneName(name) {
  if (!name) return null;
  if (name.includes('左')) return name.replace(/左/g, '右');
  if (name.includes('右')) return name.replace(/右/g, '左');
  return null;
}

  function mirrorQuaternion(sourceQ, outQ) {
  _boneEuler.setFromQuaternion(sourceQ, 'YXZ');
  outQ.setFromEuler(new THREE.Euler(_boneEuler.x, -_boneEuler.y, -_boneEuler.z, 'YXZ'));
  return outQ;
}

  function buildBoneAnatomy(mesh) {
  BONE.anatomy = { parentOf: {}, childOf: {}, order: [] };
  if (!mesh?.skeleton) return;
  for (const b of mesh.skeleton.bones) {
    BONE.anatomy.order.push(b.name);
    const pn = (b.parent?.isBone && b.parent.name) ? b.parent.name : null;
    BONE.anatomy.parentOf[b.name] = pn;
    BONE.anatomy.childOf[b.name] = b.children
      .filter(c => c.isBone && c.name)
      .map(c => c.name);
  }
  buildWBonePairs(mesh);
}

  // Detect deform W-bones (name ends in ASCII 'W' or full-width 'Ｗ') that have a
  // matching base bone, e.g. 右腕W <- 右腕. Cached so we don't rescan every frame.
  function buildWBonePairs(mesh) {
  wBonePairs = [];
  if (!mesh?.skeleton) return;
  const byName = new Map();
  for (const b of mesh.skeleton.bones) byName.set(b.name, b);
  for (const b of mesh.skeleton.bones) {
    const n = b.name;
    if (!/[WＷ]$/.test(n)) continue;
    const base = byName.get(n.slice(0, -1));
    if (!base || base === b) continue;
    // Parallel W chain (W's parent is another W / shared ancestor): grant copies
    // the local rotation 1:1. If the W bone is a direct child of its base, the
    // hierarchy already carries the rotation, so mirroring would double it.
    if (b.parent === base) continue;
    wBonePairs.push({ w: b, base });
  }
}

  let _poseGrantSolver = null;
  let _poseGrantMesh = null;
  let _poseCorrIks = null;
  let _poseCorrMesh = null;

  // The model's real MMD grant/append solver (knows exact parent index + ratio +
  // each bone's bind orientation). Far more correct than a name-based guess.
  function getPoseGrantSolver() {
  if (!currentMesh) return null;
  const grants = currentMesh.geometry?.userData?.MMD?.grants;
  if (!grants || grants.length === 0) return null;
  if (_poseGrantMesh !== currentMesh) {
    _poseGrantSolver = animHelper.createGrantSolver(currentMesh);
    _poseGrantMesh = currentMesh;
  }
  return _poseGrantSolver;
}

  // Corrective IK chains that position deform bones (e.g. 右腕W, 右ひじW driven by
  // 右腕IK). On heavily-rigged models the mesh follows these IK-driven bones, so we
  // must solve them during manual posing. We deliberately EXCLUDE the foot/leg IK
  // (足ＩＫ / つま先ＩＫ) so FK leg posing isn't fought by it.
  const _FOOT_IK_NAME = /足ＩＫ|足IK|つま先ＩＫ|つま先IK|leg.?ik|toe.?ik|foot.?ik/i;

  function getCorrectiveIkSolver() {
  if (!currentMesh) return null;
  const solver = animHelper.objects.get(currentMesh)?.ikSolver;
  if (!solver?.iks?.length) return null;
  if (_poseCorrMesh !== currentMesh) {
    const bones = currentMesh.skeleton.bones;
    _poseCorrIks = solver.iks.filter(ik => {
      const names = [bones[ik.effector]?.name, bones[ik.target]?.name,
        ...ik.links.map(l => bones[l.index]?.name)];
      return !names.some(n => n && _FOOT_IK_NAME.test(n));
    });
    _poseCorrMesh = currentMesh;
  }
  return { solver, iks: _poseCorrIks };
}

  // Drive append/grant-bones (e.g. 右腕W carrying skin + capsule) from the manually
  // posed source bones, exactly as playback does. addGrantRotation() multiplies
  // onto the bone, so grant-driven bones are first reset to their rest rotation to
  // avoid accumulating every frame. Falls back to a name-based W mirror if the
  // model exposes no grant data.
  function applyDeformWBones() {
  const gs = getPoseGrantSolver();
  if (gs) {
    const bones = currentMesh.skeleton.bones;
    // Reset grant-driven bones to rest first (addGrantRotation multiplies on),
    // then re-apply grant. Skip the bone the user is editing so we never clobber
    // a directly-posed bone that also happens to be grant-driven.
    for (const g of gs.grants) {
      if (g.isLocal || !g.affectRotation) continue;
      const bone = bones[g.index];
      if (!bone || bone.name === BONE.selected) continue;
      const rest = BONE.restPose[bone.name];
      const rq = Array.isArray(rest) ? rest : rest?.q;
      if (rq) bone.quaternion.fromArray(rq);
    }
    for (const g of gs.grants) {
      if (g.isLocal || !g.affectRotation) continue;
      if (bones[g.index]?.name === BONE.selected) continue;
      gs.updateOne(g);
    }
    // Then solve the corrective IK that positions the skin-deform bones.
    applyCorrectiveIk();
    return;
  }
  if (wBonePairs.length === 0) return;
  const sel = BONE.selected;
  for (const { w, base } of wBonePairs) {
    if (w.name === sel) base.quaternion.copy(w.quaternion);
    else w.quaternion.copy(base.quaternion);
  }
}

  // Reset the corrective-IK link bones to rest, then re-solve those IK chains so
  // the deform bones (which carry the skin) point at their targets again. IK is
  // idempotent (solves toward the current target), so this is safe per frame.
  function applyCorrectiveIk() {
  const corr = getCorrectiveIkSolver();
  if (!corr || corr.iks.length === 0) return;
  const bones = currentMesh.skeleton.bones;
  for (const ik of corr.iks) {
    for (const l of ik.links) {
      const b = bones[l.index];
      if (!b || b.name === BONE.selected) continue;
      const rest = BONE.restPose[b.name];
      const rq = Array.isArray(rest) ? rest : rest?.q;
      if (rq) b.quaternion.fromArray(rq);
    }
  }
  currentMesh.updateMatrixWorld(true);
  for (const ik of corr.iks) corr.solver.updateOne(ik);
}

  function getBoneLimitRad(name) {
  let maxDeg = 72;
  for (const r of BONE_LIMIT_RULES) {
    if (r.match.test(name)) { maxDeg = r.max; break; }
  }
  const scale = 0.58 + BONE.autoPoseStrength * 0.42;
  return THREE.MathUtils.degToRad(maxDeg * scale);
}

  function clampBoneRotationFromRest(boneName) {
  const bone = getBoneByName(boneName);
  const rest = BONE.restPose[boneName];
  if (!bone || !rest) return;
  const restQ = Array.isArray(rest) ? rest : rest.q;
  if (!restQ) return;
  _boneQa.fromArray(restQ);
  _boneQc.copy(_boneQa).invert().multiply(bone.quaternion);
  _boneEuler.setFromQuaternion(_boneQc, 'YXZ');
  const max = getBoneLimitRad(boneName);
  const maxZ = max * 0.82;
  _boneEuler.x = THREE.MathUtils.clamp(_boneEuler.x, -max, max);
  _boneEuler.y = THREE.MathUtils.clamp(_boneEuler.y, -max, max);
  _boneEuler.z = THREE.MathUtils.clamp(_boneEuler.z, -maxZ, maxZ);
  _boneQd.setFromEuler(_boneEuler);
  bone.quaternion.copy(_boneQa).multiply(_boneQd);
  if (!Number.isFinite(bone.quaternion.x)) bone.quaternion.fromArray(restQ);
}

  function getAnatomyChainToRoot(name) {
  const chain = [];
  let n = name;
  const seen = new Set();
  while (n && !seen.has(n)) {
    seen.add(n);
    chain.push(n);
    n = BONE.anatomy?.parentOf?.[n] || null;
  }
  return chain;
}

  function getAnatomySubtree(name) {
  const out = [];
  const stack = [name];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    for (const c of (BONE.anatomy?.childOf?.[n] || [])) stack.push(c);
  }
  return out;
}

  function enforceAnatomyOnChain(changedName) {
  const affected = new Set([
    ...getAnatomyChainToRoot(changedName),
    ...getAnatomySubtree(changedName),
  ]);
  for (const n of affected) clampBoneRotationFromRest(n);
}

  function applyLinkedBoneAutoPose(changedName, snap, deltaQ, baseStrength) {
  let parentName = BONE.anatomy?.parentOf?.[changedName];
  let str = baseStrength * 0.38;
  let depth = 0;
  while (parentName && str > 0.018 && depth < 28) {
    const parent = getBoneByName(parentName);
    const pSnap = snap[parentName];
    if (parent && pSnap) {
      _boneQa.fromArray(pSnap.quaternion);
      parent.quaternion.copy(_boneQa).multiply(
        _boneQb.slerpQuaternions(new THREE.Quaternion(), deltaQ, str)
      );
      clampBoneRotationFromRest(parentName);
    }
    parentName = BONE.anatomy?.parentOf?.[parentName];
    str *= 0.54;
    depth++;
  }
}

  function applyFootPlant(changedName, snap) {
  if (!/センター|グルーブ|腰/i.test(changedName)) return;
  if (BONE.transformMode !== 'translate') return;
  const root = getBoneByName(changedName);
  const rSnap = snap[changedName];
  if (!root || !rSnap) return;
  const delta = [
    root.position.x - rSnap.position[0],
    root.position.y - rSnap.position[1],
    root.position.z - rSnap.position[2],
  ];
  if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) < 1e-6) return;
  const pull = BONE.autoPoseStrength * 0.88;
  for (const n of ['左足ＩＫ', '右足ＩＫ', '左足首', '右足首', '左つま先', '右つま先']) {
    const ik = getBoneByName(n);
    const is = snap[n];
    if (!ik || !is) continue;
    ik.position.set(
      is.position[0] - delta[0] * pull,
      is.position[1] - delta[1] * pull,
      is.position[2] - delta[2] * pull
    );
  }
}

  function applyBoneMirrorPose(changedName, snap) {
  const mirrorName = getMirrorBoneName(changedName);
  if (!mirrorName) return;
  const src = getBoneByName(changedName);
  const dst = getBoneByName(mirrorName);
  const srcSnap = snap[changedName];
  const dstSnap = snap[mirrorName];
  if (!src || !dst || !srcSnap || !dstSnap) return;
  _boneQa.fromArray(srcSnap.quaternion).invert().multiply(src.quaternion);
  mirrorQuaternion(_boneQa, _boneQb);
  _boneQc.fromArray(dstSnap.quaternion).multiply(_boneQb);
  dst.quaternion.copy(_boneQc);
  if (BONE.transformMode === 'translate') {
    const dp = [
      src.position.x - srcSnap.position[0],
      src.position.y - srcSnap.position[1],
      src.position.z - srcSnap.position[2],
    ];
    dst.position.set(
      dstSnap.position[0] + dp[0],
      dstSnap.position[1] - dp[1],
      dstSnap.position[2] - dp[2]
    );
  }
}

  function applyAutoPoseAdjust(changedName) {
  if (!BONE.autoPose || !BONE.dragSnapshot || !changedName) return;
  const snap = BONE.dragSnapshot;
  const bone = getBoneByName(changedName);
  const bSnap = snap[changedName];
  if (!bone || !bSnap) return;

  clampBoneRotationFromRest(changedName);

  _boneQa.fromArray(bSnap.quaternion);
  _boneQc.copy(_boneQa).invert().multiply(bone.quaternion);

  applyLinkedBoneAutoPose(changedName, snap, _boneQc, BONE.autoPoseStrength);
  applyFootPlant(changedName, snap);
  if (BONE.mirrorPose) applyBoneMirrorPose(changedName, snap);
  enforceAnatomyOnChain(changedName);
}

  function onBoneTransformChanged(finalize = false) {
  if (!currentMesh?.skeleton || !BONE.selected) return;
  applyBoneGizmoProxyToBone();
  if (BONE.autoPose) applyAutoPoseAdjust(BONE.selected);
  else {
    clampBoneRotationFromRest(BONE.selected);
    for (const c of getAnatomySubtree(BONE.selected)) {
      if (c !== BONE.selected) clampBoneRotationFromRest(c);
    }
  }
  // Drive the skin/capsule W-bones from the posed base bones (MMD append).
  applyDeformWBones();
  currentMesh.skeleton.update();
  // Keep limb capsules glued to the bones we just posed so dynamic colliders on
  // W-bone PMX models don't drift off-axis.
  if (getS()?.physics && ammoReady && !ammoPhysicsBroken) {
    syncLimbCollidersFromBones(currentMesh);
  }
  if (finalize) {
    refreshBonePropsUI();
    updatePremiumBoneVisuals();
    if (BONE.autoKey) addBoneKeyframe(false);
    saveBoneAnim();
  }
}

  function refreshBonePropsUI() {
  const box = document.getElementById('boneProps');
  if (!box) return;
  const bone = BONE.selected ? getBoneByName(BONE.selected) : null;
  if (!bone) {
    box.innerHTML = '<div class="note" style="text-align:center;padding:4px;">Select a bone to edit X/Y/Z in 3D</div>';
    return;
  }
  const fmt = (v, d = 3) => Number.isFinite(v) ? v.toFixed(d) : '0';
  const p = bone.position, r = bone.rotation, s = bone.scale;
  const rx = THREE.MathUtils.radToDeg(r.x), ry = THREE.MathUtils.radToDeg(r.y), rz = THREE.MathUtils.radToDeg(r.z);
  let html = `<div style="font-size:11px;color:#c9a0ff;margin-bottom:4px;">${escapeHtml(bone.name)}</div>`;
  html += `<div class="note" style="margin-bottom:4px;">Position (local)</div>`;
  ['x', 'y', 'z'].forEach(ax => {
    html += `<div class="axis-row"><label>${ax.toUpperCase()}</label><input type="number" step="0.01" data-bone-prop="pos-${ax}" value="${fmt(p[ax])}"></div>`;
  });
  html += `<div class="note" style="margin:6px 0 4px;">Rotation ° (local)</div>`;
  ['x', 'y', 'z'].forEach(ax => {
    const val = ax === 'x' ? rx : ax === 'y' ? ry : rz;
    html += `<div class="axis-row"><label>${ax.toUpperCase()}</label><input type="number" step="0.5" data-bone-prop="rot-${ax}" value="${fmt(val, 1)}"></div>`;
  });
  html += `<div class="note" style="margin:6px 0 4px;">Scale</div>`;
  ['x', 'y', 'z'].forEach(ax => {
    html += `<div class="axis-row"><label>${ax.toUpperCase()}</label><input type="number" step="0.01" min="0.01" data-bone-prop="scl-${ax}" value="${fmt(s[ax])}"></div>`;
  });
  box.innerHTML = html;
  box.querySelectorAll('input[data-bone-prop]').forEach(inp => {
    inp.addEventListener('change', () => applyBonePropInput(inp));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
}

  function applyBonePropInput(inp) {
  const bone = BONE.selected ? getBoneByName(BONE.selected) : null;
  if (!bone || !inp.dataset.boneProp) return;
  storeBoneDragSnapshot();
  const [kind, axis] = inp.dataset.boneProp.split('-');
  const v = parseFloat(inp.value);
  if (!Number.isFinite(v)) return;
  if (kind === 'pos') bone.position[axis] = v;
  else if (kind === 'rot') bone.rotation[axis] = THREE.MathUtils.degToRad(v);
  else if (kind === 'scl') bone.scale[axis] = Math.max(0.01, v);
  onBoneTransformChanged(true);
  syncBoneGizmoProxyFromBone();
}

  function pickBoneFromEvent(e) {
  if (!currentMesh?.skeleton || !canPickBoneNow()) return null;
  if (_bonePickPointer?.moved) return null;
  const renderer = getRenderer();
  const camera = getCamera();
  if (!renderer?.domElement || !camera) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  _ray.setFromCamera(_ndc, camera);

  if (boneVisualRoot?.visible) {
    const pickables = [];
    boneVisualMap.forEach(v => { if (v.pick) pickables.push(v.pick); });
    const hits = _ray.intersectObjects(pickables, false);
    hits.sort((a, b) => a.distance - b.distance);
    for (const h of hits) {
      const name = h.object.userData?.boneName;
      if (name) return name;
    }
    return null;
  }

  currentMesh.updateMatrixWorld(true);
  const hits = _ray.intersectObject(currentMesh, true);
  let refPoint = hits.length ? hits[0].point : (_ray.ray.at(10, _boneVec), _boneVec);
  let bestName = null, bestScore = Infinity;
  for (const b of currentMesh.skeleton.bones) {
    b.getWorldPosition(_boneVec2);
    const dist3d = _boneVec2.distanceToSquared(refPoint);
    _boneVec.copy(_boneVec2).project(camera);
    const sx = (_boneVec.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-_boneVec.y * 0.5 + 0.5) * rect.height + rect.top;
    const dist2d = (sx - e.clientX) ** 2 + (sy - e.clientY) ** 2;
    const score = dist2d * 0.55 + dist3d * 6;
    if (score < bestScore) { bestScore = score; bestName = b.name; }
  }
  return bestName;
}

  function snapshotBonePose(names = null) {
  const pose = {};
  if (!currentMesh?.skeleton) return pose;
  for (const b of currentMesh.skeleton.bones) {
    if (names && !names.includes(b.name)) continue;
    pose[b.name] = b.quaternion.toArray();
  }
  return pose;
}

  function addBoneKeyframe(fullPose) {
  if (!currentMesh?.skeleton) { showError('Load a model first.'); return; }
  animPlaying = false;
  const t = BONE.time;
  const pose = fullPose ? snapshotBonePose() : (BONE.selected ? snapshotBonePose([BONE.selected]) : snapshotBonePose());
  const idx = BONE.keys.findIndex(k => Math.abs(k.t - t) < 0.06);
  if (idx >= 0) {
    BONE.keys[idx].pose = { ...BONE.keys[idx].pose, ...pose };
  } else {
    BONE.keys.push({ t, pose });
    BONE.keys.sort((a, b) => a.t - b.t);
  }
  refreshBoneListUI();
  refreshBoneTimelineUI();
  saveBoneAnim();
}

  function applyRestPose() {
  if (!currentMesh?.skeleton) return;
  for (const b of currentMesh.skeleton.bones) {
    const r = BONE.restPose[b.name];
    if (!r) continue;
    if (Array.isArray(r)) b.quaternion.fromArray(r);
    else {
      if (r.q) b.quaternion.fromArray(r.q);
      if (r.p) b.position.fromArray(r.p);
    }
  }
  currentMesh.skeleton.update();
}

  function sampleBoneQuaternion(boneName, t) {
  const keyed = BONE.keys.filter(k => k.pose[boneName]).sort((a, b) => a.t - b.t);
  if (keyed.length === 0) return null;
  if (t <= keyed[0].t) return _boneQ.fromArray(keyed[0].pose[boneName]);
  if (t >= keyed[keyed.length - 1].t) return _boneQ.fromArray(keyed[keyed.length - 1].pose[boneName]);
  let i = 0;
  while (i < keyed.length - 1 && keyed[i + 1].t < t) i++;
  const k0 = keyed[i], k1 = keyed[i + 1];
  const u = (t - k0.t) / Math.max(k1.t - k0.t, 0.0001);
  _boneQa.fromArray(k0.pose[boneName]);
  _boneQb.fromArray(k1.pose[boneName]);
  return _boneQa.slerp(_boneQb, u);
}

  function applyBoneAnimTime(t) {
  if (!currentMesh?.skeleton) return;
  applyRestPose();
  for (const b of currentMesh.skeleton.bones) {
    const q = sampleBoneQuaternion(b.name, t);
    if (q) b.quaternion.copy(q);
  }
  applyDeformWBones();
  currentMesh.skeleton.update();
}

  function seekBoneTime(t) {
  BONE.time = Math.max(0, Math.min(BONE.duration, t));
  applyBoneAnimTime(BONE.time);
  refreshBoneTimelineUI();
}

  function buildClipFromBoneKeys() {
  const tracks = [];
  const names = new Set();
  BONE.keys.forEach(k => Object.keys(k.pose).forEach(n => names.add(n)));
  for (const name of names) {
    const times = [];
    const values = [];
    for (const k of BONE.keys) {
      if (!k.pose[name]) continue;
      times.push(k.t);
      values.push(...k.pose[name]);
    }
    if (times.length === 0) continue;
    const bone = currentMesh.skeleton.getBoneByName(name);
    if (!bone) continue;
    const idx = currentMesh.skeleton.bones.indexOf(bone);
    tracks.push(new THREE.QuaternionKeyframeTrack(`.bones[${idx}].quaternion`, times, values));
  }
  return new THREE.AnimationClip('CustomBoneAnim', BONE.duration, tracks);
}

  function bakeBoneAnim() {
  if (!currentMesh?.skeleton) return;
  if (BONE.keys.length < 1) { showError('Add at least 1 keyframe first.'); return; }
  BONE.playing = false;
  animPlaying = false;
  const clip = buildClipFromBoneKeys();
  loadedAnims.push({ name: `Custom anim ${loadedAnims.length + 1}`, clip });
  refreshAnimList();
  playAnim(loadedAnims.length - 1);
  clearError();
}

  function saveBoneAnim() {
  try {
    const key = BONE_STORAGE_PREFIX + (BONE.modelKey || 'default');
    localStorage.setItem(key, JSON.stringify({ duration: BONE.duration, keys: BONE.keys }));
  } catch (_e) {}
}

  function loadBoneAnimSaved() {
  try {
    const key = BONE_STORAGE_PREFIX + (BONE.modelKey || 'default');
    const j = localStorage.getItem(key);
    if (!j) return;
    const data = JSON.parse(j);
    if (data.duration) BONE.duration = data.duration;
    if (Array.isArray(data.keys)) BONE.keys = data.keys;
    const v = document.getElementById('vBoneDur');
    const r = document.getElementById('rBoneDur');
    if (v) v.value = String(BONE.duration);
    if (r) r.value = BONE.duration;
  } catch (_e) {}
}

  function isBoneTransformTarget(obj) {
  return obj === boneGizmoProxy || !!obj?.isBone;
}

  function canPickBoneNow() {
  return !isTcDragging() && performance.now() >= _bonePickSuppressUntil;
}

  function suppressBonePick(ms = 320) {
  _bonePickSuppressUntil = performance.now() + ms;
}

  function syncBoneGizmoProxyFromBone() {
  const bone = BONE.selected ? getBoneByName(BONE.selected) : null;
  if (!bone) return;
  bone.updateWorldMatrix(true, false);
  boneGizmoProxy.matrix.copy(bone.matrixWorld);
  boneGizmoProxy.matrix.decompose(boneGizmoProxy.position, boneGizmoProxy.quaternion, boneGizmoProxy.scale);
  boneGizmoProxy.scale.set(1, 1, 1);
}

  function applyBoneGizmoProxyToBone() {
  const bone = BONE.selected ? getBoneByName(BONE.selected) : null;
  if (!bone?.parent) return;
  bone.parent.updateWorldMatrix(true, false);
  _boneMat.copy(bone.parent.matrixWorld).invert().multiply(boneGizmoProxy.matrix);
  _boneMat.decompose(_boneVec, _boneQa, _boneVec2);
  const mode = BONE.transformMode || 'rotate';
  if (mode === 'translate') {
    if (Number.isFinite(_boneVec.x)) bone.position.copy(_boneVec);
  } else if (mode === 'scale') {
    if (Number.isFinite(_boneVec2.x)) {
      bone.scale.set(
        Math.max(0.01, _boneVec2.x),
        Math.max(0.01, _boneVec2.y),
        Math.max(0.01, _boneVec2.z),
      );
    }
  } else if (Number.isFinite(_boneQa.x)) {
    bone.quaternion.copy(_boneQa);
  }
}

  function sanitizeGeometryMorphAttributes(geometry) {
  if (!geometry) return;
  const ma = geometry.morphAttributes;
  if (ma) {
    for (const key of ['position', 'normal', 'color']) {
      const arr = ma[key];
      if (Array.isArray(arr) && arr.length === 0) delete ma[key];
    }
  }
  if (Array.isArray(geometry.morphTargets) && geometry.morphTargets.length === 0) {
    delete geometry.morphTargets;
  }
}

  function sanitizeMeshMorphAttributes(root) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry) sanitizeGeometryMorphAttributes(o.geometry);
  });
}

  function captureModelMaterials(mesh) {
  if (!mesh) return;
  sanitizeMeshMorphAttributes(mesh);
  mesh.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (m.userData._opacityCaptured) return;
      m.userData._origOpacity = m.opacity ?? 1;
      m.userData._origTransparent = !!m.transparent;
      m.userData._origDepthWrite = m.depthWrite !== false;
      m.userData._opacityCaptured = true;
    });
  });
}

  function applyModelOpacity(alpha) {
  if (!currentMesh) return;
  const a = Math.max(0.05, Math.min(1, alpha));
  BONE.modelOpacity = a;
  currentMesh.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      const orig = m.userData._origOpacity ?? 1;
      const out = orig * a;
      m.opacity = out;
      m.transparent = out < 0.995 || m.userData._origTransparent;
      m.depthWrite = out > 0.12 && (m.userData._origDepthWrite ?? true);
    });
  });
}

  function styleBoneVisualMaterials(vis, isSel, isHover) {
  const m = vis.jointMat;
  if (isSel) {
    m.color.setHex(RIG_COLOR.sel);
    m.opacity = 0.95;
  } else if (isHover) {
    m.color.setHex(RIG_COLOR.hover);
    m.opacity = 0.95;
  } else {
    m.color.setHex(RIG_COLOR.base);
    m.opacity = 0.85;
  }
}

  function ensureBoneVisAssets() {
  if (BONE_VIS.jointGeo) return;
  // Clean solid spheres (Cascadeur look) instead of dense wireframe icosahedrons.
  BONE_VIS.jointGeo = new THREE.SphereGeometry(1, 16, 12);
  BONE_VIS.pickGeo = new THREE.SphereGeometry(1, 8, 6);
  BONE_VIS.lineMat = new THREE.LineBasicMaterial({
    color: RIG_COLOR.line,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
    depthWrite: false,
  });
  BONE_VIS.matPick = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.001,
    depthWrite: false,
    depthTest: false,
  });
}

  function disposeBoneVisuals() {
  if (boneVisualRoot) {
    getScene().remove(boneVisualRoot);
    boneVisualRoot.traverse(o => {
      if (o.material && o.material !== BONE_VIS.lineMat && o.material !== BONE_VIS.matPick && o.material.dispose) {
        o.material.dispose();
      }
      if (o.geometry && o.geometry !== BONE_VIS.jointGeo && o.geometry !== BONE_VIS.pickGeo) {
        o.geometry.dispose();
      }
    });
    boneVisualRoot = null;
  }
  boneVisualMap.clear();
  boneVisualLines.length = 0;
  _rigHoverName = null;
}

  function computeBoneVisualScale(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  // ~1.3% of model height keeps joints readable across PMX scales (Cascadeur dots).
  return Math.max(0.04, Math.max(size.x, size.y, size.z) * 0.013);
}

  function findRigBone(skeleton, aliases) {
  const bones = skeleton.bones;
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    let b = bones.find(bn => bn.name === alias);
    if (!b) b = bones.find(bn => bn.name.toLowerCase() === a);
    if (!b) b = bones.find(bn => bn.name.toLowerCase().includes(a));
    if (b) return b;
  }
  return null;
}

  // Walk the real skeleton hierarchy from a distal bone up to (and including) a
  // proximal ancestor, returning [distal, ...sub-bones, proximal]. Used to pull
  // in twist / deform sub-bones that sit between two rig anchors.
  function collectChainBetween(distal, proximal) {
  const chain = [];
  let n = distal;
  let depth = 0;
  while (n && depth < 24) {
    chain.push(n);
    if (n === proximal) return chain;
    n = (n.parent && n.parent.isBone) ? n.parent : null;
    depth++;
  }
  // Proximal was not an ancestor (unusual rig) — just connect the two anchors.
  return [distal, proximal];
}

  function addRigJoint(mesh, bone, isAnchor) {
  if (boneVisualMap.has(bone.name)) return;
  const jointMat = new THREE.MeshBasicMaterial({
    color: RIG_COLOR.base,
    transparent: true,
    opacity: isAnchor ? 0.85 : 0.7,
    depthTest: false,
    depthWrite: false,
  });
  const joint = new THREE.Mesh(BONE_VIS.jointGeo, jointMat);
  joint.renderOrder = 27;

  const pick = new THREE.Mesh(BONE_VIS.pickGeo, BONE_VIS.matPick);
  pick.userData.boneName = bone.name;
  pick.userData.isBonePick = true;
  pick.renderOrder = 28;

  boneVisualRoot.add(joint);
  boneVisualRoot.add(pick);
  boneVisualMap.set(bone.name, { joint, pick, jointMat, bone, isAnchor });
}

  function addRigConnector(a, b) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
  const line = new THREE.Line(geo, BONE_VIS.lineMat);
  line.renderOrder = 26;
  line.frustumCulled = false;
  boneVisualRoot.add(line);
  boneVisualLines.push({ line, geo, fromBone: a, toBone: b });
}

  function buildPremiumBoneVisuals(mesh) {
  disposeBoneVisuals();
  if (!mesh?.skeleton) return;
  ensureBoneVisAssets();
  boneVisualScale = computeBoneVisualScale(mesh);
  boneVisualRoot = new THREE.Group();
  boneVisualRoot.name = 'VisualRig';
  boneVisualRoot.renderOrder = 25;

  // Resolve the curated humanoid anchors.
  const anchorBone = new Map(); // rig id -> resolved THREE.Bone
  for (const def of RIG_JOINTS) {
    const bone = findRigBone(mesh.skeleton, def.aliases);
    if (bone) anchorBone.set(def.id, bone);
  }

  // For each chain, include every bone between consecutive anchors (sub-bones),
  // add joint spheres for them, and connect parent->child along the real chain.
  for (const chain of RIG_CHAINS) {
    for (let i = 0; i < chain.length - 1; i++) {
      const proximal = anchorBone.get(chain[i]);
      const distal = anchorBone.get(chain[i + 1]);
      if (!proximal || !distal) continue;
      const seg = collectChainBetween(distal, proximal); // [distal..proximal]
      for (let s = 0; s < seg.length; s++) {
        const isAnchor = (s === 0) || (s === seg.length - 1);
        addRigJoint(mesh, seg[s], isAnchor);
      }
      // Connect each adjacent pair distal..proximal.
      for (let s = 0; s < seg.length - 1; s++) {
        addRigConnector(seg[s], seg[s + 1]);
      }
    }
  }

  getScene().add(boneVisualRoot);
  updatePremiumBoneVisuals();
}

  function updatePremiumBoneVisuals() {
  if (!boneVisualRoot || !currentMesh?.skeleton) return;
  currentMesh.updateMatrixWorld(true);
  const jr = boneVisualScale;
  const sel = BONE.selected;

  boneVisualMap.forEach((vis, name) => {
    vis.bone.getWorldPosition(_boneVec);
    const isSel = name === sel;
    const isHover = name === _rigHoverName;
    // Sub-bones (twist/deform) render as smaller dots than the main anchors.
    const base = vis.isAnchor ? jr : jr * 0.62;
    const r = isSel ? base * 1.35 : (isHover ? base * 1.2 : base);
    vis.joint.position.copy(_boneVec);
    vis.joint.scale.setScalar(r);
    vis.pick.position.copy(_boneVec);
    vis.pick.scale.setScalar(r * 1.6);
    styleBoneVisualMaterials(vis, isSel, isHover);
  });

  for (const seg of boneVisualLines) {
    seg.fromBone.getWorldPosition(_boneVec);
    seg.toBone.getWorldPosition(_boneVec3);
    const pos = seg.geo.attributes.position.array;
    pos[0] = _boneVec.x;  pos[1] = _boneVec.y;  pos[2] = _boneVec.z;
    pos[3] = _boneVec3.x; pos[4] = _boneVec3.y; pos[5] = _boneVec3.z;
    seg.geo.attributes.position.needsUpdate = true;
  }
}

  // Raycast the rig joints under the cursor and recolor the hovered one (orange).
  function updateRigHover(clientX, clientY) {
  if (!boneVisualRoot?.visible || boneVisualMap.size === 0) {
    if (_rigHoverName) { _rigHoverName = null; updatePremiumBoneVisuals(); }
    return null;
  }
  const renderer = getRenderer();
  const camera = getCamera();
  if (!renderer?.domElement || !camera) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _ray.setFromCamera(_ndc, camera);
  const pickables = [];
  boneVisualMap.forEach(v => { if (v.pick) pickables.push(v.pick); });
  const hits = _ray.intersectObjects(pickables, false);
  const name = hits.length ? hits[0].object.userData?.boneName || null : null;
  if (name !== _rigHoverName) {
    _rigHoverName = name;
    updatePremiumBoneVisuals();
    if (renderer.domElement) renderer.domElement.style.cursor = name ? 'pointer' : '';
  }
  return name;
}

  function updateSkeletonHelper() {
  disposeBoneVisuals();
  if (BONE.enabled && currentMesh && !isCaptureActive()) {
    buildPremiumBoneVisuals(currentMesh);
  }
}

  function scheduleBoneTransformUpdate(finalize = false) {
  if (finalize) {
    if (_boneTransformRaf) {
      cancelAnimationFrame(_boneTransformRaf);
      _boneTransformRaf = 0;
    }
    onBoneTransformChanged(true);
    return;
  }
  if (_boneTransformRaf) return;
  _boneTransformRaf = requestAnimationFrame(() => {
    _boneTransformRaf = 0;
    onBoneTransformChanged(false);
  });
}
  function currentAction() {
  if (!currentMesh) return null;
  const obj = animHelper.objects.get(currentMesh);
  if (!obj || !obj.mixer) return null;
  // The mixer's _actions is internal but stable across recent three.js
  // versions; helper.add() creates exactly one action for the clip.
  const acts = obj.mixer._actions;
  if (!acts || acts.length === 0) return null;
  return acts[0];
}

  function updateCharacterMotion(dt, opts = {}) {
    const S = getS();
    const {
      tlRegEl,
      tlLoopEl,
      loopIn = 0,
      loopOut = 0,
      tickFrame = 0,
    } = opts;

    if (BONE.playing && currentMesh?.skeleton) {
      BONE.time += dt * animSpeed;
      if (BONE.time > BONE.duration) BONE.time = 0;
      applyBoneAnimTime(BONE.time);
      refreshBoneTimelineUI();
      return;
    }

    if (!currentMesh || !animHelper) return;

    if (activeAnimIdx >= 0) {
      if (animPlaying) {
        animHelper.update(dt * animSpeed);
        const act = currentAction();
        if (act && tlRegEl && tlRegEl.checked && loopOut > loopIn) {
          if (act.time >= loopOut) act.time = loopIn;
        }
        if (act) {
          act.loop = tlLoopEl?.checked ? THREE.LoopRepeat : THREE.LoopOnce;
          act.clampWhenFinished = !tlLoopEl?.checked;
        }
      } else {
        animHelper.update(0);
      }
    } else if (S.physics && ammoReady && !ammoPhysicsBroken && getMeshPhysics()) {
      if (BONE.enabled) {
        // Posing: pin colliders to the posed bones instead of stepping the sim.
        holdCollidersOnPose(currentMesh, getMeshPhysics());
      } else {
        animHelper.onBeforePhysics(currentMesh);
        getMeshPhysics().update(dt);
      }
    }
  }

  function updateCharacterBoneVisuals(tickFrame = 0) {
    if (!BONE.enabled || !boneVisualRoot) return;
    // "Posing" = animation paused and a model is loaded. Update the rig (and the
    // gizmo proxy / center-of-mass tracking) every frame while posing so it feels
    // responsive, but throttle hard during fast playback to keep 60 FPS.
    const posing = !animPlaying && !BONE.playing;
    if (!posing && (tickFrame % 4 !== 0)) return;
    if (!isTcDragging() && BONE.selected) syncBoneGizmoProxyFromBone();
    updatePremiumBoneVisuals();
  }

  async function initAmmoPhysics() {
    window.addEventListener('error', (ev) => {
      const msg = String(ev.message || ev.error || '');
      if (/out of memory|\bOOM\b|WebAssembly|wasm.*(fail|error|oom)|unreachable|RuntimeError/i.test(msg)) markAmmoBroken(msg);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const msg = String(ev.reason?.message || ev.reason || '');
      if (/out of memory|\bOOM\b|WebAssembly|wasm.*(fail|error|oom)|unreachable|RuntimeError/i.test(msg)) {
        markAmmoBroken(msg);
        ev.preventDefault();
      }
    });
    try {
      await initAmmo();
      ammoReady = true;
      console.info('[Ammo] Bullet Physics ready');
    } catch (e) {
      markAmmoBroken(e);
    }
  }

  return {
    animHelper,
    BONE,
    loadedAnims,
    loadedVmdFiles,
    get pendingModelFile() { return pendingModelFile; },
    set pendingModelFile(v) { pendingModelFile = v; },
    get currentMesh() { return currentMesh; },
    set currentMesh(v) { currentMesh = v; },
    get activeAnimIdx() { return activeAnimIdx; },
    set activeAnimIdx(v) { activeAnimIdx = v; },
    get animPlaying() { return animPlaying; },
    set animPlaying(v) { animPlaying = v; },
    get animSpeed() { return animSpeed; },
    set animSpeed(v) { animSpeed = v; },
    get ammoReady() { return ammoReady; },
    get ammoPhysicsBroken() { return ammoPhysicsBroken; },
    get physDebugHelper() { return physDebugHelper; },
    get boneVisualRoot() { return boneVisualRoot; },
    applyIKFixOnly,
    freezeTwistBones,
    syncArmLimbCollidersFromBones,
    syncLimbCollidersFromBones,
    configureArmPhysicsForAnimation,
    makeArmLimbCollidersKinematic,
    markAmmoBroken,
    physicsConfig,
    disposeMMDPhysics,
    disposeMeshPhysics,
    disposeLoadedMesh,
    animHelperAddMesh,
    animHelperRemoveMesh,
    restartPhysics,
    rebuildPhysics,
    getMeshPhysics,
    applyPhysicsLive,
    applySafePhysDefaults,
    syncStablePhysUI,
    setPhysDebugHelper,
    applySwing,
    applyWindForce,
    playAnim,
    refreshAnimList,
    currentAction,
    currentDuration,
    resetAnimGuardState,
    resetMeshBindPose,
    clearAnimMixerState,
    waitFrames,
    waitForMeshPhysics,
    removeScenePlaceholder,
    updateCharacterMotion,
    updateMultiCharacterMotion,
    updateCharacterBoneVisuals,
    getActionForMesh,
    playAnimOnMesh,
    initAmmoPhysics,
    initBoneSystem,
    clearBoneSystem,
    selectBone,
    setBoneTransformMode,
    setBoneSpace,
    refreshBoneExplorerUI,
    setBoneExplorerOpen,
    refreshBoneListUI,
    refreshBoneTimelineUI,
    refreshBonePropsUI,
    applyModelOpacity,
    captureModelMaterials,
    updateSkeletonHelper,
    updatePremiumBoneVisuals,
    updateRigHover,
    scheduleBoneTransformUpdate,
    pickBoneFromEvent,
    canPickBoneNow,
    suppressBonePick,
    isBoneTransformTarget,
    syncBoneGizmoProxyFromBone,
    applyBoneGizmoProxyToBone,
    seekBoneTime,
    addBoneKeyframe,
    applyRestPose,
    bakeBoneAnim,
    saveBoneAnim,
    loadBoneAnimSaved,
    buildBonePresetButtons,
    selectBoneByMatch,
    getBoneNames,
    onBoneTransformChanged,
    sanitizeMeshMorphAttributes,
    sanitizeGeometryMorphAttributes,
    boneGizmoProxy,
    boneTreeCollapsed,
    getBoneTreeRoots,
    applyBoneAnimTime,
    storeBoneDragSnapshot,
    bonePickWasDragged() {
      return !!_bonePickPointer?.moved;
    },
    bonePickPointerDown(clientX, clientY) {
      _bonePickPointer = { x: clientX, y: clientY, moved: false };
    },
    bonePickPointerMove(clientX, clientY) {
      if (!_bonePickPointer || _bonePickPointer.moved) return;
      const dx = clientX - _bonePickPointer.x;
      const dy = clientY - _bonePickPointer.y;
      if (dx * dx + dy * dy > 16) _bonePickPointer.moved = true;
    },
  };
}
