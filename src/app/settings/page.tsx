'use client';

import { useEffect, useState } from 'react';
import { usePoll } from '@/components/hooks/use-poll';
import { Empty, ErrorNote, Panel, StatusDot } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { HealthStatus } from '@/core/types';

interface ProviderConfig {
  id: string;
  label: string;
  kind: 'ollama' | 'vllm' | 'openai-compatible';
  baseUrl: string;
  apiKeyEnv?: string;
  enabled: boolean;
  credentialsReady?: boolean;
}

interface AgentConfig {
  role: 'planner' | 'builder' | 'reviewer' | 'judge';
  label: string;
  providerId: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface SettingsResponse {
  providers: ProviderConfig[];
  agents: AgentConfig[];
  orchestrator: {
    maxRounds: number;
    defaultMode: string;
    autoApplyPatches: boolean;
    runTestsAutomatically: boolean;
  };
}

interface SystemProviders {
  providers: Array<{ id: string; health: { status: HealthStatus; detail: string; models?: string[] } }>;
}

const MODES = ['FAST', 'ENGINEER', 'DEEP_ANALYSIS', 'ARCHITECT', 'DEBUG', 'TEAM', 'EXTREME'];

/** SETTINGS: providers, per-role models and orchestrator behaviour. */
export default function SettingsPage() {
  const settings = usePoll<SettingsResponse>('/api/settings', 0);
  const system = usePoll<SystemProviders>('/api/system', 20_000);
  const [draft, setDraft] = useState<SettingsResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      await api.put('/api/settings', {
        providers: draft.providers.map(({ credentialsReady: _credentialsReady, ...provider }) => provider),
        agents: draft.agents,
        orchestrator: draft.orchestrator,
      });
      setNotice('Settings saved.');
      void settings.refresh();
      void system.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="p-4">
        <ErrorNote error={settings.error} />
        <Empty>Loading settings…</Empty>
      </div>
    );
  }

  const healthFor = (id: string): HealthStatus =>
    system.data?.providers.find((provider) => provider.id === id)?.health.status ?? 'UNKNOWN';
  const modelsFor = (id: string): string[] =>
    system.data?.providers.find((provider) => provider.id === id)?.health.models ?? [];

  return (
    <div className="vc-scroll h-full p-4">
      <ErrorNote error={settings.error} />

      <Panel title="Providers" className="mb-3">
        <div className="px-4 py-3">
          {draft.providers.map((provider, index) => (
            <div key={provider.id} className="mb-3 rounded-md border border-line bg-surface-raised px-3 py-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusDot status={healthFor(provider.id)} />
                <span className="text-[12.5px] text-ink">{provider.label}</span>
                <span className="vc-tag">{provider.kind}</span>
                <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-dim">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) => {
                      const providers = [...draft.providers];
                      providers[index] = { ...provider, enabled: event.target.checked };
                      setDraft({ ...draft, providers });
                    }}
                  />
                  enabled
                </label>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-[11.5px] text-ink-dim">
                  Base URL
                  <input
                    className="vc-input mt-1 vc-mono"
                    value={provider.baseUrl}
                    onChange={(event) => {
                      const providers = [...draft.providers];
                      providers[index] = { ...provider, baseUrl: event.target.value };
                      setDraft({ ...draft, providers });
                    }}
                  />
                </label>
                <label className="text-[11.5px] text-ink-dim">
                  API key environment variable (server side)
                  <input
                    className="vc-input mt-1 vc-mono"
                    value={provider.apiKeyEnv ?? ''}
                    placeholder="not required"
                    onChange={(event) => {
                      const providers = [...draft.providers];
                      providers[index] = { ...provider, apiKeyEnv: event.target.value || undefined };
                      setDraft({ ...draft, providers });
                    }}
                  />
                </label>
              </div>
              <div className="mt-1.5 text-[11px] text-ink-faint">
                {provider.apiKeyEnv
                  ? provider.credentialsReady
                    ? `${provider.apiKeyEnv} is set on the server`
                    : `${provider.apiKeyEnv} is NOT set on the server`
                  : 'no credential required'}
                {modelsFor(provider.id).length > 0 && ` · models: ${modelsFor(provider.id).slice(0, 6).join(', ')}`}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-ink-faint">
            Keys are read from the server environment at call time and never stored in the database or sent to the
            browser.
          </p>
        </div>
      </Panel>

      <Panel title="Agents" className="mb-3">
        <div className="px-4 py-3">
          {draft.agents.map((agent, index) => (
            <div key={agent.role} className="mb-2 grid gap-2 md:grid-cols-5">
              <div className="flex items-center gap-2 text-[12.5px] capitalize text-ink">
                <StatusDot status={healthFor(agent.providerId)} />
                {agent.role}
              </div>
              <label className="text-[11px] text-ink-dim">
                Provider
                <select
                  className="vc-input mt-1"
                  value={agent.providerId}
                  onChange={(event) => {
                    const agents = [...draft.agents];
                    agents[index] = { ...agent, providerId: event.target.value };
                    setDraft({ ...draft, agents });
                  }}
                >
                  {draft.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-ink-dim md:col-span-2">
                Model
                <input
                  className="vc-input mt-1 vc-mono"
                  list={`models-${agent.role}`}
                  value={agent.model}
                  onChange={(event) => {
                    const agents = [...draft.agents];
                    agents[index] = { ...agent, model: event.target.value };
                    setDraft({ ...draft, agents });
                  }}
                />
                <datalist id={`models-${agent.role}`}>
                  {modelsFor(agent.providerId).map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
              <label className="text-[11px] text-ink-dim">
                Temperature
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  className="vc-input mt-1"
                  value={agent.temperature}
                  onChange={(event) => {
                    const agents = [...draft.agents];
                    agents[index] = { ...agent, temperature: Number(event.target.value) };
                    setDraft({ ...draft, agents });
                  }}
                />
              </label>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-ink-faint">
            Roles are abstract: any model reachable through a provider can fill any role.
          </p>
        </div>
      </Panel>

      <Panel title="Orchestrator" className="mb-3">
        <div className="grid gap-3 px-4 py-3 md:grid-cols-4">
          <label className="text-[11.5px] text-ink-dim">
            Default mode
            <select
              className="vc-input mt-1"
              value={draft.orchestrator.defaultMode}
              onChange={(event) =>
                setDraft({ ...draft, orchestrator: { ...draft.orchestrator, defaultMode: event.target.value } })
              }
            >
              {MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11.5px] text-ink-dim">
            Max builder/reviewer rounds
            <input
              type="number"
              min={1}
              max={10}
              className="vc-input mt-1"
              value={draft.orchestrator.maxRounds}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  orchestrator: { ...draft.orchestrator, maxRounds: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="flex items-end gap-2 text-[11.5px] text-ink-dim">
            <input
              type="checkbox"
              checked={draft.orchestrator.autoApplyPatches}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  orchestrator: { ...draft.orchestrator, autoApplyPatches: event.target.checked },
                })
              }
            />
            Apply patches automatically
          </label>
          <label className="flex items-end gap-2 text-[11.5px] text-ink-dim">
            <input
              type="checkbox"
              checked={draft.orchestrator.runTestsAutomatically}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  orchestrator: { ...draft.orchestrator, runTestsAutomatically: event.target.checked },
                })
              }
            />
            Run checks after applying
          </label>
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <button type="button" className="vc-button vc-button-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {notice && <span className="text-[11.5px] text-ink-dim">{notice}</span>}
      </div>
    </div>
  );
}
