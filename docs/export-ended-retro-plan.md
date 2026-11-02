# Plan: export a retro after it has ended

Status: approved, not yet implemented · 2026-11-02

## Goal

Anyone who can open an ended retro can export it, as a board file (`.fastretro.json`) or as CSV. No extra steps, no admin token.

## What happens today

- **The Export menu disappears when a retro ends.** `ExportMenu` only renders inside `LeadControls`, and `Board.svelte` passes `isLead={effectiveLead}` to the header, where `effectiveLead = isLead && !ended`. So the host loses the menu as soon as the retro ends, and participants never had it.
- **The only ways to get an ended retro out are:**
  - **Save board file & end**, which only works at the moment of ending, and only for the host.
  - The admin archive page (`/lead/<token>/archives/<id>`), which needs the global lead token.
- **All the data is still in the browser.** An ended board isn't cleared. The server keeps its Yjs doc (`board_docs` + `doc_updates`), hydrates it after restarts and sends the full state to every client that connects (`handle_socket` in `src/main.rs`). It only drops writes (`room.is_ended()`). So `conn.state` on an ended board has the same cards, votes, reactions, comments, label, phase and settings that `downloadJSON()` and `downloadCSV()` already use on a live board.
- **Prod check (on a copy of the DB):** 9 of 33 boards are ended. All 9 still have their doc, and all 9 have an archive.

## Proposal

Put the existing `ExportMenu` in the "This retro has ended" banner, for everyone viewing the board. Use the frozen board's data that's already loaded.

- **No server changes.** No new endpoint, no new auth rule, no schema change.
- **Same file format as a live export.** It reuses `exportBoardFile()` / `exportCSV()`, so ended exports import exactly like live ones, and anonymous boards still leave names out of the file.
- **Why the live doc and not the archive snapshot:** the archive endpoints are admin-only, so using them would mean a new auth rule for who can read an archive. The doc is also the source of truth: the archive is a copy the host's browser sends right before ending.

### Who can export

**Recommendation: anyone who can open the ended board.** That's what "period" implies, and it doesn't expose anything new:

- Everything in the file is already shown on screen to anyone with the link.
- The user IDs in the file are already sent to every viewer inside the Yjs doc.
- Anonymous boards still leave names out of the file.

Live boards stay host-only for export. Changing that is a separate decision.

## Implementation (one PR, small)

1. **`Board.svelte`:** render `<ExportMenu>` in the ended banner for all viewers, next to **Home** and **Start next retro**.
2. **Don't export an empty board.** On a slow connection someone could click Export before the doc has synced and download a file with no cards. Add a `synced` flag to `useBoardConnection` (set from the provider's `sync` event) and disable the menu until it's true.
3. **Analytics:** add `'ended'` to the `board_export` source union in `analytics.ts`, and give `downloadCSV()` a `source` parameter like `downloadJSON()` already has.
4. **Docs page:** one sentence saying ended retros can still be exported by anyone with the link.

### Tests

New cases in `tests/json-export.spec.ts` (or a new `ended-export.spec.ts`):

- **Host after ending:** end a retro, reload, and confirm the Export menu is in the ended banner. The downloaded board file should match one exported right before ending.
- **Participant:** in a fresh browser context with no host key, open the ended board and download both formats.
- **Round trip:** import the ended export and check the new board matches (cards, order, votes, reactions, comments, phase).
- **Anonymous:** an ended anonymous board's file has no names.
- **Sync gate:** the menu is disabled until the board has synced. A unit test on the connection state is enough for this one.

## Decisions (Scott, 2026-11-02)

1. **Everyone who can open an ended board can export it**, not just the host.
2. **Ended boards skip the name prompt.** Visitors can't edit, so a name isn't needed; opening the link goes straight to the read-only board and its Export menu. Implementation: in `Board.svelte`, when `readOnly` is true and no name is stored, start the connection without prompting (presence shows them as a guest). Test: a fresh browser context opens an ended board and sees cards with no name prompt.
3. **No per-row export in "My retros."** Opening an ended board from that list already shows the menu.

## Out of scope

- Opening export to participants on live boards.
- Exporting archives that have no board behind them (for example, archives created through the admin API). The admin archive page already covers those.
