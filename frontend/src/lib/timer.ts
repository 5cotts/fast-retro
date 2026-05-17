import * as Y from 'yjs';
import type { TimerState } from './types';

export function readTimer(timer: Y.Map<unknown>): TimerState {
  const durationSec = (timer.get('durationSec') as number | undefined) ?? 0;
  const startedAt = (timer.get('startedAt') as number | null | undefined) ?? null;
  const paused = !!timer.get('paused');
  const pausedRemaining = (timer.get('pausedRemaining') as number | null | undefined) ?? null;
  return { durationSec, startedAt, paused, pausedRemaining };
}

export function setTimerDuration(timer: Y.Map<unknown>, seconds: number) {
  timer.set('durationSec', Math.max(0, Math.floor(seconds)));
  timer.set('startedAt', null);
  timer.set('paused', false);
  timer.set('pausedRemaining', null);
}

export function startTimer(timer: Y.Map<unknown>) {
  const state = readTimer(timer);
  if (state.durationSec <= 0) return;
  if (state.paused && state.pausedRemaining !== null) {
    timer.set('startedAt', Date.now());
    timer.set('durationSec', state.pausedRemaining);
    timer.set('paused', false);
    timer.set('pausedRemaining', null);
    return;
  }
  timer.set('startedAt', Date.now());
  timer.set('paused', false);
  timer.set('pausedRemaining', null);
}

export function pauseTimer(timer: Y.Map<unknown>) {
  const state = readTimer(timer);
  if (state.startedAt === null || state.paused) return;
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const remaining = Math.max(0, state.durationSec - elapsed);
  timer.set('paused', true);
  timer.set('pausedRemaining', remaining);
  timer.set('startedAt', null);
}

export function resetTimer(timer: Y.Map<unknown>) {
  timer.set('startedAt', null);
  timer.set('paused', false);
  timer.set('pausedRemaining', null);
}

export function computeTimerRemaining(state: TimerState, now: number): number {
  if (state.paused && state.pausedRemaining !== null) return state.pausedRemaining;
  if (state.startedAt === null) return state.durationSec;
  const elapsed = Math.floor((now - state.startedAt) / 1000);
  return Math.max(0, state.durationSec - elapsed);
}

export function formatMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}
