import argon2 from 'argon2';
import { authConfig } from './config.js';

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: authConfig.argon2.memoryCost,
    timeCost: authConfig.argon2.timeCost,
    parallelism: authConfig.argon2.parallelism,
  });
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  return argon2.verify(hash, plaintext);
}
