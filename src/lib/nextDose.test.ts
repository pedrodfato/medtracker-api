import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextDoseAt } from './nextDose.js';

test('fixed schedule: returns today at fixedTime if not yet passed', () => {
  const now = new Date('2026-09-09T10:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'fixed', fixedTime: '14:00', intervalHours: null, daysOfWeek: null, startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-09T14:00:00').toISOString());
});

test('fixed schedule: rolls to tomorrow if fixedTime already passed today', () => {
  const now = new Date('2026-09-09T20:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'fixed', fixedTime: '14:00', intervalHours: null, daysOfWeek: null, startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-10T14:00:00').toISOString());
});

test('interval schedule: adds intervalHours to the last dose', () => {
  const now = new Date('2026-09-09T10:00:00');
  const lastDose = new Date('2026-09-09T06:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'interval', fixedTime: null, intervalHours: 8, daysOfWeek: null, startDate: new Date('2026-09-01') },
    lastDose,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-09T14:00:00').toISOString());
});

test('interval schedule: falls back to startDate if no dose taken yet', () => {
  const now = new Date('2026-09-09T10:00:00');
  const startDate = new Date('2026-09-01T09:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'interval', fixedTime: null, intervalHours: 8, daysOfWeek: null, startDate },
    null,
    now
  );
  assert.equal(result?.toISOString(), startDate.toISOString());
});

test('weekly schedule: picks today if today is a scheduled day and time has not passed', () => {
  // 2026-09-09 is a Wednesday (day 3)
  const now = new Date('2026-09-09T08:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'weekly', fixedTime: '20:00', intervalHours: null, daysOfWeek: [1, 3, 5], startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-09T20:00:00').toISOString());
});

test('weekly schedule: skips to the next scheduled day if today already passed', () => {
  // 2026-09-09 is a Wednesday (day 3); next scheduled day is Friday (5)
  const now = new Date('2026-09-09T21:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'weekly', fixedTime: '20:00', intervalHours: null, daysOfWeek: [1, 3, 5], startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-11T20:00:00').toISOString());
});

test('weekly schedule: wraps to next week if no scheduled day remains this week', () => {
  // 2026-09-09 is a Wednesday (day 3); only Monday (1) is scheduled -> next Monday is 2026-09-14
  const now = new Date('2026-09-09T21:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'weekly', fixedTime: '20:00', intervalHours: null, daysOfWeek: [1], startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-14T20:00:00').toISOString());
});
