#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# setup-mmd.sh
#
# Downloads three.js r166, JSZip, mp4-muxer into ./vendor/
# so mmd_rtx.html can load without any CDN. No npm required — just curl + tar.
#
# Physics: stock MMDPhysics + custom Ammo.js (64-bit, ERP fix, 256MB heap)
# in ./vendor/ammo/ and ./vendor/nexus-phys/
#
# Usage:  bash setup-mmd.sh
# Then:   python3 -m http.server 8000
#         open http://localhost:8000/mmd_rtx.html
# ---------------------------------------------------------------------------
set -euo pipefail

VENDOR_DIR="vendor"
THREE_DIR="$VENDOR_DIR/three"
JSZIP_DIR="$VENDOR_DIR/jszip"
MP4_DIR="$VENDOR_DIR/mp4-muxer"
AMMO_DIR="$VENDOR_DIR/ammo"
NEXUS_DIR="$VENDOR_DIR/nexus-phys"

download_and_extract() {
  local name="$1"
  local url="$2"
  local dest="$3"
  local tarball="$VENDOR_DIR/$(basename "$url")"

  if [ -d "$dest" ]; then
    echo "→ $dest already exists, skipping download."
    echo "  (Delete it first if you want to re-download.)"
    return
  fi

  echo "→ Downloading $name..."
  mkdir -p "$VENDOR_DIR"
  if command -v curl >/dev/null; then
    curl -L "$url" -o "$tarball"
  elif command -v wget >/dev/null; then
    wget -O "$tarball" "$url"
  else
    echo "ERROR: need curl or wget installed." >&2
    exit 1
  fi

  echo "→ Extracting into $dest/"
  mkdir -p "$dest"
  tar -xzf "$tarball" -C "$dest" --strip-components=1
  rm "$tarball"
}

download_and_extract "three.js r166" \
  "https://registry.npmjs.org/three/-/three-0.166.0.tgz" \
  "$THREE_DIR"

download_and_extract "JSZip 3.10.1" \
  "https://registry.npmjs.org/jszip/-/jszip-3.10.1.tgz" \
  "$JSZIP_DIR"

download_and_extract "mp4-muxer 5.1.3" \
  "https://registry.npmjs.org/mp4-muxer/-/mp4-muxer-5.1.3.tgz" \
  "$MP4_DIR"

# JSZip ships as UMD only; the HTML loads this ESM shim via import map.
JSZIP_ESM="$JSZIP_DIR/jszip.esm.js"
if [ ! -f "$JSZIP_ESM" ]; then
  echo "→ Writing $JSZIP_ESM"
  cat > "$JSZIP_ESM" <<'EOF'
/** Browser ESM shim for the JSZip UMD build (offline use). */
const src = new URL('./dist/jszip.min.js', import.meta.url).href;

if (!globalThis.JSZip) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load JSZip from ' + src));
    document.head.appendChild(s);
  });
}

export default globalThis.JSZip;
EOF
fi

# After fresh three.js install, restore NexusPhys MMDPhysics shim
MMD_PHYS="$THREE_DIR/examples/jsm/animation/MMDPhysics.js"
if [ -f "$MMD_PHYS" ] && ! grep -q 'nexus-phys' "$MMD_PHYS" 2>/dev/null; then
  echo "→ Restoring NexusPhys shim in $MMD_PHYS"
  cat > "$MMD_PHYS" <<'EOF'
/**
 * MMD physics — re-exports NexusPhys (stock three.js MMDPhysics on custom Ammo.js).
 */
export { MMDPhysics, MMDPhysicsHelper, createSharedWorld, getSharedWorld, disposeSharedWorld } from '../../../../nexus-phys/NexusMMDPhysics.js';
EOF
fi

REQUIRED=(
  "$THREE_DIR/build/three.module.js"
  "$THREE_DIR/examples/jsm/controls/OrbitControls.js"
  "$THREE_DIR/examples/jsm/loaders/MMDLoader.js"
  "$THREE_DIR/examples/jsm/animation/MMDAnimationHelper.js"
  "$THREE_DIR/examples/jsm/animation/MMDPhysics.js"
  "$AMMO_DIR/ammo.wasm.js"
  "$AMMO_DIR/ammo.wasm.wasm"
  "$AMMO_DIR/ammo-init.js"
  "$NEXUS_DIR/NexusMMDPhysics.js"
  "$JSZIP_DIR/dist/jszip.min.js"
  "$JSZIP_ESM"
  "$MP4_DIR/build/mp4-muxer.mjs"
)
echo "→ Verifying required files..."
missing=0
for f in "${REQUIRED[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  MISSING: $f"
    missing=1
  fi
done
if [ $missing -ne 0 ]; then
  echo "ERROR: some required files are missing."
  echo "  Run: bash build-ammo.sh   (custom Ammo with setParam + 256MB heap)"
  exit 1
fi

echo ""
echo "✓ Done. Offline dependencies are in ./$VENDOR_DIR/"
echo ""
echo "Physics engine: Bullet Physics (Ammo.js) — custom 64-bit build"
echo "  Rebuild Ammo: bash build-ammo.sh"
echo ""
echo "Next steps:"
echo "  1. Make sure mmd_rtx.html is in this folder (next to ./vendor/)"
echo "  2. Start a local HTTP server:"
echo "       python3 -m http.server 8000"
echo "  3. Open: http://localhost:8000/mmd_rtx.html"
echo ""
