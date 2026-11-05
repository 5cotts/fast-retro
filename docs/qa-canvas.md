# QA script: canvas boards

A manual run-through of the request that prompted canvas mode:

> I like columns most of the time, but canvas mode can group in a more nuanced way, where the proximity maters, not the binary of "grouped/not grouped"

The same session runs automatically in `tests/canvas-scenario.spec.ts`. Section 7 only works by hand, so don't skip it.

You need three browser sessions: a normal window for the host and two private/incognito windows for Ana and Ben. Sections 1–6 take about 10 minutes. Section 7 needs a real iPhone and a mid-range laptop.

## 1. Set up (host)

1. On the homepage, click **Start a new retro**, name it, and pick **Canvas**.
2. Add three prompts: `Went well`, `Went OK`, `To improve`.
3. Tick **Hide others' cards while brainstorming**, and click **Create retro**.
4. Share the link with Ana and Ben.

**Check:**
- [ ] Each prompt has a faint heading across the top, and a bar at the bottom offers the three prompts.
- [ ] The Canvas / List switch shows in the phase bar.

## 2. Brainstorm in private

- Ana picks **Went well** in the bottom bar and adds `Friday deploy had no drama`. She then double-clicks the canvas and adds `New hire shipped a deploy on day 3`.
- Ben picks **Went OK** and adds `Deploys were fine but slow`, then picks **To improve** and adds `Onboarding docs are stale`.
- Double-click, type something, and press Escape. Double-click, then click elsewhere without typing.

**Check:**
- [ ] A card from the bar lands under its prompt's heading. If that's off screen, the view pans to it.
- [ ] A double-clicked card lands where you clicked, in the selected prompt's color.
- [ ] Others' cards are placeholders, and can't be dragged.
- [ ] Escape and the empty double-click left nothing behind.

## 3. Group

Host clicks **Next phase**.

Ben drags `Deploys were fine but slow` right next to `Friday deploy had no drama`. Ana drags `New hire shipped a deploy on day 3` between the deploys cards and `Onboarding docs are stale`. Someone drags one card on top of another, then away.

Ana double-clicks empty space and adds a label, `Deploys`. Ben drags the label, then clicks it and changes the text.

**Check, in every window:**
- [ ] All cards are revealed at once.
- [ ] A card being dragged moves live for everyone. Nothing else moves.
- [ ] The deploy cards sit together and keep their different colors.
- [ ] Dropping a card on a card overlaps them. It doesn't merge them or open a text box.
- [ ] Moving a label moves no cards.
- [ ] Pan, zoom and **Fit** only change your own view.

## 4. Vote, then Discuss

Host clicks **Next phase**. Everyone votes on a few cards. Host clicks **Next phase**.

**Check:**
- [ ] **Top voted** opens by itself and lists cards by votes.
- [ ] Clicking a row pans to that card and highlights it, for you only, and the highlight fades.
- [ ] No card moved when the phase changed.
- [ ] There's no auto-sort toggle in the header or in **Edit board**.

## 5. Actions, ending, and the next retro

Host clicks **Next phase**. Ana adds an action item in the panel beside the canvas.

**Check:**
- [ ] The whole board still shows, resized around the panel, unless you've panned or zoomed.
- [ ] The action item isn't on the canvas.

Host clicks **Export → Save board file**, then **End retro → Archive & end**.

**Check:**
- [ ] Everyone sees that it ended. Cards and labels are still there, and can't be moved or changed. Pan, zoom and **Fit** still work.
- [ ] Importing the file makes a new board with the same layout and labels.
- [ ] **Start next retro** gives a canvas with the same prompts, no labels, and the action item in the panel.

## 6. List view and small things

- Click **List**. Vote or comment on a card, and try to drag one. Back on **Canvas**, the card hasn't moved.
- As host, click a prompt's heading and rename it. In **Edit board**, add a prompt and remove one with cards.
- Leave a prompt's name blank when creating a canvas with no other prompts: it gets one called `Notes`.
- Reload during each phase once. Your view starts at **Fit**, and everything else is where it was.

## 7. Real devices (automated tests can't cover this)

**Phone, on a real iPhone:**
- [ ] Opening a canvas board starts in List view, and voting and commenting work.
- [ ] **Canvas** opens the canvas. Dragging a card works with a finger, dragging empty space pans, and pinching zooms without zooming the whole page.
- [ ] Typing in the bottom bar works with the keyboard open.

**At 300 cards, on a mid-range laptop and on the iPhone:** import `docs/fixtures/canvas-300-cards.fastretro.json`.
- [ ] Panning, zooming and dragging a card stay smooth enough to use. Compare with two people on the board, one dragging.
- [ ] Text stays sharp after zooming, once the gesture ends.
- [ ] Opening a card's emoji picker and comments shows them above the next card.
