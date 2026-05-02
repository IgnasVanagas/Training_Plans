const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const createValidLocalDate = (year: number, month: number, day: number): Date | null => {
  const candidate = new Date(year, month, day);
  if (Number.isNaN(candidate.getTime())) return null;
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return candidate;
};

export const parseDateOnly = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = value.trim();
  const match = raw.match(DATE_ONLY_RE);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return createValidLocalDate(year, month, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

export const toDateOnlyString = (value: string | Date | null | undefined): string | null => {
  const parsed = parseDateOnly(value);
  if (!parsed) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
