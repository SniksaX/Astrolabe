/**
 * CNIL's referential allows a 50-bit entropy floor (instead of 80-bit)
 * specifically when paired with account lockout + rate-limiting — see
 * docs/adr/0003-password-policy.md. No forced periodic rotation.
 */
export const MIN_PASSWORD_ENTROPY_BITS = 50;
export const MIN_PASSWORD_LENGTH = 8;

function charsetSize(password: string): number {
  let size = 0;
  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/[0-9]/.test(password)) size += 10;
  if (/[^a-zA-Z0-9]/.test(password)) size += 33; // approximate printable-symbol alphabet
  return Math.max(size, 1);
}

export function estimatePasswordEntropyBits(password: string): number {
  return password.length * Math.log2(charsetSize(password));
}

export interface PasswordPolicyResult {
  valid: boolean;
  entropyBits: number;
  reason: string | null;
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, entropyBits: 0, reason: `must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  const entropyBits = estimatePasswordEntropyBits(password);
  if (entropyBits < MIN_PASSWORD_ENTROPY_BITS) {
    return {
      valid: false,
      entropyBits,
      reason: `entropy too low (${entropyBits.toFixed(1)} bits, need ${MIN_PASSWORD_ENTROPY_BITS})`,
    };
  }
  return { valid: true, entropyBits, reason: null };
}
