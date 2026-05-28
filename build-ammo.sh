#!/usr/bin/env bash
# Rebuild Ammo.js (Bullet) for mmd_rtx.html:
#   - USE_DOUBLE_PRECISION=ON  (64-bit float / double physics)
#   - 256MB initial heap + ALLOW_MEMORY_GROWTH
# Requires: git, cmake, python3, and Emscripten (installs emsdk to /tmp/emsdk if missing).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
AMMO_DIR="$ROOT/vendor/ammo"
BUILD_DIR="/tmp/ammo-build"
EMSDK="/tmp/emsdk"

if [ ! -d "$EMSDK" ]; then
  echo "→ Cloning Emscripten SDK to $EMSDK"
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK"
  "$EMSDK/emsdk" install latest
  "$EMSDK/emsdk" activate latest
fi

# shellcheck source=/dev/null
source "$EMSDK/emsdk_env.sh"

if [ ! -d "$BUILD_DIR" ]; then
  echo "→ Cloning ammo.js"
  git clone --depth 1 https://github.com/kripken/ammo.js.git "$BUILD_DIR"
fi

# 64-bit Bullet: WebIDL bindings must use double, not float (regenerate glue.cpp)
if [ ! -f "$BUILD_DIR/ammo.idl.orig" ]; then
  cp "$BUILD_DIR/ammo.idl" "$BUILD_DIR/ammo.idl.orig"
fi
cp "$BUILD_DIR/ammo.idl.orig" "$BUILD_DIR/ammo.idl"
sed -i 's/\bfloat\b/double/g' "$BUILD_DIR/ammo.idl"

# CMake / Emscripten 5.x patches (idempotent)
if grep -q 'EXTRA_EXPORTED_RUNTIME_METHODS' "$BUILD_DIR/CMakeLists.txt" 2>/dev/null; then
  sed -i 's/-s EXTRA_EXPORTED_RUNTIME_METHODS=\["addFunction"\]//' "$BUILD_DIR/CMakeLists.txt"
  sed -i 's/EXPORTED_RUNTIME_METHODS=\["UTF8ToString"\]/EXPORTED_RUNTIME_METHODS=["UTF8ToString","addFunction"]/' "$BUILD_DIR/CMakeLists.txt"
  sed -i '/--llvm-lto 1/d' "$BUILD_DIR/CMakeLists.txt"
fi
grep -q 'Wno-c++11-narrowing' "$BUILD_DIR/CMakeLists.txt" || sed -i '/-O3/a\  -Wno-c++11-narrowing' "$BUILD_DIR/CMakeLists.txt"
grep -q 'DBT_USE_DOUBLE_PRECISION' "$BUILD_DIR/CMakeLists.txt" || \
  sed -i 's|-include${AMMO_HEADER_FILE}|-DBT_USE_DOUBLE_PRECISION -include${AMMO_HEADER_FILE}|' "$BUILD_DIR/CMakeLists.txt"
grep -q 'tex_coords/g' "$BUILD_DIR/CMakeLists.txt" || \
  sed -i '/WEBIDL_BINDER_SCRIPT.*glue$/a\  COMMAND sed -i "s/double\\\\* tex_coords/float* tex_coords/g" glue.cpp' "$BUILD_DIR/CMakeLists.txt"

echo "→ Building Ammo WASM (64-bit double precision, 256MB + ALLOW_MEMORY_GROWTH)..."
rm -rf "$BUILD_DIR/builds"
cmake -B "$BUILD_DIR/builds" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_CXX_FLAGS="-Wno-c++11-narrowing -DBT_USE_DOUBLE_PRECISION" \
  -DUSE_DOUBLE_PRECISION=ON \
  -DTOTAL_MEMORY=268435456 -DALLOW_MEMORY_GROWTH=1
cmake --build "$BUILD_DIR/builds" --target ammo-wasm -j"$(nproc)"

mkdir -p "$AMMO_DIR"
cp "$BUILD_DIR/builds/ammo.wasm.js" "$BUILD_DIR/builds/ammo.wasm.wasm" "$AMMO_DIR/"
echo "✓ Installed to $AMMO_DIR"
