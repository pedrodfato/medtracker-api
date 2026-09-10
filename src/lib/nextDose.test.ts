import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextDoseAt, computeNextAllowedDoseAt } from './nextDose.js';

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

// computeNextAllowedDoseAt: projects the next due slot from the LAST DOSE,
// not from "now" - this is what a "can I log another dose yet?" gate needs.
// computeNextDoseAt alone can't answer this for fixed/weekly, since those
// branches always project forward from "now" and therefore always return a
// future time, even right after a dose was just logged.

test('computeNextAllowedDoseAt: fixed daily schedule allows the next day, not never again', () => {
  // Monday 2026-09-07, dose taken at 08:05 (fixedTime 08:00 already passed today)
  const lastDose = new Date('2026-09-07T08:05:00');
  const result = computeNextAllowedDoseAt(
    { scheduleType: 'fixed', fixedTime: '08:00', intervalHours: null, daysOfWeek: null, startDate: new Date('2026-09-01') },
    lastDose
  );
  assert.equal(result?.toISOString(), new Date('2026-09-08T08:00:00').toISOString());
});

test('computeNextAllowedDoseAt: weekly schedule allows the next scheduled day after the last dose', () => {
  // Monday 2026-09-07 (day 1) is scheduled; dose taken at 20:05 (fixedTime 20:00 already passed)
  const lastDose = new Date('2026-09-07T20:05:00');
  const result = computeNextAllowedDoseAt(
    { scheduleType: 'weekly', fixedTime: '20:00', intervalHours: null, daysOfWeek: [1, 3, 5], startDate: new Date('2026-09-01') },
    lastDose
  );
  // Next scheduled day after Monday is Wednesday 2026-09-09
  assert.equal(result?.toISOString(), new Date('2026-09-09T20:00:00').toISOString());
});

test('computeNextAllowedDoseAt: interval schedule adds intervalHours to the last dose', () => {
  const lastDose = new Date('2026-09-09T06:00:00');
  const result = computeNextAllowedDoseAt(
    { scheduleType: 'interval', fixedTime: null, intervalHours: 8, daysOfWeek: null, startDate: new Date('2026-09-01') },
    lastDose
  );
  assert.equal(result?.toISOString(), new Date('2026-09-09T14:00:00').toISOString());
});
