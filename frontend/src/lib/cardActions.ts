// Every write a card can make, in one object. Board.svelte builds it and hands
// it to whichever surface is drawing the board, so a new card feature is added
// here and in Card.svelte, not threaded through each surface's props.
export interface CardActions {
  add: (column: string, text: string) => void;
  edit: (column: string, cardId: string, text: string) => void;
  remove: (column: string, cardId: string) => void;
  toggleVote: (column: string, cardId: string) => void;
  toggleReaction: (column: string, cardId: string, emoji: string) => void;
  addComment: (column: string, cardId: string, text: string) => void;
  deleteComment: (column: string, cardId: string, commentId: string) => void;
  // What this person is typing into: a card ID, `new-<column>`, or nothing.
  setTyping: (target: string | null) => void;
}
