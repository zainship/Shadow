import { Type } from '@google/genai';
import type express from 'express';
import { openRouterGenerate, type AiRuntime } from './ai-provider.ts';
import { getGeminiClient, getModelConfig, withGeminiRetry } from './gemini.ts';

export class WorkspaceApiError extends Error {
  status: number;
  needsReauth: boolean;

  constructor(message: string, status = 500, needsReauth = false) {
    super(message);
    this.status = status;
    this.needsReauth = needsReauth;
  }
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  bodyText?: string;
}

export interface CalendarEventItem {
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  description: string;
  htmlLink: string;
  attendees: string[];
  status: string;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  size: string;
}

export function extractWorkspaceBearerToken(req: express.Request): string {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    throw new WorkspaceApiError(
      'Google Workspace permission token missing. Click "Connect Google Workspace" in the Workspace stage.',
      401,
      true
    );
  }
  const token = authHeader.slice(7).trim();
  if (!token || token.length < 12) {
    throw new WorkspaceApiError(
      'Invalid or empty Google Workspace access token. Please reconnect your Google account.',
      401,
      true
    );
  }
  return token;
}

async function googleFetchJson<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };

  const res = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(12_000),
  });

  if (res.status === 401) {
    throw new WorkspaceApiError(
      'Your Google Workspace session expired. Reconnect Google Workspace to grant fresh access.',
      401,
      true
    );
  }
  if (res.status === 403) {
    const errText = await res.text().catch(() => '');
    const hint = errText.includes('insufficientPermissions') || errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')
      ? 'Additional Google Workspace permissions are needed. Click Reconnect Workspace and approve Gmail, Calendar, and Drive access.'
      : `Google Workspace API permission error: ${errText.slice(0, 200)}`;
    throw new WorkspaceApiError(hint, 403, true);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new WorkspaceApiError(
      `Google Workspace request failed (HTTP ${res.status}): ${errText.slice(0, 220)}`,
      res.status >= 400 && res.status < 600 ? res.status : 502,
      false
    );
  }
  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

function decodeBase64Url(input: string): string {
  if (!input) return '';
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64').toString('utf8');
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sanitizeHeaderValue(value: string, maxLen = 280): string {
  return String(value || '')
    .replace(/[\r\n\0]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

interface GmailPayloadPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayloadPart[];
  headers?: Array<{ name?: string; value?: string }>;
}

function extractPlainTextFromPayload(payload?: GmailPayloadPart): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data).slice(0, 6000);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const txt = extractPlainTextFromPayload(part);
      if (txt) return txt;
    }
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    const html = decodeBase64Url(payload.body.data);
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
  }
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data).slice(0, 5000);
  }
  return '';
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, key: string): string {
  const lower = key.toLowerCase();
  const hit = (headers || []).find((h) => String(h?.name || '').toLowerCase() === lower);
  return String(hit?.value || '').trim();
}

export async function listGmailMessages(
  token: string,
  opts: { query?: string; maxResults?: number; unreadOnly?: boolean } = {}
): Promise<GmailMessageSummary[]> {
  const maxResults = Math.max(1, Math.min(15, Number(opts.maxResults || 10) || 10));
  const queryParts: string[] = [];
  if (opts.unreadOnly) queryParts.push('is:unread');
  if (opts.query?.trim()) queryParts.push(opts.query.trim().slice(0, 200));

  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (queryParts.length > 0) params.set('q', queryParts.join(' '));

  const listData = await googleFetchJson<{ messages?: Array<{ id: string; threadId: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    token
  );

  const refs = (listData.messages || []).slice(0, maxResults);
  if (refs.length === 0) return [];

  const details = await Promise.all(
    refs.map(async (ref) => {
      try {
        const msg = await googleFetchJson<{
          id: string;
          threadId: string;
          labelIds?: string[];
          snippet?: string;
          payload?: GmailPayloadPart;
        }>(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          token
        );
        const headers = msg.payload?.headers;
        return {
          id: msg.id,
          threadId: msg.threadId,
          from: headerValue(headers, 'From') || 'Unknown sender',
          to: headerValue(headers, 'To'),
          subject: headerValue(headers, 'Subject') || '(No subject)',
          date: headerValue(headers, 'Date'),
          snippet: String(msg.snippet || '').trim(),
          unread: Array.isArray(msg.labelIds) && msg.labelIds.includes('UNREAD'),
        } satisfies GmailMessageSummary;
      } catch {
        return null;
      }
    })
  );

  return details.filter((item): item is GmailMessageSummary => Boolean(item));
}

export async function getGmailMessageDetail(
  token: string,
  messageId: string
): Promise<GmailMessageSummary> {
  const msg = await googleFetchJson<{
    id: string;
    threadId: string;
    labelIds?: string[];
    snippet?: string;
    payload?: GmailPayloadPart;
  }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    token
  );
  const headers = msg.payload?.headers;
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: headerValue(headers, 'From') || 'Unknown sender',
    to: headerValue(headers, 'To'),
    subject: headerValue(headers, 'Subject') || '(No subject)',
    date: headerValue(headers, 'Date'),
    snippet: String(msg.snippet || '').trim(),
    unread: Array.isArray(msg.labelIds) && msg.labelIds.includes('UNREAD'),
    bodyText: extractPlainTextFromPayload(msg.payload) || String(msg.snippet || '').trim(),
  };
}

export async function summarizeGmailInbox(
  token: string,
  opts: { query?: string; maxResults?: number; runtime?: AiRuntime | null } = {}
): Promise<{
  messages: GmailMessageSummary[];
  digest: string;
  priorityItems: string[];
}> {
  const messages = await listGmailMessages(token, {
    query: opts.query,
    maxResults: opts.maxResults || 8,
  });
  if (messages.length === 0) {
    return {
      messages: [],
      digest: 'No matching emails found in Gmail.',
      priorityItems: [],
    };
  }

  const prompt = [
    'Summarize these Gmail messages concisely and list up to 5 actionable priority items.',
    messages
      .map(
        (m, idx) =>
          `[${idx + 1}] ${m.unread ? '[UNREAD] ' : ''}From: ${m.from} | Subject: ${m.subject} | Snippet: ${m.snippet}`
      )
      .join('\n'),
  ].join('\n\n');

  const schema = {
    type: Type.OBJECT,
    properties: {
      digest: { type: Type.STRING },
      priorityItems: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['digest', 'priorityItems'],
  };

  try {
    let rawJson = '';
    if (opts.runtime?.provider === 'openrouter') {
      const turn = await openRouterGenerate({
        apiKey: opts.runtime.apiKey,
        model: opts.runtime.model,
        systemInstruction: 'Return strictly valid JSON summarizing email priority items.',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        jsonSchema: schema as unknown as Record<string, unknown>,
      });
      rawJson = turn.text;
    } else {
      const ai = getGeminiClient(opts.runtime?.apiKey);
      const res = await withGeminiRetry(
        () =>
          ai.models.generateContent({
            model: getModelConfig().fastText,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: schema,
            },
          }),
        1
      );
      rawJson = res.text ?? '';
    }
    const parsed = JSON.parse(rawJson.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as {
      digest?: string;
      priorityItems?: string[];
    };
    return {
      messages,
      digest: String(parsed.digest || 'Inbox summarized.').slice(0, 800),
      priorityItems: Array.isArray(parsed.priorityItems)
        ? parsed.priorityItems.map((p) => String(p).slice(0, 200)).slice(0, 5)
        : [],
    };
  } catch {
    const unread = messages.filter((m) => m.unread);
    return {
      messages,
      digest: `Fetched ${messages.length} email(s) (${unread.length} unread). Latest from ${messages[0].from}: "${messages[0].subject}".`,
      priorityItems: messages.slice(0, 3).map((m) => `${m.subject} — ${m.from}`),
    };
  }
}

function buildMimeRaw(input: { to: string; subject: string; body: string }): string {
  const safeTo = sanitizeHeaderValue(input.to, 320);
  const safeSubject = sanitizeHeaderValue(input.subject, 240);
  if (!safeTo || !safeTo.includes('@')) {
    throw new WorkspaceApiError('Valid recipient email address is required.', 400);
  }
  const safeBody = String(input.body || '').slice(0, 12_000);
  const mime = [
    `To: ${safeTo}`,
    `Subject: ${safeSubject || '(No subject)'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    safeBody,
  ].join('\r\n');
  return encodeBase64Url(mime);
}

export async function createGmailDraft(
  token: string,
  input: { to: string; subject: string; body: string; threadId?: string }
): Promise<{ id: string; messageId?: string }> {
  const raw = buildMimeRaw(input);
  const created = await googleFetchJson<{ id: string; message?: { id?: string } }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          raw,
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
      }),
    }
  );
  return { id: created.id, messageId: created.message?.id };
}

export async function sendGmailMessage(
  token: string,
  input: { to: string; subject: string; body: string; threadId?: string }
): Promise<{ id: string; threadId?: string }> {
  const raw = buildMimeRaw(input);
  const sent = await googleFetchJson<{ id: string; threadId?: string }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }),
    }
  );
  return { id: sent.id, threadId: sent.threadId };
}

export async function listCalendarEvents(
  token: string,
  opts: { timeMin?: string; timeMax?: string; maxResults?: number } = {}
): Promise<CalendarEventItem[]> {
  const now = new Date();
  const timeMin = opts.timeMin || new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const timeMax = opts.timeMax || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const maxResults = Math.max(1, Math.min(25, Number(opts.maxResults || 15) || 15));

  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin,
    timeMax,
    maxResults: String(maxResults),
  });

  const data = await googleFetchJson<{
    items?: Array<{
      id: string;
      summary?: string;
      location?: string;
      description?: string;
      htmlLink?: string;
      status?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: Array<{ email?: string }>;
    }>;
  }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, token);

  return (data.items || []).map((ev) => ({
    id: ev.id,
    summary: ev.summary || '(Untitled Event)',
    start: ev.start?.dateTime || ev.start?.date || '',
    end: ev.end?.dateTime || ev.end?.date || '',
    location: ev.location || '',
    description: (ev.description || '').slice(0, 500),
    htmlLink: ev.htmlLink || '',
    attendees: (ev.attendees || []).map((a) => a.email || '').filter(Boolean).slice(0, 10),
    status: ev.status || 'confirmed',
  }));
}

export async function createCalendarEvent(
  token: string,
  input: {
    summary: string;
    startIso: string;
    endIso: string;
    description?: string;
    location?: string;
    attendees?: string[];
  }
): Promise<CalendarEventItem> {
  const summary = String(input.summary || '').trim().slice(0, 200);
  if (!summary) {
    throw new WorkspaceApiError('Calendar event summary is required.', 400);
  }
  const startMs = Date.parse(input.startIso);
  const endMs = Date.parse(input.endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new WorkspaceApiError('Valid ISO start and end timestamps are required.', 400);
  }

  const created = await googleFetchJson<{
    id: string;
    summary?: string;
    location?: string;
    description?: string;
    htmlLink?: string;
    status?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{ email?: string }>;
  }>('https://www.googleapis.com/calendar/v3/calendars/primary/events', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary,
      description: input.description ? String(input.description).slice(0, 1000) : undefined,
      location: input.location ? String(input.location).slice(0, 240) : undefined,
      start: { dateTime: new Date(startMs).toISOString() },
      end: { dateTime: new Date(endMs).toISOString() },
      ...(Array.isArray(input.attendees) && input.attendees.length > 0
        ? {
            attendees: input.attendees
              .map((email) => String(email).trim())
              .filter((email) => email.includes('@'))
              .slice(0, 10)
              .map((email) => ({ email })),
          }
        : {}),
    }),
  });

  return {
    id: created.id,
    summary: created.summary || summary,
    start: created.start?.dateTime || created.start?.date || input.startIso,
    end: created.end?.dateTime || created.end?.date || input.endIso,
    location: created.location || '',
    description: created.description || '',
    htmlLink: created.htmlLink || '',
    attendees: (created.attendees || []).map((a) => a.email || '').filter(Boolean),
    status: created.status || 'confirmed',
  };
}

export async function deleteCalendarEvent(token: string, eventId: string): Promise<void> {
  const cleanId = String(eventId || '').trim();
  if (!cleanId || !/^[a-zA-Z0-9_\-]+$/.test(cleanId)) {
    throw new WorkspaceApiError('Valid Calendar event ID is required.', 400);
  }
  await googleFetchJson(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(cleanId)}`,
    token,
    { method: 'DELETE' }
  );
}

export async function listDriveFiles(
  token: string,
  opts: { query?: string; pageSize?: number } = {}
): Promise<DriveFileItem[]> {
  const pageSize = Math.max(1, Math.min(25, Number(opts.pageSize || 12) || 12));
  const qParts = ['trashed = false'];
  if (opts.query?.trim()) {
    const escaped = opts.query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'").slice(0, 140);
    qParts.push(`name contains '${escaped}'`);
  }

  const params = new URLSearchParams({
    pageSize: String(pageSize),
    orderBy: 'modifiedTime desc',
    q: qParts.join(' and '),
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)',
  });

  const data = await googleFetchJson<{
    files?: Array<{
      id: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      webViewLink?: string;
      size?: string;
    }>;
  }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, token);

  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name || 'Untitled File',
    mimeType: f.mimeType || 'application/octet-stream',
    modifiedTime: f.modifiedTime || '',
    webViewLink: f.webViewLink || '',
    size: f.size || '',
  }));
}

export async function readDriveFileContent(
  token: string,
  fileId: string,
  runtime?: AiRuntime | null
): Promise<{ file: DriveFileItem; content: string; summary: string }> {
  const cleanId = String(fileId || '').trim();
  if (!cleanId || !/^[a-zA-Z0-9_\-]+$/.test(cleanId)) {
    throw new WorkspaceApiError('Valid Google Drive file ID is required.', 400);
  }

  const meta = await googleFetchJson<DriveFileItem>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}?fields=id,name,mimeType,modifiedTime,webViewLink,size`,
    token
  );

  let downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}?alt=media`;
  if (meta.mimeType === 'application/vnd.google-apps.document') {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}/export?mimeType=text/plain`;
  } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}/export?mimeType=text/csv`;
  } else if (meta.mimeType === 'application/vnd.google-apps.presentation') {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}/export?mimeType=text/plain`;
  }

  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new WorkspaceApiError('Google Drive file read permission missing or expired.', res.status, true);
  }
  if (!res.ok) {
    throw new WorkspaceApiError(`Could not read Drive file (HTTP ${res.status}).`, res.status);
  }

  const isTextLike =
    meta.mimeType.startsWith('text/') ||
    meta.mimeType.includes('json') ||
    meta.mimeType.includes('xml') ||
    meta.mimeType.startsWith('application/vnd.google-apps.');

  const rawText = isTextLike ? (await res.text()).slice(0, 12_000) : `Binary file (${meta.mimeType}, size ${meta.size || 'unknown'}).`;

  let summary = rawText.slice(0, 420);
  if (isTextLike && rawText.length > 80) {
    try {
      if (runtime?.provider === 'openrouter') {
        const turn = await openRouterGenerate({
          apiKey: runtime.apiKey,
          model: runtime.model,
          contents: [{ role: 'user', parts: [{ text: `Summarize "${meta.name}" in 3 crisp bullet points:\n\n${rawText.slice(0, 6000)}` }] }],
        });
        summary = turn.text.slice(0, 800) || summary;
      } else {
        const ai = getGeminiClient(runtime?.apiKey);
        const sumRes = await withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: getModelConfig().fastText,
              contents: `Summarize "${meta.name}" in 3 crisp bullet points:\n\n${rawText.slice(0, 6000)}`,
            }),
          0
        );
        summary = (sumRes.text || summary).trim().slice(0, 800);
      }
    } catch {
      // keep raw excerpt fallback
    }
  }

  return { file: meta, content: rawText, summary };
}

export async function fetchWorkspaceDigestForBrief(token?: string | null): Promise<string | null> {
  if (!token || !token.trim()) return null;
  try {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const [eventsRes, gmailRes] = await Promise.allSettled([
      listCalendarEvents(token, {
        timeMin: now.toISOString(),
        timeMax: tomorrow.toISOString(),
        maxResults: 6,
      }),
      listGmailMessages(token, { unreadOnly: true, maxResults: 5 }),
    ]);

    const lines: string[] = [];
    if (eventsRes.status === 'fulfilled' && eventsRes.value.length > 0) {
      lines.push(
        `UPCOMING CALENDAR (next 24h):\n${eventsRes.value
          .map((e) => `- ${e.summary} (${e.start}${e.location ? ` @ ${e.location}` : ''})`)
          .join('\n')}`
      );
    }
    if (gmailRes.status === 'fulfilled' && gmailRes.value.length > 0) {
      lines.push(
        `PRIORITY UNREAD GMAIL:\n${gmailRes.value
          .map((m) => `- ${m.subject} (from ${m.from}): ${m.snippet.slice(0, 120)}`)
          .join('\n')}`
      );
    }
    return lines.length > 0 ? lines.join('\n\n') : null;
  } catch {
    return null;
  }
}
