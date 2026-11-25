import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAiRuntime } from './ai-provider.ts';
import { runMorningBrief } from './brief.ts';
import { dispatchBridgeMessage } from './bridges.ts';
import { assertPublicHttpUrlWithDns, timingSafeEqualStr } from './security.ts';

export type ScheduleJobKind = 'morning_brief' | 'url_watch' | 'http_macro' | 'reminder_ping';

export interface ScheduledJobRecord {
  id: string;
  name: string;
  kind: ScheduleJobKind;
  enabled: boolean;
  intervalMinutes: number;
  targetUrl?: string;
  promptOrNote?: string;
  notifyBridge: boolean;
  lastRunAt?: number;
  lastStatus?: string;
  nextRunAt: number;
  createdAt: number;
}

export interface InboundWebhookRecord {
  id: string;
  name: string;
  secretPreview: string;
  secretHash: string;
  notifyBridge: boolean;
  hitCount: number;
  lastTriggeredAt?: number;
  createdAt: number;
}

export interface TriggerEventLog {
  id: string;
  source: 'schedule' | 'webhook';
  refId: string;
  name: string;
  ok: boolean;
  summary: string;
  timestamp: number;
}

interface SchedulerStore {
  jobs: ScheduledJobRecord[];
  webhooks: InboundWebhookRecord[];
  logs: TriggerEventLog[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SCHEDULER_STORE_PATH = path.join(DATA_DIR, 'scheduler-store.json');

function loadStore(): SchedulerStore {
  try {
    const raw = fs.readFileSync(SCHEDULER_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SchedulerStore>;
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch {
    return { jobs: [], webhooks: [], logs: [] };
  }
}

function saveStore(store: SchedulerStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const trimmed: SchedulerStore = {
    jobs: store.jobs.slice(0, 40),
    webhooks: store.webhooks.slice(0, 25),
    logs: store.logs.slice(0, 60),
  };
  const tmp = `${SCHEDULER_STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
  fs.renameSync(tmp, SCHEDULER_STORE_PATH);
}

function appendLog(store: SchedulerStore, entry: Omit<TriggerEventLog, 'id' | 'timestamp'>): TriggerEventLog {
  const rec: TriggerEventLog = {
    id: `trig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    ...entry,
  };
  store.logs.unshift(rec);
  store.logs = store.logs.slice(0, 60);
  return rec;
}

export function listSchedulerState(): SchedulerStore {
  return loadStore();
}

export function createScheduledJob(input: {
  name: string;
  kind: ScheduleJobKind;
  intervalMinutes: number;
  targetUrl?: string;
  promptOrNote?: string;
  notifyBridge?: boolean;
}): ScheduledJobRecord {
  const name = (String(input.name || '').trim() || 'Scheduled Job').slice(0, 100);
  const validKinds: ScheduleJobKind[] = ['morning_brief', 'url_watch', 'http_macro', 'reminder_ping'];
  const kind: ScheduleJobKind = validKinds.includes(input.kind) ? input.kind : 'reminder_ping';
  const intervalMinutes = Math.max(1, Math.min(10080, Math.round(Number(input.intervalMinutes) || 60)));

  let targetUrl = String(input.targetUrl || '').trim().slice(0, 500);
  if ((kind === 'url_watch' || kind === 'http_macro') && targetUrl) {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Target URL must use http:// or https://.');
    }
    targetUrl = parsed.toString();
  }

  const now = Date.now();
  const job: ScheduledJobRecord = {
    id: `job-${crypto.randomBytes(4).toString('hex')}`,
    name,
    kind,
    enabled: true,
    intervalMinutes,
    ...(targetUrl ? { targetUrl } : {}),
    ...(input.promptOrNote ? { promptOrNote: String(input.promptOrNote).slice(0, 500) } : {}),
    notifyBridge: Boolean(input.notifyBridge),
    nextRunAt: now + intervalMinutes * 60_000,
    createdAt: now,
  };

  const store = loadStore();
  store.jobs.unshift(job);
  saveStore(store);
  return job;
}

export function toggleScheduledJob(jobId: string, enabled: boolean): ScheduledJobRecord | null {
  const store = loadStore();
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  job.enabled = Boolean(enabled);
  if (job.enabled && job.nextRunAt < Date.now()) {
    job.nextRunAt = Date.now() + job.intervalMinutes * 60_000;
  }
  saveStore(store);
  return job;
}

export function deleteScheduledJob(jobId: string): boolean {
  const store = loadStore();
  const prevLen = store.jobs.length;
  store.jobs = store.jobs.filter((j) => j.id !== jobId);
  if (store.jobs.length === prevLen) return false;
  saveStore(store);
  return true;
}

export async function runScheduledJobNow(jobId: string): Promise<TriggerEventLog> {
  const store = loadStore();
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) {
    throw new Error('Scheduled job not found.');
  }

  let ok = true;
  let summary = '';
  try {
    if (job.kind === 'morning_brief') {
      const brief = await runMorningBrief({ runtime: resolveAiRuntime({}) });
      summary = `Generated Morning Brief: ${brief.headline}`;
      if (job.notifyBridge) {
        await dispatchBridgeMessage({
          channel: 'all',
          title: `Morning Brief (${brief.date})`,
          message: `${brief.headline}\n\nFirst move: ${brief.action}\n\n${brief.spokenSummary}`,
        });
      }
    } else if (job.kind === 'url_watch' || job.kind === 'http_macro') {
      if (!job.targetUrl) throw new Error('Target URL is missing for URL watch / HTTP macro.');
      const safeUrl = await assertPublicHttpUrlWithDns(job.targetUrl);
      const res = await fetch(safeUrl.toString(), { signal: AbortSignal.timeout(9000) });
      const text = (await res.text()).replace(/\s+/g, ' ').trim();
      const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      const snippet = titleMatch?.[1]?.trim() || text.slice(0, 140);
      ok = res.ok;
      summary = `HTTP ${res.status} from ${safeUrl.hostname} (${snippet})`;
      if (job.notifyBridge) {
        await dispatchBridgeMessage({
          channel: 'all',
          title: `Trigger: ${job.name}`,
          message: summary,
        });
      }
    } else {
      summary = job.promptOrNote?.trim() || `Scheduled reminder "${job.name}" fired.`;
      if (job.notifyBridge) {
        await dispatchBridgeMessage({
          channel: 'all',
          title: job.name,
          message: summary,
        });
      }
    }
  } catch (err) {
    ok = false;
    summary = err instanceof Error ? err.message : 'Scheduled trigger failed.';
  }

  const now = Date.now();
  job.lastRunAt = now;
  job.lastStatus = ok ? 'ok' : 'failed';
  job.nextRunAt = now + job.intervalMinutes * 60_000;
  const log = appendLog(store, {
    source: 'schedule',
    refId: job.id,
    name: job.name,
    ok,
    summary: summary.slice(0, 500),
  });
  saveStore(store);
  return log;
}

export function createInboundWebhook(input: {
  name: string;
  notifyBridge?: boolean;
}): { webhook: InboundWebhookRecord; secretOnce: string } {
  const name = (String(input.name || '').trim() || 'Inbound Trigger').slice(0, 80);
  const rawSecret = `shw_${crypto.randomBytes(18).toString('hex')}`;
  const secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

  const hook: InboundWebhookRecord = {
    id: `hk_${crypto.randomBytes(5).toString('hex')}`,
    name,
    secretPreview: `${rawSecret.slice(0, 8)}...`,
    secretHash,
    notifyBridge: input.notifyBridge !== false,
    hitCount: 0,
    createdAt: Date.now(),
  };

  const store = loadStore();
  store.webhooks.unshift(hook);
  saveStore(store);
  return { webhook: hook, secretOnce: rawSecret };
}

export function deleteInboundWebhook(hookId: string): boolean {
  const store = loadStore();
  const prev = store.webhooks.length;
  store.webhooks = store.webhooks.filter((w) => w.id !== hookId);
  if (store.webhooks.length === prev) return false;
  saveStore(store);
  return true;
}

export async function processInboundWebhook(input: {
  hookId: string;
  providedSecret: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; log: TriggerEventLog }> {
  const store = loadStore();
  const hook = store.webhooks.find((w) => w.id === input.hookId);
  if (!hook) {
    throw new Error('Webhook endpoint not found.');
  }

  const providedHash = crypto.createHash('sha256').update(input.providedSecret || '').digest('hex');
  const envSecret = (process.env.WEBHOOK_SIGNING_SECRET || '').trim();
  const matchesHook = Boolean(input.providedSecret) && timingSafeEqualStr(providedHash, hook.secretHash);
  const matchesGlobal = Boolean(envSecret && input.providedSecret) && timingSafeEqualStr(input.providedSecret, envSecret);

  if (!matchesHook && !matchesGlobal) {
    throw new Error('Unauthorized webhook secret.');
  }

  const eventMsg = String(
    input.payload?.message || input.payload?.summary || input.payload?.event || JSON.stringify(input.payload || {})
  ).slice(0, 500);

  hook.hitCount += 1;
  hook.lastTriggeredAt = Date.now();
  const log = appendLog(store, {
    source: 'webhook',
    refId: hook.id,
    name: hook.name,
    ok: true,
    summary: eventMsg,
  });
  saveStore(store);

  if (hook.notifyBridge) {
    await dispatchBridgeMessage({
      channel: 'all',
      title: `Webhook: ${hook.name}`,
      message: eventMsg,
    }).catch(() => {});
  }

  return { ok: true, log };
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerTickRunning = false;

export function startProactiveScheduler(): void {
  if (schedulerTimer) return;
  const tick = async () => {
    if (schedulerTickRunning) return;
    schedulerTickRunning = true;
    try {
      const store = loadStore();
      const now = Date.now();
      const due = store.jobs.filter((j) => j.enabled && j.nextRunAt <= now);
      for (const job of due) {
        await runScheduledJobNow(job.id);
      }
    } catch (err) {
      console.warn('[scheduler] tick warning:', err instanceof Error ? err.message : err);
    } finally {
      schedulerTickRunning = false;
    }
  };
  schedulerTimer = setInterval(() => {
    void tick();
  }, 30_000);
}
