import type { Request, Response } from 'express';
import { HttpError } from '../../lib/httpError.js';
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from './cookies.js';
import { authService } from './service.js';

function bodyRefreshToken(req: Request): string | undefined {
  const body = req.body as { refreshToken?: unknown } | undefined;
  return typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
}

/** Thin by design: parse/validate input, call the service, shape the response — no business logic here. */
export class AuthController {
  async signup(req: Request, res: Response): Promise<void> {
    const body = req.body as { email?: unknown; password?: unknown; ageConfirmed?: unknown; consentAccepted?: unknown };
    if (
      typeof body.email !== 'string' ||
      typeof body.password !== 'string' ||
      body.ageConfirmed !== true ||
      body.consentAccepted !== true
    ) {
      throw new HttpError(400, 'email, password, ageConfirmed=true, and consentAccepted=true are required');
    }
    const session = await authService.signup({
      email: body.email,
      password: body.password,
      ageConfirmed: body.ageConfirmed,
      consentAccepted: body.consentAccepted,
    });
    setSessionCookies(res, session.accessToken, session.refreshToken);
    res.status(201).json(session);
  }

  async login(req: Request, res: Response): Promise<void> {
    const body = req.body as { email?: unknown; password?: unknown };
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new HttpError(400, 'email and password are required');
    }
    const session = await authService.login({ email: body.email, password: body.password });
    setSessionCookies(res, session.accessToken, session.refreshToken);
    res.status(200).json(session);
  }

  async refresh(req: Request, res: Response): Promise<void> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? bodyRefreshToken(req);
    if (typeof refreshToken !== 'string') {
      throw new HttpError(401, 'no refresh token');
    }
    const session = await authService.refresh(refreshToken);
    setSessionCookies(res, session.accessToken, session.refreshToken);
    res.status(200).json(session);
  }

  async logout(req: Request, res: Response): Promise<void> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? bodyRefreshToken(req);
    if (typeof refreshToken === 'string') {
      await authService.logout(refreshToken);
    }
    clearSessionCookies(res);
    res.status(204).send();
  }

  async exportData(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    res.status(200).json(await authService.exportUserData(userId));
  }

  async me(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    res.status(200).json(await authService.getMe(userId));
  }

  async deleteAccount(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    await authService.deleteAccount(userId);
    res.status(204).send();
  }
}

export const authController = new AuthController();
