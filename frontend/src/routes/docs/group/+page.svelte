<script lang="ts">
  import GuideClip from '$lib/guide/GuideClip.svelte';
</script>

<p>This page is about column boards. On a canvas, cards group by sitting close together: see <a href="/docs/canvas">Use a canvas board</a>.</p>

<section>
  <h2>Group cards</h2>
  <p class="mb-3">Grouping happens in the Group phase, and anyone on the board can do it. A group can span columns, and each card stays in its own column.</p>
  <ol>
    <li>Drag a card onto another card. They form a group, and it appears as a row across the columns.</li>
    <li>To add another card, drag it onto a card in the group.</li>
    <li>Click the group's name to rename it.</li>
  </ol>
  <p class="mt-3">Without dragging, or on a phone, use the <strong>Group</strong> button on a card. From there you can pick a group, choose <strong>New group…</strong>, or <strong>Remove from group</strong>.</p>
  <GuideClip name="group-across" />
</section>

<section>
  <h2>Merge duplicates</h2>
  <p class="mb-3">Only the host can merge, and only in the Group phase.</p>
  <ol>
    <li>Group the cards that say the same thing.</li>
    <li>Click <strong>Merge</strong> on the group, then confirm with <strong>Merge cards</strong>. They become one card that keeps the combined votes, reactions and comments.</li>
  </ol>
  <p class="mt-3">A merge can't be undone. If you only want to take a group apart, use <strong>Ungroup</strong>, which leaves every card in its column.</p>
  <GuideClip name="group-merge" />
</section>

<section>
  <h2>Move and reorder</h2>
  <ul>
    <li><strong>Reorder.</strong> Drop a card near another card's top or bottom edge.</li>
    <li><strong>Move to another column.</strong> Drag it below that column's groups, or focus it and press <kbd>Shift</kbd>+<kbd>←</kbd> or <kbd>→</kbd>.</li>
  </ul>
</section>
