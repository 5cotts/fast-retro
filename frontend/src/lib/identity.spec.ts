import { describe, expect, it } from 'vitest';
import { isSamePerson } from './identity';

describe('isSamePerson', () => {
  it('matches the same name and color', () => {
    expect(isSamePerson({ name: 'Scott', color: '#ef4444' }, { name: 'Scott', color: '#ef4444' })).toBe(true);
  });

  it('ignores case and surrounding spaces in the name', () => {
    expect(isSamePerson({ name: ' scott ', color: '#ef4444' }, { name: 'Scott', color: '#ef4444' })).toBe(true);
  });

  it("doesn't match the same name with a different color", () => {
    expect(isSamePerson({ name: 'Scott', color: '#ef4444' }, { name: 'Scott', color: '#3b82f6' })).toBe(false);
  });

  it("doesn't match a different name with the same color", () => {
    expect(isSamePerson({ name: 'Scott', color: '#ef4444' }, { name: 'Ana', color: '#ef4444' })).toBe(false);
  });
});
