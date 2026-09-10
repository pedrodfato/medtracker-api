import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetDiffMinutes, toProcessZone, fromProcessZone, DEFAULT_TIMEZONE } from './timezone.js';

test('offsetDiffMinutes is 0 for the process timezone itself (America/Sao_Paulo)', () => {
  assert.equal(offsetDiffMinutes('America/Sao_Paulo'), 0);
});

test('offsetDiffMinutes is 0 for the default timezone', () => {
  assert.equal(offsetDiffMinutes(DEFAULT_TIMEZONE), 0);
});

test('offsetDiffMinutes: Manaus is 1 hour behind Sao Paulo', () => {
  assert.equal(offsetDiffMinutes('America/Manaus'), -60);
});

test('offsetDiffMinutes: Rio Branco (Acre) is 2 hours behind Sao Paulo', () => {
  assert.equal(offsetDiffMinutes('America/Rio_Branco'), -120);
});

test('offsetDiffMinutes: Noronha is 1 hour ahead of Sao Paulo', () => {
  assert.equal(offsetDiffMinutes('America/Noronha'), 60);
});

test('offsetDiffMinutes: unknown timezone falls back to the default (diff 0)', () => {
  assert.equal(offsetDiffMinutes('Not/A_Real_Zone'), 0);
});

test('toProcessZone shifts a date forward by the diff in minutes', () => {
  const date = new Date('2026-09-10T12:00:00.000Z');
  const shifted = toProcessZone(date, -60);
  assert.equal(shifted.toISOString(), '2026-09-10T11:00:00.000Z');
});

test('fromProcessZone shifts a date backward by the diff in minutes', () => {
  const date = new Date('2026-09-10T11:00:00.000Z');
  const shifted = fromProcessZone(date, -60);
  assert.equal(shifted.toISOString(), '2026-09-10T12:00:00.000Z');
});

test('toProcessZone and fromProcessZone are exact inverses', () => {
  const date = new Date('2026-09-10T15:30:00.000Z');
  const diff = -120;
  const roundTripped = fromProcessZone(toProcessZone(date, diff), diff);
  assert.equal(roundTripped.toISOString(), date.toISOString());
});
