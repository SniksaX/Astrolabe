import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireJwt } from '../auth/index.js';
import { retrievalController } from './controller.js';

export const retrievalRouter = Router();
retrievalRouter.use(requireJwt);

// Mainly consumed internally by the generation module's chat orchestration;
// exposed directly too for a standalone "search my documents" feature.
retrievalRouter.post('/search', asyncHandler((req, res) => retrievalController.search(req, res)));
