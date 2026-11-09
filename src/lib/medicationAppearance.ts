// How a medication looks in the app: its physical form and the color of the pill/package.
export const MEDICATION_FORMS = [
  'tablet_round',
  'tablet_oval',
  'capsule',
  'drops',
  'syrup',
  'injection',
  'ointment',
  'sachet',
] as const;

export type MedicationForm = (typeof MEDICATION_FORMS)[number];
export type MedicationCategory = 'pill' | 'drop' | 'vitamin';

export const DEFAULT_MEDICATION_COLOR = '#F2F2EE';

export function parseMedicationForm(value: unknown): MedicationForm | null {
  return typeof value === 'string' && (MEDICATION_FORMS as readonly string[]).includes(value)
    ? (value as MedicationForm)
    : null;
}

export function parseMedicationColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : null;
}

// The list's category filter (Pílulas / Líquidos / Outros) still reads `category`.
export function categoryForForm(form: MedicationForm): MedicationCategory {
  if (form === 'tablet_round' || form === 'tablet_oval' || form === 'capsule') return 'pill';
  if (form === 'drops' || form === 'syrup') return 'drop';
  return 'vitamin';
}
