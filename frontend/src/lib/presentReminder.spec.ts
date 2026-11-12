import { describe, expect, it } from 'vitest';
import { shouldRemind, someoneElseHere, type ReminderInputs } from './presentReminder';
import type { PresenceUser } from './types';

const base: ReminderInputs = {
  isLead: true,
  ended: false,
  presenting: false,
  narrow: false,
  othersHere: true,
  dismissedHere: false,
  remindersOff: false
};

describe('shouldRemind', () => {
  it('reminds a host on a live board once someone else is here', () => {
    expect(shouldRemind(base)).toBe(true);
  });

  it('waits for someone else to arrive', () => {
    expect(shouldRemind({ ...base, othersHere: false })).toBe(false);
  });

  it.each([
    ['participants', { isLead: false }],
    ['ended boards', { ended: true }],
    ['a tab that is already presenting', { presenting: true }],
    ['narrow screens', { narrow: true }],
    ['a board where it was dismissed or presented on', { dismissedHere: true }],
    ['a browser with reminders turned off', { remindersOff: true }]
  ] as const)('never shows for %s', (_label, patch) => {
    expect(shouldRemind({ ...base, ...patch })).toBe(false);
  });
});

function user(clientId: number, name: string, color: string): PresenceUser {
  return { clientId, name, color, isLead: false };
}

describe('someoneElseHere', () => {
  const host = user(1, 'Scott', '#ef4444');

  it('is false when the host is alone', () => {
    expect(someoneElseHere([host], 1)).toBe(false);
  });

  it("doesn't count the host's own other window", () => {
    expect(someoneElseHere([host, user(2, 'Scott', '#ef4444')], 1)).toBe(false);
  });

  it('counts a different person', () => {
    expect(someoneElseHere([host, user(2, 'Ana', '#3b82f6')], 1)).toBe(true);
  });

  it('counts someone with the same name but a different color', () => {
    expect(someoneElseHere([host, user(2, 'Scott', '#3b82f6')], 1)).toBe(true);
  });

  it('is false before this client shows up in presence', () => {
    expect(someoneElseHere([user(2, 'Ana', '#3b82f6')], 1)).toBe(false);
  });
});
