export interface CommentData {
  id: string;
  text: string;
  authorId: string;
  createdAt: number;
}

// Where a card sits on a canvas board, in world coordinates. See canvas.ts.
export interface CardPos {
  x: number;
  y: number;
  z: number;
}

export interface CardData {
  id: string;
  text: string;
  authorId: string;
  votes: string[];
  reactions: Record<string, string[]>;
  comments: CommentData[];
  // The group this card belongs to (see clusters.ts). Absent means none.
  clusterId?: string;
  // Canvas boards only. Absent means it's still in its starting grid slot.
  pos?: CardPos;
}

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
  isLead: boolean;
  typing?: string | null;
  // In a tab that's presenting (viewer.ts). Shown as a screen icon, and a
  // host's presenting window folds into their own tab (foldPresenting).
  presenting?: boolean;
}

export interface TimerState {
  durationSec: number;
  startedAt: number | null;
  paused: boolean;
  pausedRemaining: number | null;
}
