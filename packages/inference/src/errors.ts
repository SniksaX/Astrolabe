/** Raised by embed() and transcribe() (fail-closed methods) — never by score() (fail-open, returns null). */
export class InferenceError extends Error {}
