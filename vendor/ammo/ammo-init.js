/**
 * Offline Ammo.js (Bullet) init for mmd_rtx.html.
 * Loads ammo.wasm.js via script tag (UMD/Modularize build), then initializes WASM.
 * Custom build: 64-bit double-precision Bullet + 256MB heap + ALLOW_MEMORY_GROWTH.
 */
let _Ammo = null;
let _initPromise = null;

export const AMMO_DOUBLE_PRECISION = true;

export async function initAmmo() {

	if ( _Ammo ) return _Ammo;

	if ( ! _initPromise ) {

		_initPromise = new Promise( ( resolve, reject ) => {

			const src = new URL( './ammo.wasm.js', import.meta.url ).href;
			const wasmUrl = new URL( './ammo.wasm.wasm', import.meta.url ).href;

			const finish = async () => {

				try {

					const factory = globalThis.Ammo;

					if ( typeof factory !== 'function' ) {

						throw new Error( 'Ammo factory not found after loading ammo.wasm.js' );

					}

					const lib = await factory( {
						locateFile( path ) {

							if ( path.endsWith( '.wasm' ) ) return wasmUrl;
							return path;

						},
					} );

					_Ammo = lib;
					globalThis.Ammo = lib;
					resolve( lib );

				} catch ( e ) {

					reject( e );

				}

			};

			if ( globalThis.Ammo ) {

				finish();
				return;

			}

			const s = document.createElement( 'script' );
			s.src = src;
			s.async = true;
			s.onload = () => finish();
			s.onerror = () => reject( new Error( 'Failed to load ' + src ) );
			document.head.appendChild( s );

		} );

	}

	return _initPromise;

}

export function getAmmo() {

	if ( ! _Ammo ) {

		throw new Error( 'Ammo not initialized — call initAmmo() first' );

	}

	return _Ammo;

}

export function isAmmoReady() {

	return _Ammo !== null;

}

export default _Ammo;
