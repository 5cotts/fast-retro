# Board file fixtures

`board-v1.fastretro.json` is a frozen example of a version 1 board file, the
format written by Export → Save board file. People keep these files, so every
future release must still import it. `boardfile-v1.spec.ts` checks that.

Never edit it to make a test pass. If the format changes, bump
`BOARD_FILE_VERSION`, add `board-v2.fastretro.json` next to it, and keep the v1
test passing.
