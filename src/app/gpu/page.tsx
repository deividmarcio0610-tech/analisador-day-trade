'use client';

import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, Panel, Spinner, StatusDot } from '@/components/ui/primitives';
import { formatTime } from '@/lib/api';
import type { HealthStatus } from '@/core/types';

interface GpuResponse {
  status: HealthStatus;
  vendor: string | null;
  detail: string;
  checkedAt: string;
  devices: Array<{
    index: number;
    name: string;
    memoryTotalMb: number | null;
    memoryUsedMb: number | null;
    utilizationPercent: number | null;
    temperatureC: number | null;
  }>;
  inference: Array<{
    provider: string;
    status: HealthStatus;
    endpoint: string;
    latencyMs: number | null;
    models: string[];
  }>;
}

/** GPU: device telemetry when the vendor tooling exists, inference endpoints always. */
export default function GpuPage() {
  const { data, error, loading, refresh } = usePoll<GpuResponse>('/api/gpu', 20_000);

  return (
    <div className="vc-scroll h-full p-4">
      <ErrorNote error={error} />
      {loading && !data && <div className="p-4"><Spinner label="querying host" /></div>}

      {data && (
        <>
          <Panel
            title="Devices"
            actions={
              <>
                <span className="vc-tag">
                  <StatusDot status={data.status} />
                  {data.status}
                </span>
                <button type="button" className="vc-button py-1" onClick={() => void refresh()}>
                  Refresh
                </button>
              </>
            }
            className="mb-3"
          >
            {data.devices.length === 0 ? (
              <Empty>{data.detail}</Empty>
            ) : (
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-2">#</th>
                    <th className="px-4 py-2">Device</th>
                    <th className="px-4 py-2">VRAM</th>
                    <th className="px-4 py-2">Utilisation</th>
                    <th className="px-4 py-2">Temperature</th>
                  </tr>
                </thead>
                <tbody>
                  {data.devices.map((device) => (
                    <tr key={device.index} className="border-b border-line last:border-0">
                      <td className="px-4 py-1.5 text-ink-faint">{device.index}</td>
                      <td className="px-4 py-1.5 text-ink">{device.name}</td>
                      <td className="px-4 py-1.5 text-ink-dim">
                        {device.memoryUsedMb ?? '—'} / {device.memoryTotalMb ?? '—'} MB
                      </td>
                      <td className="px-4 py-1.5 text-ink-dim">
                        {device.utilizationPercent === null ? '—' : `${device.utilizationPercent}%`}
                      </td>
                      <td className="px-4 py-1.5 text-ink-dim">
                        {device.temperatureC === null ? '—' : `${device.temperatureC} °C`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">
              {data.detail} · checked {formatTime(data.checkedAt)}
            </div>
          </Panel>

          <Panel title="Inference endpoints">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2">Provider</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Endpoint</th>
                  <th className="px-4 py-2">Latency</th>
                  <th className="px-4 py-2">Models</th>
                </tr>
              </thead>
              <tbody>
                {data.inference.map((provider) => (
                  <tr key={provider.provider} className="border-b border-line last:border-0">
                    <td className="px-4 py-1.5 text-ink">{provider.provider}</td>
                    <td className="px-4 py-1.5">
                      <span className="vc-tag">
                        <StatusDot status={provider.status} />
                        {provider.status}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 vc-mono text-ink-dim">{provider.endpoint}</td>
                    <td className="px-4 py-1.5 text-ink-faint">
                      {provider.latencyMs === null ? '—' : `${provider.latencyMs} ms`}
                    </td>
                    <td className="px-4 py-1.5 vc-mono text-[11px] text-ink-faint">
                      {provider.models.length === 0 ? '—' : provider.models.slice(0, 4).join(', ')}
                      {provider.models.length > 4 ? ` +${provider.models.length - 4}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}
