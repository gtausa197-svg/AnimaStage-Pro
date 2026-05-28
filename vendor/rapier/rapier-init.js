/**
 * Offline Rapier init for mmd_rtx.html (ESM).
 * Must call initRapier() once before MMDPhysics is constructed.
 */
import RAPIER from './rapier.es.js';

let _ready = false;

export async function initRapier() {
  if (!_ready) {
    await RAPIER.init();
    _ready = true;
  }
  return RAPIER;
}

export function getRapier() {
  if (!_ready) {
    throw new Error('Rapier not initialized — call initRapier() first');
  }
  return RAPIER;
}

export function isRapierReady() {
  return _ready;
}

export default RAPIER;
