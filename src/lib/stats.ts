export type StatsMedication = {
  id: number;
  scheduleType: 'fixed' | 'interval' | 'weekly';
  intervalHours: number | null;
  daysOfWeek: number[] | null;
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

function expectedDosesInLast7Days(medication: StatsMedication): number {
  if (medication.scheduleType === 'fixed') return 7;
  if (medication.scheduleType === 'weekly') return medication.daysOfWeek?.length ?? 0;
  if (medication.scheduleType === 'interval' && medication.intervalHours) {
    return Math.floor((7 * 24) / medication.intervalHours);
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
    const expected = expectedDosesInLast7Days(medication);
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
