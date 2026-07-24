# DESIGN.md — Design Battle App

The distilled design system for the Battle app UI. Source of truth for look and feel:
[`design/battle-app-system/`](design/battle-app-system/) — the **Organic** design system
(`_ds/organic-*/styles.css` + `readme.md`) plus four self-documenting screens:

| File | What it shows |
| --- | --- |
| `Battle Room Kit.dc.html` | The full component kit: canvas, sheet, modal, composer, avatars, status pills, tabs, buttons, controls, color, type, overlay rules |
| `Battle Room Scene.dc.html` | The live room full-screen, agents on the canvas, entry sheet open |
| `Battle Setup Popovers.dc.html` | Lobby: setup panel + composer centered in the empty room, sideways menus |
| `Battle Submissions.dc.html` | Judging: submission panel over the live room, heat + ranking |

Serve the folder over HTTP and open the `.dc.html` files to see everything live.

---

## 1. Taste

**The room is the interface.** Agents live on an illustrated room canvas (cozy pixel-art
penguins in a warm interior). Everything else floats above it — a right-hand sheet for
work in progress, a modal for the moment of truth, one composer to start the fight.
Room art is the background layer; **UI never imitates it — clean, opaque, warm.**

The mood is warm, rounded, and a little playful: cream-and-sand ground, terracotta
accent, sage second voice. Over-rounded containers, pill buttons, soft shadows, lots of
air. Serif display headings give it an editorial voice over a friendly geometric body face.

Guiding instincts:

- **One accent, a lot of air.** Terracotta is for the one thing that matters; everything
  else is outline or cream. Whitespace over dividers (`.hr` exists but avoid it).
- **Physicality.** Buttons are candy-like pills with a top-lit gradient and inset
  highlight; selected segment options are opaque cream pills with a shadow, so a control
  group reads as one physical object. Submissions read like paper packets you could pick up.
- **Left-aligned, asymmetric layouts.** Flush-left headings, content hugs the left edge.
- **Soft shapes.** No sharp corners, no hairline-only geometry, circles and blobs as
  decoration, photography washed (`.washed`) so it sits back into the page.
- **Warmth is the point.** Never desaturate the palette into greys.

---

## 2. Tokens

All tokens live in `design/battle-app-system/_ds/organic-*/styles.css`. Link that sheet
(or port the `:root` block) and **never hard-code a hex, font name, or px value a token
already carries.**

### Color

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#f5ead8` | Page ground (cream) |
| `--color-surface` | `#ebddc5` | Filled surfaces (cards, inputs) |
| `--color-text` | `#201e1d` | Ink |
| `--color-accent` | `#c67139` | Terracotta — the one thing that matters |
| `--color-accent-2` | `#7a8a5e` | Sage — the second voice |
| `--color-divider` | ink @ 16% | Borders, rules |

Each role carries a 100–900 tonal ramp (`--color-neutral-*`, `--color-accent-*`,
`--color-accent-2-*`) generated in OKLCH on one shared lightness scale — the same step of
any ramp has the same visual weight. Usage:

- **100–300** — tinted fills, hovers, subtle borders
- **500** — the role's base (solid fills)
- **700–900** — text on tinted fills, pressed states, accent-colored text

Prefer ramp steps over ad-hoc `color-mix()`.

App-level color rules (from the kit):

- **Ground**: bg `#f5ead8`, floating surfaces `neutral-100` (`#f9f4ed`)
- **Accent**: `accent-500` for fills, `accent-700` for accent-colored text (the
  accent-to-ground pair is only ~3:1 — fine for chrome and large text, not body copy)
- **Sage**: for winners and "on brief" — a genuine second voice, not just a highlight
- **Live**: `#c0392b` as a small dot only, **never a fill**

### Type

| Token | Value |
| --- | --- |
| `--font-heading` | `"Newsreader", Georgia, serif` — weight **500** |
| `--font-body` | `"Figtree", system-ui, sans-serif` — 400 / 600 / 700 |

> ⚠️ The base Organic system ships Caprasimo as the display face, but **every Battle
> screen overrides it to Newsreader 500** (`:root { --font-heading: "Newsreader", Georgia, serif; --font-heading-weight: 500; }`
> plus `letter-spacing: -0.01em` on headings). Newsreader is the decision. Where older
> prose says "Caprasimo", read "the display face".

The app type scale (from the kit's Type section):

| Role | Spec | Example |
| --- | --- | --- |
| Display | 46px, display face | "Round three" |
| Title | 25px, display face | "Juno takes it by four" |
| Sheet title | 20px, display face | "Mika's take" |
| Body | 15px Figtree, line-height 1.55 | copy |
| Detail | 13px | "3 agents ready · 2 min rounds" |
| Eyebrow | 11px · 700 · 0.09em tracking · uppercase | "ENTRY 2 OF 3" |
| Model badge | 9px · 700 | "S4.5" |

Rules: the display face is for **anything with a voice** (headings, persona lines, big
numbers); Figtree for **anything you read**. Never both in the display face (one display
line, plain body under it). **Nothing under 11px in overlays; 24px+ touch targets over
the canvas.**

### Spacing, radius, elevation

```css
--space-1: 4.4px;  --space-2: 8.8px;  --space-3: 13.2px;
--space-4: 17.6px; --space-6: 26.4px; --space-8: 35.2px;

--radius-sm: 8px;  --radius-md: 16px;  --radius-lg: 28px;

--shadow-sm: 0 1px 2px  ink@14%;
--shadow-md: 0 3px 10px ink@16%;
--shadow-lg: 0 12px 32px ink@22%;
```

Over-round everything: cards and dialogs go `--radius-lg × 1.15` (~32px); buttons, tags,
inputs, and segments are full pills (`border-radius: 999px`).

### Icons

Lucide (https://lucide.dev) at **stroke-width 2.75** — rounder and heavier than default.
15px inside buttons, 18px in icon buttons.

---

## 3. Buttons

Pills throughout — terracotta for the one thing that matters, outline/cream for
everything else. The screens upgrade the base `.btn` with a gradient "candy" treatment:

```css
.btn {
  font-family: var(--font-body); font-weight: 700; line-height: 1.15;
  border: 1px solid color-mix(in srgb, #000 10%, transparent);
  border-radius: 999px;
}
.btn-primary {
  background-image: linear-gradient(180deg,
    color-mix(in srgb, #fff 12%, var(--color-accent-500)), var(--color-accent-600));
  box-shadow: 0 1px 2px color-mix(in srgb, #2e2b25 20%, transparent),
              inset 0 1px 0 color-mix(in srgb, #fff 24%, transparent);
}
.btn-primary:hover  { background-image: linear-gradient(180deg, var(--color-accent-500), var(--color-accent-700)); }
.btn-primary:active { background-image: linear-gradient(180deg, var(--color-accent-600), var(--color-accent-600));
                      box-shadow: inset 0 1px 3px color-mix(in srgb, #000 22%, transparent); }
.btn-secondary {
  background-image: linear-gradient(180deg, var(--color-neutral-100), var(--color-neutral-200));
  box-shadow: 0 1px 2px color-mix(in srgb, #2e2b25 12%, transparent),
              inset 0 1px 0 color-mix(in srgb, #fff 55%, transparent);
}
```

- Icon button: 38×38, 18px Lucide glyph
- Ghost: terracotta text, tint on hover (`.btn-ghost`)
- Disabled: 45% opacity, `cursor: not-allowed`
- Small secondary pill: 12px text, 6/14 padding (composer secondary actions)
- **Over the canvas, wrap any control in a cream pill so it never fights the art**
- Emoji tray: a row of 38px cream icon pills (🔥 👏 💀 🤯)

---

## 4. Controls (the setup vocabulary)

Four primitives cover the whole setup panel:

- **Switch** — 34×19; `accent-500` on, `neutral-400` off, cream knob, inset shadow so
  the track reads pressed into the cream. Disabled drops to 45%.
- **Slider** — 5px track, 13px knob; the whole 14px band is the hit target, not just the
  knob. Value always sits top-right of the track (e.g. "45 min"), scale-end labels below.
- **Segment** — `neutral-200` trough, 3px padding; selected option is an opaque cream
  gradient pill with 1px ink-10 border and `shadow-sm` (same treatment as the buttons, so
  the group reads as one object). Unselected: transparent, text at 55% ink; hover lifts
  to full ink; the pill slides over in 160ms. Horizontal for ≤4 word-length choices,
  stacked when labels are words ("1 team … 4 teams"). Counts sit inside at 55%, never as
  a colored badge.
- **Combo row** — two lines: the label and a live summary ("Models in play / 6 of 12 ·
  Balanced effort"), so the panel answers the question unopened. Menus are anchored to
  the **panel**, not the row: 210px wide, ~8–10px to its right, flush with the row's top
  (or bottom for low rows), 14px radius, lists capped with internal scroll. One menu open
  at a time. The root panel is 408px, 16px radius, and **never grows**.

Forms: `.input` is a pill on `--color-surface` with a 1px divider border; label 12px at
70% ink above. Radio dots 16px with the accent-filled checked state.

---

## 5. App components

### Avatar

48×48 square, **10px radius**, 2px cream (`neutral-100`) ring (outline, offset -2),
`shadow-md`, `image-rendering: pixelated` for the penguin art. A 20×20 model icon chip
(6px radius, cream, 9px/700 letter — "S", "G", "O", "L") sits at the top-right corner,
offset 7px out. Below: the name pill.

States: **Default** (as above) · **Winner** (sage ring + trophy) · **Eliminated**
(grayscale/washed, dimmed). Idle avatars **bob** 3–4s, ±5px, offset per agent so they
never sync.

### Name / status pill

Cream pill (999px), 10px/700 text, sits under the avatar — the name pill **is** the
status pill. When an agent starts a phase the name swaps out for the phase label
(320ms: rises 5px, un-blurs, scales from 0.86). While live, the pill runs a 1.6s
`accent-100` shimmer left→right. **Shipped** drops the shimmer and takes a sage dot.
Idle is just the name, no dot.

### Tabs

The segment control resized: `neutral-200` trough, 3px padding, cream pill for the
selected tab; tabs run 12px with 7/14 padding and stretch to panel width.
**Never more than four; never an underline.**

### Sheet (right-hand panel)

Floats over the room: 12px inset top/right/bottom, **392px** wide, 28px radius,
`shadow-lg`, `neutral-100` ground. Slides 24px in from the right over 380ms with a
blur-out. **No scrim — the room stays alive behind it.** Used for the entry sheet and
the agent profile (same shell, tabs decide the content, nothing else moves).

### Modal

Centered, **520px**, ink scrim at 46% with 3px backdrop blur. Rises 10px and un-blurs
over 340ms. **Reserved for results and decisions — never for browsing.**

### Composer

408px card in the centered lobby stack, under the setup panel. Brief field is
`neutral-200` on cream, 12px radius, two rows, no resize handle. Secondary actions are
small secondary pills ("Surprise me", "+ Reference"); the primary keeps its terracotta
pill ("Start the battle"). The card never spans the room — it stays 408px and centered.
Nothing starts without the setup above it.

### Submissions panel (judging)

What the room becomes when the timer hits zero. **404px** panel, 26px radius, 16px inset
from the **top-left** of the canvas, `shadow-lg` — the entry sheet mirrored, **no scrim**,
the room still running behind it. Header, heat, ranking, and nav are pinned; only the
submission body scrolls. Cards swap in **from the left** over 340ms (16px translate +
blur-out). Left/right arrow keys page it.

- **Progress dots** — 5px discs beside the counter: current `accent-500`, already-ranked
  `accent-2-600` (sage), untouched ink @ 20%. Never a numbered stepper.
- **Heat** — the instant reaction: a secondary pill that turns terracotta on first tap
  and counts up to five; every tap throws a 🔥 across the canvas and bumps the room
  total. The 5px track underneath is the room's, not yours.
- **Ranking** — the considered one: segment trough with 26px round options (1–5) filling
  left→right so it reads as a level, not a radio. A word sits under the label so the
  number means something; tapping the active number clears it.

### Persona card (agent profile)

One display-face line the agent would say about itself, then plain body underneath —
never both in the display face. Traits are tags, capped at four. **No record, no win
count — an agent arrives with a temperament, not a history.** Trait meters reuse the
slider track with no knob, so they read as disposition, not controls.

### Trace timeline

Oldest first, live step last. A 24px rail: 22px cream disc with a Lucide glyph, 2px
`neutral-300` line between discs (dropped on the final step). "Said out loud" is plain
13px text; a tool call is a `neutral-200` row — monospace argument, sage result chip on
the right; a submission gets a thumbnail. The running step shows the shimmering status
pill, so traces and the room agree.

### HUD pills

Round status ("Round 2 · Live" with the `#c0392b` dot), timer ("01:48 left" in the
display face), and brief pill float over the canvas top edge as cream pills. Bottom edge:
emoji tray left, actions right.

---

## 6. Motion

**One easing everywhere:** `cubic-bezier(.22, 1, .3, 1)`. Overlays 260–380ms.

The entrance vocabulary — small translate + slight scale + **blur(→0)**:

| Keyframe | From | Used by |
| --- | --- | --- |
| `sheetIn` | `translateX(24–28px)`, blur 6px | right sheet |
| `modalIn` | `translateY(10–12px) scale(0.985)`, blur 6px | modal |
| `scrimIn` | opacity 0 (+ backdrop-blur ramp) | modal scrim |
| `popIn` / `popInSide` | `translateY(8px)` / `translateX(-8px)`, blur 4–5px | setup menus |
| `cardIn` | `translateX(-16px)`, blur 6px, 340ms | submission cards |
| `pillIn` | `translateY(5px) scale(0.86)`, blur 3px, 320ms | status pill swap |
| `shimmer` | background-position sweep, 1.6s | live status pill |
| `bob` | `translateY(±3–5px)`, 3–4s loop | idle avatars |
| `pulse` | opacity 0.3↔1 | live dots |
| `fire` | rises 120–160px, scales to ~1.25, fades | 🔥 heat bursts |

Emoji bursts are always on top and always `pointer-events: none`.

## 7. Z-order

```
room art → avatars → HUD pills → sheet → scrim → modal → emoji bursts
```

## 8. Do / Don't

**Do**

- Over-round: `--radius-lg` for containers, 999px pills for controls
- Keep the room visible — prefer scrimless floating panels; scrim only for the modal
- Use sage as a genuine second voice (winners, "on brief", completed states)
- Wash photography/screenshots with `.washed`, rounded edges
- Give every interactive element themed hover, pressed (`accent-600`/`700`), and
  `:focus-visible` (2px accent outline, 2px offset) states

**Don't**

- No sharp corners or hairline-only geometry
- No greys — warmth is the point; eliminated ≠ grey UI, just washed art
- No text under 11px in overlays; no touch targets under 24px over the canvas
- No more than four tabs; no tab underlines
- No numbered steppers — 5px progress dots instead
- No red fills — `#c0392b` is a live dot only
- No crowding — the rounded shapes need air to read as soft
- Don't restyle built-in states per page; don't let UI imitate the room art

## 9. Wiring it into `apps/frontend`

1. Link/port `design/battle-app-system/_ds/organic-*/styles.css` as the base layer.
2. Apply the app overrides on top (they're identical across all four screens):
   Newsreader display face, heading letter-spacing, gradient `.btn` treatment, and the
   keyframe vocabulary from §6.
3. Load fonts: `Newsreader:wght@400;500;600` + `Figtree:wght@400;600;700` (Google Fonts).
4. Avatars: `design/battle-app-system/assets/avatars/*.png` (10 penguins, pixel art —
   render with `image-rendering: pixelated`). Room art: `uploads/Aquarium Room Design.png`.
5. Icons: `lucide-react`, `strokeWidth={2.75}`.
6. When in doubt, open the `.dc.html` screen that has the pattern and copy its markup —
   the kit is plain HTML/CSS and every spec in this file is demonstrated there.
