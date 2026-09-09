export type StatsMedication = {
  id: number;
  scheduleType: 'fixed' | 'interval' | 'weekly';
  intervalHours: number | null;
  daysOfWeek: number[] | null;
  startDate: Date;
};
export type StatsDose = { medicationId: number; takenAt: Date };
export type Stats = {
  currentStreak: number;
  dosesTaken: number;
  weeklyAdherenceRate: number;
  missedDoses: number;
};

function dateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeCurrentStreak(doses: StatsDose[], now: Date): number {
  const daysWithDose = new Set(doses.map((d) => dateKey(d.takenAt)));
  let streak = 0;
  const cursor = new Date(now);
  while (daysWithDose.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function daysBetweenInclusive(start: Date, end: Date): number {
  const startOfDay = new Date(start);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(end);
  endOfDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((endOfDay.getTime() - startOfDay.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(diffDays + 1, 0);
}

function expectedDosesInWindow(medication: StatsMedication, windowStart: Date, now: Date): number {
  const effectiveStart = medication.startDate.getTime() > windowStart.getTime() ? medication.startDate : windowStart;
  if (effectiveStart.getTime() > now.getTime()) return 0;

  const daysInWindow = daysBetweenInclusive(effectiveStart, now);

  if (medication.scheduleType === 'fixed') return daysInWindow;

  if (medication.scheduleType === 'weekly') {
    if (!medication.daysOfWeek || medication.daysOfWeek.length === 0) return 0;
    let count = 0;
    const cursor = new Date(effectiveStart);
    cursor.setHours(0, 0, 0, 0);
    for (let i = 0; i < daysInWindow; i++) {
      if (medication.daysOfWeek.includes(cursor.getDay())) count += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  if (medication.scheduleType === 'interval' && medication.intervalHours) {
    const hoursInWindow = (now.getTime() - effectiveStart.getTime()) / (60 * 60 * 1000);
    return Math.floor(hoursInWindow / medication.intervalHours);
  }

  return 0;
}

export function computeStats(medications: StatsMedication[], doses: StatsDose[], now: Date): Stats {
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 6);
  windowStart.setHours(0, 0, 0, 0);

  const dosesInWindow = doses.filter((d) => d.takenAt.getTime() >= windowStart.getTime());

  let totalExpected = 0;
  let totalMissed = 0;
  for (const medication of medications) {
    const expected = expectedDosesInWindow(medication, windowStart, now);
    const taken = dosesInWindow.filter((d) => d.medicationId === medication.id).length;
    totalExpected += expected;
    totalMissed += Math.max(expected - taken, 0);
  }

  const weeklyAdherenceRate = totalExpected === 0
    ? 100
    : Math.round(((totalExpected - totalMissed) / totalExpected) * 100);

  return {
    currentStreak: computeCurrentStreak(doses, now),
    dosesTaken: doses.length,
    weeklyAdherenceRate,
    missedDoses: totalMissed,
  };
}
