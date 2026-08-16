import type { AccountTier, AuthenticatedUser } from '@astrolabe/shared-types';
import { db } from '../../db.js';
import { HttpError } from '../../lib/httpError.js';
import { notImplemented } from '../../lib/notImplemented.js';
import { PostgresLockoutPolicy } from './lockout.js';
import { hashPassword, verifyPassword } from './passwordHash.js';
import { validatePasswordPolicy } from './passwordPolicy.js';
import { hashRefreshToken, issueRefreshToken, signAccessToken } from './tokens.js';
import type { AuthSession, LoginInput, RgpdExportPayload, SignupInput } from './types.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  tier: AccountTier;
}

export class AuthService {
  private readonly lockoutPolicy = new PostgresLockoutPolicy(db);

  async signup(input: SignupInput): Promise<AuthSession> {
    if (!input.ageConfirmed || !input.consentAccepted) {
      throw new HttpError(400, 'age confirmation and consent are both required');
    }
    const policy = validatePasswordPolicy(input.password);
    if (!policy.valid) {
      throw new HttpError(400, policy.reason ?? 'password does not meet policy');
    }

    const email = input.email.trim().toLowerCase();
    const existing = await db.pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new HttpError(409, 'an account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    // email_verified_at set immediately: confirmation email is short-circuited (docs/journal.md).
    const { rows } = await db.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, age_confirmed, email_verified_at)
       VALUES ($1, $2, $3, now())
       RETURNING id, email, password_hash, tier`,
      [email, passwordHash, input.ageConfirmed],
    );
    return this.issueSession(rows[0]!);
  }

  async login(input: LoginInput): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const { rows } = await db.pool.query<UserRow>(
      'SELECT id, email, password_hash, tier FROM users WHERE email = $1',
      [email],
    );
    const user = rows[0];
    // Never distinguish "no such user" from "wrong password" (ADR 0003).
    const invalidCredentials = new HttpError(401, 'invalid email or password');
    if (!user) throw invalidCredentials;

    const status = await this.lockoutPolicy.getStatus(user.id);
    if (status.locked) {
      throw new HttpError(423, 'account temporarily locked after too many failed attempts');
    }

    const validPassword = await verifyPassword(user.password_hash, input.password);
    if (!validPassword) {
      await this.lockoutPolicy.recordFailedAttempt(user.id);
      throw invalidCredentials;
    }
    await this.lockoutPolicy.recordSuccessfulAttempt(user.id);
    return this.issueSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const tokenHash = hashRefreshToken(refreshToken);
    const { rows } = await db.pool.query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>(
      'SELECT user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    const row = rows[0];
    const invalid = new HttpError(401, 'invalid or expired refresh token');
    if (!row || row.revoked_at !== null || row.expires_at.getTime() < Date.now()) throw invalid;

    // Rotate: the used token is revoked whether or not the user lookup below succeeds.
    await db.pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);

    const { rows: userRows } = await db.pool.query<UserRow>(
      'SELECT id, email, password_hash, tier FROM users WHERE id = $1',
      [row.user_id],
    );
    const user = userRows[0];
    if (!user) throw invalid;
    return this.issueSession(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    await db.pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
      tokenHash,
    ]);
  }

  private async issueSession(user: UserRow): Promise<AuthSession> {
    const accessToken = signAccessToken({ sub: user.id, tier: user.tier });
    const issued = issueRefreshToken();
    await db.pool.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
      user.id,
      issued.tokenHash,
      issued.expiresAt,
    ]);
    const authenticatedUser: AuthenticatedUser = { id: user.id, email: user.email, tier: user.tier };
    return { accessToken, refreshToken: issued.token, user: authenticatedUser };
  }

  async getMe(userId: string): Promise<AuthenticatedUser> {
    const { rows } = await db.pool.query<UserRow>(
      'SELECT id, email, password_hash, tier FROM users WHERE id = $1',
      [userId],
    );
    const user = rows[0];
    if (!user) throw new HttpError(401, 'unauthenticated');
    return { id: user.id, email: user.email, tier: user.tier };
  }

  /**
   * RGPD export: will compose ingestion's exportUserData(userId) — imported
   * only from its index.ts — once that module implements it. Whether this
   * stays on auth or moves to the privacy module is an open question,
   * decided when privacy is implemented.
   */
  async exportUserData(_userId: string): Promise<RgpdExportPayload> {
    notImplemented('AuthService.exportUserData');
  }

  /** RGPD hard-delete: deletes the users row; FK ON DELETE CASCADE removes documents/chunks rows in the same DB. */
  async deleteAccount(_userId: string): Promise<void> {
    notImplemented('AuthService.deleteAccount');
  }
}

export const authService = new AuthService();
