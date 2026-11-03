# QA script: problem-solving brainstorm

A manual run-through of the session that prompted custom columns:

> Here are 5 problem statements. Please generate ideas for potential solutions (in private, for 10 mins), then we will reveal and group and do some discussion.

The same scenario runs automatically in `tests/brainstorm-scenario.spec.ts`.

You need three browser sessions: a normal window for the host and two private/incognito windows (or a second browser) for participants. Each one is a separate person. About 10 minutes, or 2 if you set a shorter timer.

## 1. Set up the board (host)

1. On the homepage, click **Start a new retro**.
2. Name it, e.g. `Platform brainstorm`.
3. Under **Columns**, pick **Custom** and add four columns (leave out the fifth on purpose; you'll add it in step 2b):
   - How might we cut onboarding time?
   - How might we make deploys boring?
   - How might we make on-call less painful?
   - How might we keep docs up to date?
4. Untick **Action items column**. This session ends in discussion.
5. Tick **Hide others' cards while brainstorming**.
6. Click **Create retro** and enter your name.

**Check:**
- [ ] The board shows exactly the four columns, in that order.
- [ ] The phase bar shows **Brainstorm · Group · Vote · Discuss**, with no Actions.
- [ ] The board starts anonymous (the header shows **Anonymous**).

## 2. Participants join

Copy the board URL into both private windows and join as `Ana` and `Ben`.

**Check:**
- [ ] Both see the same four columns.
- [ ] Both see a banner saying others' cards are hidden until Group.
- [ ] Neither gets a host toolbar.

## 2b. Add the forgotten problem statement (host)

1. Click **Edit** (the gear button in the header).
2. Click **Add column** and type `How might we have fewer meetings?`.
3. Click **Save**.

**Check:**
- [ ] All three windows now show five columns, with the new one last, without reloading. The board scrolls sideways if the window is narrow.
- [ ] Nobody got a "host changed the columns" notice (nothing was removed).
- [ ] To fix a typo in a column name, click the column's title on the board, edit it and press Enter.

## 3. Start the 10-minute timer (host)

Open the timer in the header, set **10** minutes (or 2 to go faster), click **Set**, then **Start**.

**Check:**
- [ ] Ana and Ben see the timer counting down.

## 4. Private ideas (everyone)

- Ana adds ideas in columns 1, 2 and 5.
- Ben adds ideas in columns 1, 3 and 5. Make one of his column 1 ideas a near-duplicate of Ana's (e.g. both suggest an onboarding buddy).
- The host adds one idea in column 4.

**Check:**
- [ ] Everyone sees their own cards in full.
- [ ] Everyone else's cards show as placeholders with no text, including for the host.
- [ ] A late joiner (a third window, optional) also sees only placeholders.

## 5. Reveal (host)

When the timer ends (it pulses red), click **Next phase** to move to **Group**.

**Check:**
- [ ] All three windows show every card at the same moment; no placeholders remain.

## 6. Group (host)

Drag Ben's buddy idea onto Ana's buddy idea in column 1.

**Check:**
- [ ] The two cards merge into one, showing both texts, in every window.

## 7. Vote

Host clicks **Next phase** (Vote). Ana and Ben upvote the ideas they want to talk about. Give one idea in column 5 two votes.

**Check:**
- [ ] Upvote buttons only work in this phase.

## 8. Discuss (host)

Click **Next phase** (Discuss).

**Check:**
- [ ] There is no **Next phase** button: Discuss is the last phase.
- [ ] In each column the most-voted idea is now first.
- [ ] Anyone can comment on a card. Others see the card's comment count go up right away and can open it to read.

## 9. Wrap up (host)

Click **End retro**, then **Archive & end**.

**Check:**
- [ ] Everyone sees "This retro has ended".
- [ ] There's no "Bring N action items" checkbox for the host.
- [ ] Ana can open **Export → Save board file**. Importing that file (Start a new retro → Import from file…) gives back the five columns, the cards, votes and comments, in Discuss.
- [ ] **Start next retro** opens a new board with the same five columns and still no Action items.
