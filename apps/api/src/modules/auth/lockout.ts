import type { Database } from '@astrolabe/db-core';
import { authConfig } from './config.js';

export interface LockoutStatus {
  locked: boolean;
  remainingAttempts: number;
  lockedUntil: Date | null;
}

/**
 * Backs the CNIL 50-bit password policy: acceptable entropy floor is
 * conditioned on lockout after `maxAttempts` failures within `windowMinutes`.
 * See docs/adr/0003-password-policy.md.
 */
export interface LockoutPolicy {
  recordFailedAttempt(userId: string): Promise<LockoutStatus>;
  recordSuccessfulAttempt(userId: string): Promise<void>;
  getStatus(userId: string): Promise<LockoutStatus>;
}

interface LockoutRow {
  failed_attempts: number;
  locked_until: Date | null;
}

/**
 * `users.failed_attempts`/`locked_until` are the only columns available —
 * no per-attempt timestamp log — so "N failures within M minutes" is
 * modeled as: once failed_attempts reaches maxAttempts, lock for
 * windowMinutes; a successful login resets both columns to zero/null.
 * A lock that has already elapsed is treated as unlocked without a
 * separate reset step (toStatus below checks lockedUntil against now()).
 */
export class PostgresLockoutPolicy implements LockoutPolicy {
  constructor(private readonly db: Database) {}

  async recordFailedAttempt(userId: string): Promise<LockoutStatus> {
    const { rows } = await this.db.pool.query<LockoutRow>(
      `UPDATE users
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE
             WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3)
             ELSE locked_until
           END
       WHERE id = $1
       RETURNING failed_attempts, locked_until`,
      [userId, authConfig.lockout.maxAttempts, authConfig.lockout.windowMinutes],
    );
    return this.toStatus(rows[0]);
  }

  async recordSuccessfulAttempt(userId: string): Promise<void> {
    await this.db.pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [userId]);
  }

  async getStatus(userId: string): Promise<LockoutStatus> {
    const { rows } = await this.db.pool.query<LockoutRow>(
      'SELECT failed_attempts, locked_until FROM users WHERE id = $1',
      [userId],
    );
    return this.toStatus(rows[0]);
  }

  private toStatus(row: LockoutRow | undefined): LockoutStatus {
    if (!row) return { locked: false, remainingAttempts: authConfig.lockout.maxAttempts, lockedUntil: null };
    const locked = row.locked_until !== null && row.locked_until.getTime() > Date.now();
    return {
      locked,
      remainingAttempts: Math.max(0, authConfig.lockout.maxAttempts - row.failed_attempts),
      lockedUntil: locked ? row.locked_until : null,
    };
  }
}
