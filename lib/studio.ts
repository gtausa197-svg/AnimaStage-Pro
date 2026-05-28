/** AnimaStage Pro viewer — served from /public via next.config symlinks */
export const STUDIO_URL = "/mmd_rtx.html";

export function openAnimaStagePro() {
  window.location.assign(STUDIO_URL);
}
