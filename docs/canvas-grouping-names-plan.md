# Plan: "can't group cards" and "names weren't recorded" on a canvas board

Status: investigated, nothing built · 2026-11-21 · checked against `main` at `c9c5238` (the build on prod during the session and now)

## The report

Valentina ran a brainstorm on 2026-11-19 and reported two things:

1. She couldn't work out how to group cards any more, and wondered if grouping was broken.
2. The board didn't record people's names, even though they typed them in.

## Bottom line

Neither is a code regression, and no data was lost. Both come from how the board was set up, and the product gave her no way to see that or change it during the session.

| Symptom | Cause | Data |
| --- | --- | --- |
| Can't group | The board was created as a **Canvas**. A canvas has no groups by design, dropping a card on a card does nothing visible, and a board's type can't be changed after it's created. | All 32 cards intact. No groups exist because a canvas can't make any. |
| No names | Every new board starts **Anonymous**. The join screen asks for a name and never says it will be hidden on cards. | All six names are stored, including all four people who wrote cards. They're hidden, not missing. |

The names can be shown today by the host with one click (see [This board](#this-board)). Grouping needs PR 1 below, or a file export and import as a workaround.

## How I investigated

Nothing was changed on prod or QA. I took a read-only online backup of prod's database into a scratch directory, decoded the board's stored document from that copy, and ran the exact prod build (`c9c5238`, from `fast-retro-releases/prod`) on a scratch port against a second copy. Everything below was observed there. Prod's copy of the board has the same `updated_at` it had before I started.

## What the board looks like

| | |
| --- | --- |
| Created | 2026-11-12, by a signed-in host |
| Session | 2026-11-19 (a 5-minute timer was started 16:51 UTC) |
| Layout | `canvas`, with 6 prompts |
| Settings | Anonymous on, hide-cards on |
| Phase | Group |
| Cards | 32, from 4 authors. No votes, comments, groups or labels. |
| Moved cards | 6 of 32, each up or down within its own prompt's lane (2–17 px sideways) |
| Names stored | 6 |

The six moved cards are the telling part. Each ended up against a card in its own lane or level with one in the next lane. My reading is that someone was dropping cards onto related cards, which is how you group on a column board. On a canvas that only moves them.

For comparison, this is the only canvas board anyone outside testing has made. In the same two weeks, three column boards run by her colleagues grouped 21 of 35, 19 of 25 and 45 of 45 cards. So the team knew drag-to-group well, and "any more" in the report means "the way it worked on our other boards".

## Finding 1: grouping

Reproduced on the copy, as host, in the Group phase:

| Action | Result |
| --- | --- |
| Drop a card squarely on another card, Canvas view | The card moves and overlaps. No group, no merge, no message. The doc gains one position and nothing else. |
| Switch to List view | Looks exactly like a column board, but no card can be dragged and there's no Group button. The hint says "Switch to Canvas to arrange the cards." |
| Open Edit board | Name, prompts, Action items, Anonymous, hide-cards. Nothing about board type. |

This is the canvas working as designed (`docs/canvas-mode-plan.md`: "Nothing records membership", "Drop a card on a card: they overlap, and it never merges"). The design also deferred switching layouts (decision C3: "wait until someone asks"). This report is that ask.

Three things made it worse:

- **The first view is too small to read.** Fit shows every card, so on a 1500×950 window this board opens at **40% zoom**. Proximity grouping needs people to read the cards.
- **The only instruction is one line of grey text.** "Drag cards near each other to cluster them" sits in the phase bar. Nothing responds when someone tries the column gesture instead.
- **The first-run tips are about columns.** A new participant on a canvas is told to "Drag cards between columns".

The last release (#81–#83) didn't touch any canvas file, so this isn't a regression from it.

### The fix works on the copy

Layout is one key in the board's `meta` map, and both surfaces already ignore what they don't use. On the copy I removed that key from a script while a host tab was open:

| Check | Result |
| --- | --- |
| The open tab | Switched to columns without a reload |
| Cards | All 32 present |
| Drag a card onto a card | Made a group of 2 |
| Set the key back to `canvas` | Canvas again, all 7 positions kept, and the group still stored |

So a switch needs no conversion, loses nothing in either direction, and reaches tabs that are already open.

## Finding 2: names

Reproduced on the copy:

| Check | Result |
| --- | --- |
| Join screen | "What should we call you?" and nothing about anonymity |
| Cards, as a participant | All 32 say "Anonymous" |
| Header | A small "Anonymous" badge |
| Host turns Anonymous off | All 32 cards show their author's name at once, for everyone |
| Warning to the host, or notice to participants | None |

Why the board was anonymous: `NewRetroModal` hard-codes `anonymous: true` (decision D7 in `docs/custom-columns-plan.md`), and the dialog has a checkbox for hide-cards but none for Anonymous. The host can turn it off from the toolbar afterwards, but nothing prompts her to, and she didn't know the names were there.

The mismatch is on the participant's side too. The board asks for a name, so people assume it will be used. The guide does explain it ("New boards start anonymous"), but nobody reads the guide before joining a meeting.

### Privacy: turning Anonymous off unmasks old cards silently

This is what rescues Valentina's board, and it's also a problem. People who wrote cards under an Anonymous badge can be named later by one click, with no confirmation for the host and no notice to them. PR 3 adds both.

Separately, and not changed by this plan: anonymity is a display setting. Every browser receives the author IDs and the names map, so anyone who opens dev tools can match them up. The guide's reference page already says it's "not a guarantee". Real anonymity would need the server to withhold authors, which is a much larger change.

## This board

Nobody but the host should change it, and nothing needs to be done to prod by hand.

- **Names:** Valentina opens the board and clicks **Anonymous** in the host toolbar. Names appear on every card. It's her call whether to tell the group first, since the board said Anonymous while they wrote.
- **Grouping, after PR 1 ships:** Edit board → Board type → Columns. Cards, authors and the phase stay as they are.
- **Grouping, today:** Export → Save board file, delete the `"layout": "canvas"` line, then Start a new retro → Import from file. I checked that the edited file parses as a 32-card column board with no warnings. It's a new board at a new link, and a file exported while Anonymous is on carries no names, so turn Anonymous off first if the names matter.

I'd wait for PR 1 unless she needs the board this week.

## Fix

Three PRs, in order of how much they'd have helped her. Each is independent and can ship alone.

### PR 1: switch a board between columns and canvas

- `yboard.ts`: add `layout?: BoardLayout` to `BoardEdit`. `applyBoardEdit` sets or deletes `meta.layout` in the same transaction as the rest of the edit, and reports whether it changed.
- `EditBoardModal.svelte`: a **Board type** control (Columns / Canvas), with one line under it saying what the choice means: "Columns: drag a card onto another to group them" or "Canvas: place cards anywhere, with no groups". When the choice differs from the current one, say what's kept: "Nothing is deleted. Positions and labels come back if you switch to Canvas again."
- `Board.svelte`: pass the layout in and out, and reset the Canvas/List toggle when the layout changes.
- Host only, any phase, until the board ends. Same rule as the rest of Edit board.
- **Not a doc-model change.** It writes an existing key with existing values, and the current build already follows it live. No `doc-model-change` label, no migration, no server change.
- Tests: a unit test in `boardedit.spec.ts` for both directions, and an e2e: a canvas board in Group with cards from two people, host switches to Columns, a participant's open tab follows, drag-to-group works, switch back and positions are where they were.
- Guide: the canvas and reference pages say the type can be changed.

### PR 2: the canvas says what it does

- **Drop on a card.** In Group, when a drop leaves a card mostly covering another, show a short note by it, once per browser: "On a canvas, cards sit together without joining a group." For the host, add "Want group rows? Edit board → Columns."
- **Start a new retro.** The Canvas description gains the trade-off: "No group rows or merge. You can switch to columns later."
- **List view.** In Group, a host sees "Switch to Canvas to arrange the cards, or change this board to columns in Edit board."
- **First-run tips.** `Onboarding.svelte` gets canvas wording when the board is a canvas.
- **First view.** Don't open below a readable zoom. Fit to the board's width, start at the top, and never start under about 70%. The Fit button still shows everything. This one needs a look on a real 6-prompt board before settling the number.
- Tests: extend `canvas.spec.ts` for the drop note and the first-view zoom, and `guide.spec.ts` if the wording there changes.

### PR 3: anonymity that people can see and choose

- **Creating.** `NewRetroModal` gets an **Anonymous** checkbox beside hide-cards, on by default (D7 stands, see N1). The creator now sees the choice instead of inheriting it.
- **Joining.** One line under the name field: "Your name shows in the list of who's here. On an anonymous board it's hidden on your cards." The prompt appears before the board connects, so it can't know the setting yet, which is why the line covers both cases.
- **Writing.** On an anonymous board, the composer shows "Posting anonymously" where people type. Own cards already say "you (hidden)".
- **Turning it off.** The host gets a confirmation that counts what will be revealed: "Show author names on 32 cards to everyone?" Every open tab then shows a notice: "The host turned off Anonymous. Names now show on cards." Turning it on needs neither.
- Tests: extend `anonymous.spec.ts` for the checkbox, the confirmation and the participant's notice.

## Decisions for Scott

| # | Question | Recommendation | Why |
| --- | --- | --- | --- |
| G1 | Allow switching both ways, or only canvas to columns? | **Both ways** | It costs the same, and nothing is lost either way. |
| G2 | After columns → canvas, what happens to existing groups? | **Kept in the data, not shown on the canvas.** They return on switching back. | Drawing groups on a canvas is the "named topics" idea the canvas plan ruled out. |
| G3 | Build the first-view zoom change in PR 2? | **Yes, after trying it on a 6-prompt board** | 40% is unreadable, and it's the first thing a host sees. |
| N1 | Should Custom and Canvas boards default to Anonymous off? | **Keep it on everywhere, but visible** | All 9 team sessions on prod since late October were left anonymous, and one confused session isn't enough to reverse D7. The checkbox fixes the surprise. Worth asking Valentina which she'd expect for a brainstorm. |
| N2 | Should turning Anonymous off reveal cards written while it was on? | **Yes, with the confirmation and the notice** | Revealing only later cards needs a per-card flag, which is a doc-model change, and it would stop a host recovering names in a case like this one. |

## Out of scope

- Groups, merge or named topics on a canvas
- Converting canvas positions into groups, or groups into positions
- Server-side anonymity (withholding author IDs from other browsers)
- Changing this board's data from our side
