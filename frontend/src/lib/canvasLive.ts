import { sanitizePos, type Point } from './canvas';

// Where a card is drawn while someone moves it. Drag frames go straight to the
// card's element instead of through Svelte, so a drag doesn't re-render the
// board, and the doc only changes on drop.
//
// Precedence: your own drag, then the latest peer's, then the doc. A drop that
// arrives during your drag is recorded but not shown until you let go.

// A peer sends a frame at least this often while dragging, even holding still.
export const DRAG_HEARTBEAT_MS = 400;
// The server doesn't announce a dropped connection, so a peer whose frames stop
// is treated as gone, and their card falls back to the doc.
export const PEER_DRAG_TIMEOUT_MS = 1000;
export const DRAG_FRAME_MS = 50;

export interface DragFrame extends Point {
  id: string;
}

export interface LiveElement {
  style: { transform: string };
  toggleAttribute(name: string, force?: boolean): unknown;
}

interface PeerMove {
  cardId: string;
  at: Point;
  seq: number;
  lastFrame: number;
}

// Awareness comes from other clients, so check it like doc data.
export function parseDragFrame(raw: unknown): DragFrame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id } = raw as { id?: unknown };
  if (typeof id !== 'string' || !id || id.length > 64) return null;
  const pos = sanitizePos(raw);
  return pos ? { id, x: pos.x, y: pos.y } : null;
}

export class LiveMoves {
  private elements = new Map<string, LiveElement>();
  private doc = new Map<string, Point>();
  private own: { cardId: string; at: Point } | null = null;
  private peers = new Map<number, PeerMove>();
  private seq = 0;

  register(cardId: string, el: LiveElement): void {
    this.elements.set(cardId, el);
    this.paint(cardId);
  }

  unregister(cardId: string): void {
    this.elements.delete(cardId);
    this.doc.delete(cardId);
  }

  setDocPos(cardId: string, at: Point): void {
    this.doc.set(cardId, at);
    this.paint(cardId);
  }

  setOwn(cardId: string, at: Point): void {
    this.own = { cardId, at };
    this.paint(cardId);
  }

  clearOwn(): void {
    const cardId = this.own?.cardId;
    this.own = null;
    if (cardId) this.paint(cardId);
  }

  setPeer(clientId: number, frame: DragFrame, now: number): void {
    const before = this.peers.get(clientId)?.cardId;
    const unchanged = this.peers.get(clientId);
    const moved = !unchanged || unchanged.at.x !== frame.x || unchanged.at.y !== frame.y || before !== frame.id;
    this.peers.set(clientId, {
      cardId: frame.id,
      at: { x: frame.x, y: frame.y },
      // A heartbeat keeps the peer alive but doesn't make them the latest mover.
      seq: moved ? ++this.seq : unchanged!.seq,
      lastFrame: now
    });
    if (before && before !== frame.id) this.paint(before);
    this.paint(frame.id);
  }

  clearPeer(clientId: number): void {
    const cardId = this.peers.get(clientId)?.cardId;
    if (!this.peers.delete(clientId)) return;
    if (cardId) this.paint(cardId);
  }

  // Drops peers whose frames have stopped.
  sweep(now: number): void {
    for (const [clientId, move] of this.peers) {
      if (now - move.lastFrame > PEER_DRAG_TIMEOUT_MS) this.clearPeer(clientId);
    }
  }

  // What's on screen for a card, or null if nothing is known about it.
  shownAt(cardId: string): Point | null {
    if (this.own?.cardId === cardId) return this.own.at;
    let latest: PeerMove | null = null;
    for (const move of this.peers.values()) {
      if (move.cardId === cardId && (!latest || move.seq > latest.seq)) latest = move;
    }
    return latest?.at ?? this.doc.get(cardId) ?? null;
  }

  isLive(cardId: string): boolean {
    if (this.own?.cardId === cardId) return true;
    for (const move of this.peers.values()) if (move.cardId === cardId) return true;
    return false;
  }

  private paint(cardId: string): void {
    const el = this.elements.get(cardId);
    const at = this.shownAt(cardId);
    if (!el || !at) return;
    el.style.transform = `translate(${at.x}px, ${at.y}px)`;
    el.toggleAttribute('data-live', this.isLive(cardId));
  }
}
