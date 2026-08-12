import { randomUUID, randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function shortId(): string {
  return randomBytes(4).toString('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}
