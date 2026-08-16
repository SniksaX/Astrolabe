import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireJwt } from '../auth/index.js';
import { ingestionController } from './controller.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const ingestionRouter = Router();
ingestionRouter.use(requireJwt);

ingestionRouter.post('/documents', asyncHandler((req, res) => ingestionController.createFromUrl(req, res)));
ingestionRouter.post(
  '/documents/upload',
  upload.single('file'),
  asyncHandler((req, res) => ingestionController.createFromUpload(req, res)),
);
ingestionRouter.get('/documents', asyncHandler((req, res) => ingestionController.list(req, res)));
ingestionRouter.get('/documents/:id', asyncHandler((req, res) => ingestionController.get(req, res)));
ingestionRouter.delete('/documents/:id', asyncHandler((req, res) => ingestionController.remove(req, res)));
