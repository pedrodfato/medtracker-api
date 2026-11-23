// The app only offers "today" and "yesterday" when logging an earlier dose;
// 48h covers both in any timezone without trusting the client's idea of "day".
const MAX_BACKDATE_MS = 48 * 60 * 60 * 1000;
// Phones whose clock runs slightly ahead shouldn't be told "that's the future".
const CLOCK_SKEW_MS = 60 * 1000;

type TakenAtResult = { takenAt: Date } | { error: string; status: 400 | 409 };

/**
 * Validates the optional moment a dose was actually taken. Without one the dose
 * is logged now. Doses can't be slotted before the last recorded one, so the
 * history (and the next-dose math anchored on the last dose) stays in order.
 */
export function resolveTakenAt(
    raw: unknown,
    { now, startDate, lastDoseAt }: { now: Date; startDate: Date; lastDoseAt: Date | null },
): TakenAtResult {
    if (raw === undefined || raw === null || raw === '') return { takenAt: now };

    const takenAt = typeof raw === 'string' ? new Date(raw) : new Date(NaN);
    if (Number.isNaN(takenAt.getTime())) {
        return { error: 'Horário da dose inválido.', status: 400 };
    }
    if (takenAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
        return { error: 'O horário da dose não pode estar no futuro.', status: 400 };
    }
    if (now.getTime() - takenAt.getTime() > MAX_BACKDATE_MS) {
        return { error: 'Só é possível registrar doses de hoje ou de ontem.', status: 400 };
    }
    if (takenAt.getTime() < startDate.getTime()) {
        return { error: 'Esse horário é anterior ao início do tratamento.', status: 400 };
    }
    if (lastDoseAt && takenAt.getTime() <= lastDoseAt.getTime()) {
        return { error: 'Já existe uma dose registrada depois desse horário.', status: 409 };
    }
    return { takenAt };
}
