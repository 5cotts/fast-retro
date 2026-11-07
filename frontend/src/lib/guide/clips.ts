import canvasAdd from './clips/canvas-add.webp';
import canvasAddPoster from './clips/canvas-add.poster.webp';
import canvasCluster from './clips/canvas-cluster.webp';
import canvasClusterPoster from './clips/canvas-cluster.poster.webp';
import canvasNavigate from './clips/canvas-navigate.webp';
import canvasNavigatePoster from './clips/canvas-navigate.poster.webp';
import editBoard from './clips/edit-board.webp';
import editBoardPoster from './clips/edit-board.poster.webp';
import groupAcross from './clips/group-across.webp';
import groupAcrossPoster from './clips/group-across.poster.webp';
import groupMerge from './clips/group-merge.webp';
import groupMergePoster from './clips/group-merge.poster.webp';
import hideReveal from './clips/hide-reveal.webp';
import hideRevealPoster from './clips/hide-reveal.poster.webp';
import newCustom from './clips/new-custom.webp';
import newCustomPoster from './clips/new-custom.poster.webp';
import runPhases from './clips/run-phases.webp';
import runPhasesPoster from './clips/run-phases.poster.webp';
import saveImport from './clips/save-import.webp';
import saveImportPoster from './clips/save-import.poster.webp';

// Importing clips makes a missing file fail the build. The files come from
// tests/guide-clips/ (`make guide-clips`). Width and height reserve the space,
// so the page doesn't jump when a lazy clip loads.
export const GUIDE_CLIPS = {
  'canvas-add': {
    src: canvasAdd,
    poster: canvasAddPoster,
    width: 800,
    height: 548,
    alt: 'Typing a card into the bar below the canvas, then double-clicking the canvas and typing another card right there.'
  },
  'canvas-cluster': {
    src: canvasCluster,
    poster: canvasClusterPoster,
    width: 800,
    height: 524,
    alt: 'Dragging a card to sit just below a related card, then double-clicking beside them and typing a label.'
  },
  'canvas-navigate': {
    src: canvasNavigate,
    poster: canvasNavigatePoster,
    width: 800,
    height: 524,
    alt: 'Dragging empty space to pan the canvas, zooming in on a card, then clicking Fit to see every card again.'
  },
  'edit-board': {
    src: editBoard,
    poster: editBoardPoster,
    width: 800,
    height: 820,
    alt: 'Opening Edit board with the gear button, adding a column, moving it up the list, and saving. The new column appears on the board.'
  },
  'group-across': {
    src: groupAcross,
    poster: groupAcrossPoster,
    width: 768,
    height: 460,
    alt: 'Dragging a card onto a card in another column. They form a group shown as a row across the columns, and the group gets a name.'
  },
  'group-merge': {
    src: groupMerge,
    poster: groupMergePoster,
    width: 768,
    height: 480,
    alt: 'Clicking Merge on a group of two cards and confirming with Merge cards. The two cards become one.'
  },
  'hide-reveal': {
    src: hideReveal,
    poster: hideRevealPoster,
    width: 800,
    height: 500,
    alt: 'A card is added while other people\'s cards show as placeholders. Clicking Next phase moves to Group and reveals every card.'
  },
  'new-custom': {
    src: newCustom,
    poster: newCustomPoster,
    width: 800,
    height: 720,
    alt: 'Clicking Start a new retro, picking Custom, naming two columns, and creating the board with those columns.'
  },
  'run-phases': {
    src: runPhases,
    poster: runPhasesPoster,
    width: 1000,
    height: 500,
    alt: 'Setting the timer to 10 minutes and starting it, then clicking Next phase to move from Brainstorm to Group.'
  },
  'save-import': {
    src: saveImport,
    poster: saveImportPoster,
    width: 800,
    height: 560,
    alt: 'Saving a board file from the Export menu, then importing it from the homepage into a new board that looks the same.'
  }
} as const;

export type GuideClipName = keyof typeof GUIDE_CLIPS;
