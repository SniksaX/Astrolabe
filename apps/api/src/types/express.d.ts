import type { JwtClaims } from '@astrolabe/shared-types';

declare global {
  namespace Express {
    interface Request {
      /** Set by modules/auth's requireJwt middleware once the bearer token verifies. */
      auth?: JwtClaims;
    }
  }
}

export {};
