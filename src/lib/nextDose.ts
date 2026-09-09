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
