@AGENTS.md

# Diff vs upstream portfolio

This repo is [Udit55Sharma/Udit_Sharma_Portfolio](https://github.com/Udit55Sharma/Udit_Sharma_Portfolio)
plus commits that add sound and drop the mobile fallback.

| | Commit |
|---|---|
| Upstream `main` (base) | `7cfb83e` — "Update the tab title" |
| This repo | `7cfb83e` + this repo's own commits (`git log 7cfb83e..main`) |

Full upstream history is kept; everything up to `7cfb83e` is identical.
Reproduce the diff with:

```sh
git diff 7cfb83e main
```

## Summary

```
 app/page.tsx               |   5 +-
 components/GameWorld.tsx   |  18 ++--
 components/SoundToggle.tsx |  54 ++++++++++++   (new)
 lib/sound.ts               | ~180 ++++++++++++   (new)
 public/audio/theme.mp3     | binary, 733 KB      (new)
```

No other files differ: content, styles, other assets, config and dependencies
(`package.json`, `package-lock.json`) are unchanged. No new packages.

## What changed

### 1. Sound (new)

**`lib/sound.ts`**: all audio, played through the Web Audio API.

- **Background music:** the MP3 at `public/audio/theme.mp3`, supplied by the
  site owner. It is fetched and decoded once, then looped with an
  `AudioBufferSourceNode`. To change the song, replace that file.
  - **Licensing:** this track is third-party copyrighted music. Hosting it
    publicly is the owner's call, and it may draw takedown requests.
- **Block sound:** a synthesised square-wave "thump" (220→90 Hz) followed by a
  quick rising G–C–E–G–C arpeggio. No file is needed.
- **Levels:** music gain `0.12` (kept low), effects gain `0.14`. Volume goes
  through `GainNode`s, not an `<audio>` element's `volume`, which is
  read-only on iOS.
- **Autoplay rules:** nothing plays until `unlock()` runs from a user gesture
  (tap, click or key). Scrolling is not a gesture. The track downloads on that
  first gesture, so music starts a moment later.
- **Persistence:** the on/off choice is saved in `localStorage` under
  `udit-sound`. Storage failures, such as private mode, are ignored.
- **Tab hidden:** the `AudioContext` is suspended while the tab is hidden and
  resumed when the visitor comes back.

**`components/SoundToggle.tsx`** — a fixed `♪ SOUND ON` / `♪ SOUND OFF`
button in the bottom-right, styled as a HUD plate.

- It listens once, in the capture phase, for the first `pointerdown`,
  `touchend`, `keydown` or `click` anywhere on the page, and starts the audio
  from that gesture.
- It shows "TAP TO PLAY" until then.
- The unlocking tap never mutes. If that first tap lands on the button, it
  only starts the audio.
- The on/off state comes from `useSyncExternalStore`, so there is no
  setState-in-effect lint error.

### 2. `components/GameWorld.tsx`

- Imports `SoundToggle` and `playBlockSound`, and renders `<SoundToggle />`
  right after `<Hud />`.
- **The block sound plays once per block per page load.** A `struck` set
  inside the scroll effect records the blocks already broken. Revisiting a
  broken block, in either direction, is silent, matching the block's own
  spent "·" state.
- **The width gate is removed.** `DESKTOP_QUERY` (`min-width: 1024px`) and
  its early return are gone, and the container's `hidden … lg:block` becomes
  `block`. The game now runs at every width.

### 3. `app/page.tsx`

- `MobileWorld` is no longer rendered or imported. Every visitor gets the
  side-scrolling game.
- `components/MobileWorld.tsx` itself is still in the repo, untouched.

## Behaviour differences a visitor will notice

| | Upstream | This repo |
|---|---|---|
| Phone / narrow screen (<1024px) | Plain readable page (`MobileWorld`) | Side-scrolling game |
| Audio | None | Quiet looping theme music after the first tap, plus a sound on each block's first hit |
| Extra UI | — | SOUND ON/OFF button, bottom-right |

## Known caveats

- **Mobile layout:** removing the mobile fallback was meant to be temporary,
  for testing the game on a phone. The game isn't tuned for narrow screens.
  To restore upstream behaviour, revert the `app/page.tsx` change and the
  width-gate lines in `GameWorld.tsx`. The sound can stay.
- **iOS:** Web Audio respects the ring/silent switch.
- **Pre-existing, also on upstream:** a fast scroll can log React's "Maximum
  update depth exceeded". The likely cause is `components/ProjectBlock.tsx`
  calling `setOpen(false)` directly in an effect, which `eslint` flags as
  `react-hooks/set-state-in-effect`. This commit does not change it.
- **Type generation:** in a fresh clone, `tsc --noEmit` needs Next's generated
  types first (`next dev`, `next build` or `next typegen`). Without them it
  reports `Cannot find name 'LayoutProps'` in `app/layout.tsx`.
