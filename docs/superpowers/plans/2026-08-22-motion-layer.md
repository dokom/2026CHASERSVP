# Motion Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the semantic, unanimated guest portal built in Plan 2 into the scroll-advancing experience the spec describes — without touching its data flow, its form logic, or its accessibility.

**Architecture:** Motion is a layer, not a rewrite. Every act component from Plan 2 keeps its markup, headings, landmarks and form semantics; this plan wraps those elements in client components that attach Anime.js timelines after hydration and remove them on unmount. A single `MotionProvider` decides **once per page load** whether the visitor gets `full`, `lite` or `reduced` motion, and every timeline factory takes that mode as input. There is exactly one scroll observer layer (Anime's `onScroll`) — no component adds its own scroll listener. The Three.js hero lives behind `next/dynamic({ ssr: false })` and a tier gate, so its bytes never reach the server bundle, the shared client chunk, or a low-end phone.

**Tech Stack:** Everything from Plans 1–2, plus `animejs@4.5.0` (already installed) and `three@0.185.1` with `@types/three` (already installed). Fonts via `next/font/google`. No other additions.

**Spec:** `docs/superpowers/specs/2026-08-21-gala-rsvp-portal-design.md` — sections 6 (visual direction), 9 (guest journey), 9.2 (motion safety rails), and the success criteria in section 4.

**Plans 1–2:** read the **AS-BUILT DIVERGENCES** section of the Plan 1 document before trusting any earlier code sample. The guest portal's current markup is in `src/app/i/[token]/page.tsx` and `src/components/guest/*`; its hooks are `id="welcome|event|evening|seat|rsvp"` on the act headings and `data-agenda` on the agenda list. **Those ids and attributes are the contract this plan animates against — do not rename them.**

---

## Design plan

The spec pins the ground: ink navy to near-black with a brass accent. That is also one of the three looks that generic AI design defaults to, so the brief's words are followed exactly and the execution has to earn it through choices specific to this subject.

**The subject's world.** A gala invitation is a physical object — engraved card stock, a wax seal, foil stamping, a printed programme, a place card. The page should feel like handling that object, not like a website with sections.

**Signature: one brass line, drawn by your scroll.** A single continuous SVG path runs the full height of the guest page. At the top it *is* the broken edge of the wax seal. Below, it becomes the spine of the agenda timeline. It bends toward the guest's table on the floorplan. It closes into the seal again at the end. Scrolling draws it. It is the one memorable thing, everything around it stays quiet, and it encodes something true — it is literally the guest's journey from arrival to confirmation.

**The real risk.** The guest's **name** is the hero, set enormous, resolved letter by letter — not the event name. The whole point of a QR-token system is "we already know who you are." The invitation is about them.

**Palette.** Brass is *semantic*: it marks only what is the guest's own — their name, their table, their seal, and the line that carries them. Most of the page has no accent at all.

| Token | Hex | Role |
| --- | --- | --- |
| `--ink` | `#0B0F1F` | page ground |
| `--midnight` | `#141A33` | raised surfaces |
| `--brass` | `#C9A24D` | what is yours |
| `--brass-dim` | `#8C6F2F` | the drawn line, hairlines |
| `--bone` | `#EFE9DC` | text |
| `--mist` | `#8B90A6` | secondary text |

**Type.** Display: **Bodoni Moda** — a didone, which is what engraved invitations are actually set in; its `opsz` axis keeps the hairlines from shimmering on a phone. Body and UI: **Instrument Sans** — slightly narrow, good at small sizes, and not the default grotesk. Eyebrows (act labels) in Instrument Sans small caps, wide-tracked, the way engraved captions are set.

**Three.js.** Not abstract particles — **foil flecks**: brass-coloured, ~800 instanced points, drifting slowly, dispersing when the seal breaks. One shader. Absent entirely on low-tier devices.

**Film grain.** A static SVG `feTurbulence` overlay at ~6% opacity, fixed, `pointer-events: none`. Static, not animated — animated grain is the scattered-effects trap and costs continuous paint.

**Deliberately cut.** Parallax on the Event act (the spec mentions it; it is the "effects everywhere" failure mode and adds nothing the line does not). Numbered act markers (the acts are not a sequence the reader needs to count — the agenda already carries real order through its times). Hover effects on a mobile-first page.

---

## Global Constraints

Everything binding in Plans 1–2 still binds. New constraints specific to motion:

- **Compositor-only animation.** Only `transform`, `opacity`, `clip-path`, and `stroke-dashoffset` (for the line) are animated. Never `width`, `height`, `top`, `left`, `margin`, `padding`, `font-size`, or `filter` on anything large. A timeline that animates a layout-bound property is a defect.
- **Every timeline has a reduced-motion end state.** With `prefers-reduced-motion: reduce`, every act renders its final frame immediately: the line fully drawn, the name fully visible, the seal already broken, the agenda fully revealed. Content is fully readable and the form fully usable with zero animation. This is not optional and it is tested.
- **Motion mode is decided once** by `MotionProvider` and threaded to timeline factories as a parameter. No component reads `matchMedia` or `navigator.deviceMemory` on its own.
- **One scroll layer.** Anime's `onScroll` is the only scroll observer. No `addEventListener('scroll', …)` anywhere in `src/`. ESLint will not catch this; the final review will.
- **Three.js never reaches the server or the shared chunk.** `three` is imported only inside the one component that is loaded with `next/dynamic({ ssr: false })`. An end-to-end test proves a low-tier visitor never requests the chunk.
- **`will-change` is narrow and temporary** — applied by a timeline when it starts, removed when it completes. Never left on an element in CSS.
- **React 19 Strict Mode double-invokes effects.** Every timeline is created inside `createScope()` and reverted in the effect cleanup, or it runs twice and leaks. A component that creates an animation without a cleanup is a defect.
- **Plan 2's markup is the contract.** Wrap elements, add `data-*` attributes and classes — never restructure headings, landmarks, lists or form controls. The RSVP form's "all steps stay mounted, hidden with `hidden`" rule stands: step transitions animate the visible step's *children*, never unmount a step.
- **No new runtime dependency** beyond `animejs` and `three`, both already installed. Do not change any dependency version.
- **Every task runs `npm run typecheck` and `npm run lint`.** Tasks that touch the guest page also run `npm run build` — but **only one agent at a time**, because Next holds a global build lock.

---

## File Structure

**Foundations**
- `src/app/globals.css` — token system, grain, type scale, reduced-motion baseline *(modify)*
- `src/app/layout.tsx` — load the two fonts, expose `--font-display` / `--font-body` *(modify)*
- `src/lib/motion/preferences.ts` — pure: `deviceTier`, `prefersReducedMotion`, `resolveMotionMode`
- `src/lib/motion/brass-path.ts` — pure: build the line's `d` attribute from act anchor positions
- `src/components/motion/motion-provider.tsx` — client: decides mode once, exposes `useMotionMode()`
- `src/components/motion/use-motion-scope.ts` — client hook: `createScope` + revert on cleanup

**Acts** (each wraps Plan 2 markup; each exports a timeline factory taking `(scope, mode)`)
- `src/components/motion/brass-line.tsx` — the signature
- `src/components/motion/arrival.tsx` — seal morph + name reveal
- `src/components/motion/foil-hero.tsx` — Three.js, dynamic import only
- `src/components/motion/evening.tsx` — agenda stagger along the line
- `src/components/motion/seat.tsx` — zoom toward the marker
- `src/components/motion/rsvp-steps.tsx` — step transition wrapper
- `src/components/motion/sealed.tsx` — stamp press

**Modified**
- `src/app/i/[token]/page.tsx` — wrap acts in their motion components *(the only page touched)*
- `src/app/i/[token]/rsvp-form.tsx` — hand the step index to `RsvpSteps` *(one prop, no logic change)*

**Tests**
- `tests/unit/motion-preferences.test.ts`, `tests/unit/brass-path.test.ts`
- `tests/e2e/motion.spec.ts` — reduced motion, low tier, no-three-chunk, no-horizontal-overflow
- `tests/e2e/visual.spec.ts` — screenshots at 375 / 768 / 1440, both themes

---

## Task 1: Tokens, fonts and grain

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`
- Test: typecheck, lint, build, and a screenshot you look at

**Interfaces:**
- Produces CSS custom properties `--ink`, `--midnight`, `--brass`, `--brass-dim`, `--bone`, `--mist`, `--font-display`, `--font-body`, and the type scale `--text-hero`, `--text-display`, `--text-title`, `--text-body`, `--text-eyebrow`
- Keeps every existing `--color-*` variable that Plan 1–2 components reference, aliased to the new tokens, so nothing else breaks

The existing `globals.css` defines `--color-ink`, `--color-brass`, `--color-text`, etc. in `oklch`. **Do not delete them** — admin screens use them. Redefine them as aliases of the new hex tokens so both surfaces share one palette.

- [ ] **Step 1: Load the fonts in `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { Bodoni_Moda, Instrument_Sans } from 'next/font/google'
import './globals.css'

/**
 * Bodoni Moda is a didone — the face engraved invitations are actually set in.
 * Its optical-size axis is what keeps the hairlines from shimmering at small
 * sizes on a phone; loading it as a variable font keeps that axis available.
 */
const display = Bodoni_Moda({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-display',
  display: 'swap',
})

const body = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Gala RSVP',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Rewrite `src/app/globals.css`**

```css
@import "tailwindcss";

/* ------------------------------------------------------------------ tokens */
:root {
  /* Midnight Gala. Brass is semantic: it marks only what is the guest's own. */
  --ink:       #0B0F1F;
  --midnight:  #141A33;
  --brass:     #C9A24D;
  --brass-dim: #8C6F2F;
  --bone:      #EFE9DC;
  --mist:      #8B90A6;
  --danger:    #D9604F;
  --success:   #7FB98F;

  /* Type scale. Display sizes are fluid; the hero is deliberately enormous. */
  --text-hero:    clamp(3.25rem, 2rem + 9vw, 8.5rem);
  --text-display: clamp(2rem, 1.4rem + 3.5vw, 4rem);
  --text-title:   clamp(1.375rem, 1.15rem + 1.2vw, 2rem);
  --text-body:    clamp(1rem, 0.95rem + 0.3vw, 1.125rem);
  --text-eyebrow: 0.6875rem;

  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);

  /* Aliases the admin screens already reference. Keep them in step above. */
  --color-ink: var(--midnight);
  --color-ink-deep: var(--ink);
  --color-bone: var(--bone);
  --color-brass: var(--brass);
  --color-brass-dim: var(--brass-dim);
  --color-surface: var(--midnight);
  --color-border: #2A3150;
  --color-text: var(--bone);
  --color-text-muted: var(--mist);
  --color-danger: var(--danger);
  --color-success: var(--success);
}

/* Light theme is a designed theme, not an inversion: warm bone ground, same brass. */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --ink:       #F4EFE4;
    --midnight:  #FFFFFF;
    --bone:      #161A2B;
    --mist:      #5B6078;
    --color-border: #D9D2C2;
  }
}
:root[data-theme="dark"] {
  --ink:       #0B0F1F;
  --midnight:  #141A33;
  --bone:      #EFE9DC;
  --mist:      #8B90A6;
  --color-border: #2A3150;
}

/* ------------------------------------------------------------------- base */
body {
  background: var(--ink);
  color: var(--bone);
  font-family: var(--font-body), system-ui, sans-serif;
  font-size: var(--text-body);
  -webkit-font-smoothing: antialiased;
}

.font-serif,
.type-display {
  font-family: var(--font-display), "Bodoni Moda", Didot, "Times New Roman", serif;
  font-variation-settings: "opsz" 72;
  letter-spacing: -0.01em;
  line-height: 1.02;
}

.type-hero    { font-size: var(--text-hero); }
.type-display { font-size: var(--text-display); }
.type-title   { font-size: var(--text-title); font-variation-settings: "opsz" 24; }

/* Engraved-caption eyebrows: small caps, wide tracking. */
.type-eyebrow {
  font-family: var(--font-body), system-ui, sans-serif;
  font-size: var(--text-eyebrow);
  font-variant-caps: all-small-caps;
  letter-spacing: 0.22em;
  color: var(--mist);
}

/* ------------------------------------------------------------------ grain */
/* Static film grain. Not animated: animated grain costs continuous paint and
   is the "effects everywhere" failure mode. 6% is visible on a phone without
   muddying the type. */
.grain::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  opacity: 0.06;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* --------------------------------------------------------- reduced motion */
/* Baseline: the motion layer checks this itself via MotionProvider, but a CSS
   backstop means nothing moves even if a script fails to load. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}

/* Ambient pulse on the guest's own table (Task 8). CSS, not a timeline: it
   loops, and the reduced-motion backstop above already stops it. The
   box-shadow is on a 16px element and paints only its own layer — the one
   deliberate exception to the compositor-only rule, and it is tiny. */
@keyframes seat-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgb(201 162 77 / 0.55); }
  70%      { box-shadow: 0 0 0 14px rgb(201 162 77 / 0); }
}
.seat-pulse { animation: seat-pulse 2.4s ease-out infinite; }

/* One-shot brass shimmer after the stamp lands (Task 10). background-position
   on a text-clipped gradient a few hundred pixels wide — cheap, runs once. */
@keyframes sealed-shimmer {
  from { background-position: -200% 0; }
  to   { background-position: 200% 0; }
}
.sealed-shimmer [data-testid="rsvp-confirmed"] {
  background: linear-gradient(100deg, var(--bone) 40%, var(--brass) 50%, var(--bone) 60%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: sealed-shimmer 1.4s ease-out 1 forwards;
}

/* Visible keyboard focus everywhere, in brass. */
:focus-visible {
  outline: 2px solid var(--brass);
  outline-offset: 3px;
}
```

- [ ] **Step 3: Verify, look, commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
```

Then start the app, open an invite link and the admin panel, and **look at both**. The admin panel must look unchanged apart from the fonts. If any admin text has become unreadable, an alias is wrong — fix the alias, not the admin component.

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat: Midnight Gala tokens, type pairing and film grain"
```

---

## Task 2: Motion preferences

**Files:**
- Create: `src/lib/motion/preferences.ts`
- Test: `tests/unit/motion-preferences.test.ts`

**Interfaces:**
- Consumes: nothing — pure; browser objects are passed in
- Produces:
  - `type MotionMode = 'full' | 'lite' | 'reduced'`
  - `type DeviceTier = 'high' | 'low'`
  - `deviceTier(nav: NavigatorLike): DeviceTier`
  - `prefersReducedMotion(matchMedia: MatchMediaLike | undefined): boolean`
  - `resolveMotionMode(input: { reducedMotion: boolean; tier: DeviceTier }): MotionMode`
  - `type NavigatorLike = { deviceMemory?: number; hardwareConcurrency?: number; connection?: { effectiveType?: string; saveData?: boolean } }`

The browser objects are parameters so the logic is testable in Node, and so the one place that reads them (`MotionProvider`) is trivially small.

- [ ] **Step 1: Write the failing test**

`tests/unit/motion-preferences.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deviceTier, prefersReducedMotion, resolveMotionMode } from '@/lib/motion/preferences'

describe('deviceTier', () => {
  it('is high for a capable device', () => {
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe('high')
  })

  it('is low when memory is scarce', () => {
    expect(deviceTier({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe('low')
  })

  it('is low when cores are scarce', () => {
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 2 })).toBe('low')
  })

  it('is low on a slow connection', () => {
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 8, connection: { effectiveType: '2g' } })).toBe('low')
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 8, connection: { effectiveType: 'slow-2g' } })).toBe('low')
  })

  it('is low when the visitor asked to save data', () => {
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 8, connection: { saveData: true } })).toBe('low')
  })

  it('treats missing signals as capable — Safari reports none of them', () => {
    // Penalising the absence of a signal would drop every iPhone to low tier.
    expect(deviceTier({})).toBe('high')
  })

  it('treats exactly the threshold as capable', () => {
    expect(deviceTier({ deviceMemory: 4, hardwareConcurrency: 4 })).toBe('high')
  })
})

describe('prefersReducedMotion', () => {
  it('reads the media query', () => {
    const matchMedia = (q: string) => ({ matches: q.includes('reduce') })
    expect(prefersReducedMotion(matchMedia)).toBe(true)
  })

  it('is false when the query does not match', () => {
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false)
  })

  it('is false when matchMedia is unavailable', () => {
    expect(prefersReducedMotion(undefined)).toBe(false)
  })
})

describe('resolveMotionMode', () => {
  it('reduced wins over everything', () => {
    expect(resolveMotionMode({ reducedMotion: true, tier: 'high' })).toBe('reduced')
    expect(resolveMotionMode({ reducedMotion: true, tier: 'low' })).toBe('reduced')
  })

  it('low tier gets lite motion — timelines without the WebGL layer', () => {
    expect(resolveMotionMode({ reducedMotion: false, tier: 'low' })).toBe('lite')
  })

  it('high tier gets everything', () => {
    expect(resolveMotionMode({ reducedMotion: false, tier: 'high' })).toBe('full')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/motion-preferences.test.ts`
Expected: FAIL — cannot resolve `@/lib/motion/preferences`.

- [ ] **Step 3: Implement `src/lib/motion/preferences.ts`**

```ts
export type MotionMode = 'full' | 'lite' | 'reduced'
export type DeviceTier = 'high' | 'low'

export type NavigatorLike = {
  deviceMemory?: number
  hardwareConcurrency?: number
  connection?: { effectiveType?: string; saveData?: boolean }
}

export type MatchMediaLike = (query: string) => { matches: boolean }

const MIN_MEMORY_GB = 4
const MIN_CORES = 4
const SLOW_CONNECTIONS = new Set(['slow-2g', '2g'])

/**
 * Classifies the device from the signals the browser volunteers.
 *
 * A missing signal counts as capable: Safari reports none of these, and
 * penalising absence would drop every iPhone to the low tier. Only a signal
 * that is present AND poor demotes the device.
 */
export function deviceTier(nav: NavigatorLike): DeviceTier {
  if (nav.deviceMemory !== undefined && nav.deviceMemory < MIN_MEMORY_GB) return 'low'
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < MIN_CORES) return 'low'
  if (nav.connection?.saveData) return 'low'
  if (nav.connection?.effectiveType && SLOW_CONNECTIONS.has(nav.connection.effectiveType)) {
    return 'low'
  }
  return 'high'
}

export function prefersReducedMotion(matchMedia: MatchMediaLike | undefined): boolean {
  if (!matchMedia) return false
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * reduced > lite > full. Reduced motion is an accessibility preference and
 * always wins; lite is the same journey without the WebGL layer.
 */
export function resolveMotionMode(input: { reducedMotion: boolean; tier: DeviceTier }): MotionMode {
  if (input.reducedMotion) return 'reduced'
  if (input.tier === 'low') return 'lite'
  return 'full'
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/unit/motion-preferences.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/motion/preferences.ts tests/unit/motion-preferences.test.ts
git commit -m "feat: motion mode resolution"
```

---

## Task 3: Motion provider and scope hook

**Files:**
- Create: `src/components/motion/motion-provider.tsx`, `src/components/motion/use-motion-scope.ts`
- Test: typecheck and lint; behaviour is covered by Task 12's end-to-end suite

**Interfaces:**
- Consumes: Task 2
- Produces:
  - `<MotionProvider>` — client component; decides the mode once on mount and exposes it
  - `useMotionMode(): MotionMode` — returns `'reduced'` until mounted, so the first paint never animates and SSR output is stable
  - `useMotionScope(factory: (scope: Scope, mode: MotionMode) => void, deps)` — creates an Anime `Scope`, runs the factory inside it, and **reverts it on cleanup**

The hook is the single answer to React 19 Strict Mode double-invoking effects: every timeline in this plan is created through it, so every timeline is cleaned up.

- [ ] **Step 1: Implement `src/components/motion/motion-provider.tsx`**

```tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import {
  deviceTier, prefersReducedMotion, resolveMotionMode, type MotionMode,
} from '@/lib/motion/preferences'

const MotionContext = createContext<MotionMode>('reduced')

/**
 * Decides the motion mode exactly once per page load and hands it down.
 *
 * Starts as 'reduced' so server output and the first client paint agree and
 * nothing animates before hydration. The real mode is resolved in an effect —
 * the only place in the app that reads navigator or matchMedia.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<MotionMode>('reduced')

  useEffect(() => {
    const nav = navigator as Navigator & {
      deviceMemory?: number
      connection?: { effectiveType?: string; saveData?: boolean }
    }
    setMode(resolveMotionMode({
      reducedMotion: prefersReducedMotion(window.matchMedia?.bind(window)),
      tier: deviceTier({
        deviceMemory: nav.deviceMemory,
        hardwareConcurrency: nav.hardwareConcurrency,
        connection: nav.connection,
      }),
    }))
  }, [])

  return (
    <MotionContext.Provider value={mode}>
      <div data-motion={mode} className="contents">{children}</div>
    </MotionContext.Provider>
  )
}

export function useMotionMode(): MotionMode {
  return useContext(MotionContext)
}
```

The `data-motion` attribute is what the end-to-end tests read to know which mode the page resolved.

- [ ] **Step 2: Implement `src/components/motion/use-motion-scope.ts`**

```ts
'use client'

import { useEffect, type DependencyList } from 'react'
import { createScope, type Scope } from 'animejs'
import type { MotionMode } from '@/lib/motion/preferences'
import { useMotionMode } from './motion-provider'

/**
 * Runs a timeline factory inside an Anime scope and reverts it on cleanup.
 *
 * React 19 Strict Mode runs every effect twice in development. Without the
 * revert, every timeline in the app would be created twice and the second
 * copy would leak. Every animation in this codebase goes through this hook.
 *
 * The factory is skipped entirely in 'reduced' mode: the markup's own final
 * state IS the reduced-motion rendering, so there is nothing to set up.
 */
export function useMotionScope(
  factory: (scope: Scope, mode: Exclude<MotionMode, 'reduced'>) => void,
  deps: DependencyList = [],
): void {
  const mode = useMotionMode()

  useEffect(() => {
    if (mode === 'reduced') return undefined
    const scope = createScope()
    scope.add(() => factory(scope, mode))
    return () => {
      scope.revert()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- factory identity is intentionally not a dep
  }, [mode, ...deps])
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/components/motion/motion-provider.tsx src/components/motion/use-motion-scope.ts
git commit -m "feat: motion provider and scoped timeline hook"
```

---

## Task 4: The brass line

**Files:**
- Create: `src/lib/motion/brass-path.ts`, `src/components/motion/brass-line.tsx`
- Test: `tests/unit/brass-path.test.ts`

**Interfaces:**
- Consumes: `createDrawable`, `animate`, `onScroll` from `animejs`; `useMotionScope` (Task 3)
- Produces:
  - `type Anchor = { y: number; x?: number }` — document-relative pixel positions
  - `buildBrassPath(input: { gutterX: number; width: number; start: Anchor; anchors: Anchor[]; end: Anchor }): string` — the SVG `d`
  - `<BrassLine />` — measures the act sections after mount, builds the path, draws it on scroll

This is the signature. It starts at the seal in the Arrival act, runs down the left gutter, bends toward the guest's table marker if there is one, and ends at the seal in the Sealed act. Everything else on the page is quiet so this can be the one memorable thing.

The path math is pure and tested. The component only measures and hands off.

- [ ] **Step 1: Write the failing test**

`tests/unit/brass-path.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildBrassPath } from '@/lib/motion/brass-path'

const base = {
  gutterX: 24,
  width: 375,
  start: { x: 187, y: 120 },
  anchors: [{ y: 600 }, { y: 1200 }, { y: 1800, x: 240 }, { y: 2400 }],
  end: { x: 187, y: 3000 },
}

describe('buildBrassPath', () => {
  it('starts at the seal with a move command', () => {
    expect(buildBrassPath(base)).toMatch(/^M\s*187(\.\d+)?\s+120/)
  })

  it('ends at the closing seal', () => {
    const d = buildBrassPath(base)
    const last = d.trim().split(/[A-Z]/).filter(Boolean).at(-1)!.trim().split(/[\s,]+/)
    expect(Number(last.at(-2))).toBeCloseTo(187, 0)
    expect(Number(last.at(-1))).toBeCloseTo(3000, 0)
  })

  it('passes through every anchor y', () => {
    const d = buildBrassPath(base)
    for (const anchor of base.anchors) expect(d).toContain(String(anchor.y))
  })

  it('bends toward an anchor that carries its own x, then returns to the gutter', () => {
    const d = buildBrassPath(base)
    expect(d).toContain('240')
    // The segment after the bend must come back to the gutter x.
    const afterBend = d.slice(d.indexOf('240'))
    expect(afterBend).toContain('24 ')
  })

  it('uses only curves between anchors, never straight line commands', () => {
    // Straight L segments read as a diagram; the line is handwritten, not ruled.
    expect(buildBrassPath(base)).not.toMatch(/\bL\b/)
  })

  it('is deterministic', () => {
    expect(buildBrassPath(base)).toBe(buildBrassPath(base))
  })

  it('still draws a seal-to-seal line with no anchors at all', () => {
    const d = buildBrassPath({ ...base, anchors: [] })
    expect(d.startsWith('M')).toBe(true)
    expect(d).toContain('3000')
  })

  it('never emits NaN', () => {
    expect(buildBrassPath(base)).not.toContain('NaN')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/brass-path.test.ts`
Expected: FAIL — cannot resolve `@/lib/motion/brass-path`.

- [ ] **Step 3: Implement `src/lib/motion/brass-path.ts`**

```ts
export type Anchor = { y: number; x?: number }

export type BrassPathInput = {
  gutterX: number
  width: number
  start: Anchor
  anchors: Anchor[]
  end: Anchor
}

const round = (n: number) => Math.round(n * 10) / 10

/**
 * A cubic segment from (x0,y0) to (x1,y1) whose handles are vertical, so the
 * line leaves and arrives travelling straight down — a drawn stroke, not a
 * plotted one.
 */
function curveTo(x0: number, y0: number, x1: number, y1: number): string {
  const dy = (y1 - y0) * 0.5
  return `C ${round(x0)} ${round(y0 + dy)}, ${round(x1)} ${round(y1 - dy)}, ${round(x1)} ${round(y1)}`
}

/**
 * Builds the brass line: from the opening seal, down the left gutter through
 * each act, bending toward any anchor that carries its own x (the guest's
 * table), and closing on the final seal. Cubic curves only — a straight
 * segment reads as a diagram, and this is meant to read as a hand.
 */
export function buildBrassPath(input: BrassPathInput): string {
  const { gutterX, start, anchors, end } = input
  const parts: string[] = [`M ${round(start.x ?? gutterX)} ${round(start.y)}`]

  let cx = start.x ?? gutterX
  let cy = start.y

  for (const anchor of anchors) {
    const nx = anchor.x ?? gutterX
    parts.push(curveTo(cx, cy, nx, anchor.y))
    cx = nx
    cy = anchor.y

    // An anchor that pulled the line sideways hands it back to the gutter
    // a little further down, so the next act starts from the margin.
    if (anchor.x !== undefined && anchor.x !== gutterX) {
      const returnY = anchor.y + 80
      parts.push(curveTo(cx, cy, gutterX, returnY))
      cx = gutterX
      cy = returnY
    }
  }

  parts.push(curveTo(cx, cy, end.x ?? gutterX, end.y))
  return parts.join(' ')
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/unit/brass-path.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Implement `src/components/motion/brass-line.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { animate, createDrawable, onScroll } from 'animejs'
import { buildBrassPath, type Anchor } from '@/lib/motion/brass-path'
import { useMotionScope } from './use-motion-scope'
import { useMotionMode } from './motion-provider'

const GUTTER_X = 24
const ACT_IDS = ['welcome', 'event', 'evening', 'seat', 'rsvp'] as const

type Geometry = { d: string; height: number; width: number }

/** Document-relative top of an element, independent of current scroll. */
function docTop(el: Element): number {
  return el.getBoundingClientRect().top + window.scrollY
}

function measure(root: HTMLElement): Geometry | null {
  const headings = ACT_IDS
    .map((id) => root.querySelector<HTMLElement>(`#${id}`))
    .filter((el): el is HTMLElement => el !== null)
  if (headings.length < 2) return null

  const rootTop = docTop(root)
  const width = root.clientWidth
  const height = root.scrollHeight

  const anchors: Anchor[] = headings.slice(1).map((h) => {
    const anchor: Anchor = { y: docTop(h) - rootTop }
    // The seat act bends toward the guest's marker, if one is placed.
    if (h.id === 'seat') {
      const marker = root.querySelector<HTMLElement>('[data-testid="table-marker"]')
      if (marker) {
        const rect = marker.getBoundingClientRect()
        anchor.x = rect.left + rect.width / 2 - root.getBoundingClientRect().left
        anchor.y = docTop(marker) - rootTop
      }
    }
    return anchor
  })

  const seal = root.querySelector<HTMLElement>('[data-seal]')
  const sealX = seal ? seal.getBoundingClientRect().left + seal.offsetWidth / 2 - root.getBoundingClientRect().left : width / 2
  const sealY = seal ? docTop(seal) + seal.offsetHeight / 2 - rootTop : 120

  return {
    width,
    height,
    d: buildBrassPath({
      gutterX: GUTTER_X,
      width,
      start: { x: sealX, y: sealY },
      anchors,
      end: { x: width / 2, y: height - 80 },
    }),
  }
}

/**
 * The signature: one continuous brass line, drawn by scroll, from the opening
 * seal to the closing one. Absolutely positioned over the guest <main>, which
 * must be `position: relative`.
 *
 * In reduced mode the path renders fully drawn — the SVG's natural state —
 * and no timeline is created at all.
 */
export function BrassLine() {
  const mode = useMotionMode()
  const pathRef = useRef<SVGPathElement>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)

  // Measure after layout, and again whenever the page reflows. Reflow is a
  // layout event we respond to, not something we animate.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-guest-root]')
    if (!root) return undefined
    const update = () => setGeometry(measure(root))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useMotionScope(() => {
    const path = pathRef.current
    const root = document.querySelector<HTMLElement>('[data-guest-root]')
    if (!path || !root || !geometry) return
    const [drawable] = createDrawable(path)
    if (!drawable) return
    animate(drawable, {
      draw: ['0 0', '0 1'],
      ease: 'linear',
      autoplay: onScroll({
        target: root,
        enter: 'top top',
        leave: 'bottom bottom',
        sync: 0.35,
      }),
    })
  }, [geometry?.d])

  if (!geometry) return null

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      data-brass-line={mode}
    >
      <path
        ref={pathRef}
        d={geometry.d}
        fill="none"
        stroke="var(--brass-dim)"
        strokeWidth={1.25}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
```

**Threshold syntax note for the implementer.** Anime v4's `onScroll` thresholds are strings of the form `'<target edge> <container edge>'` — `'top top'` fires when the target's top meets the container's top. Confirm against `node_modules/animejs` before relying on the exact strings; if the documented form differs, use the documented form and note it in your report. The *behaviour* is the contract: fully undrawn at the top of the page, fully drawn at the bottom, smoothed by `sync: 0.35`.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/motion/brass-path.ts src/components/motion/brass-line.tsx tests/unit/brass-path.test.ts
git commit -m "feat: the brass line, drawn by scroll"
```

---

## Task 5: Arrival — the seal breaks and the name resolves

**Files:**
- Create: `src/components/motion/arrival.tsx`, `src/components/motion/seal.tsx`
- Test: typecheck, lint; behaviour covered by Task 12

**Interfaces:**
- Consumes: `animate`, `createTimeline`, `splitText`, `morphTo`, `onScroll`, `stagger` from `animejs`; `useMotionScope`; `journey` (new, below)
- Produces:
  - `src/lib/motion/journey.ts` — `export const journey = { sealBreak: 0 }` — a mutable scalar the foil hero reads per frame, with no React re-render
  - `<Seal />` — an inline SVG with two paths: `[data-seal-intact]` and a hidden `[data-seal-broken]` morph target
  - `<Arrival>` — wraps the Plan 2 welcome section; on load, resolves the guest's name letter by letter; on scroll, breaks the seal

**Two motions, deliberately different triggers.** The name reveal plays **on load** — it is the hero moment and should not wait for a scroll. The seal break is **scroll-driven** over the first act, so the guest's own gesture opens the invitation. That is the one orchestrated moment on the page; everything after it is quieter.

**The name is the hero.** Plan 2 renders `Welcome, {firstName}.` in the `<h1>`. Set the name at `--text-hero` in the display face, brass. Keep "Welcome," and "." in bone at `--text-display`. Split only the name's characters.

- [ ] **Step 1: Create `src/lib/motion/journey.ts`**

```ts
/**
 * Scalars shared between timelines and the WebGL layer without going through
 * React state. The foil hero reads these every frame; re-rendering React 60
 * times a second to move particles would be the wrong tool.
 */
export const journey = {
  /** 0 = seal intact, 1 = fully broken. Written by Arrival's scroll timeline. */
  sealBreak: 0,
}
```

- [ ] **Step 2: Implement `src/components/motion/seal.tsx`**

```tsx
/**
 * A wax seal as two SVG paths. The intact disc is visible; the broken shape
 * is a morph target kept in the DOM but hidden, so morphTo() has real
 * geometry to read. Both paths have the same number of points — morphTo
 * needs that to interpolate cleanly.
 */
export function Seal() {
  return (
    <svg
      data-seal
      aria-hidden="true"
      viewBox="0 0 120 120"
      className="mx-auto block h-24 w-24"
    >
      <defs>
        <radialGradient id="seal-wax" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#E0BC6A" />
          <stop offset="60%" stopColor="var(--brass)" />
          <stop offset="100%" stopColor="var(--brass-dim)" />
        </radialGradient>
      </defs>
      <path
        data-seal-intact
        fill="url(#seal-wax)"
        d="M60 8 C84 6 104 22 110 44 C116 66 108 92 86 106 C64 120 36 114 20 96 C4 78 4 50 18 30 C30 14 44 10 60 8 Z"
      />
      <path
        data-seal-broken
        fill="url(#seal-wax)"
        className="hidden"
        d="M60 8 C84 6 104 22 110 44 C116 66 104 78 86 70 C64 60 52 84 36 96 C20 108 6 92 8 72 C10 52 4 50 18 30 C30 14 44 10 60 8 Z"
      />
      <circle cx="60" cy="60" r="22" fill="none" stroke="var(--ink)" strokeOpacity="0.35" strokeWidth="1.5" />
    </svg>
  )
}
```

- [ ] **Step 3: Implement `src/components/motion/arrival.tsx`**

```tsx
'use client'

import { useRef } from 'react'
import { animate, createTimeline, morphTo, onScroll, splitText, stagger } from 'animejs'
import { journey } from '@/lib/motion/journey'
import { useMotionScope } from './use-motion-scope'

/**
 * Wraps the welcome section. Two motions with deliberately different triggers:
 * the name resolves ON LOAD (the hero moment should not wait for a scroll),
 * and the seal breaks ON SCROLL through the first act (the guest's own
 * gesture opens the invitation).
 */
export function Arrival({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const root = ref.current
    if (!root) return

    // --- the name, on load ------------------------------------------------
    const name = root.querySelector<HTMLElement>('[data-guest-name]')
    if (name) {
      const { chars } = splitText(name, { chars: true })
      animate(chars, {
        opacity: [0, 1],
        translateY: ['0.35em', '0em'],
        ease: 'outExpo',
        duration: 900,
        delay: stagger(45, { start: 250 }),
      })
    }

    // --- the seal, on scroll -----------------------------------------------
    const intact = root.querySelector<SVGPathElement>('[data-seal-intact]')
    const broken = root.querySelector<SVGPathElement>('[data-seal-broken]')
    if (intact && broken) {
      createTimeline({
        autoplay: onScroll({
          target: root,
          enter: 'top top',
          leave: 'bottom top',
          sync: 0.5,
          onUpdate: (self) => {
            journey.sealBreak = self.progress
          },
        }),
      })
        .add(intact, { d: morphTo(broken), ease: 'inOutQuad', duration: 1000 })
        .add(intact, { rotate: -6, scale: 0.92, ease: 'outQuad', duration: 1000 }, 0)
    }
  })

  return <div ref={ref} data-arrival>{children}</div>
}
```

- [ ] **Step 4: The page markup Arrival expects — owned by Task 11, not this task**

Do NOT edit `src/app/i/[token]/page.tsx` here; Task 11 wires the page and is the only task that touches it. For reference, Arrival expects the heading to look like this — Task 11 applies it:

```tsx
<h1 id="welcome" className="type-display">
  Welcome,{' '}
  <span data-guest-name className="type-hero block text-[var(--brass)]">
    {primary ? primary.firstName : invite.label}
  </span>
</h1>
```

And `<Seal />` rendered immediately above the `<h1>` inside the welcome section. Task 11 does both.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/lib/motion/journey.ts src/components/motion/seal.tsx src/components/motion/arrival.tsx
git commit -m "feat: arrival — the seal breaks and the name resolves"
```

---

## Task 6: Foil hero (Three.js)

**Files:**
- Create: `src/components/motion/foil-hero.tsx`, `src/components/motion/foil-scene.tsx`
- Test: typecheck, lint; the no-chunk-on-low-tier property is proven in Task 12

**Interfaces:**
- Consumes: `three`; `journey.sealBreak` (Task 5); `useMotionMode` (Task 3)
- Produces: `<FoilHero />` — renders nothing unless mode is `'full'`; otherwise loads `foil-scene.tsx` via `next/dynamic({ ssr: false })`

**The containment rule is the whole point of this task.** `three` must be imported in exactly one file — `foil-scene.tsx` — and that file must only ever be reached through the dynamic import. If `three` appears in any other import statement, it leaks into the shared client chunk and every visitor pays for it. The gate on `mode === 'full'` must be checked **before** the dynamic component is rendered, so the import never fires on a lite or reduced visit.

**What the flecks are.** Brass foil, not generic particles: ~800 points, slow vertical drift with slight lateral sway, additive blending so overlaps glow, and a disperse impulse proportional to `journey.sealBreak` — when the seal breaks, the flecks scatter outward from the seal's position.

- [ ] **Step 1: Implement `src/components/motion/foil-hero.tsx`**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { useMotionMode } from './motion-provider'

/**
 * The ONLY path to three.js. Gated on mode before the dynamic component is
 * rendered, so the chunk is never requested on a lite or reduced visit.
 * ssr: false keeps three out of the server bundle entirely.
 */
const FoilScene = dynamic(() => import('./foil-scene').then((m) => m.FoilScene), {
  ssr: false,
  loading: () => null,
})

export function FoilHero() {
  const mode = useMotionMode()
  if (mode !== 'full') return null
  return <FoilScene />
}
```

- [ ] **Step 2: Implement `src/components/motion/foil-scene.tsx`**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, PerspectiveCamera,
  Points, Scene, ShaderMaterial, WebGLRenderer,
} from 'three'
import { journey } from '@/lib/motion/journey'

const COUNT = 800
const BRASS = new Color('#C9A24D')

const VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uDisperse;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    // Slow drift upward with a lateral sway unique to each fleck.
    p.y += mod(uTime * 0.04 * (0.6 + aSeed), 2.4) - 1.2;
    p.x += sin(uTime * 0.3 + aSeed * 6.28) * 0.08;
    // Disperse radially from the origin as the seal breaks.
    p.xy += normalize(p.xy + 0.0001) * uDisperse * (0.8 + aSeed) * 1.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.2 + aSeed * 2.2) * (240.0 / -mv.z);
    vAlpha = (0.35 + aSeed * 0.5) * (1.0 - uDisperse * 0.6);
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    // Soft disc; discard the corners so points read as flecks, not squares.
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.2, d);
    gl_FragColor = vec4(uColor, vAlpha * edge);
  }
`

function buildGeometry(): BufferGeometry {
  const positions = new Float32Array(COUNT * 3)
  const seeds = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 3.2
    positions[i * 3 + 1] = (Math.random() - 0.5) * 2.4
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5
    seeds[i] = Math.random()
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1))
  return geometry
}

/**
 * Brass foil flecks behind the arrival act. Pauses when the tab is hidden or
 * the hero scrolls out of view, and disposes everything on unmount — a WebGL
 * context left running off-screen is exactly the battery drain the spec's
 * motion rails forbid.
 */
export function FoilScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))

    const scene = new Scene()
    const camera = new PerspectiveCamera(55, 1, 0.1, 10)
    camera.position.z = 2.6

    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDisperse: { value: 0 },
        uColor: { value: BRASS },
      },
    })
    const points = new Points(buildGeometry(), material)
    scene.add(points)

    const resize = () => {
      const { clientWidth, clientHeight } = canvas
      renderer.setSize(clientWidth, clientHeight, false)
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let visible = true
    let hidden = document.hidden
    let frame = 0
    const start = performance.now()

    const tick = () => {
      frame = 0
      if (!visible || hidden) return
      material.uniforms.uTime!.value = (performance.now() - start) / 1000
      material.uniforms.uDisperse!.value = journey.sealBreak
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    const run = () => { if (!frame && visible && !hidden) frame = requestAnimationFrame(tick) }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      run()
    })
    io.observe(canvas)

    const onVisibility = () => { hidden = document.hidden; run() }
    document.addEventListener('visibilitychange', onVisibility)
    run()

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
      io.disconnect()
      ro.disconnect()
      points.geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-foil-hero
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] w-full"
    />
  )
}
```

- [ ] **Step 3: Prove containment**

```bash
grep -rn "from 'three'" src/ | grep -v foil-scene.tsx && echo "LEAK" || echo "three is contained to foil-scene.tsx"
```

Must print the containment line. If anything else imports `three`, the task is not done.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/components/motion/foil-hero.tsx src/components/motion/foil-scene.tsx
git commit -m "feat: brass foil hero, dynamically loaded and tier-gated"
```

---

## Task 7: The Evening — agenda reveals along the line

**Files:**
- Create: `src/components/motion/evening.tsx`
- Test: typecheck, lint; covered by Task 12

**Interfaces:**
- Consumes: `animate`, `onScroll` from `animejs`; `useMotionScope`
- Produces: `<Evening>` — wraps the evening section; each agenda `<li>` reveals as the brass line reaches it

The agenda list is `<ol data-agenda>` from Plan 2. Each item reveals as it enters the lower part of the viewport: opacity and a short rise, nothing else. The brass dot already in each item's markup is the point the line "arrives at" — it scales in a beat after the text, as if the pen paused there.

- [ ] **Step 1: Implement `src/components/motion/evening.tsx`**

```tsx
'use client'

import { useRef } from 'react'
import { animate, onScroll } from 'animejs'
import { useMotionScope } from './use-motion-scope'

export function Evening({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const root = ref.current
    if (!root) return
    const items = root.querySelectorAll<HTMLLIElement>('[data-agenda] > li')

    items.forEach((item) => {
      const dot = item.querySelector<HTMLElement>('[aria-hidden="true"]')
      animate(item, {
        opacity: [0, 1],
        translateY: [14, 0],
        ease: 'outQuad',
        duration: 600,
        autoplay: onScroll({ target: item, enter: 'bottom-=12% top', sync: 0.6 }),
      })
      if (dot) {
        animate(dot, {
          scale: [0, 1],
          ease: 'outBack',
          duration: 400,
          delay: 150,
          autoplay: onScroll({ target: item, enter: 'bottom-=12% top' }),
        })
      }
    })
  })

  return <div ref={ref} data-evening>{children}</div>
}
```

- [ ] **Step 2: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/components/motion/evening.tsx
git commit -m "feat: the evening — agenda reveals along the line"
```

---

## Task 8: Your Seat — zoom toward the table

**Files:**
- Create: `src/components/motion/seat.tsx`
- Modify: `src/components/guest/seat-map.tsx` — add `data-seat-map` to the image container and expose the marker's `x`/`y` as data attributes *(attributes only)*
- Test: typecheck, lint; covered by Task 12

**Interfaces:**
- Consumes: `animate`, `onScroll` from `animejs`; `useMotionScope`
- Produces: `<SeatAct>` — wraps the seat section; as it scrolls into view, the floorplan zooms toward the marker and the marker pulses

**Zoom toward the marker, not toward the centre.** Setting `transform-origin` to the marker's own percentage coordinates means a single `scale` keeps the marker pinned exactly where it is while the rest of the plan grows around it — the camera moves to the guest's table without any translate math and without the marker ever drifting. That only works because Plan 2 stored marker coordinates normalised 0–1.

The pulse is CSS, not a timeline: it is ambient, it loops, and the reduced-motion backstop in `globals.css` already kills it.

- [ ] **Step 1: Expose the marker position from `seat-map.tsx`**

In `src/components/guest/seat-map.tsx`, add to the image container `<div className="relative overflow-hidden …">`:

```tsx
data-seat-map
style={marker ? { transformOrigin: `${marker.x * 100}% ${marker.y * 100}%` } : undefined}
```

and to the marker `<span>` add `className="… seat-pulse"`. Nothing else changes.

- [ ] **Step 2: The pulse**

`.seat-pulse` and its keyframes already exist in `globals.css` from Task 1. Do not add them again; do not touch `globals.css` in this task.

- [ ] **Step 3: Implement `src/components/motion/seat.tsx`**

```tsx
'use client'

import { useRef } from 'react'
import { animate, onScroll } from 'animejs'
import { useMotionScope } from './use-motion-scope'

export function SeatAct({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const root = ref.current
    if (!root) return
    const map = root.querySelector<HTMLElement>('[data-seat-map]')
    if (!map) return

    // transform-origin is the marker itself (set by SeatMap), so scaling the
    // plan zooms toward the guest's table with the marker pinned in place.
    animate(map, {
      scale: [1, 1.55],
      ease: 'outQuad',
      autoplay: onScroll({
        target: root,
        enter: 'top bottom-=20%',
        leave: 'center center',
        sync: 0.5,
      }),
    })
  })

  return <div ref={ref} data-seat-act>{children}</div>
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/components/motion/seat.tsx src/components/guest/seat-map.tsx
git commit -m "feat: your seat — zoom toward the table"
```

---

## Task 9: RSVP — step transitions

**Files:**
- Create: `src/components/motion/rsvp-steps.tsx`
- Modify: `src/app/i/[token]/rsvp-form.tsx` — wrap the step content in `<RsvpSteps step={step}>` *(one wrapper, no logic change)*
- Test: typecheck, lint; the all-steps-stay-mounted property is already proven by Plan 2's E2E "keeps entered details when the guest steps back"

**Interfaces:**
- Consumes: `animate`, `stagger` from `animejs`; `useMotionScope`
- Produces: `<RsvpSteps step={number}>` — on each step change, the newly visible step's children cross-fade in with a short slide

**The rule this must not break.** Plan 2's form keeps every step mounted and hides inactive ones with the `hidden` attribute, because unmounting discards the guest's input and drops the fields from the single `FormData` submit. This wrapper animates the *children of the visible step* — it never mounts, unmounts, or un-hides anything. It reads `hidden` to find the active step and leaves it alone.

- [ ] **Step 1: Implement `src/components/motion/rsvp-steps.tsx`**

```tsx
'use client'

import { useRef } from 'react'
import { animate, stagger } from 'animejs'
import { useMotionScope } from './use-motion-scope'

/**
 * Animates the children of whichever step is currently visible. Re-runs when
 * `step` changes. Never touches `hidden`: the form owns which step is shown,
 * and the all-steps-stay-mounted rule is what keeps a guest's input alive
 * across Back.
 */
export function RsvpSteps({ step, children }: { step: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const root = ref.current
    if (!root) return
    // A step can span several sibling elements — step 2 is a div of guest
    // cards AND the "add another guest" button — so collect every visible one.
    const active = Array.from(root.children).filter(
      (el) => !(el as HTMLElement).hidden && el.getAttribute('aria-hidden') !== 'true',
    ) as HTMLElement[]
    const targets = active.flatMap((el) => Array.from(el.children) as HTMLElement[])
    if (targets.length === 0) return

    animate(targets, {
      opacity: [0, 1],
      translateX: [18, 0],
      ease: 'outExpo',
      duration: 520,
      delay: stagger(40),
    })
  }, [step])

  return <div ref={ref} data-rsvp-steps>{children}</div>
}
```

- [ ] **Step 2: Wrap the steps in `rsvp-form.tsx`**

The form's step elements (the fieldsets/sections that receive `{...stepProps(n)}`) become children of a single `<RsvpSteps step={step}>` wrapper. The progressbar, the hidden inputs, the error message and the Back/Continue/Send buttons stay **outside** the wrapper so they are never re-animated on a step change. No other change to the form.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/components/motion/rsvp-steps.tsx src/app/i/[token]/rsvp-form.tsx
git commit -m "feat: rsvp — step transitions"
```

---

## Task 10: Sealed — the stamp press

**Files:**
- Create: `src/components/motion/sealed.tsx`
- Modify: `src/app/i/[token]/rsvp-form.tsx` — wrap the confirmation `<p role="status" data-testid="rsvp-confirmed">` in `<Sealed>` *(wrapper only)*
- Test: typecheck, lint; covered by Task 12

**Interfaces:**
- Consumes: `animate` from `animejs`; `useMotionScope`
- Produces: `<Sealed>` — on mount, presses the confirmation in like a stamp: a quick scale-down from slightly above 1 with a small rotation settling to 0, then a brass shimmer across the text via CSS

The confirmation only mounts once the RSVP succeeds, so "on mount" is the right trigger and nothing re-fires it.

- [ ] **Step 1: Implement `src/components/motion/sealed.tsx`**

```tsx
'use client'

import { useRef } from 'react'
import { animate } from 'animejs'
import { useMotionScope } from './use-motion-scope'

/** The stamp comes down: a press from slightly above, a settle, then the shimmer. */
export function Sealed({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const el = ref.current
    if (!el) return
    animate(el, {
      scale: [1.18, 0.97, 1],
      rotate: [-3, 0.6, 0],
      opacity: [0, 1, 1],
      ease: 'outBack',
      duration: 700,
      onComplete: () => el.classList.add('sealed-shimmer'),
    })
  })

  return <div ref={ref} data-sealed className="origin-center">{children}</div>
}
```

- [ ] **Step 2: The shimmer**

`.sealed-shimmer` and its keyframes already exist in `globals.css` from Task 1. Do not add them again; do not touch `globals.css` in this task.

- [ ] **Step 3: Wrap the confirmation in `rsvp-form.tsx`**

Where the form returns the `<p role="status" data-testid="rsvp-confirmed">` on `state.status === 'done'`, wrap that element in `<Sealed>`. The `data-testid` stays on the `<p>` so Plan 2's E2E keeps finding it.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
git add src/components/motion/sealed.tsx src/app/i/[token]/rsvp-form.tsx
git commit -m "feat: sealed — the stamp press"
```

---

## Task 11: Wire the page and build

**Files:**
- Modify: `src/app/i/[token]/page.tsx`
- Test: typecheck, lint, **build**, and Plan 2's full E2E suite must still pass

**Interfaces:**
- Consumes: every motion component above
- Produces: the assembled guest page

This is the first task that runs `npm run build` with motion in place and the first that runs the browser. It is serial by design.

- [ ] **Step 1: Wire the acts**

`page.tsx` keeps every id, heading, landmark and list exactly as Plan 2 left them. The changes are wrappers and three attributes:

```tsx
import { MotionProvider } from '@/components/motion/motion-provider'
import { BrassLine } from '@/components/motion/brass-line'
import { FoilHero } from '@/components/motion/foil-hero'
import { Arrival } from '@/components/motion/arrival'
import { Seal } from '@/components/motion/seal'
import { Evening } from '@/components/motion/evening'
import { SeatAct } from '@/components/motion/seat'
```

```tsx
<MotionProvider>
  <main data-guest-root className="grain relative mx-auto max-w-2xl space-y-24 px-6 py-16">
    <BrassLine />
    <FoilHero />

    <Arrival>
      <section aria-labelledby="welcome" className="relative z-10">
        <Seal />
        <h1 id="welcome" className="type-display">
          Welcome,{' '}
          <span data-guest-name className="type-hero block text-[var(--brass)]">
            {primary ? primary.firstName : invite.label}
          </span>
        </h1>
        {/* tagline unchanged */}
      </section>
    </Arrival>

    {/* event section unchanged, plus className="relative z-10" */}

    <Evening>
      {/* evening section unchanged */}
    </Evening>

    <SeatAct>
      {/* seat section unchanged */}
    </SeatAct>

    {/* rsvp section unchanged */}
  </main>
</MotionProvider>
```

`relative` on `<main>` is what positions the brass line; `z-10` on the act sections keeps content above the line and the hero; `space-y-24` gives the line room to breathe between acts.

- [ ] **Step 2: Build and look**

```bash
npm run typecheck 2>&1 | grep -v "^>"
npm run lint
npm run build && git checkout tsconfig.json
```

Then start the app and open an invite link in a real browser at a phone-width viewport. **Scroll it.** The line draws, the seal breaks, the agenda reveals, the plan zooms. If any of those does not happen, the wiring is wrong — fix it before running the suite. Take one screenshot at 375px and put it in your report; a picture of the thing is the verification that matters here.

- [ ] **Step 3: Run Plan 2's end-to-end suite**

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*2026CHASERSVP*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
rm -rf .next
npm run test:e2e
```

All 90 must still pass. The motion layer must not have broken a single existing assertion — if it has, the wrapper that broke it has changed markup it was only allowed to wrap.

- [ ] **Step 4: Commit**

```bash
git add src/app/i/[token]/page.tsx
git commit -m "feat: assemble the animated guest journey"
```

---

## Task 12: Motion end-to-end coverage

**Files:**
- Create: `tests/e2e/motion.spec.ts`
- Test: itself

**Interfaces:**
- Consumes: `E2E_GUEST_TOKEN` from `tests/e2e/global-setup.ts` (Plan 2)
- Produces: proof of every motion safety rail in spec §9.2

**These are the tests that make the safety rails real.** Each one targets a property that would silently regress otherwise: a reduced-motion visitor who gets animation anyway, a low-end phone that downloads Three.js, a page that scrolls sideways at 375px.

- [ ] **Step 1: Write `tests/e2e/motion.spec.ts`**

```ts
import { test, expect } from '@playwright/test'
import { E2E_GUEST_TOKEN } from './global-setup'

const url = `/i/${E2E_GUEST_TOKEN}`

/** Collect every script URL the page requests. */
function trackScripts(page: import('@playwright/test').Page): Set<string> {
  const urls = new Set<string>()
  page.on('request', (req) => {
    if (req.resourceType() === 'script') urls.add(new URL(req.url()).pathname)
  })
  return urls
}

test.describe('motion safety rails', () => {
  test('reduced motion renders the final state with nothing animating', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(url)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'reduced')

    // The name is fully visible immediately — no split, no stagger.
    const name = page.locator('[data-guest-name]')
    await expect(name).toBeVisible()
    expect(await name.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

    // No WebGL layer at all.
    await expect(page.locator('canvas')).toHaveCount(0)

    // The agenda is fully revealed without scrolling.
    const items = page.locator('[data-agenda] > li')
    expect(await items.count()).toBeGreaterThan(0)
    for (const item of await items.all()) {
      expect(await item.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    }
  })

  test('a low-tier device gets lite motion and never downloads three.js', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 })
    })
    const scripts = trackScripts(page)
    await page.goto(url)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'lite')
    await page.waitForTimeout(1500)
    await expect(page.locator('canvas')).toHaveCount(0)

    // Capture the full-tier script set for comparison.
    const lite = new Set(scripts)
    const fullPage = await page.context().newPage()
    const fullScripts = trackScripts(fullPage)
    await fullPage.goto(url)
    await expect(fullPage.locator('[data-motion]')).toHaveAttribute('data-motion', 'full')
    await fullPage.waitForSelector('canvas')
    await fullPage.close()

    // Lite must request strictly fewer scripts than full: the three.js chunk
    // is the difference, and it must never be fetched on a low-tier visit.
    expect(fullScripts.size).toBeGreaterThan(lite.size)
    for (const s of lite) expect(fullScripts.has(s)).toBe(true)
  })

  test('full motion mounts the foil hero and draws the line to the end', async ({ page }) => {
    await page.goto(url)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'full')
    await expect(page.locator('canvas[data-foil-hero]')).toHaveCount(1)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(900)
    const drawn = await page.locator('[data-brass-line] path').evaluate((el) => {
      const offset = parseFloat(getComputedStyle(el).strokeDashoffset || '0')
      return Math.abs(offset) < 2
    })
    expect(drawn).toBe(true)
  })
  // If createDrawable expresses progress through stroke-dasharray rather than
  // dashoffset in this anime version, read whichever property it actually
  // animates — the contract is "fully drawn at the bottom", not a CSS name.

  test('the foil hero pauses when the tab is hidden', async ({ page }) => {
    await page.goto(url)
    await page.waitForSelector('canvas[data-foil-hero]')
    // Simulate the tab being hidden, then confirm no frame is requested.
    const framesWhileHidden = await page.evaluate(async () => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      let frames = 0
      const original = window.requestAnimationFrame
      window.requestAnimationFrame = (cb) => { frames++; return original(cb) }
      await new Promise((r) => setTimeout(r, 400))
      window.requestAnimationFrame = original
      return frames
    })
    expect(framesWhileHidden).toBe(0)
  })

  test('never scrolls horizontally at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await page.goto(url)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('the RSVP still works end to end with motion on', async ({ page }) => {
    await page.goto(url)
    await page.getByLabel('Joyfully accepts').check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('First name').first().fill('Jordan')
    await page.getByLabel('Last name').first().fill('Reyes')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('form').first().evaluate((f: HTMLFormElement) => f.requestSubmit())
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
    await expect(page.locator('[data-sealed]')).toHaveCount(1)
  })
})
```

Note: Plan 2's own RSVP spec switched from clicking the submit button to `form.requestSubmit()` because the button's accessible name changes and it unmounts inside Playwright's actionability window. The last test above does the same — read `tests/e2e/guest-rsvp.spec.ts` and match its approach exactly rather than re-discovering that.

- [ ] **Step 2: Run it, twice**

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*2026CHASERSVP*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
rm -rf .next
npm run test:e2e
```

All prior specs plus these six, both projects, **twice back to back**.

**If the low-tier test fails because the script sets are equal:** Three.js has leaked into the shared chunk. Run the containment grep from Task 6 — that is a product defect in the import graph, not a test to loosen.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/motion.spec.ts
git commit -m "test: motion safety rails — reduced, lite, containment, overflow"
```

---

## Task 13: Visual regression

**Files:**
- Create: `tests/e2e/visual.spec.ts`, and the baseline images it generates under `tests/e2e/visual.spec.ts-snapshots/`
- Test: itself

**Interfaces:**
- Consumes: `E2E_GUEST_TOKEN`
- Produces: committed screenshot baselines at 375 / 768 / 1440, dark and light, for the guest page and the admin event screen

Screenshots are taken with **reduced motion emulated**, so every act is at its final frame and the image is deterministic. A visual baseline of a mid-animation frame would fail on every run.

Baselines are platform-specific — Playwright names them by OS — so the ones committed from this machine are Windows baselines, and CI on Linux will generate its own on first run. That is expected; say so in the commit message.

- [ ] **Step 1: Write `tests/e2e/visual.spec.ts`**

```ts
import { test, expect } from '@playwright/test'
import { E2E_GUEST_TOKEN } from './global-setup'
import { signIn } from './sign-in'
import { ADMIN_CREDENTIALS } from './global-setup'

const WIDTHS = [375, 768, 1440] as const
const SCHEMES = ['dark', 'light'] as const

for (const width of WIDTHS) {
  for (const scheme of SCHEMES) {
    test(`guest page — ${width}px, ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme })
      await page.goto(`/i/${E2E_GUEST_TOKEN}`)
      await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'reduced')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot(`guest-${width}-${scheme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      })
    })
  }
}

test('admin event screen — 1440px, dark', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
  await page.goto('/admin/event')
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveScreenshot('admin-event-1440-dark.png', { maxDiffPixelRatio: 0.01 })
})
```

`signIn(page, email, password)` lives in `tests/e2e/sign-in.ts` and `ADMIN_CREDENTIALS` in `tests/e2e/global-setup.ts` — both Plan 2's, verified against the working tree.

- [ ] **Step 2: Generate baselines, then look at them**

```bash
npm run test:e2e -- tests/e2e/visual.spec.ts --update-snapshots
```

Then **open every baseline image and look at it.** This is the first time the full design exists as a picture. Check, per the design plan: the name is the hero; brass appears only on the name, the line, the marker and the seal; nothing else is accented; the light theme reads as designed rather than inverted; at 375px nothing overflows and the line sits in the gutter. If any image is wrong, fix the CSS and regenerate — do not commit a baseline that locks in a defect.

- [ ] **Step 3: Run the comparison**

```bash
npm run test:e2e -- tests/e2e/visual.spec.ts
```

All must pass against their baselines.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/visual.spec.ts tests/e2e/visual.spec.ts-snapshots
git commit -m "test: visual regression baselines at 375/768/1440, both themes

Baselines are platform-specific; these are Windows. CI on Linux generates
its own on first run."
```

---

---

## AS-BUILT DIVERGENCES — read before re-running any task from this plan

| Module | Plan text is stale because | Read instead |
| --- | --- | --- |
| `src/components/motion/brass-line.tsx` (Task 4) | The plan read `offsetWidth`/`offsetHeight` on an `<svg>`. Those are HTMLElement properties; on an SVGElement they are `undefined`, so the path was built from `NaN` and **the line never drew**. Found only by an agent scrolling the page and looking. Uses `getBoundingClientRect()` now. | the file |
| `src/components/motion/seat.tsx` (Task 8) | The plan's `onScroll` threshold strings had the words in the wrong order. Anime v4 parses **container-first, target-second**; the plan wrote target-first, so the plan never zoomed. | the file |
| `src/components/motion/foil-scene.tsx` (Task 6) | `AdditiveBlending` on the light theme's bone ground produced a bright yellow smear across the hero. Light scheme now uses normal blending with darker, fainter flecks; the component reads `matchMedia` for the scheme — the one sanctioned exception to "only MotionProvider reads media queries", because it is already browser-only and mode-gated. | the file |
| `src/app/i/[token]/page.tsx`, `agenda-timeline.tsx` (Tasks 7, 11) | The event title and the agenda times shipped in brass, against the design plan's central rule. Title is bone, times are mist. | the files |

### What the plan got right that is worth keeping

The "look at it" steps. Both line-drawing bugs above were invisible to typecheck, lint, 376
unit tests and 90 end-to-end specs. They were found because Task 11 required an agent to
scroll a real invite at 375px and say what it saw, and because the controller then read the
screenshots rather than the report. For a motion layer, a picture is the test.

## Definition of done

- [ ] `npx vitest run`, `npm run typecheck`, `npm run lint`, `npm run build` all clean
- [ ] `npm run test:e2e` green **twice back to back** — all Plan 1–2 specs plus the motion and visual suites
- [ ] `grep -rn "from 'three'" src/` matches exactly one file: `foil-scene.tsx`
- [ ] `grep -rn "addEventListener('scroll'" src/` matches nothing
- [ ] With reduced motion, every act renders its final frame and the RSVP completes
- [ ] On a low-tier device the Three.js chunk is never requested — proven by the script-set comparison, not by inspection
- [ ] At 375px the page never scrolls horizontally
- [ ] Someone has **looked at** the guest page on a phone-width viewport, scrolled it, and seen the line draw, the seal break, the agenda reveal, and the plan zoom — and there is a screenshot in the Task 11 report to prove it
- [ ] Brass appears only on: the name, the line, the marker, the seal. Nowhere else.
