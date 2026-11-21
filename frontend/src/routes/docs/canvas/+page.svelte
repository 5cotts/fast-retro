<script lang="ts">
  import GuideClip from '$lib/guide/GuideClip.svelte';
</script>

<section>
  <h2>Two ways to cluster</h2>
  <p>Putting related cards near each other is the loose way, and a label can name the cluster. In the Group phase you can also make a real group, a box that holds its cards and moves as one (see <a href="/docs/canvas#group-cards">Group cards</a>). Outside the Group phase a drop only places the card, even on top of another.</p>
</section>

<section>
  <h2>Add cards</h2>
  <p>In Brainstorm, pick a prompt in the bar at the bottom and write your card, or double-click the canvas to put it right there. A card keeps its prompt's color wherever it goes.</p>
  <GuideClip name="canvas-add" />
</section>

<section>
  <h2>Cluster and label</h2>
  <ol>
    <li>Drag a card near the cards it belongs with. Everyone sees it move, and you can move cards at any point until the retro ends.</li>
    <li>From Group onward, double-click empty space to add a label, such as a theme's name.</li>
    <li>Drag a label to move it, click it to change the text, or clear the text to delete it. A label owns nothing, so moving it moves no cards.</li>
  </ol>
  <GuideClip name="canvas-cluster" />
</section>

<section id="group-cards">
  <h2>Group cards</h2>
  <p class="mb-3">A group is a box that holds its cards and moves as one. Anyone can make one in the Group phase, and a group can hold cards from different prompts. Each card keeps its prompt's color.</p>
  <ol>
    <li>Drop a card on another card. The target lights up first, and they go into a box where that card was.</li>
    <li>To add another card, drop it on the box. To take one out, drag it out of the box.</li>
    <li>Click the group's name to rename it. The header also shows how many cards and how many different people voted.</li>
    <li>Drag the box by its top edge to move the whole group. A new box covers whatever was under it, so drag it into open space.</li>
  </ol>
  <p class="mt-3">Without dragging, or on a phone, use the <strong>Group</strong> button on a card to join a group, start a new one, or leave. <strong>Ungroup</strong> leaves every card where it is. The host can <strong>Merge</strong> a group into one card, which can't be undone.</p>
  <GuideClip name="canvas-group" />
</section>

<section>
  <h2>Move a card to another prompt</h2>
  <p>A card can't be dragged into another prompt's column, because on a canvas it goes wherever you put it. Use the card's <strong>Move</strong> button (or the same menu as <strong>Group</strong> in the Group phase) and pick a prompt. The card stays where it is and takes the new prompt's color, and a card in a group stays in the group.</p>
</section>

<section>
  <h2>Get around</h2>
  <ul>
    <li><strong>Pan.</strong> Drag empty space, or scroll.</li>
    <li><strong>Zoom.</strong> Pinch, or hold <kbd>Ctrl</kbd>/<kbd>⌘</kbd> and scroll.</li>
    <li><strong>Fit.</strong> Click <em>Fit</em> to see every card. Your view is your own and doesn't affect anyone else's.</li>
    <li><strong>Keyboard.</strong> <kbd>Shift</kbd>+arrow keys nudge a focused card, or the whole group if the card is in one.</li>
  </ul>
  <GuideClip name="canvas-navigate" />
</section>

<section>
  <h2>Discuss on a canvas</h2>
  <p>Cards don't re-sort on a canvas, so Discuss has a <em>Top voted</em> panel. A group is one row there, ranked by how many different people voted on its cards, next to cards that are on their own. Pick a row to pan to it and highlight it, for you only. Action items sit in a panel beside the canvas, not on it.</p>
</section>

<section>
  <h2>List view and phones</h2>
  <p>The <em>List</em> button in the phase bar shows the same cards in columns, where you can add, vote and comment, and group cards with each card's <strong>Group</strong> button, but not move them. Phones start in List view; tap <em>Canvas</em> to switch.</p>
</section>

<section>
  <h2>Good to know</h2>
  <ul>
    <li>Labels are hidden in Brainstorm and stored without an author.</li>
    <li>A board stays a canvas or a column board for its whole life, and <em>Start next retro</em> keeps it the same.</li>
    <li>To create one, see <a href="/docs/setup">Set up and change a board</a>.</li>
  </ul>
</section>
