# Board file fixtures

Frozen examples of each board file version, the format written by Export →
Save board file. People keep these files, so every future release must still
import them.

- `board-v1.fastretro.json`: a classic three-column board (version 1).
  Checked by `boardfile-v1.spec.ts`. Classic boards are still exported as v1.
- `board-v2.fastretro.json`: a five-column brainstorm board with custom
  columns (version 2). Checked by `boardfile-v2.spec.ts`.
- `board-v3.fastretro.json`: a three-column board with groups across columns
  (version 3). Checked by `boardfile-v3.spec.ts`.

Never edit them to make a test pass. If the format changes in a way an older
reader would silently lose data, bump `BOARD_FILE_VERSION`, add the next
fixture next to these, and keep the existing tests passing.
