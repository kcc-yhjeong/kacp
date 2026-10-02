import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../config.js';

export const newId = (): string => uuidv7();

/** 32 random bytes, base64url — session cookie values and generated secrets. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

// AES-256-GCM for `*_enc` columns: iv(12) | tag(16) | ciphertext.
export function encrypt(plain: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
}

const csrfKey = Buffer.from(hkdfSync('sha256', config.encryptionKey, Buffer.alloc(0), 'kacp-csrf', 32));

/** Per-session CSRF token (06-auth.md §3) — derived, so nothing extra is stored. */
export const csrfTokenFor = (sessionId: string): string =>
  createHmac('sha256', csrfKey).update(sessionId).digest('base64url');
