// Curated emoji catalog for the reaction picker. Kept small on purpose:
// retros don't need a 3000-emoji picker, and a hand-picked list keeps the
// bundle small and the UI usable.

export type EmojiCategory = {
  id: string;
  label: string;
  emojis: { e: string; n: string; k?: string }[]; // emoji, name (a11y), keywords
};

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    emojis: [
      { e: '😀', n: 'grinning' },
      { e: '😄', n: 'smile' },
      { e: '😂', n: 'laugh', k: 'lol' },
      { e: '🤣', n: 'rofl' },
      { e: '😊', n: 'blush' },
      { e: '😉', n: 'wink' },
      { e: '😍', n: 'heart eyes', k: 'love' },
      { e: '🥰', n: 'smiling with hearts' },
      { e: '😎', n: 'cool' },
      { e: '🤩', n: 'star struck' },
      { e: '🤔', n: 'thinking' },
      { e: '😅', n: 'sweat smile', k: 'phew' },
      { e: '😭', n: 'sob', k: 'cry' },
      { e: '😢', n: 'sad', k: 'cry' },
      { e: '😡', n: 'angry', k: 'mad' },
      { e: '🥹', n: 'holding back tears' },
      { e: '😬', n: 'grimace', k: 'yikes' },
      { e: '🫠', n: 'melting' },
      { e: '🤯', n: 'mind blown' },
      { e: '😱', n: 'shock', k: 'scream' },
      { e: '🤗', n: 'hug' },
      { e: '🙃', n: 'upside down' },
      { e: '😴', n: 'sleep' },
      { e: '🤐', n: 'zipper mouth' },
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts',
    emojis: [
      { e: '❤️', n: 'heart', k: 'love' },
      { e: '🧡', n: 'orange heart' },
      { e: '💛', n: 'yellow heart' },
      { e: '💚', n: 'green heart' },
      { e: '💙', n: 'blue heart' },
      { e: '💜', n: 'purple heart' },
      { e: '🖤', n: 'black heart' },
      { e: '🤍', n: 'white heart' },
      { e: '💖', n: 'sparkling heart' },
      { e: '💔', n: 'broken heart' },
      { e: '❣️', n: 'heart exclamation' },
      { e: '💯', n: 'hundred' },
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    emojis: [
      { e: '👍', n: 'thumbs up', k: 'yes ok approve' },
      { e: '👎', n: 'thumbs down', k: 'no nope' },
      { e: '👏', n: 'clap' },
      { e: '🙌', n: 'raised hands' },
      { e: '🙏', n: 'pray', k: 'thanks please' },
      { e: '🤝', n: 'handshake' },
      { e: '👋', n: 'wave', k: 'hi hello' },
      { e: '🤘', n: 'rock on' },
      { e: '✌️', n: 'peace' },
      { e: '🤞', n: 'fingers crossed', k: 'luck' },
      { e: '👌', n: 'ok hand' },
      { e: '🫶', n: 'heart hands' },
      { e: '💪', n: 'flex', k: 'strong' },
      { e: '🫡', n: 'salute' },
      { e: '🤷', n: 'shrug' },
      { e: '🙋', n: 'raised hand' },
    ],
  },
  {
    id: 'celebration',
    label: 'Celebration',
    emojis: [
      { e: '🎉', n: 'party', k: 'celebrate' },
      { e: '🎊', n: 'confetti ball' },
      { e: '🥳', n: 'party face' },
      { e: '🍾', n: 'champagne' },
      { e: '🥂', n: 'cheers', k: 'toast' },
      { e: '🏆', n: 'trophy', k: 'win' },
      { e: '🥇', n: 'gold medal' },
      { e: '⭐', n: 'star' },
      { e: '🌟', n: 'sparkle star' },
      { e: '✨', n: 'sparkles' },
      { e: '🔥', n: 'fire', k: 'hot lit' },
      { e: '💥', n: 'boom' },
      { e: '🚀', n: 'rocket', k: 'ship launch' },
      { e: '🎯', n: 'bullseye', k: 'target' },
      { e: '💡', n: 'idea', k: 'bulb' },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    emojis: [
      { e: '✅', n: 'check', k: 'done yes' },
      { e: '❌', n: 'cross', k: 'no fail' },
      { e: '⚠️', n: 'warning' },
      { e: '🚨', n: 'alarm', k: 'urgent' },
      { e: '👀', n: 'eyes', k: 'look watching' },
      { e: '🧠', n: 'brain' },
      { e: '🐛', n: 'bug' },
      { e: '🛠️', n: 'tools', k: 'fix' },
      { e: '📈', n: 'chart up', k: 'growth' },
      { e: '📉', n: 'chart down' },
      { e: '⏰', n: 'alarm clock', k: 'time' },
      { e: '☕', n: 'coffee' },
      { e: '🍕', n: 'pizza' },
      { e: '🍰', n: 'cake' },
      { e: '🐢', n: 'turtle', k: 'slow' },
      { e: '🐇', n: 'rabbit', k: 'fast' },
      { e: '🦄', n: 'unicorn' },
      { e: '🌈', n: 'rainbow' },
      { e: '☀️', n: 'sun' },
      { e: '🌧️', n: 'rain' },
    ],
  },
];

// Flat lookup for accessibility labels on existing reactions.
export const EMOJI_NAME: Record<string, string> = Object.fromEntries(
  EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((it) => [it.e, it.n] as const))
);

export function emojiName(e: string): string {
  return EMOJI_NAME[e] ?? e;
}

export type FlatEmoji = { e: string; n: string; k?: string; cat: string };

export const ALL_EMOJIS: FlatEmoji[] = EMOJI_CATEGORIES.flatMap((c) =>
  c.emojis.map((it) => ({ ...it, cat: c.id }))
);

export function searchEmojis(query: string): FlatEmoji[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_EMOJIS.filter(
    (it) => it.n.toLowerCase().includes(q) || (it.k ?? '').toLowerCase().includes(q)
  );
}
