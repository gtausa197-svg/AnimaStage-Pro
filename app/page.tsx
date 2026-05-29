"use client";

import { motion, useScroll, useTransform, AnimatePresence } from "motion/react";
import { 
    Box, 
    Camera, 
    Wind, 
    Layers, 
    Sun, 
    Download, 
    Play, 
    Film, 
    Globe, 
    MonitorPlay, 
    Activity ,
    Cpu,
    Bone
} from "lucide-react";
import { ReactNode, useRef, useState, useEffect } from "react";
import { openAnimaStagePro } from "@/lib/studio";
import { ClientOnly } from "@/lib/client-only";

const FadeIn = ({ children, delay = 0, className = "" }: { children: ReactNode, delay?: number, className?: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 50, scale: 0.88, filter: "blur(16px)" }}
    whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
    viewport={{ once: true, margin: "0px" }}
    transition={{ 
      type: "spring",
      stiffness: 80,
      damping: 15,
      mass: 0.9,
      delay 
    }}
    className={className}
  >
    {children}
  </motion.div>
);

const LOADING_STEPS = [
  { threshold: 15, text: "INITIALIZING MODULE // MMDLoader" },
  { threshold: 30, text: "PROVISIONING BULLET PHYSICS ENGINE (Ammo.js WASM)" },
  { threshold: 48, text: "COMPILING VOLUMETRIC FOG & RAYMARCHED SHADERS" },
  { threshold: 65, text: "CALIBRATING BOKEH KERNELS & DEPTH OF FIELD" },
  { threshold: 82, text: "BINDING CHARACTER KINEMATIC INTEGRATORS & IK CHAINS" },
  { threshold: 95, text: "RESOLVING RTX CUSTOM COMPOSER RENDER PIPELINE" },
  { threshold: 100, text: "BOOTING ANIMASTAGE PRO WORKSPACE" },
];

export default function Home() {
  const containerRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [loadingStep, setLoadingStep] = useState("INITIALIZING CORE GRAPHICS SUBSYSTEM");

  useEffect(() => {
    const triggerMount = () => {
      setMounted(true);
    };
    setTimeout(triggerMount, 0);

    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += Math.floor(Math.random() * 8) + 4;
      if (currentProgress >= 100) {
        currentProgress = 100;
        clearInterval(interval);
        setTimeout(() => {
          setLoading(false);
          if (containerRef.current) {
            containerRef.current.scrollTop = 0;
          }
        }, 1100);
      }
      setProgress(currentProgress);
      
      const matchedStep = LOADING_STEPS.find(s => currentProgress <= s.threshold);
      if (matchedStep) {
        setLoadingStep(matchedStep.text);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const { scrollYProgress } = useScroll({ container: containerRef });
  
  const yBg1 = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const yBg2 = useTransform(scrollYProgress, [0, 1], ["0%", "-30%"]);

  return (
    <ClientOnly>
    <div className="h-screen bg-black overflow-hidden font-sans selection:bg-white selection:text-black">
      {/* Immersive MMD Load Screen */}
      <AnimatePresence>
        {mounted && loading && (
          <motion.div 
            className="fixed inset-0 z-[100] bg-black flex flex-col justify-between p-8 md:p-16 select-none"
            initial={{ opacity: 1, filter: "blur(0px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(40px)", y: -100 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          >
          {/* Top telemetry grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 border-b border-zinc-900 pb-8 text-[10px] font-mono tracking-wider text-zinc-500 uppercase">
            <div>
              <p className="text-white font-bold">SYSTEM // AnimaStage Pro</p>
              <p>BUILD_TARGET_REV // v2.4.0</p>
            </div>
            <div className="hidden md:block text-center">
              <p>HARDWARE_RENDERER // WebGL2</p>
              <p>SHADER_MODEL // 5.0 CORE</p>
            </div>
            <div className="text-right">
              <p className="text-white">STATUS // LOADING STAGE</p>
              <p>{progress}% COMPILED</p>
            </div>
          </div>

          {/* Center 3D humanoid wireframe skeleton */}
          <div className="flex-grow flex flex-col items-center justify-center relative overflow-hidden my-8">
            <div className="absolute inset-0 opacity-5">
              <div className="w-full h-full bg-dot-grid-16" />
            </div>

            <motion.div 
              className="relative w-72 h-72 flex items-center justify-center"
              animate={{ rotateY: 360 }}
              transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
              style={{ transformStyle: "preserve-3d" }}
            >
              <svg className="w-full h-full text-white/40 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]" viewBox="0 0 100 100">
                {/* Simulated joint coordinates/wireframes of humanoid silhouette */}
                {/* Spine & Head */}
                <line x1="50" y1="20" x2="50" y2="55" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1 1" />
                <circle cx="50" cy="15" r="5" stroke="currentColor" strokeWidth="0.75" fill="none" />
                {/* Collar bone & arms */}
                <line x1="32" y1="28" x2="68" y2="28" stroke="currentColor" strokeWidth="0.75" />
                <line x1="32" y1="28" x2="22" y2="45" stroke="currentColor" strokeWidth="0.5" />
                <line x1="22" y1="45" x2="16" y2="60" stroke="currentColor" strokeWidth="0.5" />
                <line x1="68" y1="28" x2="78" y2="45" stroke="currentColor" strokeWidth="0.5" />
                <line x1="78" y1="45" x2="84" y2="60" stroke="currentColor" strokeWidth="0.5" />
                {/* Joints (dots) */}
                <circle cx="32" cy="28" r="1.5" className="fill-white animate-pulse" />
                <circle cx="68" cy="28" r="1.5" className="fill-white" />
                <circle cx="22" cy="45" r="1.5" className="fill-white" />
                <circle cx="78" cy="45" r="1.5" className="fill-white" />
                <circle cx="16" cy="60" r="1.5" className="fill-white" />
                <circle cx="84" cy="60" r="1.5" className="fill-white" />

                {/* Pelvis & Legs */}
                <line x1="40" y1="55" x2="60" y2="55" stroke="currentColor" strokeWidth="0.75" />
                <line x1="40" y1="55" x2="38" y2="72" stroke="currentColor" strokeWidth="0.5" />
                <line x1="38" y1="72" x2="36" y2="90" stroke="currentColor" strokeWidth="0.5" />
                <line x1="60" y1="55" x2="62" y2="72" stroke="currentColor" strokeWidth="0.5" />
                <line x1="62" y1="72" x2="64" y2="90" stroke="currentColor" strokeWidth="0.5" />
                {/* IK Target Joints */}
                <circle cx="40" cy="55" r="1.5" className="fill-white" />
                <circle cx="60" cy="55" r="1.5" className="fill-white" />
                <circle cx="38" cy="72" r="1.5" className="fill-white" />
                <circle cx="62" cy="72" r="1.5" className="fill-white" />
                {/* Animated IK target indicators */}
                <g className="text-white animate-pulse">
                  <circle cx="36" cy="90" r="2" fill="none" stroke="currentColor" strokeWidth="0.5" />
                  <circle cx="36" cy="90" r="0.75" fill="currentColor" />
                  <circle cx="64" cy="90" r="2" fill="none" stroke="currentColor" strokeWidth="0.5" />
                  <circle cx="64" cy="90" r="0.75" fill="currentColor" />
                </g>

                {/* Grid guidelines */}
                <line x1="10" y1="90" x2="90" y2="90" stroke="currentColor" strokeWidth="0.25" strokeDasharray="2 2" />
                <line x1="50" y1="5" x2="50" y2="95" stroke="currentColor" strokeWidth="0.25" strokeDasharray="4 4" className="opacity-40" />
              </svg>
            </motion.div>

            <div className="absolute bottom-4 text-center">
              <p className="text-[10px] font-mono tracking-[0.4em] text-zinc-600 uppercase">MESH SILHOUETTE GIZMOPROXY // ROTATING_STATE</p>
            </div>
          </div>

          {/* Bottom telemetry, steps & progress bar */}
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-2">
                <span className="text-[9px] font-mono tracking-[0.2em] text-zinc-500 uppercase block">CORE_SYSTEM_LOG</span>
                <span className="text-xs font-mono text-white tracking-widest uppercase block animate-pulse">
                  &gt; {loadingStep}
                </span>
              </div>
              <div className="text-right font-mono text-xs tracking-widest text-zinc-400">
                [ {progress.toString().padStart(3, "0")} / 100 ]
              </div>
            </div>

            {/* Structured Segmented Progress Bar */}
            <div className="relative w-full h-2 border border-zinc-800 bg-zinc-950/40 p-0.5 overflow-hidden">
              <motion.div 
                className="h-full bg-white relative"
                style={{ width: `${progress}%` }}
                transition={{ ease: "easeInOut" }}
              />
            </div>

            <div className="flex justify-between text-[8px] font-mono tracking-[0.3em] text-zinc-600 uppercase pt-2">
              <span>WASM_LOAD_OK</span>
              <span>RENDER_MODEL_5.0_STABLE</span>
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Cinematic Grain Overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 h-full w-full bg-noise opacity-[0.03]" />
      
      {/* Navbar */}
      <nav className="fixed top-0 left-0 w-full border-b border-zinc-800 bg-black z-50">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 border border-white flex items-center justify-center font-bold text-xs">
              <Box className="w-4 h-4 text-white" />
            </div>
            <span className="tracking-[0.3em] text-[10px] uppercase font-semibold hidden sm:inline">AnimaStage Pro</span>
          </div>
          <div className="flex items-center gap-8 text-[10px] tracking-[0.2em] uppercase text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors hidden md:inline">Features</a>
            <a href="#engine" className="hover:text-white transition-colors hidden md:inline">Engine</a>
            <a href="#pipeline" className="hover:text-white transition-colors hidden md:inline">Pipeline</a>
            <div className="hidden md:block h-4 w-px bg-zinc-800"></div>
            <button 
              type="button"
              onClick={openAnimaStagePro}
              className="px-4 py-2 border border-white/20 bg-white text-black font-bold hover:bg-zinc-200 transition-colors"
            >
              Launch Studio
            </button>
          </div>
        </div>
      </nav>

      <main ref={containerRef} className={`h-full w-full ${loading ? "overflow-hidden" : "overflow-y-auto"} overflow-x-hidden snap-y snap-mandatory scroll-smooth`}>
        {/* SNAP BLOCK 1: Hero & Stats */}
        <div className="snap-start min-h-screen flex flex-col">
          {/* Hero Section */}
          <section className="relative flex-grow pt-16 px-6 flex flex-col items-center justify-center text-center bg-[#050505] overflow-hidden">
        {/* Faux Viewport Visual */}
        <motion.div className="absolute inset-0 opacity-10 pointer-events-none" style={{ y: yBg1 }}>
          <div className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-dot-grid-40" />
        </motion.div>

        {/* Floating Cinematic Dust Particles (Deterministic to avoid Next.js hydration mismatch) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-[1]">
          {[...Array(12)].map((_, i) => {
            const left = `${(i * 11) % 100}%`;
            const top = `${(i * 17) % 100}%`;
            const size = (i % 3) + 2;
            const duration = 12 + (i % 4) * 4;
            const driftY = -50 - (i % 5) * 15;
            const driftX = (i % 2 === 0 ? 1 : -1) * ((i % 3) * 10 + 10);
            return (
              <motion.div
                key={i}
                className="absolute rounded-full bg-white/15 blur-[2px]"
                style={{
                  width: `${size}px`,
                  height: `${size}px`,
                  left,
                  top,
                }}
                animate={{
                  y: [0, driftY, 0],
                  x: [0, driftX, 0],
                  opacity: [0.1, 0.45, 0.1],
                  scale: [1, 1.3, 1],
                }}
                transition={{
                  duration,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            );
          })}
        </div>

        <div className="relative z-10 max-w-4xl mx-auto">
          <FadeIn>
            <div className="inline-flex items-center gap-4 px-4 py-2 border border-zinc-800 bg-zinc-900/20 mb-8 backdrop-blur-md">
              <span className="flex h-1.5 w-1.5 bg-white shadow-[0_0_8px_white] animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-400">Local Browser Studio</span>
            </div>
          </FadeIn>
          
          <FadeIn delay={0.1}>
            <h1 className="text-6xl md:text-[120px] font-black tracking-tighter uppercase mb-4 leading-[0.85]">
              Cinematic<br />Reality.
            </h1>
            <div className="h-px w-32 bg-white mx-auto my-8"></div>
            <p className="text-[11px] md:text-[13px] uppercase tracking-[0.4em] text-zinc-400 mb-12 max-w-3xl mx-auto font-light leading-relaxed">
              The ultimate MMD-studio viewer featuring a cinematic RTX-style render pipeline, Ammo.js physics, and advanced bone editing. Local, powerful, and zero setup.
            </p>
          </FadeIn>

          <FadeIn delay={0.3} className="flex flex-wrap items-center justify-center gap-4">
            <button 
              type="button"
              onClick={openAnimaStagePro}
              className="px-6 py-3 border border-white/20 bg-white text-black text-[10px] uppercase tracking-widest font-bold hover:bg-zinc-200 transition-colors flex items-center gap-3"
            >
              <Play className="w-3 h-3 fill-black" /> Start Rendering
            </button>
            <a
              href="https://github.com/gtausa197-svg/AnimaStage-Pro"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 border border-zinc-800 text-white text-[10px] uppercase tracking-widest bg-black hover:bg-zinc-900 transition-colors flex items-center gap-3"
            >
              <Download className="w-3 h-3 text-zinc-400" /> Download Example Suite
            </a>
          </FadeIn>
        </div>
      </section>

      {/* Stats / Tech Stack Bar */}
      <section className="border-t border-zinc-800 bg-black px-6 py-6 pb-8 shrink-0 relative z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 divide-x divide-zinc-800">
          {[
            { label: "Render Engine", value: "Three.js / WebGL2" },
            { label: "Physics Subsystem", value: "Ammo.js WASM / 65Hz" },
            { label: "Asset Support", value: "PMX / PMD / VMD / ZIP" },
            { label: "Pipeline", value: "Cinematic RTX-Style" }
          ].map((stat, i) => (
            <div key={i} className="flex flex-col pl-8 first:pl-0">
              <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">{stat.label}</span>
              <span className="text-xs font-mono text-white">{stat.value}</span>
            </div>
          ))}
        </div>
      </section>
      </div>

      {/* SNAP BLOCK 2: Features */}
      <div id="features" className="snap-start min-h-screen flex flex-col justify-center items-center bg-black py-24 select-none">
      {/* Core Features Bento Grid */}
      <section className="w-full px-6 md:px-0 max-w-7xl mx-auto md:border-x md:border-zinc-800 bg-black">
        <FadeIn>
          <div className="mb-16 border-b border-zinc-800 pb-8 px-8">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-6 font-mono">01 // Feature Set</p>
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter mb-4 text-white">Studio-Grade Capabilities.</h2>
            <p className="text-[10px] md:text-xs uppercase tracking-[0.3em] font-light text-zinc-400">Everything you need to orchestrate complex MMD scenes.</p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3">
          {/* Feature 1 */}
          <FadeIn delay={0.1} className="md:col-span-2 group border border-zinc-800 -mt-px -ml-px">
            <div className="h-full bg-black hover:bg-zinc-900/20 transition-colors p-8 md:p-12 flex flex-col justify-between">
              <div className="w-10 h-10 border border-zinc-800 flex items-center justify-center mb-12">
                <Box className="w-4 h-4 text-white" />
              </div>
              <div className="max-w-xl">
                <div className="flex items-baseline justify-between mb-4">
                  <h3 className="text-xs uppercase tracking-[0.2em] text-white">Multi-Character Workflow</h3>
                  <span className="text-[10px] font-mono text-zinc-700">01.</span>
                </div>
                <div className="h-px bg-zinc-800 w-full mb-6"></div>
                <p className="text-[11px] text-zinc-500 uppercase tracking-widest leading-relaxed">
                  Load multiple PMX models simultaneously via drag-and-drop. Assign VMD animations from a global library effortlessly. Each character maintains independent animation states.
                </p>
              </div>
            </div>
          </FadeIn>

          {/* Feature 2 */}
          <FadeIn delay={0.2} className="group border border-zinc-800 -mt-px -ml-px md:-ml-px md:border-l-0">
            <div className="h-full bg-black hover:bg-zinc-900/20 transition-colors p-8 md:p-12 flex flex-col justify-between">
              <div className="w-10 h-10 border border-zinc-800 flex items-center justify-center mb-12">
                <Layers className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="flex items-baseline justify-between mb-4">
                  <h3 className="text-xs uppercase tracking-[0.2em] text-white">RTX-Style Post-FX</h3>
                  <span className="text-[10px] font-mono text-zinc-700">02.</span>
                </div>
                <div className="h-px bg-zinc-800 w-full mb-6"></div>
                <p className="text-[11px] text-zinc-500 uppercase tracking-widest leading-relaxed">
                  SSAO, Auto-DOF, Volumetric Raymarched God Rays, and UnrealBloom create cinematic visuals.
                </p>
              </div>
            </div>
          </FadeIn>

          {/* Feature 3 */}
          <FadeIn delay={0.1} className="group border border-zinc-800 -mt-px -ml-px">
            <div className="h-full bg-black hover:bg-zinc-900/20 transition-colors p-8 md:p-12 flex flex-col justify-between">
              <div className="w-10 h-10 border border-zinc-800 flex items-center justify-center mb-12">
                <Bone className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="flex items-baseline justify-between mb-4">
                  <h3 className="text-xs uppercase tracking-[0.2em] text-white">3D Bone Editor</h3>
                  <span className="text-[10px] font-mono text-zinc-700">03.</span>
                </div>
                <div className="h-px bg-zinc-800 w-full mb-6"></div>
                <p className="text-[11px] text-zinc-500 uppercase tracking-widest leading-relaxed">
                  Full skeletal manipulation. Move, rotate, scale. Mirror poses, auto-keying, and custom anatomy rules in viewport.
                </p>
              </div>
            </div>
          </FadeIn>

          {/* Feature 4 */}
          <FadeIn delay={0.2} className="md:col-span-2 group border border-zinc-800 -mt-px -ml-px md:-ml-px md:border-l-0">
            <div className="h-full bg-black hover:bg-zinc-900/20 transition-colors p-8 md:p-12 flex flex-col justify-between">
              <div className="w-10 h-10 border border-zinc-800 flex items-center justify-center mb-12">
                <Camera className="w-4 h-4 text-white" />
              </div>
              <div className="max-w-xl">
                <div className="flex items-baseline justify-between mb-4">
                  <h3 className="text-xs uppercase tracking-[0.2em] text-white">Cinematic Camera Tracking</h3>
                  <span className="text-[10px] font-mono text-zinc-700">04.</span>
                </div>
                <div className="h-px bg-zinc-800 w-full mb-6"></div>
                <p className="text-[11px] text-zinc-500 uppercase tracking-widest leading-relaxed">
                  Catmull-Rom spline keyframing, 2.39:1 cinematic letterboxing, track-lock smoothing, and numpad bookmarks. Perfect for offline HQ rendering via mp4-muxer.
                </p>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
      </div>

      {/* SNAP BLOCK 3: Engine */}
      <div id="engine" className="snap-start min-h-screen flex flex-col justify-center items-center bg-black border-y border-zinc-800 py-24 select-none">
      {/* Deep Dive Features */}
      <section className="w-full">
        <div className="max-w-7xl mx-auto px-6 md:px-8 md:border-x md:border-zinc-800 py-8 md:py-16">
          <FadeIn>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-6 font-mono">02 // Deep Dive Technical Specs</p>
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter mb-20 max-w-2xl text-white">
              Uncompromising Engine Layout.
            </h2>
          </FadeIn>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-16">
            <FadeIn delay={0.1} className="group">
              <div className="flex items-center gap-4 mb-4">
                <Cpu className="w-4 h-4 text-white" />
                <h4 className="text-xs uppercase tracking-[0.2em] text-white">Bullet Physics</h4>
              </div>
              <div className="h-px bg-zinc-800 w-full mb-4"></div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] leading-relaxed">
                Stock MMDPhysics enhanced with rigorous arm collision tuning, W-bone support, and tunable step rates for realistic cloth and hair simulation.
              </p>
            </FadeIn>

            <FadeIn delay={0.2} className="group">
              <div className="flex items-center gap-4 mb-4">
                <Sun className="w-4 h-4 text-white" />
                <h4 className="text-xs uppercase tracking-[0.2em] text-white">Dynamic Environments</h4>
              </div>
              <div className="h-px bg-zinc-800 w-full mb-4"></div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] leading-relaxed">
                Procedural Preetham sky domes with auto-calculated sun elevation, HDR PMREM handling, and reactive directional soft shadows.
              </p>
            </FadeIn>

            <FadeIn delay={0.3} className="group">
              <div className="flex items-center gap-4 mb-4">
                <Wind className="w-4 h-4 text-white" />
                <h4 className="text-xs uppercase tracking-[0.2em] text-white">Weather Systems</h4>
              </div>
              <div className="h-px bg-zinc-800 w-full mb-4"></div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] leading-relaxed">
                Instanced precipitation for rain and snow, material wetness mapping, and volumetric fog interactions integrated natively into the composition pipeline.
              </p>
            </FadeIn>

            <FadeIn delay={0.4} className="group">
              <div className="flex items-center gap-4 mb-4">
                <Film className="w-4 h-4 text-white" />
                <h4 className="text-xs uppercase tracking-[0.2em] text-white">Dual Timeline Control</h4>
              </div>
              <div className="h-px bg-zinc-800 w-full mb-4"></div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] leading-relaxed">
                Scrub through individual VMD animations or manage the overarching cinematic sequence with dedicated camera keys and extended duration control.
              </p>
            </FadeIn>
            
            <FadeIn delay={0.5} className="group">
              <div className="flex items-center gap-4 mb-4">
                <MonitorPlay className="w-4 h-4 text-white" />
                <h4 className="text-xs uppercase tracking-[0.2em] text-white">Scene & Layout Editor</h4>
              </div>
              <div className="h-px bg-zinc-800 w-full mb-4"></div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] leading-relaxed">
                Blender-style outliner and transform tools. Add Point, Spot, Directional, or Hemi lights. Manage visibility and animate props separately from character models.
              </p>
            </FadeIn>

            <FadeIn delay={0.6} className="group">
              <div className="flex items-center gap-4 mb-4">
                <Activity className="w-4 h-4 text-white" />
                <h4 className="text-xs uppercase tracking-[0.2em] text-white">Session Management</h4>
              </div>
              <div className="h-px bg-zinc-800 w-full mb-4"></div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-[0.1em] leading-relaxed">
                JSON-based stateless scene serialization. Re-upload a master ZIP, and AnimaStage reassembles the specific play states, transforms, and assigned kinematics.
              </p>
            </FadeIn>
          </div>
        </div>
      </section>
      </div>

      {/* SNAP BLOCK 4: CTA & Footer */}
      <div id="pipeline" className="snap-start min-h-screen flex flex-col bg-[#050505]">
      {/* CTA Section */}
      <section className="flex-grow flex flex-col justify-center py-20 px-6 relative border-t border-zinc-800 overflow-hidden">
        {/* Faux Viewport Visual */}
        <motion.div className="absolute inset-0 opacity-10 pointer-events-none" style={{ y: yBg2 }}>
          <div className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-dot-grid-40" />
        </motion.div>
        
        <div className="max-w-4xl mx-auto text-center relative z-10 border border-zinc-800 bg-black/80 backdrop-blur-sm p-16">
          <FadeIn>
            <Globe className="w-8 h-8 text-white mx-auto mb-10" />
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tighter mb-8 leading-none">
              INITIALIZE <br /> STUDIO
            </h2>
            <div className="h-px w-24 bg-white mx-auto my-8"></div>
            <p className="text-[11px] uppercase tracking-[0.3em] font-light text-zinc-400 mb-12 max-w-2xl mx-auto leading-relaxed">
              Experience the power of a desktop MMD application entirely within your web browser. No plugins, no installations.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <button 
                type="button"
                onClick={openAnimaStagePro}
                className="h-12 px-8 w-full sm:w-auto bg-white text-black border border-white/20 font-bold text-[10px] uppercase tracking-widest hover:bg-zinc-200 transition-colors"
              >
                Open AnimaStage Pro
              </button>
              <a
                href="https://github.com/gtausa197-svg/AnimaStage-Pro#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="h-12 px-8 w-full sm:w-auto border border-zinc-800 bg-black text-white font-bold text-[10px] uppercase tracking-widest hover:bg-zinc-900 transition-colors flex items-center justify-center"
              >
                Read Documentation
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Footer / Timeline Mockup */}
      <footer className="h-32 shrink-0 border-t border-zinc-800 bg-zinc-950 flex flex-col relative z-10">
        <div className="flex-grow grid grid-cols-12">
          <div className="col-span-4 md:col-span-2 border-r border-zinc-800 flex items-center justify-center bg-black">
            <span className="text-[10px] tracking-widest text-zinc-500 font-mono text-center">TIMELINE // <br className="md:hidden" />MASTER</span>
          </div>
          <div className="col-span-8 md:col-span-10 relative flex items-center px-4 overflow-hidden">
            {/* Faux Timeline Ruler */}
            <div className="absolute inset-0 flex items-end px-4 pb-2 opacity-30">
               <div className="flex-grow flex justify-between h-4 items-end">
                 {[...Array(20)].map((_, i) => (
                   <div key={i} className={`w-px ${i % 5 === 0 ? 'h-full' : 'h-2'} bg-white`}></div>
                 ))}
               </div>
            </div>
            {/* Playhead */}
            <div className="absolute left-[34%] h-full w-px bg-white z-10">
              <div className="absolute -top-1 -left-1 w-2 h-2 bg-white rotate-45"></div>
            </div>
            <div className="text-[10px] font-mono text-zinc-300 ml-4 relative z-20">00:12:45:08</div>
          </div>
        </div>
        <div className="h-8 border-t border-zinc-800 bg-black flex items-center justify-between px-8">
           <span className="text-[8px] tracking-[0.3em] text-zinc-600 uppercase hidden sm:inline">LOCAL_HTTP_SERVER_REQUIRED // NO_CDN_MODE</span>
           <span className="text-[8px] tracking-[0.3em] text-zinc-600 uppercase">© 2026 MMD Viewer RTX</span>
           <div className="text-[8px] font-mono flex items-center gap-6">
             <a href="#" className="hover:text-white transition-colors uppercase tracking-[0.3em] text-zinc-600">GitHub</a>
             <a href="#" className="hover:text-white transition-colors uppercase tracking-[0.3em] text-zinc-600">Twitter</a>
           </div>
        </div>
      </footer>
      </div>

      </main>
    </div>
    </ClientOnly>
  );
}
