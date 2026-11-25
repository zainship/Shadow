import fs from 'node:fs';
import path from 'node:path';
import { assertPublicHttpUrl } from './security.ts';

export type BridgeChannel = 'telegram' | 'discord' | 'slack';

export interface BridgesStoredConfig {
  telegramBotToken: string;
  telegramChatId: string;
  discordWebhookUrl: string;
  slackWebhookUrl: string;
}

export interface MaskedBridgesStatus {
  telegramConfigured: boolean;
  telegramChatId: string;
  discordConfigured: boolean;
  slackConfigured: boolean;
}

export interface BridgeDeliveryRecord {
  id: string;
  channel: BridgeChannel | 'all';
  title: string;
  ok: boolean;
  detail: string;
  timestamp: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BRIDGES_STORE_PATH = path.join(DATA_DIR, 'bridges-store.json');

const deliveryLog: BridgeDeliveryRecord[] = [];

function loadStoredConfig(): BridgesStoredConfig {
  try {
    const raw = fs.readFileSync(BRIDGES_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BridgesStoredConfig>;
    return {
      telegramBotToken: String(parsed.telegramBotToken || '').trim(),
      telegramChatId: String(parsed.telegramChatId || '').trim(),
      discordWebhookUrl: String(parsed.discordWebhookUrl || '').trim(),
      slackWebhookUrl: String(parsed.slackWebhookUrl || '').trim(),
    };
  } catch {
    return {
      telegramBotToken: '',
      telegramChatId: '',
      discordWebhookUrl: '',
      slackWebhookUrl: '',
    };
  }
}

function saveStoredConfig(cfg: BridgesStoredConfig): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${BRIDGES_STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, BRIDGES_STORE_PATH);
}

function resolveEffectiveBridges(): BridgesStoredConfig {
  const stored = loadStoredConfig();
  return {
    telegramBotToken: stored.telegramBotToken || (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    telegramChatId: stored.telegramChatId || (process.env.TELEGRAM_DEFAULT_CHAT_ID || '').trim(),
    discordWebhookUrl: stored.discordWebhookUrl || (process.env.DISCORD_WEBHOOK_URL || '').trim(),
    slackWebhookUrl: stored.slackWebhookUrl || (process.env.SLACK_WEBHOOK_URL || '').trim(),
  };
}

export function getMaskedBridgesStatus(): MaskedBridgesStatus {
  const eff = resolveEffectiveBridges();
  return {
    telegramConfigured: Boolean(eff.telegramBotToken && eff.telegramChatId),
    telegramChatId: eff.telegramChatId ? `${eff.telegramChatId.slice(0, 4)}***` : '',
    discordConfigured: Boolean(eff.discordWebhookUrl),
    slackConfigured: Boolean(eff.slackWebhookUrl),
  };
}

export function getBridgeDeliveryHistory(): BridgeDeliveryRecord[] {
  return [...deliveryLog].slice(0, 30);
}

function assertDiscordWebhookUrl(rawUrl: string): string {
  const parsed = assertPublicHttpUrl(rawUrl);
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    !(host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com')) ||
    !parsed.pathname.includes('/api/webhooks/')
  ) {
    throw new Error('Discord webhook URL must be an official https://discord.com/api/webhooks/... URL.');
  }
  return parsed.toString();
}

function assertSlackWebhookUrl(rawUrl: string): string {
  const parsed = assertPublicHttpUrl(rawUrl);
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    host !== 'hooks.slack.com' ||
    !parsed.pathname.startsWith('/services/')
  ) {
    throw new Error('Slack webhook URL must be an official https://hooks.slack.com/services/... URL.');
  }
  return parsed.toString();
}

export function updateBridgesConfig(patch: Partial<BridgesStoredConfig>): MaskedBridgesStatus {
  const current = loadStoredConfig();
  const next: BridgesStoredConfig = { ...current };

  if (patch.telegramBotToken !== undefined) {
    const val = String(patch.telegramBotToken || '').trim();
    if (val && !/^\d+:[a-zA-Z0-9_\-]{20,}$/.test(val)) {
      throw new Error('Invalid Telegram Bot token format.');
    }
    next.telegramBotToken = val;
  }
  if (patch.telegramChatId !== undefined) {
    next.telegramChatId = String(patch.telegramChatId || '').trim().slice(0, 64);
  }
  if (patch.discordWebhookUrl !== undefined) {
    const val = String(patch.discordWebhookUrl || '').trim();
    next.discordWebhookUrl = val ? assertDiscordWebhookUrl(val) : '';
  }
  if (patch.slackWebhookUrl !== undefined) {
    const val = String(patch.slackWebhookUrl || '').trim();
    next.slackWebhookUrl = val ? assertSlackWebhookUrl(val) : '';
  }

  saveStoredConfig(next);
  return getMaskedBridgesStatus();
}

function pushLog(rec: Omit<BridgeDeliveryRecord, 'id' | 'timestamp'>): BridgeDeliveryRecord {
  const full: BridgeDeliveryRecord = {
    id: `br-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    ...rec,
  };
  deliveryLog.unshift(full);
  if (deliveryLog.length > 40) deliveryLog.length = 40;
  return full;
}

export async function dispatchBridgeMessage(input: {
  channel: BridgeChannel | 'all';
  title?: string;
  message: string;
}): Promise<{ ok: boolean; results: BridgeDeliveryRecord[] }> {
  const eff = resolveEffectiveBridges();
  const title = (input.title || 'Shadow Alert').trim().slice(0, 120);
  const body = String(input.message || '').trim().slice(0, 3500);
  if (!body) {
    throw new Error('Bridge message text cannot be empty.');
  }

  const targets: BridgeChannel[] =
    input.channel === 'all' ? ['telegram', 'discord', 'slack'] : [input.channel];

  const results: BridgeDeliveryRecord[] = [];
  for (const ch of targets) {
    try {
      if (ch === 'telegram') {
        if (!eff.telegramBotToken || !eff.telegramChatId) {
          if (input.channel !== 'all') {
            results.push(pushLog({ channel: 'telegram', title, ok: false, detail: 'Telegram not configured.' }));
          }
          continue;
        }
        const res = await fetch(
          `https://api.telegram.org/bot${encodeURIComponent(eff.telegramBotToken)}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: eff.telegramChatId,
              text: `*${title.replace(/[*_`[\]]/g, '')}*\n\n${body}`,
              parse_mode: 'Markdown',
            }),
            signal: AbortSignal.timeout(9000),
          }
        );
        if (!res.ok) {
          const err = await res.text().catch(() => '');
          results.push(pushLog({ channel: 'telegram', title, ok: false, detail: `HTTP ${res.status}: ${err.slice(0, 140)}` }));
        } else {
          results.push(pushLog({ channel: 'telegram', title, ok: true, detail: 'Delivered via Telegram Bot API.' }));
        }
      } else if (ch === 'discord') {
        if (!eff.discordWebhookUrl) {
          if (input.channel !== 'all') {
            results.push(pushLog({ channel: 'discord', title, ok: false, detail: 'Discord webhook URL not configured.' }));
          }
          continue;
        }
        const safeUrl = assertDiscordWebhookUrl(eff.discordWebhookUrl);
        const res = await fetch(safeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'Shadow AI',
            content: `**${title}**\n${body.slice(0, 1800)}`,
          }),
          signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) {
          results.push(pushLog({ channel: 'discord', title, ok: false, detail: `Discord HTTP ${res.status}` }));
        } else {
          results.push(pushLog({ channel: 'discord', title, ok: true, detail: 'Delivered via Discord Webhook.' }));
        }
      } else if (ch === 'slack') {
        if (!eff.slackWebhookUrl) {
          if (input.channel !== 'all') {
            results.push(pushLog({ channel: 'slack', title, ok: false, detail: 'Slack webhook URL not configured.' }));
          }
          continue;
        }
        const safeUrl = assertSlackWebhookUrl(eff.slackWebhookUrl);
        const res = await fetch(safeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `*${title}*\n${body.slice(0, 2800)}`,
          }),
          signal: AbortSignal.timeout(9000),
        });
        if (!res.ok) {
          results.push(pushLog({ channel: 'slack', title, ok: false, detail: `Slack HTTP ${res.status}` }));
        } else {
          results.push(pushLog({ channel: 'slack', title, ok: true, detail: 'Delivered via Slack Webhook.' }));
        }
      }
    } catch (err) {
      results.push(
        pushLog({
          channel: ch,
          title,
          ok: false,
          detail: err instanceof Error ? err.message : 'Delivery error',
        })
      );
    }
  }

  return {
    ok: results.length > 0 && results.some((r) => r.ok),
    results,
  };
}

export async function sendTelegramDirectReply(chatId: string | number, text: string): Promise<boolean> {
  const eff = resolveEffectiveBridges();
  if (!eff.telegramBotToken) return false;
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(eff.telegramBotToken)}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3800),
      }),
      signal: AbortSignal.timeout(9000),
    }
  );
  return res.ok;
}
