process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTakenAt } from './takenAt.js';

const now = new Date('2026-11-23T15:00:00Z');
const startDate = new Date('2026-11-01T12:00:00Z');

test('resolveTakenAt: sem horário informado usa agora', () => {
  const r = resolveTakenAt(undefined, { now, startDate, lastDoseAt: null });
  assert.deepEqual(r, { takenAt: now });
});

test('resolveTakenAt: aceita um horário anterior de hoje ou de ontem', () => {
  const earlier = new Date('2026-11-23T11:00:00Z');
  assert.deepEqual(resolveTakenAt(earlier.toISOString(), { now, startDate, lastDoseAt: null }), { takenAt: earlier });
  const yesterday = new Date('2026-11-22T09:00:00Z');
  assert.deepEqual(resolveTakenAt(yesterday.toISOString(), { now, startDate, lastDoseAt: null }), { takenAt: yesterday });
});

test('resolveTakenAt: rejeita texto que não é data', () => {
  const r = resolveTakenAt('ontem de manhã', { now, startDate, lastDoseAt: null });
  assert.equal('error' in r && r.status, 400);
});

test('resolveTakenAt: rejeita horário no futuro (tolera 1 minuto de relógio adiantado)', () => {
  const future = new Date(now.getTime() + 5 * 60_000).toISOString();
  const r = resolveTakenAt(future, { now, startDate, lastDoseAt: null });
  assert.equal('error' in r && r.status, 400);
  const skew = new Date(now.getTime() + 30_000);
  assert.deepEqual(resolveTakenAt(skew.toISOString(), { now, startDate, lastDoseAt: null }), { takenAt: skew });
});

test('resolveTakenAt: rejeita mais de 48h atrás', () => {
  const old = new Date(now.getTime() - 49 * 3600_000).toISOString();
  const r = resolveTakenAt(old, { now, startDate, lastDoseAt: null });
  assert.equal('error' in r && r.status, 400);
});

test('resolveTakenAt: rejeita antes do início do tratamento', () => {
  const r = resolveTakenAt('2026-11-22T09:00:00Z', { now, startDate: new Date('2026-11-23T00:00:00Z'), lastDoseAt: null });
  assert.equal('error' in r && r.status, 400);
});

test('resolveTakenAt: rejeita horário igual ou antes da última dose registrada', () => {
  const lastDoseAt = new Date('2026-11-23T10:00:00Z');
  const before = resolveTakenAt('2026-11-23T09:00:00Z', { now, startDate, lastDoseAt });
  assert.equal('error' in before && before.status, 409);
  const same = resolveTakenAt(lastDoseAt.toISOString(), { now, startDate, lastDoseAt });
  assert.equal('error' in same && same.status, 409);
});
