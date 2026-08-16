import type { Request, Response } from 'express';
import type { SearchQuery } from '@astrolabe/shared-types';
import { HttpError } from '../../lib/httpError.js';
import { retrievalService } from './service.js';

/** Thin by design: parse/validate input, call the service, shape the response — no business logic here. */
export class RetrievalController {
  async search(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');

    const body = req.body as { text?: unknown; documentIds?: unknown; topK?: unknown };
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      throw new HttpError(400, 'text is required');
    }
    const documentIds = Array.isArray(body.documentIds)
      ? body.documentIds.filter((id): id is string => typeof id === 'string')
      : undefined;
    const topK = typeof body.topK === 'number' && Number.isInteger(body.topK) ? body.topK : 10;

    // exactOptionalPropertyTypes: documentIds must be omitted, not set to undefined, when absent.
    const query: SearchQuery = { text: body.text, userId, topK, ...(documentIds ? { documentIds } : {}) };
    res.status(200).json(await retrievalService.search(query));
  }
}

export const retrievalController = new RetrievalController();
