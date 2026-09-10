// Brazil has observed no daylight saving time since 2019, so every
// Brazilian IANA zone has a fixed UTC offset (in minutes, e.g. -180 for
// UTC-3). This lets us shift a Date by a simple, constant number of
// minutes to "pretend" it happened in a different zone, instead of doing
// full calendar-aware timezone conversion.
export const BRAZIL_TIMEZONE_OFFSETS: Record<string, number> = {
  'America/Noronha': -120,
  'America/Sao_Paulo': -180,
  'America/Manaus': -240,
  'America/Rio_Branco': -300,
};

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

// Must match the TZ the Node process itself runs in (set via
// `process.env.TZ` at the top of server.ts) - all of the existing
// schedule math in nextDose.ts/stats.ts reads wall-clock time using the
// process's local timezone via native Date methods.
const PROCESS_TIMEZONE = 'America/Sao_Paulo';

export function offsetDiffMinutes(userTimezone: string): number {
  const userOffset = BRAZIL_TIMEZONE_OFFSETS[userTimezone] ?? BRAZIL_TIMEZONE_OFFSETS[DEFAULT_TIMEZONE]!;
  const processOffset = BRAZIL_TIMEZONE_OFFSETS[PROCESS_TIMEZONE]!;
  return userOffset - processOffset;
}

// Shifts a real instant so that, when read with process-local Date
// methods (getHours, getDay, setDate, ...), it reads as if it were
// wall-clock time in the user's chosen zone.
export function toProcessZone(date: Date, diffMinutes: number): Date {
  return new Date(date.getTime() + diffMinutes * 60000);
}

// Inverse of toProcessZone: turns a "pretend" process-zone Date back into
// a real instant.
export function fromProcessZone(date: Date, diffMinutes: number): Date {
  return new Date(date.getTime() - diffMinutes * 60000);
}
