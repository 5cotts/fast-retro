import { describe, expect, it } from 'vitest';
import { LiveMoves, PEER_DRAG_TIMEOUT_MS, parseDragFrame, type LiveElement } from './canvasLive';
import { samePresence } from './awareness';

function element() {
  const attrs = new Set<string>();
  const el: LiveElement & { attrs: Set<string> } = {
    attrs,
    style: { transform: '' },
    toggleAttribute(name, force) {
      if (force) attrs.add(name);
      else attrs.delete(name);
    }
  };
  return el;
}

function setup() {
  const live = new LiveMoves();
  const el = element();
  live.register('c', el);
  live.setDocPos('c', { x: 10, y: 20 });
  return { live, el };
}

const at = (x: number, y: number) => `translate(${x}px, ${y}px)`;

describe('LiveMoves', () => {
  it('draws the doc position when nobody is moving the card', () => {
    const { el } = setup();
    expect(el.style.transform).toBe(at(10, 20));
    expect(el.attrs.has('data-live')).toBe(false);
  });

  it('shows a peer drag live, then falls back when it ends', () => {
    const { live, el } = setup();
    live.setPeer(1, { id: 'c', x: 50, y: 60 }, 0);
    expect(el.style.transform).toBe(at(50, 60));
    expect(el.attrs.has('data-live')).toBe(true);
    live.clearPeer(1);
    expect(el.style.transform).toBe(at(10, 20));
    expect(el.attrs.has('data-live')).toBe(false);
  });

  it('drops a peer whose frames stop, so a lost connection leaves no ghost', () => {
    const { live, el } = setup();
    live.setPeer(1, { id: 'c', x: 50, y: 60 }, 1000);
    live.sweep(1000 + PEER_DRAG_TIMEOUT_MS);
    expect(el.style.transform).toBe(at(50, 60));
    live.sweep(1000 + PEER_DRAG_TIMEOUT_MS + 1);
    expect(el.style.transform).toBe(at(10, 20));
  });

  it('a heartbeat keeps a still peer alive', () => {
    const { live, el } = setup();
    live.setPeer(1, { id: 'c', x: 50, y: 60 }, 0);
    live.setPeer(1, { id: 'c', x: 50, y: 60 }, PEER_DRAG_TIMEOUT_MS);
    live.sweep(PEER_DRAG_TIMEOUT_MS + 1);
    expect(el.style.transform).toBe(at(50, 60));
  });

  it("doesn't let a drop arriving during your drag move the card until you let go", () => {
    const { live, el } = setup();
    live.setOwn('c', { x: 100, y: 100 });
    live.setDocPos('c', { x: 999, y: 999 });
    live.setPeer(1, { id: 'c', x: 500, y: 500 }, 0);
    expect(el.style.transform).toBe(at(100, 100));
    live.clearPeer(1);
    live.clearOwn();
    expect(el.style.transform).toBe(at(999, 999));
  });

  it('shows the latest of two peers moving one card, and a heartbeat does not take over', () => {
    const { live, el } = setup();
    live.setPeer(1, { id: 'c', x: 1, y: 1 }, 0);
    live.setPeer(2, { id: 'c', x: 2, y: 2 }, 0);
    expect(el.style.transform).toBe(at(2, 2));
    live.setPeer(1, { id: 'c', x: 1, y: 1 }, 10);
    expect(el.style.transform).toBe(at(2, 2));
    live.setPeer(1, { id: 'c', x: 3, y: 3 }, 20);
    expect(el.style.transform).toBe(at(3, 3));
  });

  it('puts the old card back when a peer switches to another card', () => {
    const { live, el } = setup();
    const other = element();
    live.register('d', other);
    live.setDocPos('d', { x: 7, y: 7 });
    live.setPeer(1, { id: 'c', x: 50, y: 60 }, 0);
    live.setPeer(1, { id: 'd', x: 70, y: 80 }, 10);
    expect(el.style.transform).toBe(at(10, 20));
    expect(other.style.transform).toBe(at(70, 80));
  });

  it('ignores frames for a card it has no element for', () => {
    const { live } = setup();
    expect(() => live.setPeer(1, { id: 'gone', x: 1, y: 1 }, 0)).not.toThrow();
    live.unregister('c');
    expect(() => live.setDocPos('gone', { x: 1, y: 1 })).not.toThrow();
  });
});

describe('parseDragFrame', () => {
  it('reads a frame and clamps it to the world', () => {
    expect(parseDragFrame({ id: 'c', x: 1, y: 2 })).toEqual({ id: 'c', x: 1, y: 2 });
    expect(parseDragFrame({ id: 'c', x: 1e9, y: 2 })?.x).toBe(20_000);
  });

  it('rejects anything else', () => {
    for (const raw of [null, undefined, 'x', {}, { id: 'c' }, { id: 7, x: 1, y: 1 }, { id: '', x: 1, y: 1 }, { id: 'c', x: NaN, y: 1 }, { id: 'x'.repeat(65), x: 1, y: 1 }]) {
      expect(parseDragFrame(raw)).toBeNull();
    }
  });
});

describe('samePresence', () => {
  const user = { clientId: 1, name: 'A', color: '#000', isLead: false, typing: null };

  it('is true when nothing people can see changed', () => {
    expect(samePresence([user], [{ ...user }])).toBe(true);
    expect(samePresence([user], [{ ...user, typing: undefined }])).toBe(true);
  });

  it('is false when someone joins, renames or starts typing', () => {
    expect(samePresence([user], [])).toBe(false);
    expect(samePresence([user], [{ ...user, name: 'B' }])).toBe(false);
    expect(samePresence([user], [{ ...user, typing: 'c1' }])).toBe(false);
    expect(samePresence([user], [{ ...user, clientId: 2 }])).toBe(false);
  });
});
