import * as Y from 'yjs';
import type { CardData, CommentData } from './types';

// The one place that knows how a card is laid out in the Yjs doc. Every
// reader and writer goes through here, so adding a card field means editing
// this file only.

export function commentFromY(c: Y.Map<unknown>): CommentData | null {
  const id = c.get('id');
  const text = c.get('text');
  const createdAt = c.get('createdAt');
  if (typeof id !== 'string' || typeof text !== 'string' || typeof createdAt !== 'number') return null;
  const authorId = c.get('authorId');
  return { id, text, authorId: typeof authorId === 'string' ? authorId : '', createdAt };
}

export function cardFromY(card: Y.Map<unknown>): CardData | null {
  const id = card.get('id');
  const text = card.get('text');
  if (typeof id !== 'string' || typeof text !== 'string') return null;
  const authorId = card.get('authorId');
  const votesArr = card.get('votes') as Y.Array<string> | undefined;
  const reactionsMap = card.get('reactions') as Y.Map<Y.Array<string>> | undefined;
  const reactions: Record<string, string[]> = {};
  reactionsMap?.forEach((users, emoji) => {
    reactions[emoji] = users.toArray();
  });
  const commentsArr = card.get('comments') as Y.Array<Y.Map<unknown>> | undefined;
  const comments: CommentData[] = [];
  commentsArr?.forEach((c) => {
    const parsed = commentFromY(c);
    if (parsed) comments.push(parsed);
  });
  const clusterId = card.get('clusterId');
  return {
    id,
    text,
    authorId: typeof authorId === 'string' ? authorId : '',
    votes: votesArr ? votesArr.toArray() : [],
    reactions,
    comments,
    ...(typeof clusterId === 'string' && clusterId ? { clusterId } : {})
  };
}

export function commentToY(c: CommentData): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', c.id);
  m.set('text', c.text);
  m.set('authorId', c.authorId);
  m.set('createdAt', c.createdAt);
  return m;
}

export function cardToY(card: CardData): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', card.id);
  m.set('text', card.text);
  m.set('authorId', card.authorId);
  const votes = new Y.Array<string>();
  if (card.votes.length) votes.push(card.votes);
  m.set('votes', votes);
  const reactions = new Y.Map<Y.Array<string>>();
  for (const [emoji, users] of Object.entries(card.reactions)) {
    const ya = new Y.Array<string>();
    if (users.length) ya.push(users);
    reactions.set(emoji, ya);
  }
  m.set('reactions', reactions);
  const comments = new Y.Array<Y.Map<unknown>>();
  if (card.comments.length) comments.push(card.comments.map(commentToY));
  m.set('comments', comments);
  if (card.clusterId) m.set('clusterId', card.clusterId);
  return m;
}
