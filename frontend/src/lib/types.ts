export type ColumnKey = 'wentWell' | 'toImprove' | 'actions';

export const COLUMNS: { key: ColumnKey; title: string; accent: string }[] = [
  { key: 'wentWell', title: 'Went Well', accent: 'border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-700/40' },
  { key: 'toImprove', title: 'To Improve', accent: 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700/40' },
  { key: 'actions', title: 'Action Items', accent: 'border-sky-400/60 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-700/40' }
];

export const REACTION_EMOJI = ['👍', '❤️', '🎉', '😂', '😢', '🤔'] as const;
export type ReactionEmoji = typeof REACTION_EMOJI[number];

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
