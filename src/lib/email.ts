import { Resend } from 'resend';
import type { DueReminder } from './reminders.js';

const FROM = 'MedTracker <lembretes@clov.com.br>';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(date);
}

export function buildReminderEmail(reminder: DueReminder, appUrl: string) {
  const time = formatTime(reminder.scheduledFor, reminder.timezone);
  const subject = `Hora do seu remédio: ${reminder.medicationName} às ${time}`;

  const text = [
    `Olá, ${reminder.userName}!`,
    '',
    `Às ${time} é hora de tomar ${reminder.medicationName} (${reminder.dosage}).`,
    '',
    `Depois de tomar, marque a dose no MedTracker: ${appUrl}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f2f3f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;">Olá, ${escapeHtml(reminder.userName)}!</p>
      <p style="margin:0 0 8px;font-size:16px;">Às <strong>${time}</strong> é hora de tomar:</p>
      <p style="margin:0 0 24px;font-size:22px;font-weight:bold;">${escapeHtml(reminder.medicationName)} <span style="font-weight:normal;color:#6b7280;">${escapeHtml(reminder.dosage)}</span></p>
      <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-size:15px;">Abrir o MedTracker</a>
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Você pode mudar ou desligar estes lembretes no seu perfil.</p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

let client: Resend | null = null;

export async function sendDoseReminder(reminder: DueReminder): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.APP_URL;
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada');
  if (!appUrl) throw new Error('APP_URL não configurada');

  client ??= new Resend(apiKey);
  const { subject, html, text } = buildReminderEmail(reminder, appUrl);
  const { error } = await client.emails.send({ from: FROM, to: reminder.email, subject, html, text });
  if (error) throw new Error(`Resend: ${error.name} - ${error.message}`);
}
