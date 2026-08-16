// Public interface of the auth module — every cross-module reference must go through here, never into a sibling file directly.
export { authRouter } from './router.js';
export { requireJwt } from './middleware.js';
export { verifyAccessToken, type AccessTokenPayload } from './tokens.js';
export type { AuthSession, LoginInput, RgpdExportPayload, SignupInput } from './types.js';
