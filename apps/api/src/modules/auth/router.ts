import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { authController } from './controller.js';
import { requireJwt } from './middleware.js';

export const authRouter = Router();

authRouter.post('/signup', asyncHandler((req, res) => authController.signup(req, res)));
authRouter.post('/login', asyncHandler((req, res) => authController.login(req, res)));
authRouter.post('/refresh', asyncHandler((req, res) => authController.refresh(req, res)));
authRouter.post('/logout', asyncHandler((req, res) => authController.logout(req, res)));
authRouter.get('/me', requireJwt, asyncHandler((req, res) => authController.me(req, res)));
authRouter.get('/me/export', requireJwt, asyncHandler((req, res) => authController.exportData(req, res)));
authRouter.delete('/me', requireJwt, asyncHandler((req, res) => authController.deleteAccount(req, res)));
