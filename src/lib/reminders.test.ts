process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDueReminders, normalizeLeadMinutes, type ReminderCandidate } from './reminders.js';

function candidate(overrides: {
  medication?: Partial<ReminderCandidate['medication']>;
  user?: Partial<ReminderCandidate['user']>;
  lastDoseTakenAt?: Date | null;
} = {}): ReminderCandidate {
  return {
    medication: {
      id: 1,
      name: 'Losartana',
      dosage: '50mg',
      scheduleType: 'fixed',
      fixedTime: '14:00',
      intervalHours: null,
      daysOfWeek: null,
      startDate: new Date('2026-11-01T08:00:00-03:00'),
      endDate: null,
      ...overrides.medication,
    },
    lastDoseTakenAt: overrides.lastDoseTakenAt ?? null,
    user: {
      id: 'u1',
      email: 'pessoa@example.com',
      name: 'Pessoa',
      timezone: 'America/Sao_Paulo',
      reminderEnabled: true,
      reminderLeadMinutes: 10,
      ...overrides.user,
    },
  };
}

const at = (iso: string) => new Date(iso);

test('normalizeLeadMinutes: aceita valores da lista e cai para 10 fora dela', () => {
  assert.equal(normalizeLeadMinutes(0), 0);
  assert.equal(normalizeLeadMinutes(60), 60);
  assert.equal(normalizeLeadMinutes(7), 10);
  assert.equal(normalizeLeadMinutes(null), 10);
});

test('fixed: avisa dentro da antecedência', () => {
  const result = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-02T14:01:00-03:00') })],
    at('2026-11-03T13:52:00-03:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T14:00:00-03:00').toISOString());
  assert.equal(result[0]?.medicationName, 'Losartana');
  assert.equal(result[0]?.email, 'pessoa@example.com');
});

test('fixed: não avisa antes da antecedência', () => {
  const result = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-02T14:01:00-03:00') })],
    at('2026-11-03T13:45:00-03:00')
  );
  assert.equal(result.length, 0);
});

test('fixed: ainda avisa até 15 min depois do horário, e não depois disso', () => {
  const inside = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-02T14:01:00-03:00') })],
    at('2026-11-03T14:10:00-03:00')
  );
  assert.equal(inside.length, 1);

  const outside = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-02T14:01:00-03:00') })],
    at('2026-11-03T14:16:00-03:00')
  );
  assert.equal(outside.length, 0);
});

test('fixed: dose de hoje já registrada não gera lembrete', () => {
  const result = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-03T14:02:00-03:00') })],
    at('2026-11-03T14:05:00-03:00')
  );
  assert.equal(result.length, 0);
});

test('fixed: dose de ontem não registrada não impede o lembrete de hoje', () => {
  const result = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-01T14:00:00-03:00') })],
    at('2026-11-03T13:55:00-03:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T14:00:00-03:00').toISOString());
});

test('interval: horário é a última dose mais o intervalo', () => {
  const result = findDueReminders(
    [candidate({
      medication: { scheduleType: 'interval', fixedTime: null, intervalHours: 8 },
      lastDoseTakenAt: at('2026-11-03T06:00:00-03:00'),
    })],
    at('2026-11-03T13:55:00-03:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T14:00:00-03:00').toISOString());
});

test('interval: sem dose anterior, usa a data de início', () => {
  const result = findDueReminders(
    [candidate({
      medication: { scheduleType: 'interval', fixedTime: null, intervalHours: 8, startDate: at('2026-11-03T09:00:00-03:00') },
    })],
    at('2026-11-03T08:52:00-03:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T09:00:00-03:00').toISOString());
});

test('weekly: avisa só nos dias configurados', () => {
  // 2026-11-03 é terça (getDay() === 2)
  const tuesday = findDueReminders(
    [candidate({
      medication: { scheduleType: 'weekly', fixedTime: '09:00', daysOfWeek: [2, 4] },
      lastDoseTakenAt: at('2026-10-30T09:00:00-03:00'),
    })],
    at('2026-11-03T08:55:00-03:00')
  );
  assert.equal(tuesday.length, 1);

  const wednesday = findDueReminders(
    [candidate({
      medication: { scheduleType: 'weekly', fixedTime: '09:00', daysOfWeek: [2, 4] },
      lastDoseTakenAt: at('2026-11-03T09:00:00-03:00'),
    })],
    at('2026-11-04T08:55:00-03:00')
  );
  assert.equal(wednesday.length, 0);
});

test('remédio encerrado não gera lembrete', () => {
  const result = findDueReminders(
    [candidate({
      medication: { endDate: at('2026-11-02T23:59:00-03:00') },
      lastDoseTakenAt: at('2026-11-02T14:00:00-03:00'),
    })],
    at('2026-11-03T13:55:00-03:00')
  );
  assert.equal(result.length, 0);
});

test('lembrete desligado não gera lembrete', () => {
  const result = findDueReminders(
    [candidate({ user: { reminderEnabled: false }, lastDoseTakenAt: at('2026-11-02T14:00:00-03:00') })],
    at('2026-11-03T13:55:00-03:00')
  );
  assert.equal(result.length, 0);
});

test('antecedência 0: avisa só a partir do horário', () => {
  const before = findDueReminders(
    [candidate({ user: { reminderLeadMinutes: 0 }, lastDoseTakenAt: at('2026-11-02T14:00:00-03:00') })],
    at('2026-11-03T13:59:00-03:00')
  );
  assert.equal(before.length, 0);

  const onTime = findDueReminders(
    [candidate({ user: { reminderLeadMinutes: 0 }, lastDoseTakenAt: at('2026-11-02T14:00:00-03:00') })],
    at('2026-11-03T14:00:00-03:00')
  );
  assert.equal(onTime.length, 1);
});

test('antecedência 60: avisa uma hora antes', () => {
  const result = findDueReminders(
    [candidate({ user: { reminderLeadMinutes: 60 }, lastDoseTakenAt: at('2026-11-02T14:00:00-03:00') })],
    at('2026-11-03T13:00:00-03:00')
  );
  assert.equal(result.length, 1);
});

test('fuso do usuário: 14:00 em Manaus é 15:00 em Brasília', () => {
  const result = findDueReminders(
    [candidate({ user: { timezone: 'America/Manaus' }, lastDoseTakenAt: at('2026-11-02T14:00:00-04:00') })],
    at('2026-11-03T13:55:00-04:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T14:00:00-04:00').toISOString());
  assert.equal(result[0]?.timezone, 'America/Manaus');
});
