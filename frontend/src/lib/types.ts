export type ColumnKey = 'wentWell' | 'toImprove' | 'actions';

export const COLUMNS: { key: ColumnKey; title: string; accent: string; dot: string }[] = [
  {
    key: 'wentWell',
    title: 'What went well',
    accent: 'border-emerald-300/60 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-700/50',
    dot: 'bg-emerald-400 dark:bg-emerald-500'
  },
  {
    key: 'toImprove',
    title: 'What to improve',
    accent: 'border-amber-300/60 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-700/50',
    dot: 'bg-amber-400 dark:bg-amber-500'
  },
  {
    key: 'actions',
    title: 'Action items',
    accent: 'border-sky-300/60 bg-sky-50/70 dark:bg-sky-950/30 dark:border-sky-700/50',
    dot: 'bg-sky-400 dark:bg-sky-500'
  }
];

export const COLUMN_EMPTY_HINT: Record<ColumnKey, string> = {
  wentWell: 'Nothing here yet — what worked this sprint?',
  toImprove: 'Nothing here yet — what could be smoother?',
  actions: 'Nothing here yet — what should we tackle next?'
};

export const COLUMN_PLACEHOLDER: Record<ColumnKey, string> = {
  wentWell: 'Add a card…',
  toImprove: 'Add a card…',
  actions: 'Add a card…'
};

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
