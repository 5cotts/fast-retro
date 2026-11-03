export interface CommentData {
  id: string;
  text: string;
  authorId: string;
  createdAt: number;
}

export interface CardData {
  id: string;
  text: string;
  authorId: string;
  votes: string[];
  reactions: Record<string, string[]>;
  comments: CommentData[];
}

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
  isLead: boolean;
  typing?: string | null;
}

export interface TimerState {
  durationSec: number;
  startedAt: number | null;
  paused: boolean;
  pausedRemaining: number | null;
}
