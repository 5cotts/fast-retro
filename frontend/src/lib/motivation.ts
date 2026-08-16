// Short, upbeat lines shown when a retro wraps up. Kept generic (no
// team/company-specific references) since any team could be running this
// board. One is picked at random each time a retro ends.
const MOTIVATIONAL_MESSAGES = [
  'Great retro! See you next sprint.',
  "Nice work — that's a wrap.",
  'Solid session. Onward and upward!',
  'Retro complete. Go build something great.',
  "You showed up, spoke up, and leveled up. Well done.",
  'Another sprint, another step forward.',
  'Reflection done — now go make it count.',
  "That's how it's done. Great retro, team.",
  'Ideas captured, action items set. Nice work!',
  'Progress over perfection — great session.',
  'Small steps, big wins. See you next time.',
  'Retro closed. Momentum: unlocked.',
  'You made time to get better. That matters.',
  'Wrapped up and ready to build.'
];

export function pickMotivationalMessage(): string {
  const i = Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length);
  return MOTIVATIONAL_MESSAGES[i];
}
