# QA script: card groups

A manual run-through of the request that prompted group rows:

> One thing metro retro did which I liked was let you have clusters of ideas across different "columns", like if the same thing popped up as "went ok" and "went well", let's say, you could cluster them together but still keep them in separate columns

The same session runs automatically in `tests/card-groups.spec.ts`.

You need three browser sessions: a normal window for the host and two private/incognito windows for Ana and Ben. About 5 minutes.

## 1. Set up (host)

1. On the homepage, click **Start a new retro**, name it, and pick **Custom**.
2. Add three columns: `What went well`, `What went OK`, `What to improve`.
3. Open the board and share the link with Ana and Ben.

## 2. Brainstorm

- Ana adds `Friday deploy had no drama` and `Standups got shorter` to **What went well**.
- Ben adds `Deploys were fine but slow` to **What went OK** and `Rollback steps aren't written down` to **What to improve**.

**Check:**
- [ ] No card shows a **Group** button yet.

## 3. Group

Host clicks **Next phase**.

Ben drags `Deploys were fine but slow` onto the middle of `Friday deploy had no drama`.

**Check, in every window:**
- [ ] One "Untitled group" row runs across the columns, and both cards start level with each other.
- [ ] Each card is still in its own column.
- [ ] No text box opened.

Ana clicks the group's name, types `Deploys` and presses Enter. The host clicks **Group** on `Rollback steps aren't written down` and picks **Deploys**.

**Check:**
- [ ] All three windows show `Deploys` with 3 cards. `Standups got shorter` sits below the row.
- [ ] Action items isn't in the row, if the board has it.

Try the other drags, then put things back:

- [ ] Drop a card near another card's top or bottom edge: the blue line shows, and it reorders without grouping.
- [ ] Drag a grouped card: "Drop here to leave the group" appears. Dropping there takes it out, in the same column.
- [ ] Drag a loose card into another column's loose cards: it moves to that column.
- [ ] Drag a card over a row's empty cell: "Drop to add to this group" appears. Dropping there joins the group, and the card stays in its own column.
- [ ] Focus a card and press Shift+Up/Down: it reorders and stops at the row's edge.
- [ ] Only the host sees **Merge**. It asks first, naming the column. Cancel it.

## 4. Vote and Discuss

Host clicks **Next phase** (Vote). Ana and Ben both vote on `Deploys were fine but slow`, and Ben also votes on `Friday deploy had no drama`.

**Check:**
- [ ] Each card shows its own votes. The row says **2 voters**, not 3.

Host clicks **Next phase** (Discuss). Ana comments on `Deploys were fine but slow`.

**Check:**
- [ ] Rows sort by voters. The comment appears only on that card.
- [ ] Group controls are gone.

## 5. Other screens

- [ ] Resize to phone width: each column shows its own block with the group's name.
- [ ] Go back to Brainstorm with **Hide cards** on: no group names show.
- [ ] **Export → Save board file**, then import it in a new retro: the groups come back.
- [ ] **Export → Spreadsheet (CSV)**: the last column is `group`.
- [ ] End the retro: the ended board shows the rows, read-only. The host's archive view shows the groups.
