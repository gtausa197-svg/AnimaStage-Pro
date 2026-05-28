/**
 * NexusSpringPhysics — MMD PMX/PMD physics via @pixiv/three-vrm-springbone
 * (VRMSpringBoneManager + VRMSpringBoneCollider).
 *
 * Drop-in MMDPhysics API for MMDAnimationHelper.
 */
import {
	Bone,
	Object3D,
	Vector3,
} from 'three';
import {
	VRMSpringBoneCollider,
	VRMSpringBoneColliderShapeSphere,
	VRMSpringBoneColliderShapeCapsule,
	VRMSpringBoneJoint,
	VRMSpringBoneManager,
	VRMSpringBoneColliderHelper,
} from '@pixiv/three-vrm-springbone';

const _v3 = new Vector3();

function classifyBone(name = '') {
	if (/髪|毛|hair|ツイン|twin|ponytail|Ahoge|あほ|サイド|side|前髪|後髪|横髪|脇/i.test(name)) return 'hair';
	if (/スカート|skirt|フリル|frill|プリーツ|pleat/i.test(name)) return 'skirt';
	if (/コート|coat|マフラー|muffler|ケープ|cape|披|ジャケット|jacket|ワンピ|dress|服|衣|袖|襟|ネクタイ|tie|リボン|ribbon|スカーフ|scarf/i.test(name)) return 'coat';
	if (/胸|乳|bust/i.test(name)) return 'soft';
	return 'other';
}

function isBodyColliderBone(name = '') {
	if (/髪|毛|hair|スカート|skirt|リボン|ribbon/i.test(name)) return false;
	return /上半身|上半身2|首|頭|head|neck|胸|spine|センター|下半身|腰|pelvis|torso/i.test(name);
}

function findChildBone(bone, bones) {
	for (const b of bones) {
		if (b.parent === bone && b !== bone) return b;
	}
	return null;
}

function mapSpringSettings(rb, gravity) {
	const w = Math.max(0.02, rb.weight ?? 1);
	const drag = Math.min(0.92, Math.max(0.12, (rb.positionDamping ?? 0.2) * 0.5 + (rb.rotationDamping ?? 0.2) * 0.5));
	const hitRadius = Math.max(0.008, rb.width ?? 0.04);
	const g = gravity.length();
	return {
		hitRadius,
		stiffness: Math.min(2.8, Math.max(0.25, 1.15 / Math.sqrt(w))),
		gravityPower: Math.min(0.12, g * 0.00065 / Math.sqrt(w)),
		gravityDir: _v3.copy(gravity).normalize(),
		dragForce: drag,
	};
}

function makeTailObject(bone, rb) {
	const tail = new Object3D();
	tail.name = `${bone.name}_springTail`;
	const pos = rb.position || [0, 0, 0];
	const h = rb.height ?? rb.width ?? 0.05;
	tail.position.set(pos[0], pos[1] - h * 0.5, pos[2]);
	bone.add(tail);
	return tail;
}

function buildColliderForRigid(rb, bone) {
	const w = Math.max(0.02, rb.width ?? 0.05);
	const pos = rb.position || [0, 0, 0];
	let shape;
	if (rb.shapeType === 2 && (rb.height ?? 0) > w) {
		const h = rb.height ?? w * 2;
		shape = new VRMSpringBoneColliderShapeCapsule({
			radius: w,
			offset: new Vector3(pos[0], pos[1], pos[2]),
			tail: new Vector3(pos[0], pos[1] - h, pos[2]),
		});
	} else {
		shape = new VRMSpringBoneColliderShapeSphere({
			radius: w,
			offset: new Vector3(pos[0], pos[1], pos[2]),
		});
	}
	const col = new VRMSpringBoneCollider(shape);
	col.name = `col_${bone.name}`;
	bone.add(col);
	return col;
}

class SpringBodyWrapper {

	constructor(joint, rb, bone) {
		this.joint = joint;
		this.bone = bone;
		this.params = rb;
		this.body = null;
		this._mmdCat = classifyBone(bone?.name || '');
	}

	reset() {
		this.joint.reset();
		return this;
	}

	updateFromBone() {
		return this;
	}

	measureBoneBodyDrift() {
		return 0;
	}

}

export class MMDPhysics {

	constructor(mesh, rigidBodyParams, constraintParams = [], params = {}) {

		this.mesh = mesh;
		this.unitStep = params.unitStep ?? (1 / 65);
		this.maxStepNum = params.maxStepNum ?? 3;
		this.gravity = new Vector3(0, -98, 0);
		if (params.gravity) this.gravity.copy(params.gravity);
		this.world = null;
		this.constraints = constraintParams || [];
		this.bodies = [];
		this._tails = [];
		this._helpers = [];

		this.manager = new VRMSpringBoneManager();
		this._build(mesh, rigidBodyParams || [], params);
		this.manager.setInitState();

	}

	_build(mesh, rigidBodyParams, params) {

		const bones = mesh.skeleton?.bones || [];
		if (!bones.length) return;

		let center = mesh;
		for (const b of bones) {
			if (/センター|center/i.test(b.name)) { center = b; break; }
		}

		const bodyGroup = { name: 'mmd-body', colliders: [] };
		const colliderGroups = [bodyGroup];

		for (const rb of rigidBodyParams) {
			if (rb.type !== 0 || rb.boneIndex < 0 || rb.boneIndex >= bones.length) continue;
			const bone = bones[rb.boneIndex];
			if (!bone || !isBodyColliderBone(bone.name)) continue;
			if ((rb.width ?? 0) < 0.015) continue;
			bodyGroup.colliders.push(buildColliderForRigid(rb, bone));
		}

		const seenBones = new Set();

		for (const rb of rigidBodyParams) {
			if (rb.type === 0 || rb.boneIndex < 0 || rb.boneIndex >= bones.length) continue;
			const bone = bones[rb.boneIndex];
			if (!bone || seenBones.has(bone.uuid)) continue;
			seenBones.add(bone.uuid);

			let child = findChildBone(bone, bones);
			if (!child) {
				child = makeTailObject(bone, rb);
				this._tails.push(child);
			}

			const settings = mapSpringSettings(rb, this.gravity);
			const joint = new VRMSpringBoneJoint(bone, child, settings, colliderGroups);
			joint.center = center;
			this.manager.addJoint(joint);
			this.bodies.push(new SpringBodyWrapper(joint, rb, bone));
		}

		if (params.floorCollider !== false) {
			const floorGroup = { name: 'mmd-floor', colliders: [] };
			const floorShape = new VRMSpringBoneColliderShapeSphere({
				radius: 40,
				offset: new Vector3(0, -0.02, 0),
				inside: true,
			});
			const floorCol = new VRMSpringBoneCollider(floorShape);
			floorCol.name = 'floorCollider';
			mesh.add(floorCol);
			floorGroup.colliders.push(floorCol);
			for (const j of this.manager.joints) {
				j.colliderGroups.push(floorGroup);
			}
		}

	}

	update(delta) {

		if (delta <= 0) return this;

		const steps = Math.min(this.maxStepNum, Math.max(1, Math.ceil(delta / this.unitStep)));
		const stepDt = delta / steps;

		for (let i = 0; i < steps; i++) {
			this.manager.update(stepDt);
		}

		if (this.mesh.skeleton) {
			this.mesh.skeleton.update();
			this.mesh.updateMatrixWorld(true);
		}

		return this;

	}

	reset() {

		this.manager.reset();
		return this;

	}

	warmup(cycles) {

		for (let i = 0; i < cycles; i++) this.update(1 / 60);
		return this;

	}

	setGravity(gravity) {

		this.gravity.copy(gravity);
		const gDir = _v3.copy(gravity).normalize();
		const gPow = Math.min(0.12, gravity.length() * 0.00065);
		for (const w of this.bodies) {
			const j = w.joint;
			j.settings.gravityDir.copy(gDir);
			j.settings.gravityPower = gPow;
		}
		return this;

	}

	createHelper() {

		return new MMDPhysicsHelper(this.mesh, this);

	}

	dispose() {

		for (const t of this._tails) {
			if (t.parent) t.parent.remove(t);
		}
		this._tails.length = 0;
		for (const j of this.manager.joints) {
			this.manager.deleteJoint(j);
		}
		this.bodies.length = 0;

	}

}

export class MMDPhysicsHelper extends Object3D {

	constructor(mesh, physics) {

		super();
		this.mesh = mesh;
		this.physics = physics;

		for (const cg of physics.manager.colliderGroups) {
			for (const col of cg.colliders) {
				const h = new VRMSpringBoneColliderHelper(col);
				this.add(h);
				physics._helpers.push(h);
			}
		}

	}

	updateMatrixWorld(force) {

		super.updateMatrixWorld(force);
		for (const h of this.physics._helpers) {
			h.updateMatrixWorld(true);
		}

	}

}

export function createSharedWorld() {
	return null;
}

export function getSharedWorld() {
	return null;
}

export function disposeSharedWorld() {}
