<p align="center">
  <img src="assets/pasted file.jpg" alt="AnimaStage" width="900"/>
</p>

<h1 align="center">⚡ AnimaStage — Browser-Native MMD Studio</h1>

<p align="center">
  <b>Full MMD Production Environment. No Install. No Windows Lock-in. Just a Tab.</b><br>
  <i>Multi-Character · Bone Editor · Cinematic Camera · Bullet Physics · MP4 Export · Shorts-Ready</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-Pro%205.0%20%2B%20Lite%201.0-blue" alt="Version"/>
  <img src="https://img.shields.io/badge/Renderer-WebGL%202.0%20%2B%20Three.js-orange" alt="WebGL2"/>
  <img src="https://img.shields.io/badge/Physics-Bullet%20WASM-green" alt="Physics"/>
  <img src="https://img.shields.io/badge/Export-WebCodecs%20MP4-red" alt="Export"/>
  <img src="https://img.shields.io/badge/Format-PMX%20%2F%20PMD%20%2F%20VMD-purple" alt="Format"/>
  <img src="https://img.shields.io/badge/Shorts-9%3A16%20Ready-ff69b4" alt="Shorts"/>
  <img src="https://img.shields.io/badge/License-Apache%202.0-lightgrey" alt="License"/>
  <a href="https://www.animastage.net"><img src="https://img.shields.io/badge/🌐-Website-blue" alt="Website"/></a>
</p>

---

## 🎬 What is AnimaStage?

AnimaStage is a **browser-native MMD studio** — drop in your PMX model, VMD motion, and textures (or a whole ZIP), and you're in a full production environment. No DirectX. No installer. No "run as admin." Works on Mac, Linux, Windows, and iPad.

The MMD toolchain has been frozen in time for years — Windows-only, no real-time collaboration, no modern rendering. AnimaStage rebuilds that workflow from the ground up inside a browser tab, with a rendering pipeline that actually looks good and a bone editor that respects animation fundamentals.

We ship **two editions** because the use cases are genuinely different:

<p align="center">
  <img src="assets/banner_lite.png" alt="AnimaStage Lite" width="440"/>
  &nbsp;&nbsp;
  <img src="assets/banner_pro.png" alt="AnimaStage Pro" width="440"/>
</p>

| | AnimaStage **Lite** | AnimaStage **Pro** |
|---|---|---|
| Focus | Fast preview · Shorts/Reels/TikTok export | Full cinematic production |
| Renderer | WebGL 2.0, DPR 1×, optimized loop | EffectComposer, full post-FX pipeline |
| Physics | Bullet WASM, presets | Bullet WASM, deep manual tuning |
| Timeline | VMD dopesheet + VMD export | Dual timeline (VMD + Cinematic camera) |
| Characters | Single + multi | Multi-character, independent VMD per char |
| Export | WebCodecs MP4, **5× faster** than offline | WebCodecs + frame-by-frame HQ render |
| Bone editor | — | Full G/R/S gizmo editor in viewport |
| Cinematic camera | Basic bookmarks | Spline path, keyframes, track lock |
| Target | Creators, low-spec machines | Studios, production teams |
| Server | `npm run dev` (Node 18+) | Local HTTP (no file://) |

---

## 🏆 Key Numbers

| Metric | Value |
|--------|-------|
| Supported formats | PMX, PMD, VMD, ZIP, HDR, PNG / BMP / TGA / SPA / SPH |
| Vertical export | Native 1080×1920 (9:16) |
| Export speed | **5× faster** than traditional offline render (WebCodecs) |
| GPU load reduction | **~60%** vs standard MMD pipeline at ~80% visual parity |
| Physics engine | Ammo.js (Bullet) WASM, default 1/65 Hz, 3 substeps |
| Post-FX passes | SSAO → DOF → Volumetric → Bloom → Color Grading → Output |
| Shadow map | Up to 8192×8192 PCFSoft |
| Physics bodies debug | Live rigid body visualization in viewport |
| Session format | JSON (positions, VMD assignments, play state, camera path) |

---

## 🖼️ Screenshots

<p align="center">
  <img src="assets/screenshot_bone.png" alt="Bone Editor" width="440"/>
  &nbsp;
  <img src="assets/screenshot_cam.png" alt="Cinematic Camera" width="440"/>
</p>
<p align="center">
  <img src="assets/screenshot_tl.png" alt="Timeline" width="440"/>
  &nbsp;
  <img src="assets/screenshot_lite.png" alt="Lite Shorts Mode" width="440"/>
</p>

---

## ✨ Feature Overview

### 1. MMD Content Loading
Drag-and-drop or file picker for `.pmx`, `.pmd`, `.vmd`, `.zip`, folders, `.hdr`.
`fileMap` + Blob URL system with automatic texture fallbacks (`.tga → .png`, `.bmp`, `.spa`, `.sph`). Drop a full model folder with textures and it resolves everything automatically — the standard MMD workflow without any path configuration.

### 2. Multi-Character Scenes *(Pro)*
Multiple PMX models simultaneously, each with independent VMD assignments and play state. A `characters[]` array drives `animHelper` updates per mesh. Per-character play / pause / loop controls. Select active character for bone editing or timeline focus.

```
Scene
├── Character 0 — Miku.pmx    → IevanPolkka.vmd  [playing]
├── Character 1 — Haku.pmx    → IevanPolkka.vmd  [playing, offset +2s]
└── Character 2 — Luka.pmx    → CustomPose.vmd   [paused, frame 0]
```

### 3. VMD Library + Assignment *(Pro)*
VMD files load into a global library. Any loaded animation can be assigned to any character without duplicating files. `mmdLoader.loadAnimation()` retargets the clip to the target skeleton — one motion file, multiple characters.

### 4. Bone Animation Editor *(Pro)*
Full pose editor inside the Three.js viewport.

<p align="center">
  <img src="assets/screenshot_bone.png" alt="Bone Editor Detail" width="600"/>
</p>

| Feature | Detail |
|---------|--------|
| Transform modes | Move / Rotate / Scale (G / R / S) |
| Space | Local and World, X / Z axis locks |
| Selection | Click bone in viewport, list, or skeleton map |
| Mirror | L ↔ R auto-mirror |
| Anatomy | Joint limits by anatomical region (spine, arms, IK, root) |
| Keyframes | Timeline integration, auto-key, preview |
| Bake | Export to anim list, import/export JSON |
| Persistence | localStorage autosave |

`TransformControls` operates on a bone gizmo proxy — bone names, anatomical roles, and regions are surfaced in the UI panel.

### 5. Cinematic Camera System *(Pro)*

<p align="center">
  <img src="assets/screenshot_cam.png" alt="Camera Path" width="600"/>
</p>

| Feature | Detail |
|---------|--------|
| Path type | Catmull-Rom spline (smooth interpolation) |
| Keyframes | Position, target, FOV per keyframe (hotkey **K**) |
| Edit in 3D | Cyan / yellow handles visible in viewport |
| Track lock | Click model → smooth follow with cinematic damping |
| Sync | Locked to VMD timeline or cinematic timeline |
| View mode | Camera View (Numpad 0), letterbox 2.39:1 |
| Export | JSON path export / import |

**Camera Bookmarks** — 9 saved angles (keyboard 1–9), fly-to tween with configurable ease time, localStorage + `mmd-shots.json` export.

### 6. Dual Timeline *(Pro)*

<p align="center">
  <img src="assets/screenshot_tl.png" alt="Dual Timeline" width="700"/>
</p>

**VMD Timeline** (bottom of viewport)
Scrub, loop region (in/out marks), play / pause / stop. Synchronized with `MMDAnimationHelper` mixer time.

**Cinematic Timeline** (`#cinTimeline`)
Camera keyframe track. Drag keys, extend duration, export/import. Ctrl+scroll to zoom. Click to seek, `+ KF` to add camera keyframe at current time.

### 7. Bullet Physics

```
Physics config:
  unitStep   = 1 / physicsRate   (default 1/65 s — MMD-tuned)
  maxStepNum = physicsSubsteps   (default 3)
  gravity    = Vector3(0, -98 × gravityMultiplier, 0)
  warmup     = N frames pre-simulated on model load
```

| Control | Range | Purpose |
|---------|-------|---------|
| Step rate | 30–200 Hz | Simulation accuracy. >150 Hz risks constraint explosion on most PMX |
| Substeps | 1–8 | Per-frame integration steps |
| Gravity | 0–2× | Multiplier on MMD default (−98) |
| Swing | 0–0.95 | Reduces rigid body damping → hair/skirt sway longer |
| Wind | 0–60 | Turbulent force on dynamic bodies, applied pre-physics-step |
| Warmup | 0–300 frames | Pre-simulates physics on load so cloth settles immediately |

**W-bone support** (Sour Miku, TDA models) — arm collision filtering between hands and torso. `debugArmBodies()` and `debugArmIK()` available in browser console.

**Safe Defaults** button resets all physics to MMD-standard values in one click — useful after experimenting caused hair to explode.

### 8. Post-FX Pipeline — "RTX-style"

```
EffectComposer pass chain:

  RenderPass (or TAARenderPass, 4-sample)
      ↓
  SSAOPass          — ambient occlusion, kernel radius + strength
      ↓
  BokehPass         — depth of field, auto-track focus on model
      ↓
  Volumetric Pass   — raymarch fog + screen-space god rays from sun/rim/fill
      ↓
  UnrealBloomPass   — threshold, strength, radius
      ↓
  FinalFX Shader    — vignette · grain · chromatic aberration
                      saturation · contrast · shadow/highlight tint
      ↓
  FXAAShader        — edge cleanup
      ↓
  OutputPass        — color space + tonemapping
```

**Tonemapping options:** ACES Filmic · Reinhard · Cineon · AgX · Linear

**Separate:** MMD outline (toon backface pass), reflective floor (Reflector, planar), rim + fill lights.

**Style presets** — quick LUT-like presets snap the full post-FX chain to a curated look.

### 9. Sun, Sky & Volumetric Light

**Procedural sky dome** — Preetham model. Presets: Morning / Noon / Sunset / Night. Sun color automatically derived from elevation angle. Auto moon opposite sun position.

**Volumetric Lighting** — custom fullscreen pass, fog raymarch + screen-space god rays from directional sun, rim, and fill lights.

| Parameter | Control |
|-----------|---------|
| Density | Fog thickness |
| Fog height | World-space cutoff |
| Exposure | God ray intensity |
| Samples | Ray march quality (perf/quality tradeoff) |
| Decay | Ray falloff |
| Noise | Turbulence texture |
| Tint | Color shift |

### 10. Weather System

| Preset | Effects |
|--------|---------|
| ☀️ Clear | Default sun, no precip |
| 🌧 Rain | Instanced rain particles, wetness on floor material |
| ⛈ Storm | Heavy rain, dark sky, near-zero sun, fog integration |
| 🌫 Fog | FogExp2, reduced sun, volumetric pass activated |
| ❄️ Snow | Soft particle snow, ground snow lerp, blue-white sky |
| 🌸 Sakura | Pink petal particles, warm sunset sky |

Wetness scales floor roughness to near-zero (mirror-like) and boosts Reflector intensity dynamically.

### 11. Scene Editor *(Pro)*
Blender-style outliner + transforms for scene objects.

- **Light types:** Point · Spot · Directional · Hemisphere + viewport helpers
- **Empty props** for scene anchors
- Visibility toggle, delete, G / R / S per object (separate from bone transforms)

### 12. MP4 Export & Render

| Mode | Method | Quality |
|------|--------|---------|
| Live record | WebCodecs, real-time capture | High (no slowdown) |
| Offline HQ render | Frame-by-frame compositor capture | Maximum |
| Clean mode | Hides HUD, gizmos, overlays | Screenshot-ready |
| 4K screenshot | `renderer.setSize(W×4, H×4)` single frame | Lossless PNG |

Lite's WebCodecs pipeline is **5× faster** than traditional MMD rendering — what takes minutes offline takes seconds in the browser.

### 13. Lite — 9:16 Shorts Mode

<p align="center">
  <img src="assets/screenshot_lite.png" alt="Lite Shorts" width="340"/>
</p>

AnimaStage Lite is a lightweight, stability-focused edition built specifically for vertical video creators.

```
Lite rendering constraints:
  DPR   = 1.0×  (fixed, no HDPI scaling)
  Ratio = 9:16 locked
  Export = 1080×1920 native
  WebGL context recovery on memory pressure — auto
```

**~80% visual quality at ~40% GPU load** compared to full desktop MMD rendering. An effective alternative for creators on mid-range or low-spec machines.

**Performance comparison:**

| Metric | AnimaStage Lite | Standard MMD |
|--------|----------------|-------------|
| GPU load | ~40% (optimal) | ~100% (heavy) |
| Visual fidelity | ~80% | 100% |
| Export time | **5× faster** (seconds) | Minutes |
| Platform | Any browser | Windows only |
| Installation | None | MMD + DirectX |

### 14. Session Save / Load *(Pro)*

Sessions export as `animastage-session-*.json`. Saved state includes:

- All character positions, rotations, scales
- VMD assignment per character
- Current animation time and play state
- Camera position, target, FOV
- Scene light configuration
- Physics settings

> **Note:** Binary files (PMX, VMD, textures) are not embedded in JSON. On import, re-drop the same folder or ZIP with matching filenames.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AnimaStage Pro                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   mmd_rtx.html                                                  │
│   ├── UI + collapsible panel                                    │
│   ├── EffectComposer render pipeline                            │
│   ├── Weather / sky / volumetric light                          │
│   ├── Cinematic camera + bookmark system                        │
│   ├── Scene editor (lights, props, outliner)                    │
│   ├── Dual timeline (VMD + cinematic)                           │
│   └── Session save / load                                       │
│                                                                 │
│   mmd-character-motion.js                                       │
│   ├── createCharacterMotionSystem()                             │
│   ├── playAnimOnMesh(), updateMultiCharacterMotion()            │
│   ├── Bone editor (~1000+ lines)                                │
│   │   ├── Anatomy system + joint limits                         │
│   │   ├── TransformControls gizmo proxy                         │
│   │   ├── Keyframe store + bake                                 │
│   │   └── Mirror L↔R, auto-key                                  │
│   ├── Physics helpers: wind, swing, dispose, reload             │
│   └── Debug: debugArmBodies(), debugArmIK()                     │
│                                                                 │
│   vendor/                                                       │
│   ├── three.js (build + jsm addons)                             │
│   ├── ammo.wasm.js  (Bullet physics WASM)                       │
│   ├── jszip          (ZIP drag-drop support)                    │
│   └── mp4-muxer      (WebCodecs MP4 muxing)                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        AnimaStage Lite                          │
├─────────────────────────────────────────────────────────────────┤
│   index.html / app.js                                           │
│   ├── DPR 1× fixed render loop                                  │
│   ├── 9:16 vertical format, auto crop                           │
│   ├── VMD dopesheet + interpolation curve editor                │
│   ├── VMD export (modified motions back to .vmd)                │
│   ├── Bullet physics presets                                    │
│   ├── WebCodecs record → MP4 (no timeline slowdown)            │
│   ├── RTX Lite post-FX (DOF, bloom, weather, color grade)       │
│   ├── WebGL context auto-recovery (low-memory resilience)       │
│   └── Motion layer blending (Pro feature preview)               │
└─────────────────────────────────────────────────────────────────┘
```

<p align="center">
  <img src="assets/arch_diagram.png" alt="Architecture Diagram" width="700"/>
</p>

---

## 🚀 Quick Start

### AnimaStage Lite (npm)

Requires **Node.js 18+** and a Chromium-based browser (Chrome, Edge, Opera) with WebGL2.

```bash
# 1. Clone the repository
git clone https://github.com/your-handle/AnimaStage.git
cd AnimaStage/lite

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Open in browser
# → http://localhost:3000
```

### AnimaStage Pro (local HTTP server)

ES modules require a local HTTP server — `file://` protocol is blocked by CORS.

```bash
cd AnimaStage/pro

# Option A — Python (no install needed)
python3 -m http.server 8000
# → http://localhost:8000/mmd_rtx.html

# Option B — Node http-server
npx http-server . -p 8000
# → http://localhost:8000/mmd_rtx.html
```

### Vendor folder setup

```bash
# Run the provided setup script to populate ./vendor/three/
bash setup-mmd.sh

# Folder structure after setup:
vendor/
├── three/
│   ├── build/three.module.js
│   ├── examples/jsm/
│   │   ├── loaders/MMDLoader.js
│   │   ├── animation/MMDAnimationHelper.js
│   │   ├── postprocessing/EffectComposer.js
│   │   └── libs/ammo.wasm.js
├── jszip/
└── mp4-muxer/
```

---

## 🎮 Controls & Hotkeys

| Input | Action |
|-------|--------|
| LMB drag | Orbit camera |
| RMB drag | Pan camera |
| Scroll | Zoom |
| Drag-drop | Load PMX / VMD / ZIP / HDR |
| **K** | Add cinematic camera keyframe |
| **G / R / S** | Move / Rotate / Scale (bone editor) |
| **X / Z** | Axis lock (bone transforms) |
| **1–9** | Restore camera bookmark |
| **Numpad 0** | Switch to camera view (letterbox) |
| `/stats` in chat | Runtime diagnostics |
| `debugArmBodies()` | Console: visualize arm rigid bodies |
| `debugArmIK()` | Console: IK chain diagnostic |

---

## 📊 Format Support

| Format | Read | Write | Notes |
|--------|------|-------|-------|
| `.pmx` | ✅ | — | PMX 2.0, W-bone support |
| `.pmd` | ✅ | — | Legacy PMD |
| `.vmd` | ✅ | ✅ Lite | VMD export in Lite (modified motions) |
| `.zip` | ✅ | — | Auto-extracts model + textures + VMD |
| `.hdr` | ✅ | — | PMREM env map + sky background |
| `.png .bmp .tga .spa .sph` | ✅ | — | Texture formats, auto fallback chain |
| `.json` | ✅ | ✅ | Session, camera path, bone keyframes |
| `.mp4` | — | ✅ | WebCodecs H.264, configurable bitrate |

---

## 🛣️ Roadmap

- [x] AnimaStage Lite v1.0 — Shorts-first, WebCodecs, 9:16 mode
- [x] AnimaStage Pro v1.0 — multi-char, bone editor, cinematic camera, dual timeline
- [x] Bullet physics with W-bone support (Sour Miku, TDA)
- [x] ZIP drag-drop with texture auto-resolve
- [x] Procedural sky + 6 weather presets
- [x] Full post-FX pipeline (SSAO, DOF, volumetric, bloom, color grade)
- [x] Session save / load JSON
- [x] VMD export (Lite)
- [ ] AI-assisted motion infill / generative keyframes
- [ ] 4K PBR texture pipeline
- [ ] WebGPU renderer migration
- [ ] Mobile-optimized touch controls
---

## 🤝 Links & Community

- 🌐 **Website**: [animastagepro.dev](animastagepro.dev)
- 🎬 **Demo**: [animastagepro.dev](animastagepro.dev)
- Lite-version https://animastage-lite.app/
---

## 📄 Citation

```bibtex
@software{animastage2026,
  title   = {AnimaStage: Browser-Native MMD Studio with Cinematic Render Pipeline},
  author  = {Zerdovazd FBNonaMe},
  year    = {2026},
  url     = {animastage-lite.app animastagepro.dev}
}
```

---

## 📝 License

GPL-3.0 license — see `LICENSE`.

---

<p align="center">
  <i>🎬 "Drop the PMX. Hit play. No install required."</i><br>
  <b>Multi-character · Bone editor · Cinematic camera · Bullet physics · MP4 export</b><br>
  <b>Built in the browser. Runs anywhere.</b><br>
  <br>
  <a href="animastagepro.dev">animastagepro.dev</a>
</p>
