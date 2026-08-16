/** Throw this from a controller/service to produce a specific HTTP status; anything else becomes a redacted 500. */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}
