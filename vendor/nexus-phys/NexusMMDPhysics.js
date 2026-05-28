/**
 * NexusPhys — MMD rigid-body physics for mmd_rtx.html
 *
 * Stock three.js MMDPhysics (Bullet / Ammo.js) with MMD stability fixes:
 * - Custom Ammo build: setParam ERP 0.475 on spring constraints (hair/skirt)
 * - Shared btDiscreteDynamicsWorld (avoids WASM OOM on model/VMD reload)
 * - 64-bit double-precision Bullet via vendor/ammo (build-ammo.sh)
 *
 * @see https://github.com/kripken/ammo.js
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
	Vector3
} from 'three';
import { getAmmo } from '../ammo/ammo-init.js';

let _sharedWorld = null;

function ammo() {

	return getAmmo();

}

function createAmmoWorld() {

	const Ammo = ammo();
	const config = new Ammo.btDefaultCollisionConfiguration();
	const dispatcher = new Ammo.btCollisionDispatcher( config );
	const cache = new Ammo.btDbvtBroadphase();
	const solver = new Ammo.btSequentialImpulseConstraintSolver();
	return new Ammo.btDiscreteDynamicsWorld( dispatcher, cache, solver, config );

}

/** One shared Bullet world for the browser session (MMD body/constraint swap per model). */
export function createSharedWorld( gravity ) {

	if ( ! _sharedWorld ) {

		_sharedWorld = createAmmoWorld();

		try {

			const si = _sharedWorld.getSolverInfo();
			si.set_m_numIterations( 24 );
			si.set_m_erp( 0.2 );
			si.set_m_erp2( 0.85 );

		} catch ( _e ) { /* older ammo build */ }

	}

	if ( gravity && typeof gravity.x === 'number' ) {

		const Ammo = ammo();
		const g = new Ammo.btVector3( gravity.x, gravity.y, gravity.z );
		_sharedWorld.setGravity( g );
		Ammo.destroy( g );

	}

	return _sharedWorld;

}

export function getSharedWorld() {

	return _sharedWorld;

}

export function disposeSharedWorld() {

	_sharedWorld = null;

}

/** Max bone↔body distance = colliderSize × limitMul × categoryMul (hair/skirt/etc.). */
const DEFAULT_STRETCH_CATEGORY_MUL = {
	hair: 1.6,
	skirt: 2.0,
	coat: 2.2,
	soft: 1.5,
	other: 2.5,
};

class MMDPhysics {

/**
* @param {THREE.SkinnedMesh} mesh
* @param {Array} rigidBodyParams
* @param {Array} (optional) constraintParams
* @param {Object} params - (optional)
* @param {Number} params.unitStep - Default is 1 / 65.
* @param {Integer} params.maxStepNum - Default is 3.
* @param {Vector3} params.gravity - Default is ( 0, - 9.8 * 10, 0 )
*/
constructor( mesh, rigidBodyParams, constraintParams = [], params = {} ) {

try {

	getAmmo();

} catch ( _e ) {

	throw new Error( 'NexusPhys: call initAmmo() before MMDPhysics' );

}

this.manager = new ResourceManager();

this.mesh = mesh;

/*
* I don't know why but 1/60 unitStep easily breaks models
* so I set it 1/65 so far.
* Don't set too small unitStep because
* the smaller unitStep can make the performance worse.
*/
this.unitStep = ( params.unitStep !== undefined ) ? params.unitStep : 1 / 65;
this.maxStepNum = ( params.maxStepNum !== undefined ) ? params.maxStepNum : 3;
this.gravity = new Vector3( 0, - 9.8 * 10, 0 );

if ( params.gravity !== undefined ) this.gravity.copy( params.gravity );

this.world = params.world !== undefined ? params.world : null; // experimental

this.bodies = [];
this.constraints = [];

this.stretchLimitEnabled = params.stretchLimitEnabled !== false;
this.stretchLimitMul = params.stretchLimitMul !== undefined ? params.stretchLimitMul : 3.5;
this.stretchCategoryMul = params.stretchCategoryMul || DEFAULT_STRETCH_CATEGORY_MUL;

this._init( mesh, rigidBodyParams, constraintParams );

}

/**
* Advances Physics calculation and updates bones.
*
* @param {Number} delta - time in second
* @return {MMDPhysics}
*/
update( delta ) {

const manager = this.manager;
const mesh = this.mesh;

// rigid bodies and constrains are for
// mesh's world scale (1, 1, 1).
// Convert to (1, 1, 1) if it isn't.

let isNonDefaultScale = false;

const position = manager.allocThreeVector3();
const quaternion = manager.allocThreeQuaternion();
const scale = manager.allocThreeVector3();

mesh.updateMatrixWorld( true );
mesh.matrixWorld.decompose( position, quaternion, scale );

if ( scale.x !== 1 || scale.y !== 1 || scale.z !== 1 ) {

isNonDefaultScale = true;

}

let parent;

if ( isNonDefaultScale ) {

parent = mesh.parent;

if ( parent !== null ) mesh.parent = null;

scale.copy( this.mesh.scale );

mesh.scale.set( 1, 1, 1 );
mesh.updateMatrixWorld( true );

}

// calculate physics and update bones

if ( typeof this.beforeStep === 'function' ) this.beforeStep();

this._updateRigidBodies();
this._stepSimulation( delta );
this._enforceStretchLimits();
if ( typeof this.afterStep === 'function' ) this.afterStep();
this._updateBones();

if ( this.mesh.skeleton ) {

	this.mesh.skeleton.update();
	this.mesh.updateMatrixWorld( true );

}

// restore mesh if converted above

if ( isNonDefaultScale ) {

if ( parent !== null ) mesh.parent = parent;

mesh.scale.copy( scale );

}

manager.freeThreeVector3( scale );
manager.freeThreeQuaternion( quaternion );
manager.freeThreeVector3( position );

return this;

}

/**
* Resets rigid bodies transorm to current bone's.
*
* @return {MMDPhysics}
*/
reset() {

for ( let i = 0, il = this.bodies.length; i < il; i ++ ) {

this.bodies[ i ].reset();

}

return this;

}

/**
* Warm ups Rigid bodies. Calculates cycles steps.
*
* @param {Integer} cycles
* @return {MMDPhysics}
*/
warmup( cycles ) {

for ( let i = 0; i < cycles; i ++ ) {

this.update( 1 / 60 );

}

return this;

}

/**
* Sets gravity.
*
* @param {Vector3} gravity
* @return {MMDPhysicsHelper}
*/
setGravity( gravity ) {

this.world.setGravity( new (ammo()).btVector3( gravity.x, gravity.y, gravity.z ) );
this.gravity.copy( gravity );

return this;

}

/**
* Creates MMDPhysicsHelper
*
* @return {MMDPhysicsHelper}
*/
createHelper() {

return new MMDPhysicsHelper( this.mesh, this );

}

// private methods

_init( mesh, rigidBodyParams, constraintParams ) {

const manager = this.manager;

// rigid body/constraint parameters are for
// mesh's default world transform as position(0, 0, 0),
// quaternion(0, 0, 0, 1) and scale(0, 0, 0)

const parent = mesh.parent;

if ( parent !== null ) mesh.parent = null;

const currentPosition = manager.allocThreeVector3();
const currentQuaternion = manager.allocThreeQuaternion();
const currentScale = manager.allocThreeVector3();

currentPosition.copy( mesh.position );
currentQuaternion.copy( mesh.quaternion );
currentScale.copy( mesh.scale );

mesh.position.set( 0, 0, 0 );
mesh.quaternion.set( 0, 0, 0, 1 );
mesh.scale.set( 1, 1, 1 );

mesh.updateMatrixWorld( true );

try {

	if ( this.world === null ) {

		this.world = createSharedWorld( this.gravity );

	}

	this._initRigidBodies( rigidBodyParams );
	this._initConstraints( constraintParams );

	if ( this.bodies.length > 0 ) {

		console.info(
			'[NexusPhys] rigid bodies:', this.bodies.length,
			'constraints:', this.constraints.length
		);

	}

	this.reset();

} finally {

	if ( parent !== null ) mesh.parent = parent;

	mesh.position.copy( currentPosition );
	mesh.quaternion.copy( currentQuaternion );
	mesh.scale.copy( currentScale );

	mesh.updateMatrixWorld( true );

	manager.freeThreeVector3( currentPosition );
	manager.freeThreeQuaternion( currentQuaternion );
	manager.freeThreeVector3( currentScale );

}

}


_initRigidBodies( rigidBodies ) {

for ( let i = 0, il = rigidBodies.length; i < il; i ++ ) {

this.bodies.push( new RigidBody(
this.mesh, this.world, rigidBodies[ i ], this.manager ) );

}

}

_initConstraints( constraints ) {

for ( let i = 0, il = constraints.length; i < il; i ++ ) {

const params = constraints[ i ];
	const bodyA = this.bodies[ params.rigidBodyIndex1 ];
	const bodyB = this.bodies[ params.rigidBodyIndex2 ];
	if ( ! bodyA?.body || ! bodyB?.body ) continue;
		try {

			this.constraints.push( new Constraint( this.mesh, this.world, bodyA, bodyB, params, this.manager ) );

		} catch ( e ) {

			console.warn( '[NexusPhys] skipped constraint', i, e?.message || e );

		}

}

}

_stepSimulation( delta ) {

const unitStep = this.unitStep;
let stepTime = delta;
let maxStepNum = ( ( delta / unitStep ) | 0 ) + 1;

if ( stepTime < unitStep ) {

stepTime = unitStep;
maxStepNum = 1;

}

if ( maxStepNum > this.maxStepNum ) {

maxStepNum = this.maxStepNum;

}

// Bullet WASM heap corrupts beyond ~8 internal steps on heavy PMX models.
if ( maxStepNum > 8 ) maxStepNum = 8;

try {

this.world.stepSimulation( stepTime, maxStepNum, unitStep );

} catch ( e ) {

console.warn( '[NexusPhys] stepSimulation failed:', e?.message || e );
if ( typeof this.onStepError === 'function' ) this.onStepError( e );

}

}

_enforceStretchLimits() {

	if ( this.stretchLimitEnabled === false ) return;

	const mul = this.stretchLimitMul ?? 3.5;
	const cats = this.stretchCategoryMul || DEFAULT_STRETCH_CATEGORY_MUL;

	for ( let i = 0, il = this.bodies.length; i < il; i ++ ) {

		const body = this.bodies[ i ];
		if ( ! body.body || body.params.boneIndex === - 1 ) continue;
		if ( body.params.type !== 1 && body.params.type !== 2 ) continue;

		const maxDist = body._getStretchLimitDist( mul, cats );
		const drift = body.measureBoneBodyDrift();

		if ( drift <= maxDist ) continue;

		body.reset();
		if ( body._linVel ) body._linVel.set( 0, 0, 0 );
		if ( body._angVel ) body._angVel.set( 0, 0, 0 );
		if ( body._syncVelToBody ) body._syncVelToBody();

	}

}

_updateRigidBodies() {

for ( let i = 0, il = this.bodies.length; i < il; i ++ ) {

this.bodies[ i ].updateFromBone();

}

}

_updateBones() {

const stretchEnabled = this.stretchLimitEnabled !== false;
const stretchMul = this.stretchLimitMul ?? 3.5;
const stretchCats = this.stretchCategoryMul || DEFAULT_STRETCH_CATEGORY_MUL;

for ( let i = 0, il = this.bodies.length; i < il; i ++ ) {

this.bodies[ i ].updateBone( stretchEnabled, stretchMul, stretchCats );

}

}

}

/**
* This manager's responsibilies are
*
* 1. manage Ammo.js and Three.js object resources and
* improve the performance and the memory consumption by
* reusing objects.
*
* 2. provide simple Ammo object operations.
*/
class ResourceManager {

constructor() {

// for Three.js
this.threeVector3s = [];
this.threeMatrix4s = [];
this.threeQuaternions = [];
this.threeEulers = [];

// for Ammo.js
this.transforms = [];
this.quaternions = [];
this.vector3s = [];

}

allocThreeVector3() {

return ( this.threeVector3s.length > 0 )
? this.threeVector3s.pop()
: new Vector3();

}

freeThreeVector3( v ) {

this.threeVector3s.push( v );

}

allocThreeMatrix4() {

return ( this.threeMatrix4s.length > 0 )
? this.threeMatrix4s.pop()
: new Matrix4();

}

freeThreeMatrix4( m ) {

this.threeMatrix4s.push( m );

}

allocThreeQuaternion() {

return ( this.threeQuaternions.length > 0 )
? this.threeQuaternions.pop()
: new Quaternion();

}

freeThreeQuaternion( q ) {

this.threeQuaternions.push( q );

}

allocThreeEuler() {

return ( this.threeEulers.length > 0 )
? this.threeEulers.pop()
: new Euler();

}

freeThreeEuler( e ) {

this.threeEulers.push( e );

}

allocTransform() {

return ( this.transforms.length > 0 )
? this.transforms.pop()
: new (ammo()).btTransform();

}

freeTransform( t ) {

this.transforms.push( t );

}

allocQuaternion() {

return ( this.quaternions.length > 0 )
? this.quaternions.pop()
: new (ammo()).btQuaternion();

}

freeQuaternion( q ) {

this.quaternions.push( q );

}

allocVector3() {

return ( this.vector3s.length > 0 )
? this.vector3s.pop()
: new (ammo()).btVector3();

}

freeVector3( v ) {

this.vector3s.push( v );

}

setIdentity( t ) {

t.setIdentity();

}

getBasis( t ) {

var q = this.allocQuaternion();
t.getBasis().getRotation( q );
return q;

}

getBasisAsMatrix3( t ) {

var q = this.getBasis( t );
var m = this.quaternionToMatrix3( q );
this.freeQuaternion( q );
return m;

}

getOrigin( t ) {

return t.getOrigin();

}

setOrigin( t, v ) {

t.getOrigin().setValue( v.x(), v.y(), v.z() );

}

copyOrigin( t1, t2 ) {

var o = t2.getOrigin();
this.setOrigin( t1, o );

}

setBasis( t, q ) {

t.setRotation( q );

}

setBasisFromMatrix3( t, m ) {

var q = this.matrix3ToQuaternion( m );
this.setBasis( t, q );
this.freeQuaternion( q );

}

setOriginFromArray3( t, a ) {

t.getOrigin().setValue( a[ 0 ], a[ 1 ], a[ 2 ] );

}

setOriginFromThreeVector3( t, v ) {

t.getOrigin().setValue( v.x, v.y, v.z );

}

setBasisFromArray3( t, a ) {

var thQ = this.allocThreeQuaternion();
var thE = this.allocThreeEuler();
thE.set( a[ 0 ], a[ 1 ], a[ 2 ] );
this.setBasisFromThreeQuaternion( t, thQ.setFromEuler( thE ) );

this.freeThreeEuler( thE );
this.freeThreeQuaternion( thQ );

}

setBasisFromThreeQuaternion( t, a ) {

var q = this.allocQuaternion();

q.setX( a.x );
q.setY( a.y );
q.setZ( a.z );
q.setW( a.w );
this.setBasis( t, q );

this.freeQuaternion( q );

}

multiplyTransforms( t1, t2 ) {

var t = this.allocTransform();
this.setIdentity( t );

var m1 = this.getBasisAsMatrix3( t1 );
var m2 = this.getBasisAsMatrix3( t2 );

var o1 = this.getOrigin( t1 );
var o2 = this.getOrigin( t2 );

var v1 = this.multiplyMatrix3ByVector3( m1, o2 );
var v2 = this.addVector3( v1, o1 );
this.setOrigin( t, v2 );

var m3 = this.multiplyMatrices3( m1, m2 );
this.setBasisFromMatrix3( t, m3 );

this.freeVector3( v1 );
this.freeVector3( v2 );

return t;

}

inverseTransform( t ) {

var t2 = this.allocTransform();

var m1 = this.getBasisAsMatrix3( t );
var o = this.getOrigin( t );

var m2 = this.transposeMatrix3( m1 );
var v1 = this.negativeVector3( o );
var v2 = this.multiplyMatrix3ByVector3( m2, v1 );

this.setOrigin( t2, v2 );
this.setBasisFromMatrix3( t2, m2 );

this.freeVector3( v1 );
this.freeVector3( v2 );

return t2;

}

multiplyMatrices3( m1, m2 ) {

var m3 = [];

var v10 = this.rowOfMatrix3( m1, 0 );
var v11 = this.rowOfMatrix3( m1, 1 );
var v12 = this.rowOfMatrix3( m1, 2 );

var v20 = this.columnOfMatrix3( m2, 0 );
var v21 = this.columnOfMatrix3( m2, 1 );
var v22 = this.columnOfMatrix3( m2, 2 );

m3[ 0 ] = this.dotVectors3( v10, v20 );
m3[ 1 ] = this.dotVectors3( v10, v21 );
m3[ 2 ] = this.dotVectors3( v10, v22 );
m3[ 3 ] = this.dotVectors3( v11, v20 );
m3[ 4 ] = this.dotVectors3( v11, v21 );
m3[ 5 ] = this.dotVectors3( v11, v22 );
m3[ 6 ] = this.dotVectors3( v12, v20 );
m3[ 7 ] = this.dotVectors3( v12, v21 );
m3[ 8 ] = this.dotVectors3( v12, v22 );

this.freeVector3( v10 );
this.freeVector3( v11 );
this.freeVector3( v12 );
this.freeVector3( v20 );
this.freeVector3( v21 );
this.freeVector3( v22 );

return m3;

}

addVector3( v1, v2 ) {

var v = this.allocVector3();
v.setValue( v1.x() + v2.x(), v1.y() + v2.y(), v1.z() + v2.z() );
return v;

}

dotVectors3( v1, v2 ) {

return v1.x() * v2.x() + v1.y() * v2.y() + v1.z() * v2.z();

}

rowOfMatrix3( m, i ) {

var v = this.allocVector3();
v.setValue( m[ i * 3 + 0 ], m[ i * 3 + 1 ], m[ i * 3 + 2 ] );
return v;

}

columnOfMatrix3( m, i ) {

var v = this.allocVector3();
v.setValue( m[ i + 0 ], m[ i + 3 ], m[ i + 6 ] );
return v;

}

negativeVector3( v ) {

var v2 = this.allocVector3();
v2.setValue( - v.x(), - v.y(), - v.z() );
return v2;

}

multiplyMatrix3ByVector3( m, v ) {

var v4 = this.allocVector3();

var v0 = this.rowOfMatrix3( m, 0 );
var v1 = this.rowOfMatrix3( m, 1 );
var v2 = this.rowOfMatrix3( m, 2 );
var x = this.dotVectors3( v0, v );
var y = this.dotVectors3( v1, v );
var z = this.dotVectors3( v2, v );

v4.setValue( x, y, z );

this.freeVector3( v0 );
this.freeVector3( v1 );
this.freeVector3( v2 );

return v4;

}

transposeMatrix3( m ) {

var m2 = [];
m2[ 0 ] = m[ 0 ];
m2[ 1 ] = m[ 3 ];
m2[ 2 ] = m[ 6 ];
m2[ 3 ] = m[ 1 ];
m2[ 4 ] = m[ 4 ];
m2[ 5 ] = m[ 7 ];
m2[ 6 ] = m[ 2 ];
m2[ 7 ] = m[ 5 ];
m2[ 8 ] = m[ 8 ];
return m2;

}

quaternionToMatrix3( q ) {

var m = [];

var x = q.x();
var y = q.y();
var z = q.z();
var w = q.w();

var xx = x * x;
var yy = y * y;
var zz = z * z;

var xy = x * y;
var yz = y * z;
var zx = z * x;

var xw = x * w;
var yw = y * w;
var zw = z * w;

m[ 0 ] = 1 - 2 * ( yy + zz );
m[ 1 ] = 2 * ( xy - zw );
m[ 2 ] = 2 * ( zx + yw );
m[ 3 ] = 2 * ( xy + zw );
m[ 4 ] = 1 - 2 * ( zz + xx );
m[ 5 ] = 2 * ( yz - xw );
m[ 6 ] = 2 * ( zx - yw );
m[ 7 ] = 2 * ( yz + xw );
m[ 8 ] = 1 - 2 * ( xx + yy );

return m;

}

matrix3ToQuaternion( m ) {

var t = m[ 0 ] + m[ 4 ] + m[ 8 ];
var s, x, y, z, w;

if ( t > 0 ) {

s = Math.sqrt( t + 1.0 ) * 2;
w = 0.25 * s;
x = ( m[ 7 ] - m[ 5 ] ) / s;
y = ( m[ 2 ] - m[ 6 ] ) / s;
z = ( m[ 3 ] - m[ 1 ] ) / s;

} else if ( ( m[ 0 ] > m[ 4 ] ) && ( m[ 0 ] > m[ 8 ] ) ) {

s = Math.sqrt( 1.0 + m[ 0 ] - m[ 4 ] - m[ 8 ] ) * 2;
w = ( m[ 7 ] - m[ 5 ] ) / s;
x = 0.25 * s;
y = ( m[ 1 ] + m[ 3 ] ) / s;
z = ( m[ 2 ] + m[ 6 ] ) / s;

} else if ( m[ 4 ] > m[ 8 ] ) {

s = Math.sqrt( 1.0 + m[ 4 ] - m[ 0 ] - m[ 8 ] ) * 2;
w = ( m[ 2 ] - m[ 6 ] ) / s;
x = ( m[ 1 ] + m[ 3 ] ) / s;
y = 0.25 * s;
z = ( m[ 5 ] + m[ 7 ] ) / s;

} else {

s = Math.sqrt( 1.0 + m[ 8 ] - m[ 0 ] - m[ 4 ] ) * 2;
w = ( m[ 3 ] - m[ 1 ] ) / s;
x = ( m[ 2 ] + m[ 6 ] ) / s;
y = ( m[ 5 ] + m[ 7 ] ) / s;
z = 0.25 * s;

}

var q = this.allocQuaternion();
q.setX( x );
q.setY( y );
q.setZ( z );
q.setW( w );
return q;

}

}

/**
* @param {THREE.SkinnedMesh} mesh
* @param {Object} world - btDiscreteDynamicsWorld
* @param {Object} params
* @param {ResourceManager} manager
*/
class RigidBody {

constructor( mesh, world, params, manager ) {

this.mesh = mesh;
this.world = world;
this.params = params;
this.manager = manager;

this.body = null;
this.bone = null;
this.boneOffsetForm = null;
this.boneOffsetFormInverse = null;
this._linVel = new Vector3();
this._angVel = new Vector3();

this._init();

}

/**
* Resets rigid body transform to the current bone's.
*
* @return {RigidBody}
*/
reset() {

this._setTransformFromBone();
return this;

}

/**
* Updates rigid body's transform from the current bone.
*
* @return {RidigBody}
*/
updateFromBone() {

	if ( this.params.boneIndex !== - 1 ) {

		if ( this.params.type === 0 ) {

			this._setTransformFromBone();

		} else if ( this.params.type === 2 ) {

			this._setPositionFromBone();

		}

	}

	return this;

}

/**
* Updates bone from the current ridid body's transform.
*
* @param {boolean} [stretchEnabled]
* @param {number} [stretchMul]
* @param {Object} [stretchCats]
* @return {RidigBody}
*/
updateBone( stretchEnabled, stretchMul, stretchCats ) {

if ( this.params.type === 0 || this.params.boneIndex === - 1 ) {

return this;

}

this._updateBoneRotation( stretchEnabled, stretchMul, stretchCats );

if ( this.params.type === 1 ) {

this._updateBonePosition( stretchEnabled, stretchMul, stretchCats );

}

this.bone.updateMatrixWorld( true );

if ( this.params.type === 2 ) {

this._setPositionFromBone();

}

return this;

}

_syncVelFromBody() {

	if ( ! this.body ) return;
	const Ammo = ammo();
	const lv = this.body.getLinearVelocity();
	const av = this.body.getAngularVelocity();
	this._linVel = this._linVel || new Vector3();
	this._angVel = this._angVel || new Vector3();
	this._linVel.set( lv.x(), lv.y(), lv.z() );
	this._angVel.set( av.x(), av.y(), av.z() );
	Ammo.destroy( lv );
	Ammo.destroy( av );

}

_syncVelToBody() {

	if ( ! this.body ) return;
	const Ammo = ammo();
	const lv = new Ammo.btVector3( this._linVel.x, this._linVel.y, this._linVel.z );
	const av = new Ammo.btVector3( this._angVel.x, this._angVel.y, this._angVel.z );
	this.body.setLinearVelocity( lv );
	this.body.setAngularVelocity( av );
	Ammo.destroy( lv );
	Ammo.destroy( av );

}

measureBoneBodyDrift() {

	if ( ! this.body || this.params.type === 0 || this.params.boneIndex === - 1 ) return 0;
	const form = this._getBoneTransform();
	const tr = this.body.getCenterOfMassTransform();
	const o = tr.getOrigin();
	const dx = o.x() - form.getOrigin().x();
	const dy = o.y() - form.getOrigin().y();
	const dz = o.z() - form.getOrigin().z();
	const dist = Math.sqrt( dx * dx + dy * dy + dz * dz );
	this.manager.freeTransform( form );
	return dist;

}

_getColliderReach() {

	const p = this.params;
	let size = Math.max( p.width ?? 0.05, 0.002 );
	if ( p.shapeType === 1 ) {

		size = Math.max( size, p.height ?? size, p.depth ?? size );

	} else if ( p.shapeType === 2 ) {

		size = Math.max( size, ( p.height ?? size ) * 0.5 + size );

	}

	return size;

}

_getStretchLimitDist( limitMul, categoryMulMap ) {

	const cat = this._mmdCat || 'other';
	const catMul = ( categoryMulMap && categoryMulMap[ cat ] ) ?? 1;
	return this._getColliderReach() * ( limitMul ?? 3.5 ) * catMul;

}

_init() {

function generateShape( p ) {

switch ( p.shapeType ) {

case 0:
return new (ammo()).btSphereShape( p.width );

case 1:
return new (ammo()).btBoxShape( new (ammo()).btVector3( p.width, p.height, p.depth ) );

case 2:
return new (ammo()).btCapsuleShape( p.width, p.height );

default:
throw new Error( 'unknown shape type ' + p.shapeType );

}

}

const manager = this.manager;
const params = this.params;
const bones = this.mesh.skeleton.bones;
const bone = ( params.boneIndex === - 1 )
? new Bone()
: bones[ params.boneIndex ];

const shape = generateShape( params );
const weight = ( params.type === 0 ) ? 0 : params.weight;
const localInertia = manager.allocVector3();
localInertia.setValue( 0, 0, 0 );

if ( weight !== 0 ) {

shape.calculateLocalInertia( weight, localInertia );

}

const boneOffsetForm = manager.allocTransform();
manager.setIdentity( boneOffsetForm );
manager.setOriginFromArray3( boneOffsetForm, params.position );
manager.setBasisFromArray3( boneOffsetForm, params.rotation );

const vector = manager.allocThreeVector3();
const boneForm = manager.allocTransform();
manager.setIdentity( boneForm );
manager.setOriginFromThreeVector3( boneForm, bone.getWorldPosition( vector ) );

const form = manager.multiplyTransforms( boneForm, boneOffsetForm );
const state = new (ammo()).btDefaultMotionState( form );

const info = new (ammo()).btRigidBodyConstructionInfo( weight, state, shape, localInertia );
info.set_m_friction( params.friction );
info.set_m_restitution( params.restitution );

const body = new (ammo()).btRigidBody( info );

if ( params.type === 0 ) {

body.setCollisionFlags( body.getCollisionFlags() | 2 );

/*
* It'd be better to comment out this line though in general I should call this method
* because I'm not sure why but physics will be more like MMD's
* if I comment out.
*/
body.setActivationState( 4 );

}

body.setDamping( params.positionDamping, params.rotationDamping );
body.setSleepingThresholds( 0, 0 );

this.world.addRigidBody( body, 1 << params.groupIndex, params.groupTarget );

this.body = body;
this.bone = bone;
this.boneOffsetForm = boneOffsetForm;
this.boneOffsetFormInverse = manager.inverseTransform( boneOffsetForm );

manager.freeVector3( localInertia );
manager.freeTransform( form );
manager.freeTransform( boneForm );
manager.freeThreeVector3( vector );

}

_getBoneTransform() {

const manager = this.manager;
const p = manager.allocThreeVector3();
const q = manager.allocThreeQuaternion();
const s = manager.allocThreeVector3();

this.bone.matrixWorld.decompose( p, q, s );

const tr = manager.allocTransform();
manager.setOriginFromThreeVector3( tr, p );
manager.setBasisFromThreeQuaternion( tr, q );

const form = manager.multiplyTransforms( tr, this.boneOffsetForm );

manager.freeTransform( tr );
manager.freeThreeVector3( s );
manager.freeThreeQuaternion( q );
manager.freeThreeVector3( p );

return form;

}

_getWorldTransformForBone() {

const manager = this.manager;
const tr = this.body.getCenterOfMassTransform();
return manager.multiplyTransforms( tr, this.boneOffsetFormInverse );

}

_setTransformFromBone() {

const manager = this.manager;
const form = this._getBoneTransform();

// TODO: check the most appropriate way to set
//this.body.setWorldTransform( form );
this.body.setCenterOfMassTransform( form );
this.body.getMotionState().setWorldTransform( form );

manager.freeTransform( form );

}

_setPositionFromBone() {

const manager = this.manager;
const form = this._getBoneTransform();

const tr = manager.allocTransform();
this.body.getMotionState().getWorldTransform( tr );
manager.copyOrigin( tr, form );

// TODO: check the most appropriate way to set
//this.body.setWorldTransform( tr );
this.body.setCenterOfMassTransform( tr );
this.body.getMotionState().setWorldTransform( tr );

manager.freeTransform( tr );
manager.freeTransform( form );

}

_getMaxRotationDelta( limitMul, categoryMulMap ) {

	const cat = this._mmdCat || 'other';
	const catMul = ( categoryMulMap && categoryMulMap[ cat ] ) ?? 1;
	const base = { hair: 0.11, skirt: 0.14, coat: 0.13, soft: 0.09, other: 0.18 };
	const b = base[ cat ] ?? base.other;
	return b * ( ( limitMul ?? 3.5 ) / 3.5 ) * catMul;

}

_clampRotationToAnimPose( stretchEnabled, stretchMul, stretchCats ) {

	if ( stretchEnabled === false || ! this._animSnapQuat ) return;

	const maxA = this._getMaxRotationDelta( stretchMul, stretchCats );
	if ( ! Number.isFinite( maxA ) || maxA <= 0 ) return;

	const qa = this.bone.quaternion;
	const qb = this._animSnapQuat;
	const dot = Math.abs( qa.dot( qb ) );
	const angle = 2 * Math.acos( Math.min( 1, dot ) );

	if ( angle <= maxA ) return;

	qa.copy( qb ).slerp( qa, maxA / Math.max( angle, 1e-6 ) ).normalize();

}

_updateBoneRotation( stretchEnabled, stretchMul, stretchCats ) {

const manager = this.manager;

const tr = this._getWorldTransformForBone();
const q = manager.getBasis( tr );

const thQ = manager.allocThreeQuaternion();
const thQ2 = manager.allocThreeQuaternion();
const thQ3 = manager.allocThreeQuaternion();

thQ.set( q.x(), q.y(), q.z(), q.w() );
thQ2.setFromRotationMatrix( this.bone.matrixWorld );
thQ2.conjugate();
thQ2.multiply( thQ );

//this.bone.quaternion.multiply( thQ2 );

thQ3.setFromRotationMatrix( this.bone.matrix );

// Renormalizing quaternion here because repeatedly transforming
// quaternion continuously accumulates floating point error and
// can end up being overflow. See #15335
this.bone.quaternion.copy( thQ2.multiply( thQ3 ).normalize() );

this._clampRotationToAnimPose( stretchEnabled, stretchMul, stretchCats );

manager.freeThreeQuaternion( thQ );
manager.freeThreeQuaternion( thQ2 );
manager.freeThreeQuaternion( thQ3 );

manager.freeQuaternion( q );
manager.freeTransform( tr );

}

_updateBonePosition( stretchEnabled, stretchMul, stretchCats ) {

const manager = this.manager;

const tr = this._getWorldTransformForBone();

const thV = manager.allocThreeVector3();

const o = manager.getOrigin( tr );
thV.set( o.x(), o.y(), o.z() );

if ( stretchEnabled ) {

	const maxDist = this._getStretchLimitDist( stretchMul, stretchCats );
	if ( Number.isFinite( maxDist ) && maxDist > 0 ) {

		const boneForm = this._getBoneTransform();
		const boneO = manager.getOrigin( boneForm );
		const bx = boneO.x();
		const by = boneO.y();
		const bz = boneO.z();
		const dx = thV.x - bx;
		const dy = thV.y - by;
		const dz = thV.z - bz;
		const distSq = dx * dx + dy * dy + dz * dz;
		const maxDistSq = maxDist * maxDist;

		if ( distSq > maxDistSq && distSq > 1e-12 ) {

			const dist = Math.sqrt( distSq );
			const scale = maxDist / dist;
			thV.set( bx + dx * scale, by + dy * scale, bz + dz * scale );

		}

		manager.freeTransform( boneForm );

	}

}

if ( this.bone.parent ) {

this.bone.parent.worldToLocal( thV );

}

this.bone.position.copy( thV );

manager.freeThreeVector3( thV );

manager.freeTransform( tr );

}

}

//

class Constraint {

/**
* @param {THREE.SkinnedMesh} mesh
* @param {Object} world - btDiscreteDynamicsWorld
* @param {RigidBody} bodyA
* @param {RigidBody} bodyB
* @param {Object} params
* @param {ResourceManager} manager
*/
constructor( mesh, world, bodyA, bodyB, params, manager ) {

this.mesh = mesh;
this.world = world;
this.bodyA = bodyA;
this.bodyB = bodyB;
this.params = params;
this.manager = manager;

this.constraint = null;

this._init();

}

// private method

_init() {

const manager = this.manager;
const params = this.params;
const bodyA = this.bodyA;
const bodyB = this.bodyB;

const form = manager.allocTransform();
manager.setIdentity( form );
manager.setOriginFromArray3( form, params.position );
manager.setBasisFromArray3( form, params.rotation );

const formA = manager.allocTransform();
const formB = manager.allocTransform();

bodyA.body.getMotionState().getWorldTransform( formA );
bodyB.body.getMotionState().getWorldTransform( formB );

const formInverseA = manager.inverseTransform( formA );
const formInverseB = manager.inverseTransform( formB );

const formA2 = manager.multiplyTransforms( formInverseA, form );
const formB2 = manager.multiplyTransforms( formInverseB, form );

const constraint = new (ammo()).btGeneric6DofSpringConstraint( bodyA.body, bodyB.body, formA2, formB2, true );

const lll = manager.allocVector3();
const lul = manager.allocVector3();
const all = manager.allocVector3();
const aul = manager.allocVector3();

lll.setValue( params.translationLimitation1[ 0 ],
params.translationLimitation1[ 1 ],
params.translationLimitation1[ 2 ] );
lul.setValue( params.translationLimitation2[ 0 ],
params.translationLimitation2[ 1 ],
params.translationLimitation2[ 2 ] );
all.setValue( params.rotationLimitation1[ 0 ],
params.rotationLimitation1[ 1 ],
params.rotationLimitation1[ 2 ] );
aul.setValue( params.rotationLimitation2[ 0 ],
params.rotationLimitation2[ 1 ],
params.rotationLimitation2[ 2 ] );

constraint.setLinearLowerLimit( lll );
constraint.setLinearUpperLimit( lul );
constraint.setAngularLowerLimit( all );
constraint.setAngularUpperLimit( aul );

for ( let i = 0; i < 3; i ++ ) {

if ( params.springPosition[ i ] !== 0 ) {

constraint.enableSpring( i, true );
constraint.setStiffness( i, params.springPosition[ i ] );

}

}

for ( let i = 0; i < 3; i ++ ) {

if ( params.springRotation[ i ] !== 0 ) {

constraint.enableSpring( i + 3, true );
constraint.setStiffness( i + 3, params.springRotation[ i ] );

}

}

constraint.setEquilibriumPoint();

/*
* Custom Ammo build exposes setParam on spring constraints.
* BT_CONSTRAINT_ERP ≈ 0.475 matches MMD / Bullet tuning for hair/skirt.
*/
if ( constraint.setParam !== undefined ) {

const erp = ( ammo().BT_CONSTRAINT_ERP !== undefined ) ? ammo().BT_CONSTRAINT_ERP : 2;

for ( let i = 0; i < 6; i ++ ) {

constraint.setParam( erp, 0.475, i );

}

}

this.world.addConstraint( constraint, true );
this.constraint = constraint;
this.joint = constraint;

manager.freeTransform( form );
manager.freeTransform( formA );
manager.freeTransform( formB );
manager.freeTransform( formInverseA );
manager.freeTransform( formInverseB );
manager.freeTransform( formA2 );
manager.freeTransform( formB2 );
manager.freeVector3( lll );
manager.freeVector3( lul );
manager.freeVector3( all );
manager.freeVector3( aul );

}

}

//

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _matrixWorldInv = new Matrix4();

class MMDPhysicsHelper extends Object3D {

/**
* Visualize Rigid bodies
*
* @param {THREE.SkinnedMesh} mesh
* @param {Physics} physics
*/
constructor( mesh, physics ) {

super();

this.root = mesh;
this.physics = physics;

this.matrix.copy( mesh.matrixWorld );
this.matrixAutoUpdate = false;

this.materials = [];

this.materials.push(
new MeshBasicMaterial( {
color: new Color( 0xff8888 ),
wireframe: true,
depthTest: false,
depthWrite: false,
opacity: 0.25,
transparent: true
} )
);

this.materials.push(
new MeshBasicMaterial( {
color: new Color( 0x88ff88 ),
wireframe: true,
depthTest: false,
depthWrite: false,
opacity: 0.25,
transparent: true
} )
);

this.materials.push(
new MeshBasicMaterial( {
color: new Color( 0x8888ff ),
wireframe: true,
depthTest: false,
depthWrite: false,
opacity: 0.25,
transparent: true
} )
);

this._init();

}

/**
* Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.
*/
dispose() {

const materials = this.materials;
const children = this.children;

for ( let i = 0; i < materials.length; i ++ ) {

materials[ i ].dispose();

}

for ( let i = 0; i < children.length; i ++ ) {

const child = children[ i ];

if ( child.isMesh ) child.geometry.dispose();

}

}

/**
* Updates Rigid Bodies visualization.
*/
updateMatrixWorld( force ) {

var mesh = this.root;

if ( this.visible ) {

var bodies = this.physics.bodies;

_matrixWorldInv
.copy( mesh.matrixWorld )
.decompose( _position, _quaternion, _scale )
.compose( _position, _quaternion, _scale.set( 1, 1, 1 ) )
.invert();

for ( var i = 0, il = bodies.length; i < il; i ++ ) {

var body = bodies[ i ].body;
var child = this.children[ i ];

var tr = body.getCenterOfMassTransform();
var origin = tr.getOrigin();
var rotation = tr.getRotation();

child.position
.set( origin.x(), origin.y(), origin.z() )
.applyMatrix4( _matrixWorldInv );

child.quaternion
.setFromRotationMatrix( _matrixWorldInv )
.multiply(
_quaternion.set( rotation.x(), rotation.y(), rotation.z(), rotation.w() )
);

}

}

this.matrix
.copy( mesh.matrixWorld )
.decompose( _position, _quaternion, _scale )
.compose( _position, _quaternion, _scale.set( 1, 1, 1 ) );

super.updateMatrixWorld( force );

}

// private method

_init() {

var bodies = this.physics.bodies;

function createGeometry( param ) {

switch ( param.shapeType ) {

case 0:
return new SphereGeometry( param.width, 16, 8 );

case 1:
return new BoxGeometry( param.width * 2, param.height * 2, param.depth * 2, 8, 8, 8 );

case 2:
return new CapsuleGeometry( param.width, param.height, 8, 16 );

default:
return null;

}

}

for ( var i = 0, il = bodies.length; i < il; i ++ ) {

var param = bodies[ i ].params;
this.add( new Mesh( createGeometry( param ), this.materials[ param.type ] ) );

}

}

}

export { MMDPhysics, MMDPhysicsHelper };
