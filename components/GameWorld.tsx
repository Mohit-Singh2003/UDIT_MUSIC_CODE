'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

import { checkpoints, projects } from '@/content/profile';
import CheckpointPanel from './CheckpointPanel';
import ProjectBlock from './ProjectBlock';
import { CastlePanel, OutroPanel, TitlePanel } from './Panels';
import { Clouds, Foreground, Hills, Mountains, Stars, Trees } from './Scenery';
import Character, { type HeroState } from './Character';
import Hud from './Hud';
import SoundToggle from './SoundToggle';
import { playBlockSound } from '@/lib/sound';
import { PHASES, skyAt } from '@/lib/timeOfDay';

/** Scroll speed (px/s) above which the character is considered running. */
const RUN_THRESHOLD = 25;

/** Where the character stands, as a fraction of viewport width. */
const HERO_X = 0.2;

/**
 * Zoom level of the world. 0.9 shows ~11% more of it per screen, which reads
 * like viewing the page at 90% in the browser.
 *
 * Implemented as a transform on a wrapper, NOT CSS `zoom`. Everything below
 * measures the DOM, and `zoom` splits layout pixels from visual pixels —
 * getBoundingClientRect scales while offsetLeft/scrollWidth don't, which
 * silently desyncs the parallax and the project triggers. With a transform,
 * all layout stays in one coordinate space and only the visual result is
 * scaled, so the maths just needs dividing through by this constant.
 */
const WORLD_SCALE = 0.9;

/**
 * How close (px) the character must be to a project block before it opens.
 * Wide enough that a fast scroll can't skip straight past the trigger.
 */
const TRIGGER_RADIUS = 260;

/**
 * Parallax speeds as a fraction of camera movement. Far silhouettes crawl,
 * the foreground outruns the world — that mismatch is what reads as depth.
 * Kept to a handful of layers; past that the visual return drops off and
 * scroll cost multiplies.
 */
const LAYERS = {
  stars: 0.05,
  mountains: 0.18,
  clouds: 0.28,
  hills: 0.45,
  trees: 0.72,
  foreground: 1.15,
} as const;

export default function GameWorld() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const starsRef = useRef<HTMLDivElement>(null);
  const mountainsRef = useRef<HTMLDivElement>(null);
  const cloudsRef = useRef<HTMLDivElement>(null);
  const hillsRef = useRef<HTMLDivElement>(null);
  const treesRef = useRef<HTMLDivElement>(null);
  const foregroundRef = useRef<HTMLDivElement>(null);

  const [progress, setProgress] = useState(0);
  const [heroState, setHeroState] = useState<HeroState>('idle');
  const [facing, setFacing] = useState<1 | -1>(1);
  const [level, setLevel] = useState({ world: '0-0', title: 'Press scroll to start' });
  const [phase, setPhase] = useState(PHASES[0].label);
  const [sceneryWidth, setSceneryWidth] = useState(14000);
  const [activeProject, setActiveProject] = useState<string | null>(null);

  /** Camera kick, fired when a project block is struck. */
  const shake = useCallback(() => {
    const el = cameraRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.classList.remove('shaking');
    // Force a reflow so the animation restarts on repeated hits.
    void el.offsetWidth;
    el.classList.add('shaking');
    window.setTimeout(() => el.classList.remove('shaking'), 320);
  }, []);

  useLayoutEffect(() => {
    // TEMP (session only): run the game at every width.

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({ duration: 1.05, wheelMultiplier: 1.1 });
    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    let idleTimer: ReturnType<typeof setTimeout>;
    let lastCoinStep = -1;
    // Blocks already broken; revisiting one stays silent, like the block itself.
    const struck = new Set<string>();

    const ctx = gsap.context(() => {
      const track = trackRef.current;
      const container = containerRef.current;
      if (!track || !container) return;

      setSceneryWidth(track.scrollWidth);

      const panels = Array.from(track.querySelectorAll<HTMLElement>('[data-world]'));
      // Inside the scaled wrapper the world lays out in a viewport that is
      // WORLD_SCALE smaller, so every comparison happens in that space.
      const viewW = () => window.innerWidth / WORLD_SCALE;
      const maxX = () => Math.max(1, track.scrollWidth - viewW());

      // Reveal queue, ordered left-to-right by untransformed position.
      // IntersectionObserver is no use here: the track is pinned with
      // position:fixed and only its transform changes, which browsers do
      // not reliably re-evaluate intersections for.
      let pending = Array.from(track.querySelectorAll<HTMLElement>('[data-reveal]'))
        .map((el) => ({
          el,
          // Rects come back already scaled; divide back to layout space.
          baseLeft: el.getBoundingClientRect().left / WORLD_SCALE,
        }))
        .sort((a, b) => a.baseLeft - b.baseLeft);

      const revealUpTo = (x: number) => {
        const threshold = viewW() * 0.9;
        let i = 0;
        while (i < pending.length && pending[i].baseLeft + x < threshold) {
          pending[i].el.classList.add('is-in');
          i += 1;
        }
        if (i > 0) pending = pending.slice(i);
      };

      revealUpTo(0);

      // Project blocks, measured once in untransformed space. Their on-screen
      // position is just `baseCenter + x`, so no per-frame layout reads.
      const blocks = Array.from(
        track.querySelectorAll<HTMLElement>('[data-project]'),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset.project ?? '',
          baseCenter: (r.left + r.width / 2) / WORLD_SCALE,
        };
      });

      ScrollTrigger.create({
        trigger: container,
        start: 'top top',
        end: () => `+=${maxX() * WORLD_SCALE}`,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onRefresh: () => setSceneryWidth(track.scrollWidth),
        onUpdate: (self) => {
          const x = -self.progress * maxX();

          // The world moves; the camera (and character) stay put.
          gsap.set(track, { x });
          gsap.set(starsRef.current, { x: x * LAYERS.stars });
          gsap.set(mountainsRef.current, { x: x * LAYERS.mountains });
          gsap.set(cloudsRef.current, { x: x * LAYERS.clouds });
          gsap.set(hillsRef.current, { x: x * LAYERS.hills });
          gsap.set(treesRef.current, { x: x * LAYERS.trees });
          gsap.set(foregroundRef.current, { x: x * LAYERS.foreground });

          revealUpTo(x);

          // Advance the time of day. Written straight to CSS variables on
          // the container so every layer recolours without a React render.
          const sky = skyAt(self.progress);
          for (const [k, v] of Object.entries(sky)) {
            container.style.setProperty(k, v);
          }

          // Re-render the HUD only when a coin actually ticks over.
          const step = Math.round(self.progress * 500);
          if (step !== lastCoinStep) {
            lastCoinStep = step;
            setProgress(self.progress);
          }

          // Whichever level currently occupies the camera.
          const cameraX = -x + viewW() * 0.45;
          let active = panels[0];
          for (const p of panels) {
            if (p.offsetLeft <= cameraX) active = p;
          }
          if (active) {
            const world = active.dataset.world ?? '';
            const title = active.dataset.title ?? '';
            setLevel((prev) =>
              prev.world === world && prev.title === title ? prev : { world, title },
            );
          }

          // Name the current time of day for the HUD. Pick the NEAREST
          // phase, not the last one passed — the sky is already blending
          // toward the next phase well before its start point, so
          // "last passed" reads as wrong against what's on screen.
          let label = PHASES[0].label;
          let best = Infinity;
          for (const ph of PHASES) {
            const d = Math.abs(self.progress - ph.at);
            if (d < best) {
              best = d;
              label = ph.label;
            }
          }
          setPhase((prev) => (prev === label ? prev : label));

          // Walking level with a block trips it open; walking on closes it.
          const heroX = viewW() * HERO_X;
          let hit: string | null = null;
          for (const b of blocks) {
            if (Math.abs(b.baseCenter + x - heroX) < TRIGGER_RADIUS) {
              hit = b.id;
              break;
            }
          }
          // Chime only the first time each block is broken.
          if (hit && !struck.has(hit)) {
            struck.add(hit);
            playBlockSound();
          }
          setActiveProject((prev) => (prev === hit ? prev : hit));

          // Run cycle follows scroll velocity and direction.
          const v = self.getVelocity();
          if (Math.abs(v) > RUN_THRESHOLD) {
            setHeroState('run');
            setFacing(v > 0 ? 1 : -1);
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => setHeroState('idle'), 140);
          }
        },
      });
    }, containerRef);

    return () => {
      clearTimeout(idleTimer);
      ctx.revert();
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  // Build the level order: checkpoint → its outro line → any project blocks.
  const nodes: React.ReactNode[] = [<TitlePanel key="title" />];

  for (const cp of checkpoints) {
    if (cp.id === 'castle') continue;

    nodes.push(<CheckpointPanel key={cp.id} checkpoint={cp} />);

    if (cp.outro) {
      nodes.push(<OutroPanel key={`${cp.id}-outro`} text={cp.outro} />);
    }

    for (const project of projects.filter((p) => p.afterCheckpoint === cp.id)) {
      nodes.push(
        <ProjectBlock
          key={project.id}
          project={project}
          active={activeProject === project.id}
          onHit={shake}
        />,
      );
    }
  }

  nodes.push(<CastlePanel key="castle" />);

  return (
    <div
      ref={containerRef}
      className="crt sky relative block h-screen w-full overflow-hidden"
    >
      {/* Everything inside the camera shakes together on impact. */}
      <div ref={cameraRef} className="absolute inset-0">
        {/* The world is laid out at 1/WORLD_SCALE size and scaled down, so a
            wider slice of it fits on screen. Origin is the top-left corner so
            layout coordinates map to visual ones by a plain multiply. */}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: `${100 / WORLD_SCALE}%`,
            height: `${100 / WORLD_SCALE}%`,
            transform: `scale(${WORLD_SCALE})`,
          }}
        >
        {/* parallax layers, slowest first */}
        <div ref={starsRef} className="absolute inset-0 will-change-transform" aria-hidden="true">
          <Stars width={sceneryWidth} />
        </div>
        <div
          ref={mountainsRef}
          className="absolute inset-0 will-change-transform"
          aria-hidden="true"
        >
          <Mountains width={sceneryWidth} />
        </div>
        <div ref={cloudsRef} className="absolute inset-0 will-change-transform" aria-hidden="true">
          <Clouds width={sceneryWidth} />
        </div>
        <div ref={hillsRef} className="absolute inset-0 will-change-transform" aria-hidden="true">
          <Hills width={sceneryWidth} />
        </div>
        <div ref={treesRef} className="absolute inset-0 will-change-transform" aria-hidden="true">
          <Trees width={sceneryWidth} />
        </div>

        {/* the world */}
        {/* w-max so the track's own width equals the sum of its panels —
            the ground below is width:100% of it. */}
        <div ref={trackRef} className="relative flex h-full w-max will-change-transform">
          <div className="ground" style={{ width: '100%' }} aria-hidden="true" />
          {nodes}
        </div>

        {/* foreground runs fastest, and sits above the world */}
        <div
          ref={foregroundRef}
          className="pointer-events-none absolute inset-0 z-20 will-change-transform"
          aria-hidden="true"
        >
          <Foreground width={sceneryWidth} />
        </div>

        {/* camera-locked character */}
        <div
          className="pointer-events-none absolute z-30"
          style={{ left: `${HERO_X * 100}%`, bottom: 'calc(var(--ground-h) - 8px)' }}
        >
          <Character state={heroState} facing={facing} />
        </div>
        </div>
      </div>

      <Hud progress={progress} world={level.world} title={level.title} phase={phase} />
      <SoundToggle />

      {/* progress bar along the very bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 h-2.5 bg-black/35">
        <div
          className="h-full"
          style={{
            width: `${progress * 100}%`,
            background: 'linear-gradient(90deg,var(--primary),var(--coin))',
            boxShadow: '0 0 12px rgba(255,212,59,.6)',
          }}
        />
      </div>
    </div>
  );
}
