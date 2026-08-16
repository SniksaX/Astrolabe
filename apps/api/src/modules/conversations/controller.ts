import type { Request, Response } from 'express';
import type { ConversationSettings, EffortTier } from '@astrolabe/shared-types';
import { HttpError } from '../../lib/httpError.js';
import { conversationService } from './service.js';

function parseSettingsBody(raw: unknown): ConversationSettings {
  if (typeof raw !== 'object' || raw === null) return {};
  const body = raw as Record<string, unknown>;
  const settings: ConversationSettings = {};
  if (body.effort === 'low' || body.effort === 'medium' || body.effort === 'high') {
    settings.effort = body.effort as EffortTier;
  }
  if (typeof body.thinking === 'boolean') settings.thinking = body.thinking;
  if (typeof body.webSearch === 'boolean') settings.webSearch = body.webSearch;
  if (typeof body.useRag === 'boolean') settings.useRag = body.useRag;
  if (typeof body.ragWeight === 'number' && Number.isFinite(body.ragWeight)) {
    settings.ragWeight = Math.min(1, Math.max(0, body.ragWeight));
  }
  if (typeof body.generation === 'object' && body.generation !== null) {
    settings.generation = body.generation as NonNullable<ConversationSettings['generation']>;
  }
  return settings;
}

export class ConversationController {
  async list(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    res.status(200).json(await conversationService.list(userId));
  }

  async create(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    const body = req.body as { title?: unknown };
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
    res.status(201).json(await conversationService.create(userId, title));
  }

  async get(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    const id = req.params.id;
    if (!id) throw new HttpError(400, 'id is required');
    const detail = await conversationService.getWithMessages(userId, id);
    if (!detail) throw new HttpError(404, 'conversation not found');
    res.status(200).json(detail);
  }

  async patchSettings(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    const id = req.params.id;
    if (!id) throw new HttpError(400, 'id is required');
    const settings = parseSettingsBody(req.body);
    if (Object.keys(settings).length === 0) {
      throw new HttpError(400, 'settings body is empty');
    }
    const saved = await conversationService.updateSettings(userId, id, settings);
    res.status(200).json({ settings: saved });
  }

  async remove(req: Request, res: Response): Promise<void> {
    const userId = req.auth?.sub;
    if (!userId) throw new HttpError(401, 'unauthenticated');
    const id = req.params.id;
    if (!id) throw new HttpError(400, 'id is required');
    await conversationService.delete(userId, id);
    res.status(204).send();
  }
}

export const conversationController = new ConversationController();
