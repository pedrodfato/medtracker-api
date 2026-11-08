process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEndDate,
  computeTreatmentSummary,
  durationDaysFromRange,
  parseDurationDays,
  type SummaryMedication,
} from './treatmentSummary.js';

const at = (iso: string) => new Date(iso);
const doses = (...isos: string[]) => isos.map((iso) => ({ takenAt: at(iso) }));

function med(startIso: string, days: number, overrides: Partial<SummaryMedication> = {}): SummaryMedication {
  const startDate = at(startIso);
  return {
    scheduleType: 'fixed',
    fixedTime: '08:00',
    intervalHours: null,
    daysOfWeek: null,
    startDate,
    endDate: computeEndDate(startDate, days, 0),
    ...overrides,
  };
}

test('parseDurationDays: aceita inteiros de 1 a 365, número ou texto', () => {
  assert.equal(parseDurationDays(10), 10);
  assert.equal(parseDurationDays('10'), 10);
  assert.equal(parseDurationDays(365), 365);
  assert.equal(parseDurationDays(0), null);
  assert.equal(parseDurationDays(-1), null);
  assert.equal(parseDurationDays(366), null);
  assert.equal(parseDurationDays(1.5), null);
  assert.equal(parseDurationDays('abc'), null);
  assert.equal(parseDurationDays(''), null);
  assert.equal(parseDurationDays(undefined), null);
  assert.equal(parseDurationDays(null), null);
});

test('computeEndDate: fim do dia N no fuso do processo', () => {
  const end = computeEndDate(at('2026-11-02T15:00:00-03:00'), 10, 0);
  assert.equal(end.toISOString(), at('2026-11-11T23:59:59.999-03:00').toISOString());
});

test('computeEndDate: respeita o fuso do usuário (Manaus, UTC-4)', () => {
  // 15:00 em São Paulo = 14:00 em Manaus; o dia 10 termina às 23:59:59.999 de Manaus.
  const end = computeEndDate(at('2026-11-02T15:00:00-03:00'), 10, -60);
  assert.equal(end.toISOString(), at('2026-11-11T23:59:59.999-04:00').toISOString());
});

test('durationDaysFromRange: inverso de computeEndDate', () => {
  const start = at('2026-11-02T15:00:00-03:00');
  assert.equal(durationDaysFromRange(start, computeEndDate(start, 10, 0), 0), 10);
  assert.equal(durationDaysFromRange(start, computeEndDate(start, 10, -60), -60), 10);
  assert.equal(durationDaysFromRange(start, computeEndDate(start, 1, 0), 0), 1);
});

test('fixed: tratamento perfeito', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 3),
    doses('2026-11-02T08:05:00-03:00', '2026-11-03T08:02:00-03:00', '2026-11-04T08:10:00-03:00'),
  );
  assert.equal(summary.expected, 3);
  assert.equal(summary.taken, 3);
  assert.equal(summary.perfect, true);
  assert.deepEqual(summary.missedDays, []);
  assert.equal(summary.readyAt.toISOString(), at('2026-11-04T08:00:00-03:00').toISOString());
});

test('fixed: cadastro depois do horário do dia não conta a dose já passada', () => {
  const summary = computeTreatmentSummary(med('2026-11-02T09:00:00-03:00', 3), []);
  assert.equal(summary.expected, 2);
  assert.deepEqual(summary.missedDays.map((d) => d.date), ['2026-11-03', '2026-11-04']);
});

test('fixed: lista o dia com dose perdida', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 3),
    doses('2026-11-02T08:05:00-03:00', '2026-11-04T08:10:00-03:00'),
  );
  assert.equal(summary.taken, 2);
  assert.equal(summary.perfect, false);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-03', missed: 1, expected: 1 }]);
});

test('fixed: dose extra no dia não compensa dia perdido', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 3),
    doses('2026-11-02T08:05:00-03:00', '2026-11-02T20:00:00-03:00', '2026-11-04T08:10:00-03:00'),
  );
  assert.equal(summary.taken, 2);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-03', missed: 1, expected: 1 }]);
});

test('doses fora do período do tratamento são ignoradas', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 3),
    doses('2026-11-02T08:05:00-03:00', '2026-11-05T08:00:00-03:00'),
  );
  assert.equal(summary.taken, 1);
});

test('interval: agrupa a grade de horários por dia', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T08:00:00-03:00', 2, { scheduleType: 'interval', fixedTime: null, intervalHours: 8 }),
    doses(
      '2026-11-02T08:05:00-03:00',
      '2026-11-02T16:10:00-03:00',
      '2026-11-03T00:10:00-03:00',
      '2026-11-03T08:05:00-03:00',
    ),
  );
  // Grade: 02/11 08h e 16h; 03/11 00h, 08h e 16h.
  assert.equal(summary.expected, 5);
  assert.equal(summary.taken, 4);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-03', missed: 1, expected: 3 }]);
  assert.equal(summary.readyAt.toISOString(), at('2026-11-03T16:00:00-03:00').toISOString());
});

test('weekly com vários dias: só conta os dias escolhidos', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 7, { scheduleType: 'weekly', daysOfWeek: [1, 3, 5] }),
    doses('2026-11-02T08:00:00-03:00', '2026-11-06T08:00:00-03:00'),
  );
  assert.equal(summary.expected, 3);
  assert.equal(summary.taken, 2);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-04', missed: 1, expected: 1 }]);
});

test('weekly com um dia só: tomar em outro dia da mesma semana conta (drift)', () => {
  // daysOfWeek atual = [quinta]; a primeira dose foi tomada na quarta, antes do ajuste.
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 14, { scheduleType: 'weekly', daysOfWeek: [4] }),
    doses('2026-11-04T08:00:00-03:00', '2026-11-12T08:00:00-03:00'),
  );
  assert.equal(summary.expected, 2);
  assert.equal(summary.taken, 2);
  assert.equal(summary.perfect, true);
});

test('weekly com um dia só: semana sem dose aparece como perdida', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 14, { scheduleType: 'weekly', daysOfWeek: [4] }),
    doses('2026-11-04T08:00:00-03:00'),
  );
  assert.equal(summary.taken, 1);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-12', missed: 1, expected: 1 }]);
});

test('sem nenhuma dose prevista: perfeito e pronto no fim do período', () => {
  const m = med('2026-11-02T07:00:00-03:00', 3, { scheduleType: 'weekly', daysOfWeek: [] });
  const summary = computeTreatmentSummary(m, []);
  assert.equal(summary.expected, 0);
  assert.equal(summary.perfect, true);
  assert.equal(summary.readyAt.getTime(), m.endDate.getTime());
});
