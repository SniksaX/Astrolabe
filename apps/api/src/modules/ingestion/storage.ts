import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { optionalEnv } from '@astrolabe/config-core';

/**
 * Local upload store for PDF/DOCX bytes until processJob has read them.
 * Path is recorded on documents.storage_path — not the file contents.
 */
export function uploadDir(): string {
  return path.resolve(optionalEnv('UPLOAD_DIR', '.data/uploads'));
}

export async function saveUpload(documentId: string, bytes: Buffer, originalName: string): Promise<string> {
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  const storagePath = path.join(dir, `${documentId}${ext}`);
  await writeFile(storagePath, bytes);
  return storagePath;
}

export async function readUpload(storagePath: string): Promise<Buffer> {
  return readFile(storagePath);
}

export async function removeUpload(storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  await unlink(storagePath).catch(() => undefined);
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
