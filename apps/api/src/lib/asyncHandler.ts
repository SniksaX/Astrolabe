import type { NextFunction, Request, Response } from 'express';

type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

/** Express 4 doesn't forward rejected promises to error middleware on its own. */
export function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}
