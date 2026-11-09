import { dateKey } from './stats.js';
import { fromProcessZone, toProcessZone } from './timezone.js';

export const MAX_DURATION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SummaryMedication = {
  scheduleType: 'fixed' | 'interval' | 'weekly';
  fixedTime: string | null;
  intervalHours: number | null;
  daysOfWeek: number[] | null;
  startDate: Date;
  endDate: Date;
};
export type SummaryDose = { takenAt: Date };
export type MissedDay = { date: string; missed: number; expected: number };
export type TreatmentSummary = {
  expected: number;
  taken: number;
  perfect: boolean;
  missedDays: MissedDay[];
  readyAt: Date;
};

export type Schedule = Omit<SummaryMedication, 'endDate'>;
export type DayAdherence = { date: string; expected: number; taken: number };

export function parseDurationDays(value: unknown): number | null {
  const n: unknown = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_DURATION_DAYS) return null;
  return n;
}

// End of day N (day 1 = the day the medication starts) in the user's zone.
export function computeEndDate(startDate: Date, durationDays: number, diffMinutes: number): Date {
  const local = toProcessZone(startDate, diffMinutes);
  local.setDate(local.getDate() + durationDays - 1);
  local.setHours(23, 59, 59, 999);
  return fromProcessZone(local, diffMinutes);
}

export function durationDaysFromRange(startDate: Date, endDate: Date, diffMinutes: number): number {
  const start = toProcessZone(startDate, diffMinutes);
  start.setHours(0, 0, 0, 0);
  const end = toProcessZone(endDate, diffMinutes);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function dayStartMs(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

// Every dose the schedule expects between startDate and `until`, oldest first.
// Mirrors nextDose.ts: with no dose taken yet, the first one is the first slot
// at or after startDate. Interval slots are always anchored on startDate.
function expectedSlots(m: Schedule, until: Date): Date[] {
  const slots: Date[] = [];
  const startMs = m.startDate.getTime();
  const endMs = until.getTime();

  if (m.scheduleType === 'interval') {
    if (!m.intervalHours || m.intervalHours < 0) return slots;
    const step = m.intervalHours * 60 * 60 * 1000;
    for (let t = startMs; t <= endMs; t += step) slots.push(new Date(t));
    return slots;
  }

  if (!m.fixedTime) return slots;
  if (m.scheduleType === 'weekly' && (!m.daysOfWeek || m.daysOfWeek.length === 0)) return slots;

  const [hours = 0, minutes = 0] = m.fixedTime.split(':').map(Number);
  const cursor = new Date(m.startDate);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= endMs) {
    const slot = new Date(cursor);
    slot.setHours(hours, minutes, 0, 0);
    const onScheduledDay = m.scheduleType === 'fixed' || m.daysOfWeek!.includes(slot.getDay());
    if (onScheduledDay && slot.getTime() >= startMs && slot.getTime() <= endMs) slots.push(slot);
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

export function computeTreatmentSummary(m: SummaryMedication, doses: SummaryDose[]): TreatmentSummary {
  const slots = expectedSlots(m, m.endDate);

  // A once-a-week medication moves to whichever weekday it was actually taken
  // on (see driftedWeeklyDaysOfWeek), so it is matched per 7-day block counted
  // from the start date; every other schedule is matched per calendar day.
  const perWeek = m.scheduleType === 'weekly' && m.daysOfWeek?.length === 1;
  const startDay = dayStartMs(m.startDate);
  const bucketOf = (d: Date): string =>
    perWeek ? `w${Math.floor(Math.round((dayStartMs(d) - startDay) / DAY_MS) / 7)}` : dateKey(d);

  const expectedByBucket = new Map<string, { date: string; count: number }>();
  for (const slot of slots) {
    const key = bucketOf(slot);
    const entry = expectedByBucket.get(key);
    if (entry) entry.count += 1;
    else expectedByBucket.set(key, { date: dateKey(slot), count: 1 });
  }

  const takenByBucket = new Map<string, number>();
  for (const dose of doses) {
    const t = dose.takenAt.getTime();
    if (t < m.startDate.getTime() || t > m.endDate.getTime()) continue;
    const key = bucketOf(dose.takenAt);
    takenByBucket.set(key, (takenByBucket.get(key) ?? 0) + 1);
  }

  let taken = 0;
  const missedDays: MissedDay[] = [];
  for (const [key, { date, count }] of expectedByBucket) {
    const takenInBucket = Math.min(takenByBucket.get(key) ?? 0, count);
    taken += takenInBucket;
    if (takenInBucket < count) missedDays.push({ date, missed: count - takenInBucket, expected: count });
  }

  return {
    expected: slots.length,
    taken,
    perfect: missedDays.length === 0,
    missedDays,
    readyAt: slots.length > 0 ? slots[slots.length - 1]! : m.endDate,
  };
}

// One entry per calendar day from max(from, startDate) to `until`. `taken` is
// capped at `expected` on scheduled days; on days with nothing scheduled it is
// the real number of doses taken.
export function dailyAdherence(m: Schedule, doses: SummaryDose[], from: Date, until: Date): DayAdherence[] {
  const fromMs = Math.max(from.getTime(), m.startDate.getTime());
  const untilMs = until.getTime();
  if (untilMs < fromMs) return [];

  const days: DayAdherence[] = [];
  const byDate = new Map<string, DayAdherence>();
  const cursor = new Date(fromMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= untilMs) {
    const day = { date: dateKey(cursor), expected: 0, taken: 0 };
    days.push(day);
    byDate.set(day.date, day);
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const slot of expectedSlots(m, until)) {
    if (slot.getTime() < fromMs) continue;
    const day = byDate.get(dateKey(slot));
    if (day) day.expected += 1;
  }

  for (const dose of doses) {
    const t = dose.takenAt.getTime();
    if (t < fromMs || t > untilMs) continue;
    const day = byDate.get(dateKey(dose.takenAt));
    if (day) day.taken += 1;
  }

  for (const day of days) {
    if (day.expected > 0) day.taken = Math.min(day.taken, day.expected);
  }
  return days;
}

// The whole of today (including doses scheduled for later today), cut at the
// treatment's end date.
export function todayAdherence(
  m: Schedule,
  doses: SummaryDose[],
  now: Date,
  endDate: Date | null,
): { expected: number; taken: number } {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const until = endDate && endDate.getTime() < dayEnd.getTime() ? endDate : dayEnd;
  const [day] = dailyAdherence(m, doses, dayStart, until);
  return day ? { expected: day.expected, taken: day.taken } : { expected: 0, taken: 0 };
}
