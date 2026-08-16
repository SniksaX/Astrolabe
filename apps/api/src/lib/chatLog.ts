import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { optionalEnvBool } from '@astrolabe/config-core';

const CHAT_DEBUG =
  process.env.NODE_ENV === 'development' || optionalEnvBool('CHAT_DEBUG', false);

/** Always-on JSONL trail for Cursor / ops debugging (independent of console). */
const FILE_LOG =
  process.env.ASTROLABE_CHAT_LOG !== '0' && process.env.ASTROLABE_CHAT_LOG !== 'false';

export type ChatLogFields = Record<string, string | number | boolean | null | undefined>;

function resolveLogPath(): string {
  if (process.env.ASTROLABE_CHAT_LOG_PATH) return process.env.ASTROLABE_CHAT_LOG_PATH;
  return path.join(process.cwd(), 'logs', 'chat-pipeline.log');
}

function appendFileLog(line: string): void {
  if (!FILE_LOG) return;
  try {
    const filePath = resolveLogPath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${line}\n`, 'utf8');
  } catch {
    // Fail-open: never break chat because of logging I/O.
  }
}

/**
 * Structured one-line JSON logs for the chat pipeline.
 * - Console: development or CHAT_DEBUG=true
 * - File: always append to logs/chat-pipeline.log (unless ASTROLABE_CHAT_LOG=0)
 */
export function chatLog(
  step: string,
  fields: ChatLogFields & { requestId?: string } = {},
): void {
  const payload = {
    ts: new Date().toISOString(),
    scope: 'chat',
    step,
    ...fields,
  };
  const line = JSON.stringify(payload);
  appendFileLog(line);
  if (CHAT_DEBUG) {
    console.info(line);
  }
}

export function newRequestId(): string {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function chatLogFilePath(): string {
  return resolveLogPath();
}
