import type { HealthStatus } from '@/core/types';
import { ProviderHttpError } from './http';
import { singleton } from '@/core/util/singleton';

/**
 * Failure classification and the "last failure" record shown in diagnostics.
 *
 * The distinction matters operationally: OFFLINE means the GPU host is not
 * answering, ERROR means it answered and rejected us. Telling the user the wrong
 * one sends them to the wrong place.
 */

export function statusForFailure(error: unknown): HealthStatus {
  if (error instanceof ProviderHttpError) {
    switch (error.kind) {
      case 'unreachable':
      case 'timeout':
        return 'OFFLINE';
      case 'auth':
      case 'not-found':
      case 'protocol':
      case 'server':
        return 'ERROR';
      default:
        return 'ERROR';
    }
  }
  return 'ERROR';
}

export interface FailureRecord {
  providerId: string;
  at: string;
  kind: string;
  status: number | null;
  message: string;
}

function store(): Map<string, FailureRecord> {
  return singleton('provider-failures', () => new Map<string, FailureRecord>());
}

export function recordFailure(providerId: string, error: unknown): FailureRecord {
  const record: FailureRecord = {
    providerId,
    at: new Date().toISOString(),
    kind: error instanceof ProviderHttpError ? error.kind : 'unknown',
    status: error instanceof ProviderHttpError ? error.status : null,
    message: error instanceof Error ? error.message : String(error),
  };
  store().set(providerId, record);
  return record;
}

export function lastFailure(providerId: string): FailureRecord | null {
  return store().get(providerId) ?? null;
}

export function clearFailure(providerId: string): void {
  store().delete(providerId);
}
