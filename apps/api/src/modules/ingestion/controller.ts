import type { Request, Response } from 'express';
import type { SourceType } from '@astrolabe/shared-types';
import { HttpError } from '../../lib/httpError.js';
import { documentIngestService } from './service.js';

const URL_SOURCE_TYPES: readonly SourceType[] = ['youtube', 'web', 'text'];

function isUrlSourceType(value: unknown): value is SourceType {
  return typeof value === 'string' && (URL_SOURCE_TYPES as readonly string[]).includes(value);
}

/** Thin by design: parse/validate input, call the service, shape the response — no business logic here. */
export class IngestionController {
  async createFromUrl(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');

    const body = req.body as { sourceType?: unknown; sourceUrl?: unknown; title?: unknown };
    if (!isUrlSourceType(body.sourceType)) {
      throw new HttpError(400, 'sourceType must be youtube, web, or text');
    }
    if (typeof body.sourceUrl !== 'string' || typeof body.title !== 'string') {
      throw new HttpError(400, 'sourceUrl and title are required');
    }

    const document = await documentIngestService.createDocument(userId, body.sourceType, body.sourceUrl, body.title);
    res.status(201).json(document);
  }

  async createFromUpload(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');

    const file = req.file;
    if (!file) throw new HttpError(400, 'file is required');

    const document = await documentIngestService.createDocument(userId, 'pdf', null, file.originalname, {
      fileBytes: file.buffer,
      originalName: file.originalname,
    });
    res.status(201).json(document);
  }

  async list(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    res.status(200).json(await documentIngestService.listDocuments(userId));
  }

  async get(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    const document = await documentIngestService.getDocument(userId, req.params.id ?? '');
    if (!document) throw new HttpError(404, 'document not found');
    res.status(200).json(document);
  }

  async remove(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    await documentIngestService.deleteDocument(userId, req.params.id ?? '');
    res.status(204).send();
  }
}

export const ingestionController = new IngestionController();
