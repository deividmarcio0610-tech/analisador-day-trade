import type { HealthStatus } from '@/core/types';
import { runCommand } from './process-runner';
import { providerStatuses } from '@/core/providers/registry';

/**
 * GPU STATUS
 *
 * Values come from `nvidia-smi` / `rocm-smi` when present. When no tool is
 * available the status is UNKNOWN and the fields stay null — nothing is
 * invented to fill the panel.
 */

export interface GpuDevice {
  index: number;
  name: string;
  memoryTotalMb: number | null;
  memoryUsedMb: number | null;
  utilizationPercent: number | null;
  temperatureC: number | null;
}

export interface GpuStatus {
  status: HealthStatus;
  vendor: 'nvidia' | 'amd' | null;
  devices: GpuDevice[];
  detail: string;
  inference: Array<{
    provider: string;
    status: HealthStatus;
    endpoint: string;
    latencyMs: number | null;
    models: string[];
  }>;
  checkedAt: string;
}

export async function gpuStatus(): Promise<GpuStatus> {
  const checkedAt = new Date().toISOString();
  const inference = (await providerStatuses()).map((provider) => ({
    provider: provider.id,
    status: provider.health.status,
    endpoint: provider.baseUrl,
    latencyMs: provider.health.latencyMs,
    models: provider.health.models ?? [],
  }));

  const nvidia = await runCommand({
    commandLine:
      'nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
    timeoutMs: 10_000,
    confirmed: true,
  }).catch(() => null);

  if (nvidia && nvidia.exitCode === 0 && nvidia.stdout.trim().length > 0) {
    const devices: GpuDevice[] = nvidia.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const parts = line.split(',').map((value) => value.trim());
        return {
          index: toNumber(parts[0]) ?? 0,
          name: parts[1] ?? 'unknown',
          memoryTotalMb: toNumber(parts[2]),
          memoryUsedMb: toNumber(parts[3]),
          utilizationPercent: toNumber(parts[4]),
          temperatureC: toNumber(parts[5]),
        };
      });
    return {
      status: 'ONLINE',
      vendor: 'nvidia',
      devices,
      detail: `${devices.length} NVIDIA device(s) reported by nvidia-smi`,
      inference,
      checkedAt,
    };
  }

  const rocm = await runCommand({
    commandLine: 'rocm-smi --showproductname --showmeminfo vram --csv',
    timeoutMs: 10_000,
    confirmed: true,
  }).catch(() => null);

  if (rocm && rocm.exitCode === 0 && rocm.stdout.trim().length > 0) {
    return {
      status: 'ONLINE',
      vendor: 'amd',
      devices: [],
      detail: 'rocm-smi responded; per-device parsing is not implemented for this vendor yet',
      inference,
      checkedAt,
    };
  }

  return {
    status: 'UNKNOWN',
    vendor: null,
    devices: [],
    detail: 'No GPU tooling found on this host (nvidia-smi / rocm-smi unavailable)',
    inference,
    checkedAt,
  };
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
