import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireJwt } from '../auth/index.js';
import { conversationController } from './controller.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireJwt);

conversationsRouter.get('/', asyncHandler((req, res) => conversationController.list(req, res)));
conversationsRouter.post('/', asyncHandler((req, res) => conversationController.create(req, res)));
conversationsRouter.get('/:id', asyncHandler((req, res) => conversationController.get(req, res)));
conversationsRouter.patch(
  '/:id/settings',
  asyncHandler((req, res) => conversationController.patchSettings(req, res)),
);
conversationsRouter.delete('/:id', asyncHandler((req, res) => conversationController.remove(req, res)));
