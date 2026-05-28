/**
 * Offline Jolt.js init for mmd_rtx.html (ESM).
 * Must call initJolt() once before MMDPhysics is constructed.
 *
 * @see https://github.com/jrouwe/JoltPhysics.js
 */
import JoltModule from './dist/jolt-physics.wasm-compat.js';

let _Jolt = null;
let _initPromise = null;
let _sharedWorld = null;

const LAYER_MMD = 0;

export async function initJolt() {
	if ( _Jolt ) return _Jolt;
	if ( ! _initPromise ) {
		_initPromise = JoltModule().then( ( Jolt ) => {
			_Jolt = Jolt;
			return Jolt;
		} );
	}
	return _initPromise;
}

export function getJolt() {
	if ( ! _Jolt ) {
		throw new Error( 'Jolt not initialized — call initJolt() first' );
	}
	return _Jolt;
}

export function isJoltReady() {
	return _Jolt !== null;
}

function vec3FromThree( v ) {
	const Jolt = getJolt();
	return new Jolt.Vec3( v.x, v.y, v.z );
}

function rvec3FromThree( v ) {
	const Jolt = getJolt();
	return new Jolt.RVec3( v.x, v.y, v.z );
}

function quatFromThree( q ) {
	const Jolt = getJolt();
	return new Jolt.Quat( q.x, q.y, q.z, q.w );
}

/**
 * @param {{ x: number, y: number, z: number } | import('three').Vector3} gravity
 */
export function createJoltWorld( gravity = { x: 0, y: - 98, z: 0 } ) {

	const Jolt = getJolt();
	const gx = gravity.x ?? 0;
	const gy = gravity.y ?? - 98;
	const gz = gravity.z ?? 0;

	const settings = new Jolt.JoltSettings();
	settings.mMaxBodies = 65536;
	settings.mMaxBodyPairs = 65536;
	settings.mMaxContactConstraints = 8192;

	const objectFilter = new Jolt.ObjectLayerPairFilterMask();
	const bpInterface = new Jolt.BroadPhaseLayerInterfaceMask( 1 );
	bpInterface.ConfigureLayer( new Jolt.BroadPhaseLayer( LAYER_MMD ), 0xffff, 0 );
	settings.mObjectLayerPairFilter = objectFilter;
	settings.mBroadPhaseLayerInterface = bpInterface;
	settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterMask( bpInterface );

	const jolt = new Jolt.JoltInterface( settings );
	Jolt.destroy( settings );

	const physicsSystem = jolt.GetPhysicsSystem();
	const bodyInterface = physicsSystem.GetBodyInterface();

	const physSettings = physicsSystem.GetPhysicsSettings();
	physSettings.mNumVelocitySteps = 12;
	physSettings.mNumPositionSteps = 4;
	physSettings.mConstraintWarmStart = true;
	physicsSystem.SetPhysicsSettings( physSettings );

	const g = new Jolt.Vec3( gx, gy, gz );
	physicsSystem.SetGravity( g );
	Jolt.destroy( g );

	return {
		jolt,
		physicsSystem,
		bodyInterface,
		objectFilter,
		layer: LAYER_MMD,
		gravity: { x: gx, y: gy, z: gz },
		stepSimulation( delta, maxStepNum, unitStep ) {

			let stepTime = delta;
			let steps = ( ( delta / unitStep ) | 0 ) + 1;
			if ( stepTime < unitStep ) {

				stepTime = unitStep;
				steps = 1;

			}
			if ( steps > maxStepNum ) steps = maxStepNum;
			for ( let i = 0; i < steps; i ++ ) {

				jolt.Step( unitStep, 1 );

			}

		},
		setGravity( vec ) {

			const gv = new Jolt.Vec3( vec.x, vec.y, vec.z );
			physicsSystem.SetGravity( gv );
			Jolt.destroy( gv );
			this.gravity.x = vec.x;
			this.gravity.y = vec.y;
			this.gravity.z = vec.z;

		},
	};

}

export function getMMDObjectLayer( groupIndex, groupTarget, objectFilter ) {

	const group = 1 << ( groupIndex | 0 );
	return objectFilter.sGetObjectLayer( group, groupTarget >>> 0 );

}

/** One shared Jolt world for the browser session (MMD body/constraint swap per model). */
export function createSharedWorld( gravity ) {

	if ( _sharedWorld ) return _sharedWorld;

	const g = gravity && typeof gravity.x === 'number'
		? { x: gravity.x, y: gravity.y, z: gravity.z }
		: { x: 0, y: - 98, z: 0 };

	_sharedWorld = createJoltWorld( g );
	return _sharedWorld;

}

export function getSharedWorld() {

	return _sharedWorld;

}

export function disposeSharedWorld() {

	if ( ! _sharedWorld ) return;
	const Jolt = getJolt();
	Jolt.destroy( _sharedWorld.jolt );
	_sharedWorld = null;

}

export { vec3FromThree, rvec3FromThree, quatFromThree, LAYER_MMD };
export default _Jolt;
