'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { isSoundOn, onSoundChange, setPageVisible, setSoundOn, unlock } from '@/lib/sound';

/**
 * Music on/off, plus the one-time audio unlock. Browsers refuse to play
 * sound until the visitor taps, clicks or presses a key, so the first such
 * gesture anywhere on the page starts the music.
 */
export default function SoundToggle() {
  // Server render assumes on; the client reads the saved preference.
  const on = useSyncExternalStore(onSoundChange, isSoundOn, () => true);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const events = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
    const first = () => {
      unlock();
      setStarted(true);
      events.forEach((e) => window.removeEventListener(e, first, true));
    };
    events.forEach((e) => window.addEventListener(e, first, true));

    const onVis = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);

    return () => {
      events.forEach((e) => window.removeEventListener(e, first, true));
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        // The very first tap only starts the audio; don't mute on it.
        if (!started) return;
        setSoundOn(!on);
      }}
      aria-pressed={on}
      aria-label={on ? 'Mute music and sound effects' : 'Turn on music and sound effects'}
      className="hud-plate hud-action font-display text-outline fixed right-5 bottom-5 z-50 cursor-pointer text-white sm:right-8"
    >
      <span className="text-[10px]" style={{ color: on ? 'var(--coin)' : 'var(--muted-fg)' }}>
        {on ? '♪ SOUND ON' : '♪ SOUND OFF'}
      </span>
      {on && !started && (
        <span className="mt-2 block text-[8px] opacity-80">TAP TO PLAY</span>
      )}
    </button>
  );
}
