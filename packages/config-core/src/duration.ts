const UNIT_TO_MS: Record<'s' | 'm' | 'h' | 'd', number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function isDurationUnit(value: string): value is keyof typeof UNIT_TO_MS {
  return value === 's' || value === 'm' || value === 'h' || value === 'd';
}

/** Parses durations like "15m", "30d", "12h" (used for JWT TTLs) into milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  const amount = match?.[1];
  const unit = match?.[2];
  if (!amount || !unit || !isDurationUnit(unit)) {
    throw new Error(`invalid duration: ${JSON.stringify(value)} (expected e.g. "15m", "12h", "30d")`);
  }
  return Number.parseInt(amount, 10) * UNIT_TO_MS[unit];
}
