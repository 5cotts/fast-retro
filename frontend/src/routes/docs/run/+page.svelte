<script lang="ts">
  import GuideClip from '$lib/guide/GuideClip.svelte';
</script>

<section>
  <h2>Start and share</h2>
  <ol>
    <li>On the homepage, click <strong>Start a new retro</strong>. Whoever starts a board hosts it, and no token is needed.</li>
    <li>Give it a name so you can recognize it later, such as <em>Sprint 42 — Mobile</em>, then click <strong>Create retro</strong>. <strong>Skip naming</strong> also works. The <em>Host</em> badge in the header shows you're hosting.</li>
    <li>Click <strong>Share</strong> in the header to copy the link, and paste it in your team channel. On a phone it's in the menu.</li>
  </ol>
  <p class="mt-3">Your host access is tied to this browser. If Google sign-in is offered on the homepage, sign in to keep it after clearing your browser or switching devices. Otherwise you can be locked out of your own retro.</p>
</section>

<section id="present">
  <h2>Present while you share your screen</h2>
  <p class="mb-3">Your screen marks what's yours: <em>you</em> under your cards, and your votes and reactions highlighted. On a shared screen, your team sees all of that. Present first, so your screen shows the board the way they see it.</p>
  <ol>
    <li>Click <strong>Present</strong> in the header, next to <strong>Share</strong>, and pick how you'll share:
      <ul>
        <li><strong>Present in this tab</strong> if you share your whole screen. Voting pauses in that tab.</li>
        <li><strong>Open a window to share</strong> if you share a single window. The board opens in a new window that's presenting. Share that window, and keep voting privately in the one you started in.</li>
      </ul>
    </li>
    <li>Share your screen or the window. Its header shows a dark <strong>Presenting</strong> label, so the team can tell your own input isn't on show.</li>
    <li>Click <strong>Stop</strong> on that label when you're done, or just close the presenting window.</li>
  </ol>
  <GuideClip name="present" />
  <p class="mt-3 mb-3">While you present:</p>
  <ul>
    <li><strong>Nothing is marked as yours.</strong> Your cards and comments show <em>Anonymous</em>, or your name on a board that shows names. Your votes and reactions look like anyone's. With <em>Hide cards</em> on, your own Brainstorm cards are placeholders too.</li>
    <li><strong>Voting and reactions pause where you present</strong>, because the click itself would give your choice away. Vote in your other window, from another device such as your phone, or click <strong>Stop</strong> first.</li>
    <li><strong>Everything else works.</strong> You can still add cards and comments, and use the timer, phases and the rest of the host controls.</li>
    <li><strong>Only your screen changes.</strong> The board and everyone else's view stay the same. A reload keeps you presenting, and <strong>Share</strong> still copies the normal link.</li>
    <li><strong>The team sees a screen icon</strong> next to your name in the list of who's here. With a presenting window open, you're still listed once.</li>
    <li><strong>What you type is on screen.</strong> Presenting can't hide typing, so add your own Brainstorm cards before you share, or from another device.</li>
  </ul>
  <p class="mt-3">You can present an ended board too, for example to review last retro's action items with the team.</p>
  <p class="mt-3"><strong>If you forget,</strong> Fast Retro reminds you: the first time someone else joins your live board, a note under <strong>Present</strong> asks whether you're sharing your screen. Click <strong>Present</strong> on it to open the menu, or <strong>Not now</strong> to hide it on this board. <strong>Don't remind me</strong> turns it off in this browser, and the <strong>Remind me when people join</strong> checkbox in the Present menu turns it back on. Nobody else sees the note.</p>
</section>

<section>
  <h2>Walk through the phases</h2>
  <p class="mb-3">A suggested 45 minutes for 4–8 people:</p>
  <ul>
    <li><strong>Brainstorm, 10 min.</strong> Start the timer: click the timer button in the header, enter the minutes, click <em>Set</em>, then press play. Everyone adds cards quietly.</li>
    <li><strong>Group, 5 min.</strong> Click <em>Next phase</em> in the phase bar. The team pulls related cards together, and you can merge true duplicates. See <a href="/docs/group">Group and merge cards</a>.</li>
    <li><strong>Vote, 5 min.</strong> Advance again. Everyone votes, and the totals show what to talk about.</li>
    <li><strong>Discuss, 20 min.</strong> Work through the top votes. Cards sort by votes from here on unless you turn <em>Auto-sort</em> off. Use comments for anything worth keeping.</li>
    <li><strong>Actions, 5 min.</strong> Capture next steps with owners and dates. A board without an Action items column ends at Discuss, so it has four phases.</li>
  </ul>
  <p class="mt-3">Going back with <em>Previous</em> doesn't lose anything, so a misclick is harmless.</p>
  <GuideClip name="run-phases" />
</section>

<section>
  <h2>End the retro</h2>
  <ol>
    <li>Click <strong>End retro</strong> in the header.</li>
    <li>Choose <strong>Archive &amp; end</strong>, or <strong>Save board file &amp; end</strong> to also download a copy. The board becomes read-only for everyone.</li>
    <li>Click <strong>Start next retro</strong> when you're ready for the next one. See <a href="/docs/save">Save, export and start the next retro</a>.</li>
  </ol>
</section>

<section>
  <h2>Good to know</h2>
  <ul>
    <li><strong>Other board shapes.</strong> The default is a classic retro. For your own columns or a free-form canvas, see <a href="/docs/setup">Set up and change a board</a>.</li>
    <li><strong>Changing your mind.</strong> You can edit the board's columns and options at any point until the retro ends.</li>
    <li><strong>What the phases enforce.</strong> Cards go into input columns only in Brainstorm and into Action items only in Actions, and votes count only in Vote. That stops late cards from drifting in mid-vote.</li>
  </ul>
</section>
