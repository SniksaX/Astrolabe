export type AccountTier = 'free' | 'paid';

export interface JwtClaims {
  sub: string;
  tier: AccountTier;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  tier: AccountTier;
}
