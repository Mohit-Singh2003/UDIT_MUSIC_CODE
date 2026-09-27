/**
 * Site audio, via the Web Audio API.
 *
 * Music is the MP3 at MUSIC_URL, decoded once and looped with an
 * AudioBufferSourceNode. Going through a GainNode (rather than an <audio>
 * element's `volume`) is what keeps it quiet on iOS, where `volume` is
 * read-only. The "?" block sound is synthesised, so it needs no file.
 *
 * Browsers only allow audio after a user gesture (tap, click, key), so
 * nothing plays until `unlock()` runs from one. Scrolling is not a gesture.
 */

const MUSIC_URL = '/audio/theme.mp3';
const MUSIC_VOLUME = 0.12;
const SFX_VOLUME = 0.14;
const STORAGE_KEY = 'udit-sound';

// Semitones from A4 (440 Hz), for the block sound.
const N = { G4: -2, C5: 3, E5: 7, G5: 10, C6: 15 } as const;

const freq = (semi: number) => 440 * 2 ** (semi / 12);

let ctx: AudioContext | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBuffer: AudioBuffer | null = null;
let musicLoading: Promise<AudioBuffer | null> | null = null;
let musicSource: AudioBufferSourceNode | null = null;
let wantMusic = false;
let enabled = readEnabled();
const listeners = new Set<(on: boolean) => void>();

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

/** Fetch and decode the track once. Resolves null if it can't be loaded. */
function loadMusic(c: AudioContext): Promise<AudioBuffer | null> {
  if (!musicLoading) {
    musicLoading = fetch(MUSIC_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`music ${r.status}`);
        return r.arrayBuffer();
      })
      // Callback form: older Safari has no promise-returning decodeAudioData.
      .then((data) => new Promise<AudioBuffer>((res, rej) => c.decodeAudioData(data, res, rej)))
      .then((buf) => (musicBuffer = buf))
      .catch(() => null);
  }
  return musicLoading;
}

function startMusic() {
  const c = ctx;
  if (!c || musicSource) return;
  wantMusic = true;
  if (!musicBuffer) {
    // Start as soon as it's decoded, unless muted in the meantime.
    void loadMusic(c).then((buf) => {
      if (buf && wantMusic && enabled) startMusic();
    });
    return;
  }
  const src = c.createBufferSource();
  src.buffer = musicBuffer;
  src.loop = true;
  src.connect(musicBus!);
  src.start();
  musicSource = src;
}

function stopMusic() {
  wantMusic = false;
  musicSource?.stop();
  musicSource?.disconnect();
  musicSource = null;
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

/** Call from a user gesture. Starts the music if sound is on. */
export function unlock() {
  const c = ensureContext();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  if (enabled) startMusic();
}

/** The "?" block: a short thump, then a rising arpeggio. */
export function playBlockSound() {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
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
