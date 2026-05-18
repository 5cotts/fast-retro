# Fast Retro — UX & Visual Design Review

**Reviewer perspective:** Apple-style design + research review.
**Method:** Code read of `frontend/src/` + scripted Playwright walk-through of `https://retro-board-5cotts.zocomputer.io` (desktop 1440×900, iPhone 13, single & multi-user, engineer & lead roles, dark mode, keyboard nav, invalid token).
**Screenshots:** `tests/screenshots/01-…24-…png` (referenced inline below).
**Scope:** Research only. No code or content changes were made.

---

## 1. Executive summary

Fast Retro is **functionally complete and surprisingly polished for a self-hosted tool** — a first-time engineer with retro experience can land, name themselves, and add a card in well under 30 seconds. But the product is **80% utility, 20% identity**: it does not yet *feel* like a retro tool, it feels like a generic Tailwind dashboard with the word "retro" in the title. The biggest gaps are (a) the homepage is the board (no context, no agenda, no purpose), (b) authorship and "you" attribution use loud all-caps that fights the rest of the UI, and (c) the lead header is a wall of dense iconography that is intimidating on first contact.

## 2. Overall Apple-vs-current rating: **5.5 / 10**

| Heuristic | Score | Notes |
|---|---|---|
| Clarity | 6 | Columns + cards are immediately legible. Iconography (▶ ⏸ ⟲ ⤓ ⨯ ✎ ✕ 😊+) is overloaded and unlabeled. |
| Deference | 5 | Content is foregrounded, but column tints and large `Add` blocks compete with cards visually. |
| Depth | 3 | Almost no transitions. New cards just *appear*. Drag insertion shows a 1px sky bar — functional but lifeless. |
| Discoverability | 5 | Voting/reactions are visible. **Edit/Delete are hidden behind hover and invisible on touch when not in lead view.** Drag-and-drop has no affordance hint. Shift+Arrow is undocumented. |
| Feedback | 6 | Optimistic CRDT updates feel fast. Timer hits 0 with no animation/sound/banner. Theme toggle has no transition. |
| Forgiveness | 6 | Card and board deletion are confirmed. Comment delete is two-step inline. **No undo for moves, edits, or deletes.** |
| Consistency | 5 | Three different "you" treatments (`— YOU`, `Alice (you):`, name badge). Button heights vary (h-6, h-8, h-9, h-11 across the app). |
| Accessibility | 6 | Good ARIA roles, focus ring, keyboard move. Several aria-hidden landmines (typing list, count badges). Contrast OK in light, fragile in dark. |
| Empty/loading/error | 4 | Board has no empty state — three blank pastel boxes greet a brand-new team. "Checking lead token…" then "Invalid lead token / Join as engineer" reads like internal tooling. |
| Mobile | 6 | Tap targets reasonable. Layout collapses sensibly. Some leftover desktop idioms (⌘/Ctrl+Enter hint, hidden hover icons on cards in non-lead view). |
| Microcopy | 4 | Mostly serviceable. "Join as engineer", "End board", all-caps `YOU`, and `fast-retro · joined as Alice` footer betray developer-author voice. |
| Onboarding | 3 | The first screen *after* naming yourself is the board, with no orientation. A first-timer who has never been in a retro will not know what "Went Well / To Improve / Action Items" means or what to put there. |

---

## 3. What's working well

Be specific, give credit where it is earned:

1. **Name-prompt modal is a quiet, correct piece of UI.** Single field, autofocus, max-length, Enter submits, disabled when empty, dark/light aware. `NamePrompt.svelte:36-58` is the most Apple-feeling screen in the app. Theme cycler below is a nice tertiary affordance.
2. **CRDT plumbing is invisible — which is the goal.** Typing indicators, presence dots, vote tallies, and reaction counts update in well under a second across two browser contexts (verified in screenshot `12-typing-indicator.png`).
3. **End-board confirmation is genuinely good design.** `Board.svelte:392-420` surfaces an inline alertdialog rather than a `confirm()` popup, distinguishes "Export CSV & clear" from "Clear board" (a destructive split), and uses rose tinting. This is the right pattern. Generalize it.
4. **Three-state theme (auto / light / dark) with system-pref tracking + legacy-key migration.** `storage.ts:49-67` shows care. Auto-mode label `Theme: auto (light)` is a thoughtful disclosure.
5. **Color-by-`userId` (not by name).** `identity.ts:7-13`'s comment names the right tradeoff — renaming yourself shouldn't rotate your dot. This is exactly the level of detail a sharp designer notices.
6. **Reactions are tasteful.** Six emoji, well-chosen set, picker dismisses on outside-click and Escape (`Card.svelte:103-120`). Aggregate pill shows count and self-state with a sky-blue tint.
7. **Keyboard-driven card move.** Shift+Arrow on a focused card moves it across columns (`Board.svelte:251-302`). Genuinely thoughtful. Almost no one will discover it (see Issues §4), but it's there for power users.

## 4. Critical issues a first-time user stumbles on

These are the things I would fix first.

### 4.1 The homepage *is* the board. There is no product surface.

`routes/+page.svelte` is literally `<Board isLead={false} />`. A user who lands at the root URL with no Slack/email context has:
- No product name explanation
- No "what is a retro" framing
- No "share this URL with your team" affordance
- No room/board concept — everyone in the world shares one board

Compare to Linear, Figma, or Loom: even single-tenant tools give you a one-line "what this is" the first time. The name modal helps, but it greets you with **"Welcome to the retro"** — *which* retro? You don't know. (Screenshot: `01-name-prompt.png`.)

### 4.2 Loud `— YOU` and `— ALICE` author labels read as shouting.

`Card.svelte:147` renders `— {card.authorId === userId ? 'you' : authorName}` inside a `text-[10px] uppercase tracking-wide` block. The CSS converts a friendly `you` into `YOU`. Stacked down a column, every card screams **YOU YOU YOU** or **ALICE ALICE ALICE**. (See `03-board-with-cards.png`.) Then `Card.svelte:265-271` writes comments as `Alice (you):` in sentence case — three different formats for the same concept in one card.

### 4.3 Edit and delete are hidden behind hover on desktop, sometimes invisible on touch.

`Card.svelte:209-227` applies `md:opacity-0 md:group-hover:opacity-100`. Outcome:
- **Desktop**: a first-time user does not know cards are editable. They will type a typo and recreate the card instead of editing it.
- **Mobile non-lead view**: at narrow widths the buttons should be visible (no `md:` prefix would hide them), but `flex-wrap` pushes the icon row, and the icons are 16px slate-400 — easy to miss. I had to look hard at `21-mobile-lead-menu.png` to find them.
- **The icons themselves are `✎` and `✕`**, which are decorative chars that don't always render well across fonts (the ✎ renders as a paperclip-looking glyph in Chrome's default).

### 4.4 The lead header is an avionics cockpit.

`13-lead-view.png` shows: title, LEAD pill, "live" dot, ⏱ 02:00 readout, `5` number input, `Set`, ▶, ⏸, ⟲, ⤓ Export CSV, ⨯ End board, 🖥 theme, then a row of "6 online: Alice, Alice, Bob…, Bob…, Carol (Lead), Carol (Lead), Carol (Lead)". That's **fifteen interactive elements** plus presence in a 32-pixel-tall header. No grouping, no separators. A first-time lead has to decode this top-down before they can run a retro. Apple would group these (timer cluster, board cluster, theme/identity cluster) and progressive-disclose the timer controls behind a single `⏱ Timer` button.

### 4.5 Duplicate display names are unresolved.

The CRDT happily tolerates 4× "Alice" online at once (`13-lead-view.png` shows "Alice, Alice" and "Carol (Lead)" three times across sessions). Presence pills become useless — there is no way to tell which Alice typed in `To Improve` or which Bob is currently typing a card. The author label `— ALICE` becomes ambiguous on the board itself. This will hit real teams (two Daves, two Sarahs is the default at most companies).

### 4.6 The board has no empty state.

A brand-new team lands on three empty pastel rectangles. No instructions, no example, no "Add something that went well to start". `Board.svelte:444-446` renders `min-h-[80px]` of empty space. (See `02-empty-board.png`.) A first-time user who has never done a retro will read "Went Well / To Improve / Action Items" and freeze. **Onboarding without an instruction screen is the high bar; you need *something* in the empty zone.**

### 4.7 Drag-and-drop is not visually advertised.

Cards get `cursor-grab` on hover, which is the only signal. There is no drag handle, no "drag to reorder" hint, no animation on drop. The drop-target indicator (`Board.svelte:455-457`) is a 4px sky bar that's easy to miss. First-timers do not learn this exists. **Shift+Arrow is even more invisible** — no kbd hint anywhere on the page.

### 4.8 The "Invalid lead token" page calls the participant role "engineer".

`routes/lead/[token]/+page.svelte:29` says **"Join as engineer"** as the recovery link. That word leaks from the project's own framing (lead = facilitator, others = engineers). Half of Fast Retro's potential users will be designers, PMs, marketers, etc. (Screenshot: `16-invalid-lead-token.png`.) "Join as participant" or "Join the retro" is correct.

### 4.9 Timer behavior at zero is silent.

When the timer expires, `BoardHeader.svelte:99-103` flips the pill from emerald to rose and adds a tiny `⏰`. No sound, no flash, no global banner, no animation. In a real retro the lead is talking and not staring at a 60-pixel readout — they'll blow through the expired timer without noticing.

### 4.10 The mobile placeholder still says `⌘/Ctrl+Enter`.

`Board.svelte:483` uses `placeholder="Add a card…  (⌘/Ctrl+Enter)"`. On an iPhone there is no Cmd, Ctrl, or hardware Enter — the user is told to do an impossible thing. (Screenshot: `19-mobile-add-card.png`.)

---

## 5. High-impact, low-effort wins (top 10, prioritized)

> "Could be a single PR each, day or two of work, big perceived quality jump."

1. **Replace `— YOU`/`— ALICE` all-caps with mixed-case attribution at the bottom-right of the card in slate-400/500.** Drop `uppercase tracking-wide`. One CSS change, ten-point quality jump. (`Card.svelte:144-148`)
2. **Add an empty state to each column.** A subtle illustration-less line like *"Nothing here yet. What went well?"* in slate-400, only when `cards[col].length === 0`. (`Board.svelte:438-446`)
3. **Make edit/delete always visible on touch breakpoints, and replace `✎`/`✕` with `lucide-svelte` icons (Pencil, Trash2).** Set tap target ≥ 40×40. (`Card.svelte:209-227`)
4. **Disambiguate duplicate names automatically.** When a second "Alice" joins, show her as `Alice (2)` in presence and `— alice (2)` on cards, derived from `clientId`. No user friction; no name collisions in the room. (`PresenceList.svelte`, `identity.ts`)
5. **Strip the keyboard hint from the textarea placeholder on touch.** Detect via `matchMedia('(pointer: coarse)')` and use plain `"Add a card…"`. Add a tiny `⌘↵` chip near the desktop button instead. (`Board.svelte:483`)
6. **Group the lead toolbar.** Collapse timer controls into one `Timer ⏱ 02:00 ▾` button that opens a popover with input + ▶ ⏸ ⟲. Keep CSV/End as standalone. Removes 4 always-visible buttons. (`LeadControls.svelte`)
7. **Replace `— Join as engineer` with `Join the retro`.** Also tighten "Invalid lead token" copy to "This lead link has expired or doesn't match the current session." (`routes/lead/[token]/+page.svelte:21-31`)
8. **Highlight "(you)" in the presence list.** Bold or accented border on the user's own pill; show name badge separately or move it out of the presence row entirely so it stops looking like a duplicate entry. (`PresenceList.svelte`, `BoardHeader.svelte`)
9. **Animate timer expiration.** Pulse the pill for 6 seconds, flash background once on first expiry, and add an inline banner *"⏰ Time's up — wrap up your last point."* (`BoardHeader.svelte:73-103`)
10. **Add subtle entry transitions for new cards.** Svelte `fly` or `scale` 150ms on mount. Currently cards pop in with zero motion — feels like a 1998 page reload. (`Board.svelte:447-475`)

## 6. Bigger investments worth considering (top 5)

1. **Boards are rooms.** Move from a single global board to `/board/<slug>` with a one-line homepage at `/` that creates a board, shows recent boards from `localStorage`, and exposes a copy-link CTA. This is the single largest perceived-quality investment and unlocks multi-team usage. Backend already supports board state by URL; add slug routing.
2. **Onboarding for first-time-anywhere users.** The first time `localStorage` has no user id, show a 3-step illustrated overlay (1) Click a column to add a card, (2) Vote ▲ on what matters, (3) Drag cards between columns. Auto-dismisses, never returns. The product is otherwise too sparse for someone who has *never* done a retro.
3. **Phase-based facilitation, lead-controlled.** Lead can step the board through *Brainstorm → Group → Vote → Discuss → Actions*, dimming non-current columns or hiding voting until the right phase. Right now everything is available at all times — fine for experienced teams, overwhelming for new ones, and a real differentiator vs easyretro.
4. **Visual identity.** Pick a real type pair (Inter is fine; pair with a display face for the wordmark), a single brand color (currently you have emerald, amber, sky, fuchsia, rose, slate — six accent families), and design a logo that replaces the `Fast Retro` text wordmark. The current design reads as "Tailwind starter" not "product".
5. **Persistent past retros + lightweight history.** A `/history` page listing the last N closed boards (date, # cards, top-voted item) is a near-zero-effort backend change that makes the tool feel like it remembers your team rather than being a disposable whiteboard.

---

## 7. Per-flow walkthrough findings

### 7.1 Landing → name prompt → board

- **Land:** Root URL renders `<Board isLead={false} />`. Until `localStorage.retro-name` is set, the `NamePrompt` modal covers everything. No product positioning, no agenda, no team context.
- **Name prompt** (`01-name-prompt.png`): Clean, well-paced. Heading `"Welcome to the retro"` is generic; could reference the team or product more strongly. The `Theme:` button below is borderless ghost-style — a thoughtful tertiary, but it looks unclickable on first glance.
- **Submit:** Smooth, instantaneous. WebSocket connects, board fades in. No celebration; that's correct.

### 7.2 Joining a board

There's effectively no "join" — you either are on the board or you have a name modal. A team that shares a URL has to trust the URL is right; there's no board name on screen anywhere. The header just says "Fast Retro".

### 7.3 Card CRUD

- **Add:** Bottom-of-column textarea + Add button. Disabled state when empty is correct. ⌘/Ctrl+Enter shortcut is noted in the placeholder (good on desktop, broken on mobile §4.10). Submit clears the textarea immediately. Solid.
- **Edit:** Pencil ✎ at far right of the action row, opacity 0 until hover. Click → inline textarea with Save/Cancel + Esc to cancel + ⌘/Ctrl+Enter to save. `Card.svelte:131-141`. Once you find it, the editing UX is good.
- **Delete:** ✕ → inline rose confirmation strip. `Card.svelte:227-243`. Two-step. Correct pattern. The ✕ is the same shape and weight as Comment delete and reaction-picker dismiss — a quick lucide swap would clean up a lot of glyph noise.

### 7.4 Commenting

- Click 💬 → reveals comment list + composer (`Card.svelte:269-310`). Good.
- Author label `Alice (you): Nice work team!` (sentence case, parens) is friendlier than the card author label `— ALICE` (all caps, em dash). Pick one. Sentence case wins.
- Comment delete is two-step inline `Delete?` which is fine, but the trigger ✕ is identical to the card delete ✕. Visually noisy.
- No comment edit; that's likely an intentional simplification — fine.

### 7.5 Voting & reactions

- Vote ▲ pill with count, emerald when active. Tap target ~ 28×24 — borderline small.
- Reaction `😊+` opens a 6-emoji picker that **clips behind the card edge on narrow screens** when the card is near the right column boundary. (Observable on `07-reaction-picker.png` — the picker just barely fits.)
- Reaction picker uses `absolute z-10` positioning; on a board with many cards it can be obscured by adjacent cards' shadows or, when in the rightmost column near the viewport edge, push offscreen.

### 7.6 Drag-and-drop + keyboard move

- **D&D:** `cursor-grab` is the only affordance. Drop indicator is a 1px sky bar. No card "lift" (no shadow/scale/rotate during drag). It works, but it feels like a 2014 jQuery-UI demo, not an Apple-class experience.
- **Keyboard:** Shift+Arrow on a focused card moves it (`Board.svelte:251-302`). Confirmed working (`23-after-shift-arrow-right.png`). Zero discoverability. Add a `?` keyboard-shortcuts overlay (or a small "drag, or Shift+arrow keys" hint in the footer).

### 7.7 Multi-user presence

- 5+ tabs, 4 distinct users — all show up in <1s. Presence dots colored by user-id seed — stable.
- Typing indicator under the new-card textarea ("Bob, Bob typing…") reveals the duplicate-name issue immediately (`12-typing-indicator.png`). It also displays the same name twice when one user has two tabs open. Real users will do this.
- Self pill is not marked. The `NameBadge` button sits *next to* the presence list, looking like just another peer's pill (`02-empty-board.png` shows `Alice` as the last entry, identical styling).

### 7.8 Lead view & timer

- Lead view (`13-lead-view.png`) is correct in structure but visually overloaded (§4.4).
- Setting a 2-minute timer: type `2` → Set → ▶. Works (`14-timer-running.png`).
- Set/Start are separate; a first-time lead reasonably expects `Set` to also start the timer.
- Pause and Reset are unlabeled icons. The reset icon `⟲` could mean undo, refresh, or go-back depending on the user.
- End-board flow (`15-end-board-confirm.png`) is excellent — clear, scoped, two-CTA, easy to cancel. **Use this pattern as the model for the next destructive action you add.**

### 7.9 Mobile

- Name prompt is fine (just cropped — modal is anchored to centre but very tall viewport leaves whitespace, see screenshot 01 captured at iPhone size).
- Cards (`17-mobile-board.png`) are large, readable, scroll smoothly. Tap targets meet the 44pt minimum on votes and reactions.
- Mobile menu (`18-mobile-menu-open.png`) reveals theme + name + presence in a tidy stack. Good.
- **Edit/delete affordances on cards:** lead-mode mobile shows them (`21-mobile-lead-menu.png`); non-lead mobile shows them too (no `md:` prefix means they're always rendered at the smaller breakpoints) but they get pushed by `flex-wrap` to where they're easily missed. Worth verifying with a touch-only user.

### 7.10 Errors & edge cases

- Empty card submit: Add button correctly disabled. Verified.
- Long card (~960 char Lorem ipsum, `09-long-card.png`): card grows unboundedly, no max-height, no "show more". The Action Items column became 50% of the viewport (see `13-lead-view.png`).
- Long names (>40 char): clipped server-side at 40 via `setName` (`storage.ts:39-41`). No UI feedback that the clip happened.
- Invalid lead token (`16-invalid-lead-token.png`): bare text page, no header, no logo, "Join as engineer" copy. Feels unbranded.
- Disconnect/reconnect: the green/red `live`/`…` pill is the only signal (`BoardHeader.svelte:55-67`). When I throttled my network, it went to `…` for ~3 seconds — readable but easy to miss. A brief inline banner on actual disconnect (>10s) would be reassuring.

---

## 8. Visual design audit

### Typography

- Single typeface stack (Tailwind default = `ui-sans-serif`/`-apple-system`). Acceptable but generic.
- Scale: `text-base/lg` for H1, `text-sm` body, `text-xs` for chrome, `text-[10px]` for author labels and typing indicators. **The 10-pixel author labels are too small** especially in dark mode where contrast drops.
- Line-height defaults are reasonable. Card text uses `whitespace-pre-wrap break-words` which handles long content but invites unbounded vertical growth.
- The wordmark `Fast Retro` is just text in `font-semibold` — no display face, no character. Worth investing in a real wordmark for identity.

### Color

You have **six accent color families** in active use: emerald (live, vote-active, Went-Well column), amber (timer pause, To-Improve column), sky (focus ring, action items column, drop indicator), fuchsia (LEAD badge), rose (end-board, danger, delete), slate (neutral text/borders). That's too many. Pick one brand color (sky is the strongest candidate given it's already focus and indicator) and reserve the rest strictly for semantic states (emerald=success/active, amber=warn, rose=destructive). Right now the LEAD pill is fuchsia for no semantic reason.

Contrast in light mode is generally fine. In dark mode the column header backgrounds (`bg-emerald-950/40` etc.) are nearly indistinguishable — the three columns lose visual identity (`24-dark-mode.png`). Either raise the alpha on the tints or move the differentiation to the column-title row.

### Spacing & rhythm

Not on a strict 8pt grid: `p-3`, `p-4`, `py-2`, `py-3`, `gap-1`, `gap-1.5`, `gap-2`, `gap-3` are all in active use. Component heights vary: `min-h-[32px]` on card buttons, `min-h-[36px]` on lead timer buttons, `min-h-[44px]` only on mobile name field. Codify a 4/8/12/16 spacing scale and a 32/40/44 height scale and stop using one-offs.

### Icons

Glyph-based: ⏱ ▶ ⏸ ⟲ ⤓ ⨯ ✎ ✕ ☰ 🖥 ☀ 🌙 ⭐. Renders inconsistently across OSes and font fallbacks (verified — ✎ renders as a paperclip-like char in Chromium on the test runner). **Adopt `lucide-svelte` or `lucide-react`** for all UI icons; reserve emoji strictly for user-content reactions.

### Components

- **Buttons:** `.btn`, `.btn-ghost`, `.btn-danger` (in `app.css`) is a good three-way taxonomy. Plus the dark CTA `bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900` used for `Join board`, column `Add`, comment `Post`, edit `Save`. That's a fourth implicit variant — formalize it as `.btn-primary`.
- **Inputs:** `.input` rule is consistent. Focus ring `ring-sky-400` is visible and correct.
- **Cards:** `border rounded-md px-3 py-2 shadow-sm hover:shadow` is clean but the shadow is so faint on light-grey background that the card almost floats inertly. A slightly stronger shadow-on-hover would communicate "this is interactive."
- **Pills/chips:** `.pill` is fine; presence pills could use a slightly larger color dot (currently 8px) for better visibility.

### Polish

- No layout transitions; columns and cards jump on add/delete.
- Theme cycle: instantaneous; no color crossfade.
- Focus ring: visible, correct (`ring-2 ring-sky-400`). Good.
- The `min-h-[80px]` empty drop zone is wasted space rather than designed empty state.

---

## 9. Accessibility audit

| Item | Status | Notes |
|---|---|---|
| Keyboard nav | ✅ ish | Tab order is reasonable; cards are focusable; Shift+Arrow moves cards. Reaction picker can be opened by keyboard but emoji buttons inside don't have `aria-label` so a screen reader reads literal emoji name only. |
| Focus visibility | ✅ | `focus:ring-2 focus:ring-sky-400` consistently applied. |
| ARIA roles | ⚠️ | `role="list"` on columns + `role="listitem"` on cards is correct. `role="alertdialog"` on end-board and card-delete is good. **`aria-live` is missing** on `12-typing-indicator` and on the timer expiry state — screen readers won't announce these. |
| Contrast | ⚠️ | Light mode mostly passes. `text-slate-400` on `bg-slate-50` for typing indicators and footer ("fast-retro · joined as Alice") is ~3.1:1 — fails WCAG AA for normal text. Dark mode column tints also fragile. |
| Touch target ≥ 44pt | ⚠️ | Met on most interactive elements after the recent `min-h-[44px]` adds, but vote/react/comment pills on cards are `min-h-[32px]` — too small for fingertips. |
| Labels | ⚠️ | `aria-label="Edit card"`, `"Delete card"` are present (good), but the reaction picker trigger uses `title="Add reaction"` with no `aria-label`. The Set/▶/⏸/⟲ icon buttons in lead controls have no accessible names. |
| Reduced motion | ❌ | No `@media (prefers-reduced-motion)` handling. Currently moot (almost no motion), but as motion is added (recommended in §5.9-10), respect this. |
| Screen reader for live regions | ❌ | Timer countdown, presence changes, and new cards are not announced. |

---

## 10. Microcopy audit

| Where | Current | Proposed |
|---|---|---|
| Name modal heading | `Welcome to the retro` | `Welcome to the retro` — fine, but consider `Join the retro` for participants and `Open the board as host` for the lead path. Add a one-line sub-line like "Share this URL with your team to invite them." |
| Name modal sublabel | `What should we call you?` | Keep — this is genuinely warm. |
| Name modal button | `Join board` | `Join the retro` (matches heading vocab). |
| Theme cycle line | `Theme: auto (light)` | Keep — this is good disclosure. |
| Header brand | `Fast Retro` | Replace text with a wordmark mark + word. Optional small subline "retro board" on first load. |
| Lead pill | `LEAD` | `Host` reads warmer; `Lead` is fine if you keep it, but lose the all-caps tracked styling — make it sentence case in a pill. |
| Connection state | `live` / `…` | `Live` / `Connecting…` (capitalized; tooltip "Connected to the board"). |
| Column titles | `Went Well` / `To Improve` / `Action Items` | Consider `What went well` / `What to improve` / `Action items` — full sentences are kinder to first-timers; sentence case on the third. |
| Card placeholder | `Add a card…  (⌘/Ctrl+Enter)` | Desktop: `Add a card…` plus a `⌘↵` kbd chip beside the Add button. Touch: `Add a card…` only. |
| Submit button | `Add` | `Add card` (verb+noun is friendlier; saves the user a glance). |
| Author label | `— YOU` / `— ALICE` | `you · added` (right-aligned, slate-400, sentence case) or simply remove for `you` and show only on others' cards. |
| Comment author | `Alice (you): Nice work team!` | `Alice you · 2 min ago` then text below. Move the `: ` colon out; it reads as IRC. |
| Comment placeholder | `Add a comment…` | Keep. |
| Comment delete | `Delete?` | `Delete this comment?` |
| Voting | `▲ 1` | Keep arrow; consider `lucide ChevronUp`. |
| Reaction trigger | `😊+` | Use `lucide Smile` icon; the `+` glyph is unnecessary. |
| Timer pause label | `(paused)` | Keep. |
| Timer expired badge | `⏰` | Add accompanying text `Time's up` in the badge. |
| End-board heading | `End this retro?` | Keep — strong wording. |
| End-board sub | `This clears all cards, comments, and the timer for everyone. This can't be undone.` | Keep — exemplary. |
| Export button | `⤓ Export CSV` | `Download CSV` with `lucide Download`. |
| End board button | `⨯ End board` | `End retro` — keep verb consistent with the dialog heading. |
| Invalid-token heading | `Invalid lead token` | `This host link isn't valid` |
| Invalid-token sub | `This link isn't valid for the current session.` | `The host link may have expired or this token doesn't match. Ask your host for a fresh link, or join as a participant.` |
| Invalid-token CTA | `Join as engineer` | `Join the retro` |
| Footer | `fast-retro · joined as Alice` | `Joined as Alice` — drop the kebab-case product name in the footer; the wordmark is already in the header. |

---

## 11. Screenshot references

All saved under `tests/screenshots/`:

| # | File | Subject |
|---|---|---|
| 01 | `01-name-prompt.png` | Welcome modal (iPhone viewport captured last) |
| 02 | `02-empty-board.png` | Board chrome with no new cards |
| 03 | `03-board-with-cards.png` | Three populated columns, light mode |
| 04 | `04-card-hover-edit-affordance.png` | Hover state — edit/delete barely visible |
| 05 | `05-comment-composer.png` | Comment composer open |
| 06 | `06-comment-posted.png` | After posting a comment |
| 07 | `07-reaction-picker.png` | Reaction emoji picker open |
| 08 | `08-after-vote-react.png` | Voted + reacted state |
| 09 | `09-long-card.png` | Unbounded long-text card |
| 10 | `10-bob-sees-alice-cards.png` | Second user joining mid-session |
| 11 | `11-alice-sees-bob-presence.png` | Multi-user presence list |
| 12 | `12-typing-indicator.png` | Cross-user typing indicator |
| 13 | `13-lead-view.png` | Full lead UI (dense header) |
| 14 | `14-timer-running.png` | Timer started, green pill |
| 15 | `15-end-board-confirm.png` | End-board confirmation strip |
| 16 | `16-invalid-lead-token.png` | Invalid token error page |
| 17 | `17-mobile-board.png` | Mobile board, single column |
| 18 | `18-mobile-menu-open.png` | Mobile hamburger menu |
| 19 | `19-mobile-add-card.png` | Mobile new card composer |
| 20 | `20-mobile-after-add.png` | Mobile post-add state |
| 21 | `21-mobile-lead-menu.png` | Mobile lead-mode menu |
| 22 | `22-card-focus-ring.png` | Card focus ring visibility |
| 23 | `23-after-shift-arrow-right.png` | Keyboard-driven card move |
| 24 | `24-dark-mode.png` | Dark mode full board |

---

## 12. Open questions for Scott

These are product/scope decisions you need to make before some of the recommendations above can be implemented well.

1. **Multi-board or single-board?** Today there is a single global board. Are boards per-team, per-meeting, or always one? This decides everything about the homepage, routing, and history (§6.1, §6.5).
2. **Audience: technical or general?** "Join as engineer", `fast-retro · joined as`, ⌘/Ctrl+Enter hints, and the README's `RETRO_LEAD_TOKEN` env-var paradigm all assume developer users. Is that the long-term audience or are you trying to reach designers/PMs/managers too?
3. **Is "Lead" the right word?** Industry standard for retro tooling is `Facilitator` or `Host`. Linguistic decision, but it touches every screen.
4. **Is the timer for the lead's eye, or for everyone?** If everyone, it needs more prominence and a visible expiry event. If just the lead, it can be tucked away in a popover.
5. **Phase-based facilitation: yes/no?** (§6.3) This is a strategic call — it shifts the product from "free-form board" to "facilitated flow", which is the easyretro.io differentiator.
6. **What does "End board" mean?** Today it clears state. Should it instead archive a snapshot, so a team can browse history? (§6.5)
7. **Anonymous mode?** No way today to add an anonymous card. For psychologically-tough teams, this matters. Worth deciding deliberately yes-or-no.
8. **Long-card behavior?** Should very long card text get a `max-h` with "Show more", or wrap freely? Affects column layout under heavy use.
9. **Reactions: locked set of 6, or open emoji picker?** Six is fine but `🚀` and `👀` are common requests. Decide now or you'll be patching forever.
10. **Reduced-motion / accessibility commitment?** Are you targeting WCAG AA? That answer determines whether the polish recommendations get gated on `prefers-reduced-motion` and contrast checks become required.

---

*Walkthrough conducted 2026-05-18. Screenshots: `tests/screenshots/`. Code references: `frontend/src/lib/Board.svelte`, `Card.svelte`, `BoardHeader.svelte`, `LeadControls.svelte`, `NamePrompt.svelte`, `routes/lead/[token]/+page.svelte`, `app.css`, `identity.ts`, `storage.ts`.*
