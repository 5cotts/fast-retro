<script lang="ts">
  import GuideClip from '$lib/guide/GuideClip.svelte';
</script>

<section>
  <h2>Choose a board type</h2>
  <p class="mb-3">Click <strong>Start a new retro</strong> on the homepage, then pick one under <em>Board type</em>:</p>
  <table>
    <thead><tr><th scope="col">Type</th><th scope="col">What you get</th></tr></thead>
    <tbody>
      <tr><td><strong>Retro</strong></td><td>What went well, What to improve, and Action items.</td></tr>
      <tr><td><strong>Custom</strong></td><td>As many columns as you like, named by you.</td></tr>
      <tr><td><strong>Canvas</strong></td><td>Cards go anywhere under prompts you name, or under a single <em>Notes</em> prompt if you leave them blank. See <a href="/docs/canvas">Use a canvas board</a>.</td></tr>
    </tbody>
  </table>
  <p class="mt-3">An <em>Action items</em> column comes last unless you untick it. Without it, the board has four phases and ends at Discuss.</p>
  <GuideClip name="new-custom" />
</section>

<section>
  <h2>Change a live board</h2>
  <ol>
    <li>Click the gear button in the header. On a phone it's <strong>Edit board</strong> in the menu.</li>
    <li>Rename the board, add, rename, reorder or remove columns, turn <em>Action items</em> on or off, and change the options.</li>
    <li>Save. Everyone on the board sees the change at once.</li>
  </ol>
  <p class="mt-3">Cards stay with their column when you rename or reorder it. <strong>Removing a column that has cards deletes those cards.</strong> The dialog says how many before you save.</p>
  <p class="mt-3">Editing works until the retro ends, on classic boards too. A canvas changes its prompts the same way.</p>
  <GuideClip name="edit-board" />
</section>

<section>
  <h2>Rename a column</h2>
  <p>Click the column's title on the board, type, and press <kbd>Enter</kbd>. <kbd>Escape</kbd> cancels.</p>
</section>

<section>
  <h2>Options</h2>
  <ul>
    <li><strong>Anonymous.</strong> On by default. Hides names on cards and comments for everyone. Names are still recorded, so it's a display setting and not a guarantee.</li>
    <li><strong>Hide cards.</strong> During Brainstorm, everyone sees only their own cards, and moving to Group reveals them. Action items are never hidden. It isn't a security feature: the board's data still reaches every browser. See <a href="/docs/brainstorm">Run a private brainstorm</a>.</li>
    <li><strong>Auto-sort.</strong> Cards reorder by votes from Discuss onward. Not offered on a canvas, where cards never re-sort.</li>
  </ul>
</section>
