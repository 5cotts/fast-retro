<script lang="ts">
  import GuideClip from '$lib/guide/GuideClip.svelte';
</script>

<section>
  <h2>Group cards on a canvas</h2>
  <p>You can cluster cards two ways. Putting related cards near each other is the loose way, and a label can name the cluster. In the Group phase you can also make a real group: drop a card on another card, and they go into a box that moves as one and keeps a name, a card count and a voter count. Outside the Group phase a drop only places the card, even on top of another.</p>
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
    <li>In Group, drop a card on another card to make a group, or on a group's box to join it. The target lights up first. Drag a card out of the box to take it out. Drag the box by its top edge to move the whole group.</li>
    <li>Prefer a menu, or on a phone? Use the <strong>Group</strong> button on a card to join a group, start a new one, or leave.</li>
    <li>Click a group's name to rename it. <strong>Ungroup</strong> leaves every card where it is, and the host can <strong>Merge</strong> a group into one card.</li>
    <li>From Group onward, double-click empty space to add a label, such as a theme's name.</li>
    <li>Drag a label to move it, click it to change the text, or clear the text to delete it. A label owns nothing, so moving it moves no cards.</li>
  </ol>
  <GuideClip name="canvas-cluster" />
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
  <p>Cards don't re-sort on a canvas, so Discuss has a <em>Top voted</em> panel. Pick a card there to pan to it and highlight it, for you only. Action items sit in a panel beside the canvas, not on it.</p>
</section>

<section>
  <h2>List view and phones</h2>
  <p>The <em>List</em> button in the phase bar shows the same cards in columns, where you can add, vote and comment but not move them. Phones start in List view; tap <em>Canvas</em> to switch.</p>
</section>

<section>
  <h2>Good to know</h2>
  <ul>
    <li>Labels are hidden in Brainstorm and stored without an author.</li>
    <li>A board stays a canvas or a column board for its whole life, and <em>Start next retro</em> keeps it the same.</li>
    <li>To create one, see <a href="/docs/setup">Set up and change a board</a>.</li>
  </ul>
</section>
