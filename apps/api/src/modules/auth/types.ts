import type { AuthenticatedUser } from '@astrolabe/shared-types';

export interface SignupInput {
  email: string;
  password: string;
  /** Must be true — signup is restricted to 18+, stated in the ToS instead of building parental-consent RGPD flows. */
  ageConfirmed: boolean;
  /** Must be true — separate from ageConfirmed by design (wireframe écran 02, EF-06/EF-56): no bundled consent. */
  consentAccepted: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

export interface RgpdExportPayload {
  user: AuthenticatedUser;
  /** Populated by composing each module's exportUserData(userId), called only through its index.ts. */
  modules: Record<string, unknown>;
  exportedAt: string;
}
