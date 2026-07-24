# COMPONENTS.md — Design Battle App

The builder's map from the design screens to React components in `apps/frontend`.
This doc covers **what each screen and component is for and why it's shaped that way**.
Raw values (tokens, colors, type scale, motion specs, z-order) live in
[`DESIGN.md`](DESIGN.md) — nothing there is repeated here.

Living references (plain HTML, serve `design/battle-app-system/` and open in a browser):

| Screen | File |
| --- | --- |
| Component kit | [`design/battle-app-system/Battle Room Kit.dc.html`](design/battle-app-system/Battle%20Room%20Kit.dc.html) |
| Live room | [`design/battle-app-system/Battle Room Scene.dc.html`](design/battle-app-system/Battle%20Room%20Scene.dc.html) |
| Lobby / setup | [`design/battle-app-system/Battle Setup Popovers.dc.html`](design/battle-app-system/Battle%20Setup%20Popovers.dc.html) |
| Judging | [`design/battle-app-system/Battle Submissions.dc.html`](design/battle-app-system/Battle%20Submissions.dc.html) |

The one idea that organizes everything: **the room is the interface.** The illustrated
room canvas is always the bottom layer and almost never leaves the screen. Every state
of the app is expressed as something floating over it — a centered setup stack, a
right-hand sheet, a top-left judging panel, one centered modal. Prefer scrimless
floating panels so the room stays alive; the scrim exists only for the results modal.

How screens map to the arena's round phases (`apps/arena/src/phases.ts`,
`events.ts`): `idle` → Lobby, `mingle`/`build`/`submit` → Live Room,
`judging` → Submissions panel, `judged` → Results modal. Note the *round* phases are
distinct from the *per-agent* status vocabulary shown on the status pill
(Thinking / Working / Reviewing / Shipped) — the pill tracks what one agent is doing
inside `build`/`submit`, not the round clock.

---

## 1. Screens

### 1.1 Lobby / Setup (`Battle Setup Popovers.dc.html` — phase `idle`)

**What the user is doing:** configuring a battle and writing the brief. You choose
how many teams, how long combat runs, and which models and archetypes are allowed in
the pool; who ends up where is drawn at random. Randomness is the product — setup
constrains the dice, it doesn't place agents.

**On screen:** the empty room canvas with a single centered column: the
`<BattleSetupPanel>` (408px) with the `<Composer>` directly beneath it. HUD shows
"Lobby · not started". Nothing else.

**Why this shape:**
- Setup and brief sit **centered in the empty room** because there is no way to start
  without setting up — the layout makes the precondition physical. Nothing starts
  without the setup above the composer.
- Menus (model pool, archetype pool) open **sideways** from combo rows, anchored to
  the panel, so the panel itself **never grows**. The panel stays a fixed, calm object;
  detail spills to the right instead of pushing the primary action down.
- Every combo row shows a live summary line ("6 of 12 · Balanced effort") so the panel
  answers its questions unopened.

**Panel anatomy, top to bottom:** header ("Battle setup" + Reset ghost) → Teams
stacked segment (1–4 teams, with a roster note) → Combat length slider ("15 min
sprint … 4 h marathon") → Models in play combo row → Thinking effort segment →
Archetypes in play combo row → "No repeats in a team" switch. The composer below
carries the brief, "Surprise me" / "+ Reference" small pills, and the one terracotta
"Start the battle" button.

**Components:** `<RoomCanvas>`, `<HudPill>`, `<BattleSetupPanel>` (built from
`<SegmentControl>`, `<Slider>`, `<ComboRow>` + `<PopMenu>`, `<Switch>`),
`<Composer>`, `<Button>`.

**Transitions:** menus pop in sideways (`popInSide`). "Start the battle" dismisses
the whole centered stack; the HUD pills and agents take over the room (Live Room).

### 1.2 Live Room (`Battle Room Scene.dc.html` — phases `mingle`/`build`/`submit`)

**What the user is doing:** watching. Agents work; the human spectates, reacts with
emoji, and can inspect any agent or entry without stopping anything.

**On screen:** the room art full-bleed. Agents as `<AgentAvatar>`s positioned on the
canvas, each with its name/status pill, idly bobbing (offset per agent so they never
sync). Top edge: `<HudPill>`s — round status ("Round 2 · Live" with the live dot),
the timer in the display face, and the brief pill ("Brief: warm pricing page").
Bottom edge: `<EmojiTray>` on the left, actions on the right (open entry sheet,
"Call the round"). Emoji reactions fly up as `<EmojiBurst>`s, always topmost,
always `pointer-events: none`.

**Why this shape:** the room *is* the content, so the chrome is reduced to cream
pills floating at the edges — over the canvas, every control is wrapped in a cream
pill so it never fights the art. No panels are open by default; the spectacle owns
the screen.

**Components:** `<RoomCanvas>`, `<AgentAvatar>` + `<StatusPill>`, `<HudPill>`,
`<Timer>`, `<EmojiTray>`, `<EmojiBurstLayer>`, `<Button>`.

**Transitions in/out:** clicking an agent slides in the `<AgentSheet>` from the
right; an entry action opens the `<EntrySheet>` in the same shell. When the timer
hits zero the room becomes the judging screen (1.4). "Call the round" raises the
results modal (1.5).

### 1.3 Entry Sheet & Agent Sheet (kit "Avatar profile" section + Scene)

**What the user is doing:** inspecting — one entry, or one agent — while the round
keeps running.

**On screen:** the right-hand `<Sheet>`: 392px, floating with an inset (never
edge-to-edge), **no scrim**. Two contents share the identical shell:

- **Entry sheet:** eyebrow ("Entry 2 of 3"), sheet title in the display face
  ("Mika's take"), body copy, a `<TagRow>` ("Warm · On brief · 3 revisions"),
  judge notes, and a footer ("Skip" secondary / "Cast your vote" primary).
- **Agent sheet:** the sheet, tabbed. `<Tabs>` (Persona / Traces) decide the content,
  nothing else moves. Persona shows the `<PersonaCard>` (one display-face line the
  agent would say about itself, plain body, up to four trait tags, knobless trait
  meters — Boldness / Restraint / Speed — and "Remix persona" / "Challenge" actions).
  Traces shows the `<TraceTimeline>` with a Live/Replay sub-tab.

**Why this shape:**
- **No scrim** because the sheet is for browsing while the battle continues — dimming
  the room would kill the thing you came to watch. The room stays alive behind it.
- One shell for both contents means one slide-in animation, one dismiss gesture, one
  layout to build. Click an agent, and *who they are plus everything they've done this
  round* floats in — identity and evidence in the same place.
- Persona has **no record, no win count** — an agent arrives with a temperament, not
  a history. That keeps every battle a fresh bet on personality, not a leaderboard.

**Components:** `<Sheet>`, `<Tabs>`, `<PersonaCard>`, `<TraceTimeline>`, `<TagRow>`,
`<ModelBadge>`, `<Button>`.

**Transitions:** slides 24px in from the right with a blur-out (`sheetIn`); tab
switches swap content only. Close returns to the bare Live Room.

### 1.4 Judging / Submissions (`Battle Submissions.dc.html` — phase `judging`)

**What the user is doing:** scoring the pile, one submission at a time. This is what
the room *becomes* when the timer hits zero — not a new page.

**On screen:** the `<SubmissionPanel>`: 404px, inset from the **top-left** of the
canvas — the entry sheet mirrored — **no scrim**, the room still running behind it.
Pinned header: counter ("Submission 1 of 3") with `<ProgressDots>`, team name,
ship line ("Shipped with 0:04 left"), and a Trace link. Scrollable body: submission
title in the display face, the agent's own pitch, tags, and the artifact preview.
Pinned footer: `<HeatButton>`, `<RankingControl>`, and the "Next submission" nav.
The HUD reads "Round 2 · Closed", timer at 00:00.

**Why this shape:**
- Top-left mirrors the entry sheet so judging feels like the same system, but a
  different mode — you know you've changed jobs without leaving the room.
- Header/heat/ranking/nav are **pinned; only the submission body scrolls**, so the
  two judgment controls never leave your thumb while you read.
- Two reactions on purpose: **heat is the instant one** (tap up to five 🔥, each tap
  throws fire across the canvas and bumps the room total — the track under it is the
  room's, not yours), **ranking is the considered one** (1–5 filling left to right so
  it reads as a level, with a word under the label — "Solid", "Would ship it",
  "Best in the room" — so the number means something).
- Progress dots, never a numbered stepper: current terracotta, already-ranked sage,
  untouched faint ink — the whole pile's state at a glance.

**Components:** `<SubmissionPanel>` (from `<ProgressDots>`, `<HeatButton>`,
`<RankingControl>`, `<TagRow>`, `<Button>`), `<EmojiBurstLayer>`, `<HudPill>`.

**Transitions:** cards swap **in from the left** (340ms translate + blur-out);
left/right arrow keys page the pile. Finishing the pile leads to results.

### 1.5 Results / Reveal (kit "Modal" — phase `judged`)

**What the user is doing:** witnessing the verdict, then deciding what's next.

**On screen:** the one `<Modal>` in the app: centered 520px over an ink scrim.
Eyebrow ("Round 2 · Results"), a display-face verdict line ("Juno takes it by four
points"), one line of body, the score list (big display-face numbers, winner gets
sage treatment), and two actions: "Back to room" secondary, "Start round 3" primary.

**Why this shape:** the modal is **reserved for results and decisions — never for
browsing**. The whole app trains you that panels float and the room stays lit;
the one time the room dims, it means a verdict. That scarcity is what gives the
moment weight.

**Components:** `<Modal>`, `<ScoreRow>`, `<Button>`.

**Transitions:** rises 10px and un-blurs (`modalIn`) over the scrim. "Back to room"
returns to the live room; "Start round 3" loops to a fresh round.

---

## 2. Component catalog

Format: **purpose** · anatomy · states/behavior · used in · why.

### `<RoomCanvas>`
Bottom layer — the illustrated room everything floats over.
- Anatomy: room art image, absolutely-positioned children (avatars, HUD, panels).
- Behavior: never scrolls, never dims except under the modal scrim.
- Used in: every screen.
- Why: UI never imitates the art — clean, opaque, warm chrome over painterly ground.

### `<AgentAvatar>`
One agent's presence in the room.
- Anatomy: 48×48 pixel-art square with cream ring, a model icon chip
  (`<ModelBadge>` letter chip) at the top-right corner, `<StatusPill>` below.
- States: Default · Winner (sage ring + trophy) · Eliminated (washed/dimmed, never
  grey UI). Idle avatars bob, offset per agent so they never sync.
- Used in: Live Room, Judging (background), setup roster previews.
- Why: agents must feel like inhabitants, not list items; the bob is the room's pulse.

### `<StatusPill>`
The name pill that is also the phase pill — one slot, two jobs.
- Anatomy: cream pill under the avatar; carries the name, or a phase label.
- States: Idle (name only, no dot) → Thinking / Working / Reviewing (label swaps in
  via `pillIn`, 1.6s shimmer while live) → Shipped (shimmer drops, sage dot).
- Used in: Live Room; mirrored inside `<TraceTimeline>`'s running step.
- Why: one pill means the eye only ever watches one place per agent; traces and the
  room agree because they share the component.

### `<HudPill>`
Cream pill chrome floating at the canvas edges.
- Anatomy: pill with text and optional live dot; the timer variant sets its numerals
  in the display face. Variants: round status, timer, brief.
- Used in: Live Room, Judging, Lobby ("Lobby · not started").
- Why: over the canvas every control gets a cream pill so it never fights the art;
  the live dot is the only red in the system, and it is never a fill.

### `<EmojiTray>` and `<EmojiBurstLayer>`
Spectator reactions (🔥 👏 💀 🤯) and the flying results.
- Anatomy: tray is a row of 38px cream icon pills; bursts rise, scale, fade (`fire`).
- Behavior: bursts render above everything, `pointer-events: none`.
- Used in: Live Room, Judging (heat taps reuse the burst).
- Why: reactions must never block interaction — pure celebration layer.

### `<Sheet>`
The right-hand floating panel shell.
- Anatomy: 392px, inset from top/right/bottom, over-rounded, `shadow-lg`; slots for
  eyebrow, title, body, footer. No scrim.
- Behavior: `sheetIn` slide from the right; one sheet at a time.
- Used in: `<EntrySheet>`, `<AgentSheet>`.
- Why: work-in-progress browsing must not stop the show; the shared shell means
  content changes, chrome doesn't.

### `<EntrySheet>` (Sheet content)
One entry, mid-round, with judge context.
- Anatomy: eyebrow counter, display-face take title, body, `<TagRow>`, judge notes,
  Skip / Cast your vote footer.
- Used in: Live Room.

### `<AgentSheet>` (Sheet content)
Who an agent is and what it has done this round.
- Anatomy: header (name, `<ModelBadge>`, persona line), `<Tabs>` Persona | Traces.
- Used in: Live Room, Judging (via Trace links).

### `<PersonaCard>`
An agent's temperament, stated in its own voice.
- Anatomy: one display-face line the agent would say about itself, plain body under
  it (never both in the display face), trait `<Tag>`s capped at four, knobless trait
  meters, action buttons.
- Why: meters reuse the slider track with no knob so they read as disposition, not
  controls. No record, no win count — temperament, not history.

### `<TraceTimeline>`
Everything an agent did this round, oldest first, live step last.
- Anatomy: 24px rail of cream discs with Lucide glyphs, connecting line (dropped on
  the final step). Step kinds: said-out-loud (plain text), tool call (surface row —
  monospace argument, sage result chip), submission (thumbnail). Disc glyph color
  encodes kind (neutral speech, terracotta tool, sage submit, accent ring running).
- Behavior: the running step shows the shimmering `<StatusPill>`.
- Used in: Agent sheet (Traces tab), Trace links from the submission panel.
- Why: maps 1:1 onto the arena's append-only `AgentEvent` log
  (`apps/arena/src/events.ts`) — `thought`/`message` → speech, `build` → tool row,
  `submit` → thumbnail. The remaining kinds (`theme`, `present`, `verdict`, `score`)
  are round-level: they belong to the results modal and HUD, not the timeline.

### `<Modal>`
The one dimming overlay.
- Anatomy: centered 520px card over an ink scrim with backdrop blur; `modalIn`.
- Used in: Results only.
- Why: reserved for results and decisions — never for browsing. Scarcity = weight.

### `<ScoreRow>`
One agent's result line in the modal.
- Anatomy: big display-face number, name; winner takes the sage voice.
- Why: sage is the genuine second voice — winners and "on brief", not a highlight.

### `<Composer>`
The brief and the only start button.
- Anatomy: 408px card — two-row brief field (no resize handle), small secondary
  pills ("Surprise me", "+ Reference"), terracotta "Start the battle".
- Behavior: never spans the room; stays centered under the setup panel.
- Used in: Lobby.
- Why: one loud action per screen; nothing starts without the setup above it.

### `<BattleSetupPanel>`
The 408px fixed-width setup card.
- Anatomy: header + Reset, then the four control primitives in rows (see 1.1).
- Behavior: never grows; menus open beside it; one menu open at a time.
- Used in: Lobby.
- Why: constrain the pool, let the dice place agents — the panel is a bet slip.

### `<Switch>`
Boolean setting. Terracotta on, cream knob, track pressed into the cream (inset
shadow). Disabled at 45%. Used in setup ("No repeats in a team").

### `<Slider>`
Ranged setting. Value readout always top-right of the track, scale-end labels below
("15 min sprint … 4 h marathon"); the whole band is the hit target, not just the
knob. Used in setup (Combat length).

### `<SegmentControl>`
One-of-N for four or fewer choices. Trough + opaque cream gradient pill for the
selection — the same physical treatment as the buttons, so the group reads as one
object. Horizontal for short labels (effort), stacked when labels are words
("1 team … 4 teams"). The pill slides in 160ms. Counts sit inside at 55% ink,
never a colored badge. Used in setup; resized, it *is* `<Tabs>`.

### `<Tabs>`
The segment control resized for panel navigation: 12px labels stretched to the panel
width. Never more than four; never an underline. Used in the Agent sheet
(Persona | Traces, Live | Replay).

### `<ComboRow>` + `<PopMenu>`
A setting whose options live in a sideways menu.
- Anatomy: two lines — label + live summary ("Models in play / 6 of 12 · Balanced
  effort") — and a chevron. Menu: 210px, anchored to the **panel** (not the row),
  ~8–10px to its right, flush with the row's top (bottom for low rows), internal
  scroll, All/None quick actions, check rows with name + maker/blurb.
- Why: the summary answers the question unopened; panel-anchored menus keep the
  panel from ever growing.

### `<Button>`
Pill buttons, candy treatment (top-lit gradient + inset highlight — see DESIGN.md §3).
- Variants: primary (terracotta — the one thing that matters, at most one per
  surface), secondary (cream), ghost (terracotta text), icon (38×38), small pill
  (composer secondary actions). Disabled 45%.
- Why: terracotta budget — if two things are terracotta, neither matters.

### `<Input>`
Pill text field on surface color with a divider border; 12px label at 70% ink above.
The composer's brief field is its two-row textarea variant.

### `<Tag>` / `<TagRow>`
Small cream pills for facts about a thing ("Warm", "On brief", "3 revisions",
"At the buzzer"). Sage voice for "On brief". Capped at four on persona cards.

### `<ModelBadge>`
The 20×20 letter chip ("S", "G", "O", "L") on the avatar corner and the inline 9px
badge ("S4.5") in sheets — the model is metadata, never the headline.

### `<SubmissionPanel>`
The judging panel — the entry sheet mirrored to the top-left.
- Anatomy: pinned header (counter + `<ProgressDots>`, team, ship line, Trace link),
  scrolling body (title, pitch, tags, artifact), pinned footer (`<HeatButton>`,
  `<RankingControl>`, next-nav).
- Behavior: `cardIn` from the left per submission; arrow-key paging.
- Used in: Judging.

### `<ProgressDots>`
5px discs beside the counter: current terracotta, ranked sage, untouched faint ink.
Never a numbered stepper — it's the state of the whole pile, not a wizard.

### `<HeatButton>`
The instant reaction. Secondary pill that turns terracotta on first tap; counts up
to five; every tap throws a 🔥 burst and bumps the room total shown on the 5px track
beneath (the track is the room's, not yours). Used in Judging.

### `<RankingControl>`
The considered reaction. Segment trough with five 26px round options filling left to
right so it reads as a level, not a radio; a word under the label gives the number
meaning ("Missed the brief" … "Best in the room"); tapping the active number clears
it. Used in Judging.

---

## 3. Proposed component tree (`apps/frontend`)

Build bottom-up: primitives → shells → screens.

```text
<App>                              — phase-driven from arena SSE (arena.ts)
└─ <RoomCanvas>
   ├─ <AgentAvatar>* (each: <ModelBadge>, <StatusPill>)
   ├─ <HudPill> round · <HudPill> timer · <HudPill> brief
   ├─ <EmojiTray>
   ├─ phase = idle:
   │  ├─ <BattleSetupPanel>
   │  │  ├─ <SegmentControl> teams
   │  │  ├─ <Slider> combat length
   │  │  ├─ <ComboRow> models  → <PopMenu>
   │  │  ├─ <SegmentControl> effort
   │  │  ├─ <ComboRow> archetypes → <PopMenu>
   │  │  └─ <Switch> no repeats
   │  └─ <Composer> (<Input> brief, <Button> small*, <Button> primary)
   ├─ phase = mingle/build/submit:
   │  └─ <Sheet> (on demand)
   │     ├─ <EntrySheet> (<TagRow>, <Button>*)
   │     └─ <AgentSheet> (<Tabs>, <PersonaCard>, <TraceTimeline>)
   ├─ phase = judging:
   │  └─ <SubmissionPanel>
   │     ├─ <ProgressDots>
   │     ├─ <TagRow>
   │     ├─ <HeatButton>
   │     └─ <RankingControl>
   ├─ phase = judged:
   │  └─ <Modal> results (<ScoreRow>*, <Button>*)
   └─ <EmojiBurstLayer>            — always last, always on top
```

Wiring notes: drive everything from the arena event stream the current `App.tsx`
already consumes (`AgentEvent`, `ArenaStatus`); the `EventStream` list it renders
today is the raw ancestor of `<TraceTimeline>`. Tokens, fonts, motion keyframes,
and the z-order stack are specified in [`DESIGN.md`](DESIGN.md) §2–§9 — link the
Organic stylesheet plus the app overrides before building any of the above.

---

## 4. Open questions (design ↔ arena mismatches to decide before building)

1. **Two judging surfaces.** The mid-round entry sheet carries "Skip / Cast your
   vote" while the end-of-round submissions panel carries heat + ranking. Both are
   designed; whether mid-round voting exists (and what it counts for) is a product
   decision, not a design one.
2. **Team count.** The setup panel offers 1–4 teams; the arena currently hard-codes
   2 tracks × 3 agents. Either the panel clamps to what the arena supports for now,
   or the arena grows a team parameter.
3. **Naming drift.** Screens use agents Mika / Odin / Juno / Vex; the arena uses
   ada / rex / juno / iris / otto / vera. Harmless, but pick one roster before
   wiring avatars to `AgentId`s.
