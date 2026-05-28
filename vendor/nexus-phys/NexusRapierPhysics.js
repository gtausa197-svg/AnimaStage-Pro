/**
 * NexusRapierPhysics — MMD PMX/PMD physics on Rapier.js (full Bullet replacement).
 */
import {
	Bone,
	BoxGeometry,
	CapsuleGeometry,
	Color,
	Euler,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Quaternion,
	SphereGeometry,
	Vector3,
} from 'three';
import { getRapier } from '../rapier/rapier-init.js';

let _sharedWorld = null;
const _meshPhysicsRegistry = new WeakMap();

const _v3a = new Vector3();
const _v3b = new Vector3();
const _qA = new Quaternion();
const _qB = new Quaternion();
const _qC = new Quaternion();
const _mA = new Matrix4();
const _mB = new Matrix4();
const _mC = new Matrix4();
const _mD = new Matrix4();
const _euler = new Euler();

function matrixFromBasisArray(arr) {

	_mA.set(
		arr[ 0 ], arr[ 1 ], arr[ 2 ], 0,
		arr[ 3 ], arr[ 4 ], arr[ 5 ], 0,
		arr[ 6 ], arr[ 7 ], arr[ 8 ], 0,
		0, 0, 0, 1
	);
	return _mA;

}

function matrixFromParams(position, rotation) {

	_mA.copy( matrixFromBasisArray( rotation ) );
	_mA.setPosition( position[ 0 ], position[ 1 ], position[ 2 ] );
	return _mA;

}

function resolveRigidBone( mesh, params ) {

	if ( params.boneIndex === - 1 ) {

		return { bone: new Bone(), orphan: true };

	}

	const skeleton = mesh.skeleton;
	if ( ! skeleton?.bones?.length ) {

		return { bone: new Bone(), orphan: true };

	}

	const bone = skeleton.bones[ params.boneIndex ];
	if ( ! bone ) {

		console.warn( '[NexusRapier] invalid boneIndex', params.boneIndex, '— orphan fallback' );
		return { bone: new Bone(), orphan: true };

	}

	return { bone, orphan: false };

}

function rapier() {

	return getRapier();

}

function createRapierWorld( gravity ) {

	const R = rapier();
	const g = gravity || { x: 0, y: -98, z: 0 };
	const world = new R.World( g );
	world.integrationParameters.numSolverIterations = 12;
	world.integrationParameters.numInternalPgsIterations = 2;
	world.integrationParameters.maxCcdSubsteps = 2;
	return world;

}

export function createSharedWorld( gravity ) {

	if ( ! _sharedWorld ) _sharedWorld = createRapierWorld( gravity );

	if ( gravity && typeof gravity.x === 'number' ) {

		_sharedWorld.gravity = { x: gravity.x, y: gravity.y, z: gravity.z };

	}

	return _sharedWorld;

}

export function getSharedWorld() {

	return _sharedWorld;

}

export function disposeSharedWorld() {

	_sharedWorld = null;

}

class ResourceManager {

	constructor() {

		this.threeVector3s = [];
		this.threeMatrix4s = [];
		this.threeQuaternions = [];

	}

	allocThreeVector3() {

		return this.threeVector3s.length > 0 ? this.threeVector3s.pop() : new Vector3();

	}

	freeThreeVector3( v ) {

		this.threeVector3s.push( v );

	}

	allocThreeQuaternion() {

		return this.threeQuaternions.length > 0 ? this.threeQuaternions.pop() : new Quaternion();

	}

	freeThreeQuaternion( q ) {

		this.threeQuaternions.push( q );

	}

}

class RigidBody {

	constructor( mesh, world, params, manager ) {

		this.mesh = mesh;
		this.world = world;
		this.params = params;
		this.manager = manager;
		this.rigidBody = null;
		this.collider = null;
		this.body = this.rigidBody;
		this.bone = null;
		this._orphanBone = false;
		this.boneOffsetMatrix = new Matrix4();
		this.boneOffsetMatrixInverse = new Matrix4();
		this._linVel = new Vector3();
		this._angVel = new Vector3();
		this._disposed = false;
		this._init();

	}

	reset() {

		this._setTransformFromBone();
		return this;

	}

	updateFromBone() {

		if ( this.params.boneIndex !== - 1 && this.rigidBody ) {

			if ( this.params.type === 0 ) {

				this._setTransformFromBone();

			} else if ( this.params.type === 2 ) {

				// Type 2 = rotation-only; keep body anchored to animated bone position.
				this._setPositionFromBone();

			}

		}

		return this;

	}

	updateBone() {

		if ( this.params.type === 0 || this.params.boneIndex === - 1 || this._orphanBone || ! this.bone || ! this.rigidBody ) return this;

		this._updateBoneRotation();

		if ( this.params.type === 1 ) this._updateBonePosition();

		this.bone.updateMatrixWorld( true );

		if ( this.params.type === 2 ) this._setPositionFromBone();

		this._syncVelFromBody();

		return this;

	}

	_syncVelFromBody() {

		if ( ! this.rigidBody || this.params.type === 0 ) return;
		const lv = this.rigidBody.linvel();
		const av = this.rigidBody.angvel();
		this._linVel.set( lv.x, lv.y, lv.z );
		this._angVel.set( av.x, av.y, av.z );

	}

	_syncVelToBody() {

		if ( ! this.rigidBody || this.params.type === 0 ) return;
		this.rigidBody.setLinvel( { x: this._linVel.x, y: this._linVel.y, z: this._linVel.z }, true );
		this.rigidBody.setAngvel( { x: this._angVel.x, y: this._angVel.y, z: this._angVel.z }, true );

	}

	measureBoneBodyDrift() {

		if ( ! this.rigidBody || this.params.type === 0 || this.params.boneIndex === - 1 ) return 0;
		_mA.copy( this._getBoneTransformMatrix() );
		_v3a.setFromMatrixPosition( _mA );
		const t = this.rigidBody.translation();
		_v3b.set( t.x, t.y, t.z );
		return _v3a.distanceTo( _v3b );

	}

	_getBoneTransformMatrix() {

		if ( ! this.bone?.matrixWorld ) return _mA.identity();

		this.bone.matrixWorld.decompose( _v3a, _qA, _v3b );
		_mA.compose( _v3a, _qA, _v3b );
		_mA.multiply( this.boneOffsetMatrix );
		return _mA;

	}

	_getWorldTransformForBoneMatrix() {

		const t = this.rigidBody.translation();
		const r = this.rigidBody.rotation();
		_mA.compose(
			_v3a.set( t.x, t.y, t.z ),
			_qA.set( r.x, r.y, r.z, r.w ),
			_v3b.set( 1, 1, 1 )
		);
		_mA.multiply( this.boneOffsetMatrixInverse );
		return _mA;

	}

	_setTransformFromBone() {

		if ( ! this.bone?.matrixWorld || ! this.rigidBody ) return;

		_mA.copy( this._getBoneTransformMatrix() );
		_v3a.setFromMatrixPosition( _mA );
		_mA.decompose( _v3a, _qA, _v3b );

		if ( this.params.type === 0 ) {

			this.rigidBody.setNextKinematicTranslation( { x: _v3a.x, y: _v3a.y, z: _v3a.z } );
			this.rigidBody.setNextKinematicRotation( { x: _qA.x, y: _qA.y, z: _qA.z, w: _qA.w } );

		} else {

			this.rigidBody.setTranslation( { x: _v3a.x, y: _v3a.y, z: _v3a.z }, true );
			this.rigidBody.setRotation( { x: _qA.x, y: _qA.y, z: _qA.z, w: _qA.w }, true );
			this.rigidBody.setLinvel( { x: 0, y: 0, z: 0 }, true );
			this.rigidBody.setAngvel( { x: 0, y: 0, z: 0 }, true );

		}

	}

	_setPositionFromBone() {

		_mA.copy( this._getBoneTransformMatrix() );
		_v3a.setFromMatrixPosition( _mA );
		this.rigidBody.setTranslation( { x: _v3a.x, y: _v3a.y, z: _v3a.z }, true );

	}

	_updateBoneRotation() {

		if ( ! this.bone?.matrixWorld || ! this.bone.matrix ) return;

		_mA.copy( this._getWorldTransformForBoneMatrix() );
		_qA.setFromRotationMatrix( _mA );
		if ( ! Number.isFinite( _qA.x ) || ! Number.isFinite( _qA.w ) ) return;

		_qB.setFromRotationMatrix( this.bone.matrixWorld ).invert();
		_qB.multiply( _qA );
		_qC.setFromRotationMatrix( this.bone.matrix );
		this.bone.quaternion.copy( _qB.multiply( _qC ).normalize() );

	}

	_updateBonePosition() {

		_mA.copy( this._getWorldTransformForBoneMatrix() );
		_v3a.setFromMatrixPosition( _mA );
		if ( this.bone.parent ) this.bone.parent.worldToLocal( _v3a );
		this.bone.position.copy( _v3a );

	}

	_init() {

		const R = rapier();
		const params = this.params;
		const resolved = resolveRigidBone( this.mesh, params );
		const bone = resolved.bone;
		this._orphanBone = resolved.orphan;

		matrixFromParams( params.position, params.rotation );
		this.boneOffsetMatrix.copy( _mA );
		this.boneOffsetMatrixInverse.copy( this.boneOffsetMatrix ).invert();

		if ( this.mesh.skeleton ) this.mesh.skeleton.update();
		bone.updateMatrixWorld( true );
		this._getBoneTransformMatrix();
		_v3a.setFromMatrixPosition( _mA );
		_mA.decompose( _v3a, _qA, _v3b );

		let desc = params.type === 0
			? R.RigidBodyDesc.kinematicPositionBased()
			: R.RigidBodyDesc.dynamic();

		desc.setTranslation( _v3a.x, _v3a.y, _v3a.z );
		desc.setRotation( { x: _qA.x, y: _qA.y, z: _qA.z, w: _qA.w } );
		desc.setLinearDamping( Math.max( 0.01, params.positionDamping ?? 0.2 ) );
		desc.setAngularDamping( Math.max( 0.01, params.rotationDamping ?? 0.2 ) );

		if ( params.type !== 0 ) {

			desc.setAdditionalMass( Math.max( 0.001, params.weight ?? 1 ) );

		}

		this.rigidBody = this.world.createRigidBody( desc );
		this.body = this.rigidBody;

		if ( params.type !== 0 ) {

			// MMD hair/skirt chains are spring-driven; world gravity breaks weak Rapier joints.
			this.rigidBody.setGravityScale( 0, false );

		}

		if ( params.type === 2 ) {

			this.rigidBody.lockTranslations( true, false );

		}

		let colliderDesc;
		const w = Math.max( 0.001, params.width ?? 0.05 );
		switch ( params.shapeType ) {

			case 0:
				colliderDesc = R.ColliderDesc.ball( w );
				break;
			case 1:
				colliderDesc = R.ColliderDesc.cuboid(
					Math.max( 0.001, params.width ?? 0.05 ),
					Math.max( 0.001, params.height ?? 0.05 ),
					Math.max( 0.001, params.depth ?? 0.05 )
				);
				break;
			case 2:
				colliderDesc = R.ColliderDesc.capsule( w, Math.max( 0.001, ( params.height ?? w ) * 0.5 ) );
				break;
			default:
				colliderDesc = R.ColliderDesc.ball( w );

		}

		colliderDesc.setFriction( params.friction ?? 0.5 );
		colliderDesc.setRestitution( params.restitution ?? 0 );
		const membership = 1 << ( params.groupIndex ?? 0 );
		const filter = params.groupTarget ?? 0xffff;
		colliderDesc.setCollisionGroups( membership | ( filter << 16 ) );

		this.collider = this.world.createCollider( colliderDesc, this.rigidBody );
		this.bone = bone;

	}

	dispose() {

		if ( this._disposed ) return;
		this._disposed = true;

		if ( this.collider ) {

			this.world.removeCollider( this.collider, true );
			this.collider = null;

		}

		if ( this.rigidBody ) {

			this.world.removeRigidBody( this.rigidBody );
			this.rigidBody = null;
			this.body = null;

		}

	}

}

class Constraint {

	constructor( mesh, world, bodyA, bodyB, params, manager ) {

		this.mesh = mesh;
		this.world = world;
		this.bodyA = bodyA;
		this.bodyB = bodyB;
		this.params = params;
		this.manager = manager;
		this.joint = null;
		this.constraint = null;
		this._disposed = false;
		this._init();

	}

	_computeAnchors() {

		const params = this.params;
		const bodyA = this.bodyA;
		const bodyB = this.bodyB;

		_mA.copy( matrixFromParams( params.position, params.rotation ) );
		_mB.copy( bodyA._getBoneTransformMatrix() );
		_mC.copy( bodyB._getBoneTransformMatrix() );

		_mD.copy( _mB ).invert().multiply( _mA );
		_v3a.setFromMatrixPosition( _mD );
		const anchor1 = { x: _v3a.x, y: _v3a.y, z: _v3a.z };

		_mD.copy( _mC ).invert().multiply( _mA );
		_v3a.setFromMatrixPosition( _mD );
		const anchor2 = { x: _v3a.x, y: _v3a.y, z: _v3a.z };

		return { anchor1, anchor2 };

	}

	_init() {

		const R = rapier();
		const params = this.params;
		const bodyA = this.bodyA;
		const bodyB = this.bodyB;

		if ( ! bodyA?.rigidBody || ! bodyB?.rigidBody ) return;

		const { anchor1, anchor2 } = this._computeAnchors();
		const eps = 1e-5;

		const hasPosSpring = ( params.springPosition || [] ).some( ( s ) => s !== 0 );
		const hasRotSpring = ( params.springRotation || [] ).some( ( s ) => s !== 0 );
		const transFree = params.translationLimitation1.some( ( v, i ) =>
			Math.abs( params.translationLimitation2[ i ] - v ) >= eps
		);

		let jointData;

		if ( hasPosSpring && ! transFree ) {

			const stiff = Math.max(
				params.springPosition[ 0 ],
				params.springPosition[ 1 ],
				params.springPosition[ 2 ],
				1
			);
			const damp = Math.max( params.positionDamping ?? 0.2, 0.05 ) * stiff * 0.02;
			jointData = R.JointData.spring( 0, stiff, damp, anchor1, anchor2 );

		} else if ( hasRotSpring || ! transFree ) {

			jointData = R.JointData.spherical( anchor1, anchor2 );

		} else {

			const JM = R.JointAxesMask;
			let mask = JM.LinX | JM.LinY | JM.LinZ;

			for ( let i = 0; i < 3; i ++ ) {

				if ( Math.abs( params.rotationLimitation2[ i ] - params.rotationLimitation1[ i ] ) < eps ) {

					mask |= ( i === 0 ? JM.AngX : i === 1 ? JM.AngY : JM.AngZ );

				}

			}

			jointData = R.JointData.generic(
				anchor1,
				anchor2,
				{ x: 1, y: 0, z: 0 },
				mask
			);

		}

		this.joint = this.world.createImpulseJoint( jointData, bodyA.rigidBody, bodyB.rigidBody, true );
		this.constraint = this.joint;

	}

	dispose() {

		if ( this._disposed ) return;
		this._disposed = true;

		if ( this.joint ) {

			this.world.removeImpulseJoint( this.joint, true );
			this.joint = null;
			this.constraint = null;

		}

	}

}

export class MMDPhysics {

	constructor( mesh, rigidBodyParams, constraintParams = [], params = {} ) {

		getRapier();

		const prev = _meshPhysicsRegistry.get( mesh );
		if ( prev && ! prev._disposed ) {

			// #region agent log
			fetch( 'http://127.0.0.1:7412/ingest/30bc1dd7-b82a-489d-99df-2baf2ae68165', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5bc1e6' },
				body: JSON.stringify( {
					sessionId: '5bc1e6',
					runId: 'post-fix',
					hypothesisId: 'H7',
					location: 'NexusRapierPhysics.js:constructor',
					message: 'disposing previous MMDPhysics for same mesh',
					data: { prevBodies: prev.bodies?.length ?? 0 },
					timestamp: Date.now(),
				} ),
			} ).catch( () => {} );
			// #endregion
			prev.dispose();

		}

		this.manager = new ResourceManager();
		this.mesh = mesh;
		this.unitStep = params.unitStep !== undefined ? params.unitStep : 1 / 65;
		this.maxStepNum = params.maxStepNum !== undefined ? params.maxStepNum : 3;
		this.gravity = new Vector3( 0, -98, 0 );
		if ( params.gravity !== undefined ) this.gravity.copy( params.gravity );
		this.world = params.world !== undefined ? params.world : null;
		this.bodies = [];
		this.constraints = [];

		this._disposed = false;

		this._init( mesh, rigidBodyParams, constraintParams );

		_meshPhysicsRegistry.set( mesh, this );

	}

	update( delta ) {

		const mesh = this.mesh;
		let isNonDefaultScale = false;
		const position = this.manager.allocThreeVector3();
		const quaternion = this.manager.allocThreeQuaternion();
		const scale = this.manager.allocThreeVector3();

		mesh.updateMatrixWorld( true );
		mesh.matrixWorld.decompose( position, quaternion, scale );

		if ( scale.x !== 1 || scale.y !== 1 || scale.z !== 1 ) isNonDefaultScale = true;

		let parent;
		if ( isNonDefaultScale ) {

			parent = mesh.parent;
			if ( parent !== null ) mesh.parent = null;
			scale.copy( mesh.scale );
			mesh.scale.set( 1, 1, 1 );
			mesh.updateMatrixWorld( true );

		}

		if ( mesh.skeleton ) mesh.skeleton.update();
		mesh.updateMatrixWorld( true );

		this._updateRigidBodies();
		this._stepSimulation( delta );
		this._updateBones();

		if ( mesh.skeleton ) mesh.skeleton.update();
		mesh.updateMatrixWorld( true );

		if ( isNonDefaultScale ) {

			if ( parent !== null ) mesh.parent = parent;
			mesh.scale.copy( scale );

		}

		this.manager.freeThreeVector3( scale );
		this.manager.freeThreeQuaternion( quaternion );
		this.manager.freeThreeVector3( position );

		return this;

	}

	reset() {

		for ( let i = 0, il = this.bodies.length; i < il; i ++ ) this.bodies[ i ].reset();
		return this;

	}

	warmup( cycles ) {

		for ( let i = 0; i < cycles; i ++ ) this.update( 1 / 60 );
		return this;

	}

	setGravity( gravity ) {

		this.gravity.copy( gravity );
		this.world.gravity = { x: gravity.x, y: gravity.y, z: gravity.z };
		return this;

	}

	createHelper() {

		return new MMDPhysicsHelper( this.mesh, this );

	}

	dispose() {

		if ( this._disposed ) return;
		this._disposed = true;

		// #region agent log
		fetch('http://127.0.0.1:7412/ingest/30bc1dd7-b82a-489d-99df-2baf2ae68165', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5bc1e6' },
			body: JSON.stringify({
				sessionId: '5bc1e6',
				runId: 'pre-fix',
				hypothesisId: 'H1',
				location: 'NexusRapierPhysics.js:MMDPhysics.dispose',
				message: 'MMDPhysics.dispose removing all bodies',
				data: { bodyCount: this.bodies.length, constraintCount: this.constraints.length, stack: ( new Error() ).stack?.split( '\n' ).slice( 1, 5 ) },
				timestamp: Date.now(),
			}),
		}).catch( () => {} );
		// #endregion

		for ( let i = this.constraints.length - 1; i >= 0; i -- ) this.constraints[ i ].dispose();
		this.constraints.length = 0;
		for ( let i = this.bodies.length - 1; i >= 0; i -- ) this.bodies[ i ].dispose();
		this.bodies.length = 0;

		if ( _meshPhysicsRegistry.get( this.mesh ) === this ) _meshPhysicsRegistry.delete( this.mesh );

	}

	_init( mesh, rigidBodyParams, constraintParams ) {

		const parent = mesh.parent;
		const currentPosition = this.manager.allocThreeVector3();
		const currentQuaternion = this.manager.allocThreeQuaternion();
		const currentScale = this.manager.allocThreeVector3();

		currentPosition.copy( mesh.position );
		currentQuaternion.copy( mesh.quaternion );
		currentScale.copy( mesh.scale );

		if ( parent !== null ) mesh.parent = null;
		mesh.position.set( 0, 0, 0 );
		mesh.quaternion.set( 0, 0, 0, 1 );
		mesh.scale.set( 1, 1, 1 );
		mesh.updateMatrixWorld( true );
		if ( mesh.skeleton ) mesh.skeleton.update();

		try {

			if ( this.world === null ) this.world = createSharedWorld( this.gravity );

			for ( let i = 0, il = rigidBodyParams.length; i < il; i ++ ) {

				this.bodies.push( new RigidBody( mesh, this.world, rigidBodyParams[ i ], this.manager ) );

			}

			for ( let i = 0, il = constraintParams.length; i < il; i ++ ) {

				const params = constraintParams[ i ];
				const bodyA = this.bodies[ params.rigidBodyIndex1 ];
				const bodyB = this.bodies[ params.rigidBodyIndex2 ];
				if ( ! bodyA?.rigidBody || ! bodyB?.rigidBody ) continue;
				try {

					this.constraints.push( new Constraint( mesh, this.world, bodyA, bodyB, params, this.manager ) );

				} catch ( e ) {

					console.warn( '[NexusRapier] skipped constraint', i, e?.message || e );

				}

			}

			if ( this.bodies.length > 0 ) {

				console.info(
					'[NexusRapier] rigid bodies:', this.bodies.length,
					'constraints:', this.constraints.length
				);

			}

			this.reset();

			if ( mesh.skeleton ) mesh.skeleton.update();
			mesh.updateMatrixWorld( true );

		} finally {

			if ( parent !== null ) mesh.parent = parent;
			mesh.position.copy( currentPosition );
			mesh.quaternion.copy( currentQuaternion );
			mesh.scale.copy( currentScale );
			mesh.updateMatrixWorld( true );
			this.manager.freeThreeVector3( currentPosition );
			this.manager.freeThreeQuaternion( currentQuaternion );
			this.manager.freeThreeVector3( currentScale );

		}

	}

	_updateRigidBodies() {

		for ( let i = 0, il = this.bodies.length; i < il; i ++ ) this.bodies[ i ].updateFromBone();

	}

	_stepSimulation( delta ) {

		const unitStep = this.unitStep;
		let stepTime = delta;
		let maxStepNum = ( ( delta / unitStep ) | 0 ) + 1;

		if ( stepTime < unitStep ) {

			stepTime = unitStep;
			maxStepNum = 1;

		}

		if ( maxStepNum > this.maxStepNum ) maxStepNum = this.maxStepNum;

		this.world.integrationParameters.dt = unitStep;
		for ( let i = 0; i < maxStepNum; i ++ ) this.world.step();

	}

	_updateBones() {

		for ( let i = 0, il = this.bodies.length; i < il; i ++ ) this.bodies[ i ].updateBone();

	}

}

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _matrixWorldInv = new Matrix4();

export class MMDPhysicsHelper extends Object3D {

	constructor( mesh, physics ) {

		super();
		this.root = mesh;
		this.physics = physics;
		this.matrix.copy( mesh.matrixWorld );
		this.matrixAutoUpdate = false;
		this.materials = [
			new MeshBasicMaterial( { color: new Color( 0xff8888 ), wireframe: true, depthTest: false, depthWrite: false, opacity: 0.25, transparent: true } ),
			new MeshBasicMaterial( { color: new Color( 0x88ff88 ), wireframe: true, depthTest: false, depthWrite: false, opacity: 0.25, transparent: true } ),
			new MeshBasicMaterial( { color: new Color( 0x8888ff ), wireframe: true, depthTest: false, depthWrite: false, opacity: 0.25, transparent: true } ),
		];
		this._init();

	}

	dispose() {

		for ( const m of this.materials ) m.dispose();
		for ( const child of this.children ) if ( child.isMesh ) child.geometry.dispose();

	}

	updateMatrixWorld( force ) {

		const mesh = this.root;
		if ( this.visible ) {

			const bodies = this.physics.bodies;
			const children = this.children;

			_matrixWorldInv
				.copy( mesh.matrixWorld )
				.decompose( _position, _quaternion, _scale )
				.compose( _position, _quaternion, _scale.set( 1, 1, 1 ) )
				.invert();

			let drawn = 0;
			for ( let i = 0, il = bodies.length; i < il; i ++ ) {

				const body = bodies[ i ].rigidBody;
				const child = children[ i ];
				if ( ! body || ! child ) continue;

				const t = body.translation();
				const r = body.rotation();

				child.position
					.set( t.x, t.y, t.z )
					.applyMatrix4( _matrixWorldInv );

				child.quaternion
					.setFromRotationMatrix( _matrixWorldInv )
					.multiply( _qA.set( r.x, r.y, r.z, r.w ) );

				drawn++;

			}

			// #region agent log
			if ( drawn === 0 && bodies.length > 0 ) {

				fetch( 'http://127.0.0.1:7412/ingest/30bc1dd7-b82a-489d-99df-2baf2ae68165', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5bc1e6' },
					body: JSON.stringify( {
						sessionId: '5bc1e6',
						runId: 'post-fix',
						hypothesisId: 'H12',
						location: 'NexusRapierPhysics.js:MMDPhysicsHelper.updateMatrixWorld',
						message: 'debug helper drew zero bodies',
						data: { bodyCount: bodies.length, childCount: children.length, physicsMatch: true },
						timestamp: Date.now(),
					} ),
				} ).catch( () => {} );

			}
			// #endregion

		}

		this.matrix
			.copy( mesh.matrixWorld )
			.decompose( _position, _quaternion, _scale )
			.compose( _position, _quaternion, _scale.set( 1, 1, 1 ) );

		super.updateMatrixWorld( force );

	}

	_init() {

		const bodies = this.physics.bodies;
		const materials = this.materials;

		for ( let i = 0, il = bodies.length; i < il; i ++ ) {

			const params = bodies[ i ].params;
			let geometry;
			switch ( params.shapeType ) {

				case 0:
					geometry = new SphereGeometry( params.width, 8, 8 );
					break;
				case 1:
					geometry = new BoxGeometry( params.width * 2, params.height * 2, params.depth * 2 );
					break;
				case 2:
					geometry = new CapsuleGeometry( params.width, params.height, 4, 8 );
					break;
				default:
					geometry = new SphereGeometry( params.width, 8, 8 );

			}

			const material = materials[ params.type ] || materials[ 0 ];
			const shape = new Mesh( geometry, material );
			this.add( shape );

		}

	}

}
