/**
 * 8-bit audio, synthesised with the Web Audio API — no audio files.
 *
 * The music is an original chiptune loop (square-wave lead, triangle bass),
 * written for this site in the spirit of classic platformers. The block sound
 * is an original rising "item" arpeggio.
 *
 * Browsers only allow audio after a user gesture (tap, click, key), so
 * nothing plays until `unlock()` runs from one. Scrolling is not a gesture.
 */

const MUSIC_VOLUME = 0.05;
const SFX_VOLUME = 0.14;
const BPM = 132;
const STORAGE_KEY = 'udit-sound';

// Notes as semitones from A4 (440 Hz); null is a rest. Durations in beats.
type Note = [number | null, number];

const N = {
  G3: -14, A3: -12, B3: -10, C4: -9, D4: -7, E4: -5, F4: -4, G4: -2,
  A4: 0, B4: 2, C5: 3, D5: 5, E5: 7, F5: 8, G5: 10, A5: 12, C6: 15,
} as const;

// Original 8-bar melody, C major. Loops back to the top.
const LEAD: Note[] = [
  [N.E5, 0.5], [N.G5, 0.5], [N.C6, 1], [N.A5, 0.5], [N.G5, 0.5], [N.E5, 1],
  [N.F5, 0.5], [N.A5, 0.5], [N.G5, 1], [N.E5, 0.5], [N.D5, 0.5], [N.C5, 1],
  [N.D5, 0.5], [N.E5, 0.5], [N.F5, 0.5], [N.D5, 0.5], [N.G5, 1], [null, 1],
  [N.E5, 0.5], [N.C5, 0.5], [N.D5, 0.5], [N.B4, 0.5], [N.C5, 1.5], [null, 0.5],
  [N.C5, 0.5], [N.E5, 0.5], [N.G5, 0.5], [N.E5, 0.5], [N.A5, 1], [N.G5, 1],
  [N.F5, 0.5], [N.E5, 0.5], [N.D5, 0.5], [N.F5, 0.5], [N.E5, 1], [N.C5, 1],
  [N.A4, 0.5], [N.C5, 0.5], [N.D5, 0.5], [N.E5, 0.5], [N.D5, 1], [N.G4, 1],
  [N.C5, 0.5], [N.D5, 0.5], [N.E5, 0.5], [N.D5, 0.5], [N.C5, 1.5], [null, 0.5],
];

// Bouncing root–fifth bass, one pattern per bar: C F G C / C F G C.
const BASS_ROOTS = [N.C4, N.F4, N.G4, N.C4, N.A3, N.F4, N.G3, N.C4];
const BASS: Note[] = BASS_ROOTS.flatMap((r) => [
  [r - 12, 1], [r - 5, 1], [r - 12, 1], [r - 5, 1],
] as Note[]);

const freq = (semi: number) => 440 * 2 ** (semi / 12);
const beat = 60 / BPM;

let ctx: AudioContext | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let loopStart = 0;
let scheduledUntil = 0;
let enabled = readEnabled();
const listeners = new Set<(on: boolean) => void>();

const LOOP_BEATS = LEAD.reduce((s, [, d]) => s + d, 0);

function readEnabled(): boolean {
  try {
    return typeof window === 'undefined' || localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  musicBus = ctx.createGain();
  musicBus.gain.value = MUSIC_VOLUME;
  musicBus.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = SFX_VOLUME;
  sfxBus.connect(ctx.destination);
  return ctx;
}

/** One enveloped oscillator note. */
function tone(
  bus: GainNode,
  type: OscillatorType,
  hz: number,
  start: number,
  dur: number,
  peak = 1,
) {
  const c = ctx!;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, start);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.01);
  env.gain.setValueAtTime(peak, start + dur * 0.7);
  env.gain.linearRampToValueAtTime(0, start + dur * 0.95);
  osc.connect(env).connect(bus);
  osc.start(start);
  osc.stop(start + dur);
}

function scheduleVoice(notes: Note[], type: OscillatorType, peak: number, from: number, to: number) {
  const loopLen = LOOP_BEATS * beat;
  let t = loopStart;
  // Walk loops until we pass the window we're filling.
  while (t < to) {
    let offset = 0;
    for (const [n, d] of notes) {
      const at = t + offset * beat;
      if (at >= from && at < to && n !== null) {
        tone(musicBus!, type, freq(n), at, d * beat, peak);
      }
      offset += d;
    }
    t += loopLen;
  }
}

// Lookahead scheduler: every 50ms, queue the next ~200ms of notes.
function tick() {
  if (!ctx) return;
  const horizon = ctx.currentTime + 0.2;
  if (scheduledUntil >= horizon) return;
  scheduleVoice(LEAD, 'square', 0.9, scheduledUntil, horizon);
  scheduleVoice(BASS, 'triangle', 1.6, scheduledUntil, horizon);
  scheduledUntil = horizon;
  // Keep loopStart close to now so the walk stays short.
  const loopLen = LOOP_BEATS * beat;
  while (loopStart + loopLen < ctx.currentTime) loopStart += loopLen;
}

function startMusic() {
  if (!ctx || timer) return;
  loopStart = ctx.currentTime + 0.05;
  scheduledUntil = loopStart;
  timer = setInterval(tick, 50);
  tick();
}

function stopMusic() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Call from a user gesture. Starts the music if sound is on. */
export function unlock() {
  const c = ensureContext();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  if (enabled) startMusic();
}

/** The "?" block: an original rising arpeggio with a bright finish. */
export function playBlockSound() {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  // Short thump for the hit, then the item chime.
  const thump = ctx.createOscillator();
  const env = ctx.createGain();
  thump.type = 'square';
  thump.frequency.setValueAtTime(220, t);
  thump.frequency.exponentialRampToValueAtTime(90, t + 0.08);
  env.gain.setValueAtTime(0.7, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  thump.connect(env).connect(sfxBus!);
  thump.start(t);
  thump.stop(t + 0.1);

  [N.G4, N.C5, N.E5, N.G5, N.C6].forEach((n, i) => {
    tone(sfxBus!, 'square', freq(n + 12), t + 0.07 + i * 0.045, i === 4 ? 0.28 : 0.06, 0.8);
  });
}

export function isSoundOn() {
  return enabled;
}

export function setSoundOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode etc. — the toggle still works for this visit.
  }
  if (on) unlock();
  else stopMusic();
  listeners.forEach((fn) => fn(on));
}

export function onSoundChange(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Pause while the tab is hidden, resume when it comes back. */
export function setPageVisible(visible: boolean) {
  if (!ctx) return;
  if (visible) {
    if (enabled) void ctx.resume();
  } else {
    void ctx.suspend();
  }
}
