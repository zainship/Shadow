import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import { getApiOrigin, parseJsonSafely } from '../lib/apiBase';
import { reportExceptionError } from '../lib/errorStore';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_CARD,
  MAC_GLASS_FIELD,
  MAC_GLASS_SUBSURFACE,
  MAC_GLASS_TOOLBAR,
  MacSegmentedControl,
  MacToggleSwitch,
} from './MacWindowShell';

type TriggersSubtab = 'scheduler' | 'bridges' | 'cloudrun';

interface ScheduledJob {
  id: string;
  name: string;
  kind: 'morning_brief' | 'url_watch' | 'http_macro' | 'reminder_ping';
  enabled: boolean;
  intervalMinutes: number;
  targetUrl?: string;
  promptOrNote?: string;
  notifyBridge: boolean;
  lastRunAt?: number;
  lastStatus?: string;
  nextRunAt: number;
}

interface InboundWebhook {
  id: string;
  name: string;
  secretPreview: string;
  notifyBridge: boolean;
  hitCount: number;
  lastTriggeredAt?: number;
}

interface TriggerLog {
  id: string;
  source: 'schedule' | 'webhook';
  name: string;
  ok: boolean;
  summary: string;
  timestamp: number;
}

interface MaskedBridgeStatus {
  telegramConfigured: boolean;
  telegramChatId: string;
  discordConfigured: boolean;
  slackConfigured: boolean;
}

interface BridgeDelivery {
  id: string;
  channel: string;
  title: string;
  ok: boolean;
  detail: string;
  timestamp: number;
}

export const RemoteTriggersStage: React.FC = () => {
  const [subtab, setSubtab] = useState<TriggersSubtab>('scheduler');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Scheduler & Webhooks
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [webhooks, setWebhooks] = useState<InboundWebhook[]>([]);
  const [logs, setLogs] = useState<TriggerLog[]>([]);
  const [jobName, setJobName] = useState('');
  const [jobKind, setJobKind] = useState<ScheduledJob['kind']>('url_watch');
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [jobTargetUrl, setJobTargetUrl] = useState('');
  const [jobNote, setJobNote] = useState('');
  const [jobNotifyBridge, setJobNotifyBridge] = useState(true);

  const [hookName, setHookName] = useState('');
  const [hookSecretOnce, setHookSecretOnce] = useState<{ id: string; secret: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Messaging Bridges
  const [bridgeStatus, setBridgeStatus] = useState<MaskedBridgeStatus>({
    telegramConfigured: false,
    telegramChatId: '',
    discordConfigured: false,
    slackConfigured: false,
  });
  const [deliveries, setDeliveries] = useState<BridgeDelivery[]>([]);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [testChannel, setTestChannel] = useState<'all' | 'telegram' | 'discord' | 'slack'>('all');
  const [testMessage, setTestMessage] = useState('Shadow bridge dispatch test.');

  // Cloud Run Health
  const [runtimeHealth, setRuntimeHealth] = useState<{
    playwrightAvailable?: boolean;
    hasGeminiKey?: boolean;
  } | null>(null);

  const refreshScheduler = useCallback(async () => {
    try {
      const res = await fetch(`${getApiOrigin()}/api/scheduler/state`);
      const data = await parseJsonSafely<{
        jobs?: ScheduledJob[];
        webhooks?: InboundWebhook[];
        logs?: TriggerLog[];
      }>(res);
      if (res.ok && data) {
        setJobs(data.jobs || []);
        setWebhooks(data.webhooks || []);
        setLogs(data.logs || []);
      }
    } catch {
      // ignore offline
    }
  }, []);

  const refreshBridges = useCallback(async () => {
    try {
      const res = await fetch(`${getApiOrigin()}/api/bridges/status`);
      const data = await parseJsonSafely<{
        status?: MaskedBridgeStatus;
        deliveries?: BridgeDelivery[];
      }>(res);
      if (res.ok && data) {
        if (data.status) setBridgeStatus(data.status);
        if (data.deliveries) setDeliveries(data.deliveries);
      }
    } catch {
      // ignore offline
    }
  }, []);

  useEffect(() => {
    void refreshScheduler();
    void refreshBridges();
  }, [refreshScheduler, refreshBridges]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      window.setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobName.trim() || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/scheduler/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: jobName.trim(),
          kind: jobKind,
          intervalMinutes,
          targetUrl: jobTargetUrl.trim() || undefined,
          promptOrNote: jobNote.trim() || undefined,
          notifyBridge: jobNotifyBridge,
        }),
      });
      const data = await parseJsonSafely<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Could not create scheduled job.');
      setJobName('');
      setJobTargetUrl('');
      setJobNote('');
      await refreshScheduler();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Job creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleJob = async (job: ScheduledJob) => {
    await fetch(`${getApiOrigin()}/api/scheduler/jobs/${encodeURIComponent(job.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    await refreshScheduler();
  };

  const handleRunJobNow = async (jobId: string) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/scheduler/jobs/${encodeURIComponent(jobId)}/run`, {
        method: 'POST',
      });
      const data = await parseJsonSafely<{ log?: TriggerLog; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || 'Run failed.');
      await refreshScheduler();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Run failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    await fetch(`${getApiOrigin()}/api/scheduler/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
    await refreshScheduler();
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hookName.trim() || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/scheduler/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: hookName.trim(), notifyBridge: true }),
      });
      const data = await parseJsonSafely<{
        webhook?: InboundWebhook;
        secretOnce?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data?.webhook || !data.secretOnce) {
        throw new Error(data?.error || 'Could not create webhook.');
      }
      setHookName('');
      setHookSecretOnce({ id: data.webhook.id, secret: data.secretOnce });
      await refreshScheduler();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Webhook creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteWebhook = async (hookId: string) => {
    await fetch(`${getApiOrigin()}/api/scheduler/webhooks/${encodeURIComponent(hookId)}`, {
      method: 'DELETE',
    });
    if (hookSecretOnce?.id === hookId) setHookSecretOnce(null);
    await refreshScheduler();
  };

  const handleSaveBridges = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload: Record<string, string> = {};
      if (telegramToken.trim()) payload.telegramBotToken = telegramToken.trim();
      if (telegramChatId.trim()) payload.telegramChatId = telegramChatId.trim();
      if (discordWebhookUrl.trim()) payload.discordWebhookUrl = discordWebhookUrl.trim();
      if (slackWebhookUrl.trim()) payload.slackWebhookUrl = slackWebhookUrl.trim();
      const res = await fetch(`${getApiOrigin()}/api/bridges/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseJsonSafely<{
        ok?: boolean;
        status?: MaskedBridgeStatus;
        error?: string;
      }>(res);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Could not save bridge settings.');
      if (data.status) setBridgeStatus(data.status);
      setTelegramToken('');
      setTelegramChatId('');
      setDiscordWebhookUrl('');
      setSlackWebhookUrl('');
      setStatusMsg('Bridge settings saved (credentials are masked on the server).');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bridge configuration failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendTestBridge = async () => {
    if (!testMessage.trim() || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/bridges/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: testChannel,
          title: 'Shadow Dispatch',
          message: testMessage.trim(),
        }),
      });
      const data = await parseJsonSafely<{ deliveries?: BridgeDelivery[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || 'Dispatch failed.');
      if (data?.deliveries) setDeliveries(data.deliveries);
      setStatusMsg('Dispatch attempted — check delivery log below.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bridge send failed.');
    } finally {
      setBusy(false);
    }
  };

  const checkCloudHealth = async () => {
    try {
      const res = await fetch(`${getApiOrigin()}/api/health`);
      const data = await parseJsonSafely<{
        hasGeminiKey?: boolean;
        playwrightRuntime?: { available?: boolean };
      }>(res);
      if (data) {
        setRuntimeHealth({
          hasGeminiKey: data.hasGeminiKey,
          playwrightAvailable: data.playwrightRuntime?.available,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach /api/health';
      setErrorMsg(msg);
      reportExceptionError('Server Health Check', err, msg, { endpoint: '/api/health' });
    }
  };

  const baseOrigin =
    typeof window !== 'undefined' ? getApiOrigin() || window.location.origin : 'https://your-service.run.app';
  const cloudRunSnippet = `gcloud run deploy shadow-assistant \\\n  --source . \\\n  --port 3000 \\\n  --allow-unauthenticated \\\n  --set-env-vars GEMINI_API_KEY="YOUR_KEY",APP_ORIGIN="https://shadow-solodev.web.app"`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={MAC_GLASS_TOOLBAR}>
        <MacSegmentedControl
          layoutId="triggers-stage-tabs"
          value={subtab}
          onChange={setSubtab}
          options={[
            { id: 'scheduler', label: `Scheduler & Hooks (${jobs.length})` },
            { id: 'bridges', label: 'Messaging Bridges' },
            { id: 'cloudrun', label: 'Cloud Run Deploy' },
          ]}
        />
        <button
          type="button"
          onClick={() => {
            void refreshScheduler();
            void refreshBridges();
          }}
          className={`ml-auto ${MAC_GLASS_BTN_SECONDARY}`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {(errorMsg || statusMsg) && (
        <div
          className={`px-5 py-2.5 text-xs border-b border-white/10 flex items-start justify-between gap-3 ${
            errorMsg ? 'bg-rose-500/12 text-rose-200' : 'bg-emerald-500/12 text-emerald-200'
          }`}
        >
          <span className="whitespace-pre-wrap break-words leading-relaxed min-w-0">
            {errorMsg || statusMsg}
          </span>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setStatusMsg(null);
            }}
            className="text-[11px] underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {subtab === 'scheduler' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 space-y-4">
              <form onSubmit={handleCreateJob} className={`p-4 space-y-3 ${MAC_GLASS_CARD}`}>
                <h3 className="text-xs font-semibold text-slate-200">Create Proactive Schedule</h3>
                <input
                  type="text"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="Job name (e.g. Check production health)"
                  className={MAC_GLASS_FIELD}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={jobKind}
                    onChange={(e) => setJobKind(e.target.value as ScheduledJob['kind'])}
                    className={MAC_GLASS_FIELD}
                  >
                    <option value="url_watch">URL Health Watch</option>
                    <option value="http_macro">HTTP Poll</option>
                    <option value="morning_brief">Morning Brief</option>
                    <option value="reminder_ping">Reminder Ping</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
                    className={MAC_GLASS_FIELD}
                    placeholder="Interval (min)"
                  />
                </div>
                {(jobKind === 'url_watch' || jobKind === 'http_macro') && (
                  <input
                    type="url"
                    value={jobTargetUrl}
                    onChange={(e) => setJobTargetUrl(e.target.value)}
                    placeholder="https://example.com"
                    className={`${MAC_GLASS_FIELD} font-mono`}
                  />
                )}
                {jobKind === 'reminder_ping' && (
                  <input
                    type="text"
                    value={jobNote}
                    onChange={(e) => setJobNote(e.target.value)}
                    placeholder="Reminder text to dispatch..."
                    className={MAC_GLASS_FIELD}
                  />
                )}
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Notify configured bridges</span>
                  <MacToggleSwitch
                    checked={jobNotifyBridge}
                    onChange={() => setJobNotifyBridge((v) => !v)}
                    label="Notify bridges"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!jobName.trim() || busy}
                  className={`w-full ${MAC_GLASS_BTN_PRIMARY}`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Schedule Job</span>
                </button>
              </form>

              <form onSubmit={handleCreateWebhook} className={`p-4 space-y-3 ${MAC_GLASS_CARD}`}>
                <h3 className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                  <Webhook className="w-3.5 h-3.5 text-sky-300" />
                  <span>Create Inbound Webhook</span>
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={hookName}
                    onChange={(e) => setHookName(e.target.value)}
                    placeholder="Webhook label (e.g. Deploy Alert)"
                    className={`${MAC_GLASS_FIELD} flex-1`}
                  />
                  <button
                    type="submit"
                    disabled={!hookName.trim() || busy}
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    <span>Create</span>
                  </button>
                </div>

                {hookSecretOnce && (
                  <div className="p-3 rounded-xl bg-amber-500/12 border border-amber-400/35 space-y-2 text-xs">
                    <p className="font-semibold text-amber-200">
                      Copy Webhook Secret Now (shown once)
                    </p>
                    <pre className="p-2 rounded bg-black/45 font-mono text-[11px] text-slate-100 overflow-x-auto">
                      {`curl -X POST ${baseOrigin}/api/hooks/${hookSecretOnce.id} \\\n  -H "Content-Type: application/json" \\\n  -H "x-webhook-secret: ${hookSecretOnce.secret}" \\\n  -d '{"event":"deploy_ok","message":"Build green"}'`}
                    </pre>
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(
                          'hook-curl',
                          `curl -X POST ${baseOrigin}/api/hooks/${hookSecretOnce.id} -H "Content-Type: application/json" -H "x-webhook-secret: ${hookSecretOnce.secret}" -d '{"event":"ping"}'`
                        )
                      }
                      className={MAC_GLASS_BTN_SECONDARY}
                    >
                      {copiedId === 'hook-curl' ? (
                        <Check className="w-3 h-3 text-emerald-300" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedId === 'hook-curl' ? 'Copied' : 'Copy cURL'}</span>
                    </button>
                  </div>
                )}
              </form>
            </div>

            <div className="lg:col-span-7 space-y-4">
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">Active Schedules</h3>
                {jobs.length === 0 ? (
                  <div className={`p-5 text-center text-xs text-slate-400 ${MAC_GLASS_SUBSURFACE}`}>
                    No scheduled jobs yet.
                  </div>
                ) : (
                  jobs.map((job) => (
                    <div
                      key={job.id}
                      className={`p-3 flex items-center justify-between gap-3 ${MAC_GLASS_CARD}`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-100 truncate">{job.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {job.kind} · every {job.intervalMinutes}m
                          {job.lastStatus ? ` · last ${job.lastStatus}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <MacToggleSwitch
                          checked={job.enabled}
                          onChange={() => void handleToggleJob(job)}
                          label={`Toggle ${job.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => void handleRunJobNow(job.id)}
                          className={MAC_GLASS_BTN_SECONDARY}
                        >
                          <Play className="w-3 h-3 text-emerald-300" />
                          <span>Run</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteJob(job.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                          aria-label={`Delete ${job.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">
                  Inbound Webhooks ({webhooks.length})
                </h3>
                {webhooks.map((w) => (
                  <div
                    key={w.id}
                    className={`p-3 flex items-center justify-between gap-3 ${MAC_GLASS_SUBSURFACE}`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-100 truncate">{w.name}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">
                        POST /api/hooks/{w.id} · secret {w.secretPreview} · {w.hitCount} hits
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteWebhook(w.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {logs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-300">Recent Trigger History</h3>
                  <div className={`divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                    {logs.slice(0, 10).map((l) => (
                      <div key={l.id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-slate-200 truncate">
                            [{l.source}] {l.name}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">{l.summary}</p>
                        </div>
                        <span
                          className={`text-[11px] shrink-0 ${
                            l.ok ? 'text-emerald-300' : 'text-rose-300'
                          }`}
                        >
                          {l.ok ? 'OK' : 'Failed'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {subtab === 'bridges' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <form onSubmit={handleSaveBridges} className={`lg:col-span-6 p-4 space-y-3 ${MAC_GLASS_CARD}`}>
              <h3 className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-sky-300" />
                <span>Configure Messaging Bridges</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Status: Telegram {bridgeStatus.telegramConfigured ? `Configured (${bridgeStatus.telegramChatId})` : 'Not set'} · Discord{' '}
                {bridgeStatus.discordConfigured ? 'Configured' : 'Not set'} · Slack{' '}
                {bridgeStatus.slackConfigured ? 'Configured' : 'Not set'}
              </p>

              <div className="space-y-2">
                <input
                  type="password"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder="Telegram Bot Token (e.g. 123456:ABC...)"
                  className={MAC_GLASS_FIELD}
                />
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="Telegram Default Chat ID"
                  className={MAC_GLASS_FIELD}
                />
                <input
                  type="password"
                  value={discordWebhookUrl}
                  onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  placeholder="Discord Webhook URL (https://discord.com/api/webhooks/...)"
                  className={MAC_GLASS_FIELD}
                />
                <input
                  type="password"
                  value={slackWebhookUrl}
                  onChange={(e) => setSlackWebhookUrl(e.target.value)}
                  placeholder="Slack Webhook URL (https://hooks.slack.com/services/...)"
                  className={MAC_GLASS_FIELD}
                />
              </div>

              <button type="submit" disabled={busy} className={MAC_GLASS_BTN_PRIMARY}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Save Bridge Config</span>
              </button>
            </form>

            <div className="lg:col-span-6 space-y-4">
              <div className={`p-4 space-y-3 ${MAC_GLASS_CARD}`}>
                <h3 className="text-xs font-semibold text-slate-200">Test Bridge Dispatch</h3>
                <div className="flex items-center gap-2">
                  <select
                    value={testChannel}
                    onChange={(e) =>
                      setTestChannel(e.target.value as 'all' | 'telegram' | 'discord' | 'slack')
                    }
                    className={`${MAC_GLASS_FIELD} max-w-[140px]`}
                  >
                    <option value="all">All configured</option>
                    <option value="telegram">Telegram</option>
                    <option value="discord">Discord</option>
                    <option value="slack">Slack</option>
                  </select>
                  <input
                    type="text"
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    className={`${MAC_GLASS_FIELD} flex-1`}
                  />
                  <button
                    type="button"
                    disabled={busy || !testMessage.trim()}
                    onClick={() => void handleSendTestBridge()}
                    className={MAC_GLASS_BTN_PRIMARY}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">
                  Delivery History ({deliveries.length})
                </h3>
                {deliveries.length === 0 ? (
                  <div className={`p-5 text-center text-xs text-slate-400 ${MAC_GLASS_SUBSURFACE}`}>
                    No deliveries sent yet.
                  </div>
                ) : (
                  <div className={`divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                    {deliveries.map((d) => (
                      <div key={d.id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-slate-100 truncate">
                            {d.channel} · {d.title}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">{d.detail}</p>
                        </div>
                        <span className={d.ok ? 'text-emerald-300 text-[11px]' : 'text-rose-300 text-[11px]'}>
                          {d.ok ? 'Sent' : 'Failed'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {subtab === 'cloudrun' && (
          <div className="max-w-3xl space-y-4">
            <div className={`p-5 space-y-3 ${MAC_GLASS_CARD}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-sky-300" />
                  <span>Cloud Run Companion Backend</span>
                </h3>
                <button
                  type="button"
                  onClick={() => void checkCloudHealth()}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  <span>Check Backend Health</span>
                </button>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Deploy the containerized Node + Playwright companion server to Google Cloud Run so voice sessions, background schedules, inbound webhooks, messaging bridges, and full JS Chromium automation work everywhere.
              </p>

              {runtimeHealth && (
                <p className="text-xs text-sky-300">
                  Server Gemini Key: {runtimeHealth.hasGeminiKey ? 'Configured' : 'Not set'} · Playwright Chromium:{' '}
                  {runtimeHealth.playwrightAvailable ? 'Active' : 'Fallback HTTP/DOM mode'}
                </p>
              )}

              <pre className="p-3 rounded-xl bg-black/50 border border-white/10 text-xs font-mono text-slate-200 overflow-x-auto">
                {cloudRunSnippet}
              </pre>
              <button
                type="button"
                onClick={() => void copyText('cloudrun', cloudRunSnippet)}
                className={MAC_GLASS_BTN_SECONDARY}
              >
                {copiedId === 'cloudrun' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedId === 'cloudrun' ? 'Copied command' : 'Copy deploy command'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
