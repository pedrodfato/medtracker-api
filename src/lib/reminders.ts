import { computeNextDoseAt, computeNextDueAt, type NextDoseInput } from './nextDose.js';
import { offsetDiffMinutes, toProcessZone, fromProcessZone, DEFAULT_TIMEZONE } from './timezone.js';

export const REMINDER_LEAD_OPTIONS = [0, 5, 10, 15, 30, 60];
export const DEFAULT_REMINDER_LEAD_MINUTES = 10;
// How long after the dose time a reminder is still worth sending, to absorb
// a late or skipped cron run.
export const REMINDER_LATE_TOLERANCE_MINUTES = 15;

const MINUTE = 60 * 1000;

export type ReminderCandidate = {
  medication: {
    id: number;
    name: string;
    dosage: string;
    scheduleType: NextDoseInput['scheduleType'];
    fixedTime: string | null;
    intervalHours: number | null;
    daysOfWeek: number[] | null;
    startDate: Date;
    endDate: Date | null;
  };
  lastDoseTakenAt: Date | null;
  user: {
    id: string;
    email: string;
    name: string;
    timezone: string | null;
    reminderEnabled: boolean;
    reminderLeadMinutes: number | null;
  };
};

export type DueReminder = {
  medicationId: number;
  userId: string;
  email: string;
  userName: string;
  medicationName: string;
  dosage: string;
  scheduledFor: Date;
  timezone: string;
};

export function normalizeLeadMinutes(value: number | null): number {
  return value !== null && REMINDER_LEAD_OPTIONS.includes(value) ? value : DEFAULT_REMINDER_LEAD_MINUTES;
}

/**
 * The dose times (real instants) a reminder could be about: the open dose
 * (anchored on the last dose taken, like the dashboard shows) and, for
 * fixed/weekly schedules, the next slot from now. The second one keeps
 * reminders coming for people who forget to mark a dose as taken - without
 * it the open dose would stay stuck in the past forever.
 */
function candidateSlots(candidate: ReminderCandidate, now: Date): Date[] {
  const { medication, lastDoseTakenAt, user } = candidate;
  const diff = offsetDiffMinutes(user.timezone ?? DEFAULT_TIMEZONE);
  const input: NextDoseInput = {
    scheduleType: medication.scheduleType,
    fixedTime: medication.fixedTime,
    intervalHours: medication.intervalHours,
    daysOfWeek: medication.daysOfWeek,
    startDate: toProcessZone(medication.startDate, diff),
  };
  const lastInZone = lastDoseTakenAt ? toProcessZone(lastDoseTakenAt, diff) : null;

  const slots: Date[] = [];
  const due = computeNextDueAt(input, lastInZone);
  if (due) slots.push(fromProcessZone(due, diff));

  if (medication.scheduleType !== 'interval') {
    const from = new Date(now.getTime() - REMINDER_LATE_TOLERANCE_MINUTES * MINUTE);
    const upcoming = computeNextDoseAt(input, lastInZone, toProcessZone(from, diff));
    if (upcoming) slots.push(fromProcessZone(upcoming, diff));
  }

  return slots.filter((slot, index) => slots.findIndex((other) => other.getTime() === slot.getTime()) === index);
}

export function findDueReminders(candidates: ReminderCandidate[], now: Date): DueReminder[] {
  const reminders: DueReminder[] = [];

  for (const candidate of candidates) {
    const { medication, lastDoseTakenAt, user } = candidate;
    if (!user.reminderEnabled) continue;
    if (medication.endDate && medication.endDate.getTime() < now.getTime()) continue;

    const leadMs = normalizeLeadMinutes(user.reminderLeadMinutes) * MINUTE;
    const toleranceMs = REMINDER_LATE_TOLERANCE_MINUTES * MINUTE;

    for (const slot of candidateSlots(candidate, now)) {
      const windowStart = slot.getTime() - leadMs;
      const windowEnd = slot.getTime() + toleranceMs;

      // A dose registered from the start of this slot's window onwards
      // already covers it.
      if (lastDoseTakenAt && lastDoseTakenAt.getTime() >= windowStart - toleranceMs) continue;
      if (now.getTime() < windowStart || now.getTime() >= windowEnd) continue;

      reminders.push({
        medicationId: medication.id,
        userId: user.id,
        email: user.email,
        userName: user.name,
        medicationName: medication.name,
        dosage: medication.dosage,
        scheduledFor: slot,
        timezone: user.timezone ?? DEFAULT_TIMEZONE,
      });
    }
  }

  return reminders;
}
