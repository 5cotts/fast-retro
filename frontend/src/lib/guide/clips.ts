import canvasAdd from './clips/canvas-add.webp';
import canvasAddPoster from './clips/canvas-add.poster.webp';
import canvasCluster from './clips/canvas-cluster.webp';
import canvasClusterPoster from './clips/canvas-cluster.poster.webp';
import canvasNavigate from './clips/canvas-navigate.webp';
import canvasNavigatePoster from './clips/canvas-navigate.poster.webp';

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
    height: 518,
    alt: 'Dragging a card to sit just below a related card, then double-clicking beside them and typing a label.'
  },
  'canvas-navigate': {
    src: canvasNavigate,
    poster: canvasNavigatePoster,
    width: 800,
    height: 518,
    alt: 'Dragging empty space to pan the canvas, zooming in on a card, then clicking Fit to see every card again.'
  }
} as const;

export type GuideClipName = keyof typeof GUIDE_CLIPS;
