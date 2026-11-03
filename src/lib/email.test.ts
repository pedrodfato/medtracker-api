import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderEmail } from './email.js';
import type { DueReminder } from './reminders.js';

const reminder: DueReminder = {
  medicationId: 1,
  userId: 'u1',
  email: 'pessoa@example.com',
  userName: 'Pessoa',
  medicationName: 'Losartana',
  dosage: '50mg',
  scheduledFor: new Date('2026-11-03T14:00:00-03:00'),
  timezone: 'America/Sao_Paulo',
};

test('assunto traz o remédio e o horário no fuso do usuário', () => {
  const email = buildReminderEmail(reminder, 'https://app.example.com');
  assert.equal(email.subject, 'Hora do seu remédio: Losartana às 14:00');
});

test('horário respeita o fuso do usuário', () => {
  const email = buildReminderEmail({ ...reminder, timezone: 'America/Manaus' }, 'https://app.example.com');
  assert.equal(email.subject, 'Hora do seu remédio: Losartana às 13:00');
});

test('corpo traz nome, dosagem e link do app', () => {
  const email = buildReminderEmail(reminder, 'https://app.example.com');
  for (const body of [email.html, email.text]) {
    assert.match(body, /Pessoa/);
    assert.match(body, /Losartana/);
    assert.match(body, /50mg/);
    assert.match(body, /https:\/\/app\.example\.com/);
  }
});

test('html escapa texto vindo do usuário', () => {
  const email = buildReminderEmail({ ...reminder, medicationName: '<b>X</b>' }, 'https://app.example.com');
  assert.doesNotMatch(email.html, /<b>X<\/b>/);
  assert.match(email.html, /&lt;b&gt;X&lt;\/b&gt;/);
});
