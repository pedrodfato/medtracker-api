process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyAdherence, historyUntil, todayAdherence, type Schedule } from './treatmentSummary.js';

const at = (iso: string) => new Date(iso);
const doses = (...isos: string[]) => isos.map((iso) => ({ takenAt: at(iso) }));

function sched(startIso: string, overrides: Partial<Schedule> = {}): Schedule {
  return {
    scheduleType: 'fixed',
    fixedTime: '08:00',
    intervalHours: null,
    daysOfWeek: null,
    startDate: at(startIso),
    ...overrides,
  };
}

test('dailyAdherence: fixed, um item por dia, dose extra limitada', () => {
  const m = sched('2026-11-02T07:00:00-03:00');
  const days = dailyAdherence(
    m,
    doses('2026-11-02T08:05:00-03:00', '2026-11-04T08:10:00-03:00', '2026-11-04T20:00:00-03:00'),
    m.startDate,
    at('2026-11-04T23:59:59.999-03:00'),
  );
  assert.deepEqual(days, [
    { date: '2026-11-02', expected: 1, taken: 1 },
    { date: '2026-11-03', expected: 1, taken: 0 },
    { date: '2026-11-04', expected: 1, taken: 1 },
  ]);
});

test('dailyAdherence: weekly, dia de folga tem expected 0 e conta dose tomada', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { scheduleType: 'weekly', daysOfWeek: [1, 3] });
  const days = dailyAdherence(
    m,
    doses('2026-11-02T08:00:00-03:00', '2026-11-03T09:00:00-03:00'),
    m.startDate,
    at('2026-11-04T23:59:59.999-03:00'),
  );
  assert.deepEqual(days, [
    { date: '2026-11-02', expected: 1, taken: 1 },
    { date: '2026-11-03', expected: 0, taken: 1 },
    { date: '2026-11-04', expected: 1, taken: 0 },
  ]);
});

test('dailyAdherence: interval agrupa horários por dia', () => {
  const m = sched('2026-11-02T08:00:00-03:00', { scheduleType: 'interval', fixedTime: null, intervalHours: 8 });
  const days = dailyAdherence(
    m,
    doses('2026-11-02T08:05:00-03:00', '2026-11-02T16:10:00-03:00'),
    m.startDate,
    at('2026-11-03T23:59:59.999-03:00'),
  );
  assert.deepEqual(days, [
    { date: '2026-11-02', expected: 2, taken: 2 },
    { date: '2026-11-03', expected: 3, taken: 0 },
  ]);
});

test('dailyAdherence: until corta o período e doses depois dele são ignoradas', () => {
  const m = sched('2026-11-02T07:00:00-03:00');
  const days = dailyAdherence(m, doses('2026-11-04T08:00:00-03:00'), m.startDate, at('2026-11-03T12:00:00-03:00'));
  assert.deepEqual(days, [
    { date: '2026-11-02', expected: 1, taken: 0 },
    { date: '2026-11-03', expected: 1, taken: 0 },
  ]);
});

test('dailyAdherence: janela no meio do tratamento mantém a grade do interval ancorada no início', () => {
  // Grade a partir de 02/11 10h: 10h e 18h no dia 02; 02h, 10h e 18h no dia 03.
  const m = sched('2026-11-02T10:00:00-03:00', { scheduleType: 'interval', fixedTime: null, intervalHours: 8 });
  const days = dailyAdherence(m, [], at('2026-11-03T00:00:00-03:00'), at('2026-11-03T23:59:59.999-03:00'));
  assert.deepEqual(days, [{ date: '2026-11-03', expected: 3, taken: 0 }]);
});

test('dailyAdherence: until antes do início devolve lista vazia', () => {
  const m = sched('2026-11-03T07:00:00-03:00');
  assert.deepEqual(dailyAdherence(m, [], m.startDate, at('2026-11-02T12:00:00-03:00')), []);
});

test('todayAdherence: dose de mais tarde conta como prevista e não tomada', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { fixedTime: '20:00' });
  assert.deepEqual(todayAdherence(m, [], at('2026-11-03T12:00:00-03:00'), null), { expected: 1, taken: 0 });
});

test('todayAdherence: dose de hoje tomada', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { fixedTime: '20:00' });
  assert.deepEqual(
    todayAdherence(m, doses('2026-11-03T20:05:00-03:00'), at('2026-11-03T21:00:00-03:00'), null),
    { expected: 1, taken: 1 },
  );
});

test('todayAdherence: tratamento que terminou antes de hoje', () => {
  const m = sched('2026-11-01T07:00:00-03:00');
  assert.deepEqual(
    todayAdherence(m, [], at('2026-11-03T12:00:00-03:00'), at('2026-11-02T23:59:59.999-03:00')),
    { expected: 0, taken: 0 },
  );
});

test('todayAdherence: cadastrado hoje depois do horário não tem dose hoje', () => {
  const m = sched('2026-11-03T09:00:00-03:00');
  assert.deepEqual(todayAdherence(m, [], at('2026-11-03T12:00:00-03:00'), null), { expected: 0, taken: 0 });
});

test('todayAdherence: weekly em dia de folga', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { scheduleType: 'weekly', daysOfWeek: [1] });
  assert.deepEqual(todayAdherence(m, [], at('2026-11-03T12:00:00-03:00'), null), { expected: 0, taken: 0 });
});

test('historyUntil: vai até o fim de hoje, como a faixa Hoje', () => {
  assert.equal(
    historyUntil(at('2026-11-03T12:00:00-03:00'), null).toISOString(),
    at('2026-11-03T23:59:59.999-03:00').toISOString(),
  );
});

test('historyUntil: para no fim do tratamento se ele terminou antes', () => {
  const end = at('2026-11-02T23:59:59.999-03:00');
  assert.equal(historyUntil(at('2026-11-03T12:00:00-03:00'), end).toISOString(), end.toISOString());
});

test('dailyAdherence com historyUntil: dose de mais tarde hoje conta como prevista', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { fixedTime: '20:00' });
  const now = at('2026-11-03T12:00:00-03:00');
  const days = dailyAdherence(m, doses('2026-11-03T10:00:00-03:00'), m.startDate, historyUntil(now, null));
  assert.deepEqual(days.at(-1), { date: '2026-11-03', expected: 1, taken: 1 });
});
