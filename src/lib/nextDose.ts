export type NextDoseInput = {
  scheduleType: 'fixed' | 'interval' | 'weekly';
  fixedTime: string | null;
  intervalHours: number | null;
  daysOfWeek: number[] | null;
  startDate: Date;
};

function atTime(base: Date, hhmm: string): Date {
  const parts = hhmm.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const result = new Date(base);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function computeNextDoseAt(
  medication: NextDoseInput,
  lastDoseTakenAt: Date | null,
  now: Date
): Date | null {
  if (medication.scheduleType === 'fixed') {
    if (!medication.fixedTime) return null;
    const todayAtTime = atTime(now, medication.fixedTime);
    if (todayAtTime.getTime() > now.getTime()) return todayAtTime;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return atTime(tomorrow, medication.fixedTime);
  }

  if (medication.scheduleType === 'interval') {
    if (!medication.intervalHours) return null;
    if (lastDoseTakenAt) {
      return new Date(lastDoseTakenAt.getTime() + medication.intervalHours * 60 * 60 * 1000);
    }
    return medication.startDate;
  }

  if (medication.scheduleType === 'weekly') {
    if (!medication.fixedTime || !medication.daysOfWeek || medication.daysOfWeek.length === 0) return null;
    const sortedDays = [...medication.daysOfWeek].sort((a, b) => a - b);
    const todayDow = now.getDay();

    if (sortedDays.includes(todayDow)) {
      const todayAtTime = atTime(now, medication.fixedTime);
      if (todayAtTime.getTime() > now.getTime()) return todayAtTime;
    }

    const laterThisWeek = sortedDays.find((day) => day > todayDow);
    const targetDow = laterThisWeek !== undefined ? laterThisWeek : sortedDays[0]!;
    const daysUntil = laterThisWeek !== undefined
      ? targetDow - todayDow
      : 7 - todayDow + targetDow;

    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysUntil);
    return atTime(targetDate, medication.fixedTime);
  }

  return null;
}

/**
 * When would the dose AFTER `lastDoseTakenAt` become due? Unlike computeNextDoseAt
 * (which projects from "now" and therefore always returns a future time for
 * fixed/weekly schedules), this projects from the last dose itself, so it can
 * correctly answer "has a new slot opened up since the last dose?" even when
 * that slot is already in the past relative to `now`.
 */
export function computeNextAllowedDoseAt(
  medication: NextDoseInput,
  lastDoseTakenAt: Date
): Date | null {
  if (medication.scheduleType === 'interval') {
    if (!medication.intervalHours) return null;
    return new Date(lastDoseTakenAt.getTime() + medication.intervalHours * 60 * 60 * 1000);
  }

  // fixed/weekly ignore the lastDoseTakenAt parameter and derive purely from
  // the reference time, so feeding the last dose's timestamp as that
  // reference correctly finds the next scheduled slot after it.
  return computeNextDoseAt(medication, null, lastDoseTakenAt);
}

/**
 * Is a dose currently due (possibly overdue)? Used for display and for
 * gating the "mark as taken" action. Always anchors on the last known
 * reference point (the last dose taken, or the medication's start date if
 * none yet) instead of "now", so an overdue dose stays visible as due today
 * rather than silently rolling forward to the next occurrence.
 */
export function computeNextDueAt(
  medication: NextDoseInput,
  lastDoseTakenAt: Date | null
): Date | null {
  if (lastDoseTakenAt) {
    return computeNextAllowedDoseAt(medication, lastDoseTakenAt);
  }
  return computeNextDoseAt(medication, null, medication.startDate);
}

/**
 * A medication configured to a single day of the week ("once a week") should
 * adapt to whichever day it's actually taken on, so the next reminder lands
 * exactly 7 days later on that new day instead of the originally configured
 * one. Medications with more than one configured day never drift - only a
 * true once-a-week schedule has an unambiguous "new day" to move to.
 * Returns the daysOfWeek to persist, or null if nothing should change.
 */
export function driftedWeeklyDaysOfWeek(
  daysOfWeek: number[] | null,
  takenDayOfWeek: number
): number[] | null {
  if (!daysOfWeek || daysOfWeek.length !== 1) return null;
  if (daysOfWeek[0] === takenDayOfWeek) return null;
  return [takenDayOfWeek];
}
