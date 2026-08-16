/** Marks a typed stub pending Step 4 implementation, with a clear error instead of `undefined` misbehaving silently. */
export function notImplemented(where: string): never {
  throw new Error(`not implemented: ${where}`);
}
