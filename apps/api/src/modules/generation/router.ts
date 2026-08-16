import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireJwt } from '../auth/index.js';
import { generationController } from './controller.js';

export const generationRouter = Router();
generationRouter.use(requireJwt);

generationRouter.post('/chat', asyncHandler((req, res) => generationController.chat(req, res)));
