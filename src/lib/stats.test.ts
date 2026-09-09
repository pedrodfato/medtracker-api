import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from './stats.js';

test('dosesTaken counts all doses regardless of date', () => {
  const now = new Date('2026-09-09T12:00:00');
  const doses = [
    { medicationId: 1, takenAt: new Date('2026-09-01T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-08T08:00:00') },
  ];
  const stats = computeStats([], doses, now);
  assert.equal(stats.dosesTaken, 2);
});

test('currentStreak counts consecutive days up to today with at least one dose', () => {
  const now = new Date('2026-09-09T12:00:00');
  const doses = [
    { medicationId: 1, takenAt: new Date('2026-09-09T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-08T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-07T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-05T08:00:00') }, // gap on the 6th breaks the streak
  ];
  const stats = computeStats([], doses, now);
  assert.equal(stats.currentStreak, 3);
});

test('currentStreak is 0 when no dose was taken today or yesterday', () => {
  const now = new Date('2026-09-09T12:00:00');
  const doses = [{ medicationId: 1, takenAt: new Date('2026-09-01T08:00:00') }];
  const stats = computeStats([], doses, now);
  assert.equal(stats.currentStreak, 0);
});

test('weeklyAdherenceRate and missedDoses for a fixed-schedule medication with one miss', () => {
  // 2026-09-09 is Wednesday. Window is the 7 days ending today: 2026-09-03..2026-09-09 (7 expected doses for a daily fixed schedule).
  const now = new Date('2026-09-09T20:00:00');
  const medications = [{ id: 1, scheduleType: 'fixed' as const, intervalHours: null, daysOfWeek: null }];
  const doses = [
    { medicationId: 1, takenAt: new Date('2026-09-03T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-04T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-05T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-06T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-07T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-08T08:00:00') },
    // 2026-09-09 not taken yet -> 1 missed out of 7 expected
  ];
  const stats = computeStats(medications, doses, now);
  assert.equal(stats.missedDoses, 1);
  assert.equal(stats.weeklyAdherenceRate, 86); // round(6/7 * 100)
});

test('weekly adherence with zero expected doses reports 100% and 0 missed', () => {
  const now = new Date('2026-09-09T20:00:00');
  const stats = computeStats([], [], now);
  assert.equal(stats.weeklyAdherenceRate, 100);
  assert.equal(stats.missedDoses, 0);
});
