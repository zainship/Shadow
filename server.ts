import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { Modality, ThinkingLevel } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  extractRawErrorDetail,
  getGeminiClient,
  getGeminiLiveClient,
  getModelConfig,
  isOverloadOrQuotaError,
  parseGeminiHttpError,
  preferDeepCommandDefault,
  resolveLiveThinkingLevel,
  resolveServerGeminiKey,
  sanitizeErrorSecrets,
  withGeminiRetry,
  type DetailedErrorPayload,
} from './server/gemini.ts';
import {
  DEFAULT_OPENROUTER_MODEL,
  openRouterGenerate,
  resolveAiRuntime,
  resolveCompanionGeminiKey,
} from './server/ai-provider.ts';
import type { Content, FunctionCall } from '@google/genai';
import { searchYouTube } from './server/youtube.ts';
import { runJarvisResearch } from './server/research.ts';
import {
  getBriefHistory,
  getTodayBrief,
  loadBriefConfig,
  runMorningBrief,
  saveBriefConfig,
  startBriefScheduler,
} from './server/brief.ts';
import {
  generateVisualAsset,
  normalizeAspectRatio,
  normalizeVisualStyle,
} from './server/visuals.ts';
import {
  buildDesktopLayoutInspection,
  buildShadowSystemInstruction,
  executeBrowserPlan,
  getActiveToolDeclarations,
  inspectWebPage,
  runAutonomousWebAgent,
  synthesizeJarvisSpeech,
  type AssistantSessionContext,
} from './server/automation.ts';
import {
  buildPluginToolDeclarations,
  executeHttpPlugin,
  fetchPluginManifestFromUrl,
  normalizePluginDescriptors,
  PLUGIN_CATALOG,
  renderLaptopCommand,
} from './server/plugins.ts';
import { detectPlaywrightRuntime } from './server/browser-playwright.ts';
import {
  createCalendarEvent,
  createGmailDraft,
  deleteCalendarEvent,
  extractWorkspaceBearerToken,
  getGmailMessageDetail,
  listCalendarEvents,
  listDriveFiles,
  listGmailMessages,
  readDriveFileContent,
  sendGmailMessage,
  summarizeGmailInbox,
  WorkspaceApiError,
} from './server/workspace.ts';
import {
  askMeetingTranscript,
  summarizeMeetingTranscript,
  transcribeAudioChunk,
} from './server/meetings.ts';
import {
  askVault,
  deleteVaultDocument,
  ingestVaultDocument,
  listVaultDocuments,
  searchVault,
} from './server/vault.ts';
import { fetchGithubRepoOverview, summarizeDevopsState } from './server/devops.ts';
import {
  dispatchBridgeMessage,
  getBridgeDeliveryHistory,
  getMaskedBridgesStatus,
  sendTelegramDirectReply,
  updateBridgesConfig,
  type BridgeChannel,
} from './server/bridges.ts';
import {
  createInboundWebhook,
  createScheduledJob,
  deleteInboundWebhook,
  deleteScheduledJob,
  listSchedulerState,
  processInboundWebhook,
  runScheduledJobNow,
  startProactiveScheduler,
  toggleScheduledJob,
  type ScheduleJobKind,
} from './server/scheduler.ts';
import { timingSafeEqualStr } from './server/security.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  const buildErrorDetail = (
    status: number,
    source: string,
    errOrMessage: unknown,
    fallback: string,
    endpoint?: string
  ): DetailedErrorPayload => {
    const extracted = extractRawErrorDetail(errOrMessage);
    const rawMsg = sanitizeErrorSecrets(extracted.rawMessage || fallback);
    return {
      source,
      status,
      summary: rawMsg.slice(0, 500) || fallback,
      rawMessage: rawMsg.slice(0, 2000),
      code: extracted.code,
      cause: extracted.cause,
      stack: extracted.stack,
      ...(endpoint ? { endpoint: sanitizeErrorSecrets(endpoint) } : {}),
      timestamp: Date.now(),
    };
  };

  const sendError = (
    res: express.Response,
    status: number,
    source: string,
    errOrMessage: unknown,
    fallback: string,
    endpoint?: string,
    extra?: Record<string, unknown>
  ) => {
    const detail = buildErrorDetail(status, source, errOrMessage, fallback, endpoint);
    return res.status(status).json({
      ok: false,
      ...(extra ?? {}),
      error: detail.summary,
      errorDetail: detail,
    });
  };

  const sendGeminiError = (
    res: express.Response,
    err: unknown,
    fallback: string,
    source: string,
    endpoint?: string
  ) => {
    const { status, message, detail } = parseGeminiHttpError(err, fallback, source);
    return res.status(status).json({
      ok: false,
      error: message,
      errorDetail: {
        ...detail,
        ...(endpoint ? { endpoint: sanitizeErrorSecrets(endpoint) } : {}),
      },
    });
  };

  // Allow packaged Tauri shell, local dev servers, Firebase Hosting PWA domains,
  // and any explicit CORS_ALLOWED_ORIGINS entries to reach this server.
  const localUiOrigin =
    /^(tauri|asset|ipc):\/\/localhost$|^https?:\/\/tauri\.localhost$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const firebaseHostingOrigin =
    /^https:\/\/(shadow-solodev|gen-lang-client-0109825597)\.(web\.app|firebaseapp\.com)$/;
  const extraCorsOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isAllowed =
      Boolean(origin) &&
      (localUiOrigin.test(origin!) ||
        firebaseHostingOrigin.test(origin!) ||
        extraCorsOrigins.has(origin!));
    if (origin && isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Authorization, x-shadow-provider, x-shadow-key, x-shadow-model, x-shadow-gemini-key, x-github-token, x-webhook-secret'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'shadow-desktop-server',
      playwrightRuntime: detectPlaywrightRuntime(),
    });
  });

  // Short-lived loopback OAuth handoff for the packaged Tauri desktop shell
  const desktopAuthSessions = new Map<
    string,
    {
      createdAt: number;
      completed: boolean;
      idToken?: string | null;
      accessToken?: string | null;
    }
  >();

  const pruneDesktopAuthSessions = () => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [key, entry] of desktopAuthSessions.entries()) {
      if (entry.createdAt < cutoff) {
        desktopAuthSessions.delete(key);
      }
    }
  };

  app.post('/api/desktop-auth/session', (_req, res) => {
    pruneDesktopAuthSessions();
    const nonce = crypto.randomUUID();
    desktopAuthSessions.set(nonce, { createdAt: Date.now(), completed: false });
    res.json({ ok: true, nonce });
  });

  app.post('/api/desktop-auth/complete', (req, res) => {
    pruneDesktopAuthSessions();
    const nonce = String(req.body?.nonce || '').trim();
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : null;
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken : null;
    const session = desktopAuthSessions.get(nonce);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Desktop sign-in session expired. Click Sign In again.' });
    }
    if (!idToken && !accessToken) {
      return res.status(400).json({ ok: false, error: 'Missing Google OAuth token.' });
    }
    session.completed = true;
    session.idToken = idToken;
    session.accessToken = accessToken;
    return res.json({ ok: true });
  });

  app.get('/api/desktop-auth/session/:nonce', (req, res) => {
    pruneDesktopAuthSessions();
    const nonce = String(req.params.nonce || '').trim();
    const session = desktopAuthSessions.get(nonce);
    if (!session) {
      return res.status(404).json({ ok: false, status: 'expired' });
    }
    if (!session.completed) {
      return res.json({ ok: true, status: 'pending' });
    }
    desktopAuthSessions.delete(nonce);
    return res.json({
      ok: true,
      status: 'completed',
      idToken: session.idToken || null,
      accessToken: session.accessToken || null,
    });
  });

  // Server AI configuration status (booleans only, never returns secret values)
  app.get('/api/ai/status', (_req, res) => {
    res.json({
      hasServerGeminiKey: Boolean(resolveServerGeminiKey()),
      hasServerOpenRouterKey: Boolean((process.env.OPENROUTER_API_KEY || '').trim()),
      defaultOpenRouterModel:
        (process.env.OPENROUTER_MODEL || '').trim() || DEFAULT_OPENROUTER_MODEL,
    });
  });

  // Verify a GUI-supplied OpenRouter or Gemini key live
  app.post('/api/ai/test', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      if (!runtime) {
        return sendError(
          res,
          400,
          'AI Configuration',
          'No API key provided. Enter an OpenRouter or Gemini key in Settings/Setup.',
          'No API key provided',
          req.originalUrl
        );
      }
      if (runtime.provider === 'openrouter') {
        const turn = await openRouterGenerate({
          apiKey: runtime.apiKey,
          model: runtime.model,
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
          maxTokens: 12,
        });
        return res.json({
          ok: true,
          provider: 'openrouter',
          model: runtime.model,
          reply: turn.text.slice(0, 60) || 'OK',
        });
      }
      const ai = getGeminiClient(runtime.apiKey);
      const models = getModelConfig();
      let modelUsed = models.fastText;
      let response;
      try {
        response = await withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: models.fastText,
              contents: 'Reply with OK.',
            }),
          1
        );
      } catch (err) {
        if (!isOverloadOrQuotaError(err)) throw err;
        modelUsed = models.deepText;
        response = await withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: models.deepText,
              contents: 'Reply with OK.',
            }),
          0
        );
      }
      return res.json({
        ok: true,
        provider: 'gemini',
        model: modelUsed,
        reply: (response.text || 'OK').trim().slice(0, 60),
      });
    } catch (err) {
      return sendGeminiError(res, err, 'API key verification failed', 'AI Key Verification', req.originalUrl);
    }
  });

  // Downloadable / copyable standalone Shadow Laptop Agent & background service installers
  app.get('/api/desktop/scripts', (req, res) => {
    try {
      const scriptsDir = path.resolve(__dirname, 'scripts');
      const agent = fs.readFileSync(path.join(scriptsDir, 'shadow-laptop-agent.mjs'), 'utf8');
      const installUnix = fs.readFileSync(path.join(scriptsDir, 'install-shadow-agent.sh'), 'utf8');
      const installWin = fs.readFileSync(path.join(scriptsDir, 'install-shadow-agent.ps1'), 'utf8');
      return res.json({
        ok: true,
        files: {
          'shadow-laptop-agent.mjs': agent,
          'install-shadow-agent.sh': installUnix,
          'install-shadow-agent.ps1': installWin,
        },
      });
    } catch (err) {
      return sendError(res, 500, 'Desktop Scripts', err, 'Unable to load agent scripts', req.originalUrl);
    }
  });

  // YouTube search endpoint
  app.get('/api/youtube/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) {
        return sendError(res, 400, 'YouTube Search', 'Missing query parameter q', 'Missing query parameter q', req.originalUrl);
      }
      const ytRuntime = resolveAiRuntime({ headers: req.headers });
      const results = await searchYouTube(
        q,
        ytRuntime?.provider === 'openrouter'
          ? { openRouter: { apiKey: ytRuntime.apiKey, model: ytRuntime.model } }
          : { geminiKeyOverride: ytRuntime?.apiKey }
      );
      return res.json({ query: q, results });
    } catch (err) {
      return sendGeminiError(res, err, 'YouTube search failed', 'YouTube Search', req.originalUrl);
    }
  });

  // Web page inspector endpoint for real DOM form & link discovery
  app.post('/api/automation/inspect', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!url) {
        return sendError(res, 400, 'Web Inspector', 'Missing url', 'Missing url', req.originalUrl);
      }
      const inspection = await inspectWebPage(url);
      return res.json(inspection);
    } catch (err) {
      return sendError(res, 500, 'Web Inspector', err, 'Page inspection failed', req.originalUrl);
    }
  });

  // Real multi-step Playwright (with HTTP/DOM fallback) browser automation executor
  app.post('/api/automation/execute', async (req, res) => {
    try {
      const goal = String(req.body?.goal || 'Browser Automation').trim();
      const targetUrl = String(req.body?.targetUrl || '').trim();
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
      const engine =
        req.body?.engine === 'playwright' || req.body?.engine === 'http-dom'
          ? req.body.engine
          : 'auto';
      if (!targetUrl && steps.length === 0) {
        return sendError(res, 400, 'Browser Automation', 'Missing targetUrl or steps', 'Missing targetUrl or steps', req.originalUrl);
      }
      const execution = await executeBrowserPlan({ goal, targetUrl, steps, engine });
      if (!execution.ok && execution.error) {
        return res.json({
          ...execution,
          errorDetail: buildErrorDetail(400, 'Browser Automation', execution.error, execution.error, req.originalUrl),
        });
      }
      return res.json(execution);
    } catch (err) {
      return sendError(res, 500, 'Browser Automation', err, 'Browser automation failed', req.originalUrl);
    }
  });

  // Iterative autonomous AI web agent (Inspect -> Reason -> Act -> Verify loop)
  app.post('/api/automation/agent', async (req, res) => {
    try {
      const goal = String(req.body?.goal || '').trim();
      const startUrl = String(req.body?.startUrl || req.body?.targetUrl || '').trim();
      const maxSteps = Number(req.body?.maxSteps || 4);
      const preferDeep = req.body?.preferDeep === true || req.body?.deepThinking === true;
      if (!goal || !startUrl) {
        return sendError(res, 400, 'Autonomous Web Agent', 'Missing goal or startUrl', 'Missing goal or startUrl', req.originalUrl);
      }
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const result = await runAutonomousWebAgent({ goal, startUrl, maxSteps, preferDeep, runtime });
      if (!result.ok && result.error) {
        return res.json({
          ...result,
          errorDetail: buildErrorDetail(400, 'Autonomous Web Agent', result.error, result.error, req.originalUrl),
        });
      }
      return res.json(result);
    } catch (err) {
      return sendGeminiError(res, err, 'Autonomous web agent failed', 'Autonomous Web Agent', req.originalUrl);
    }
  });

  // Text-to-speech endpoint (Gemini Flash Lite TTS -> WAV)
  app.post('/api/assistant/tts', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const voiceName = String(req.body?.voiceName || 'Charon');
      if (!text) return sendError(res, 400, 'Speech Synthesis', 'Missing text', 'Missing text', req.originalUrl);
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const geminiTtsKey = resolveCompanionGeminiKey({ headers: req.headers, body: req.body, runtime });
      if (!geminiTtsKey && !resolveServerGeminiKey()) {
        return res.json({ audioBase64: null, mimeType: null, fallback: 'browser-speech' });
      }
      const audioBase64 = await synthesizeJarvisSpeech(text, voiceName, geminiTtsKey);
      return res.json({
        audioBase64,
        mimeType: audioBase64 ? 'audio/wav' : null,
      });
    } catch (err) {
      return sendGeminiError(res, err, 'TTS failed', 'Speech Synthesis', req.originalUrl);
    }
  });

  // Deep Research endpoint (Google Search grounding + URL Context + primary-source verification)
  app.post('/api/research/run', async (req, res) => {
    try {
      const query = String(req.body?.query || '').trim();
      const depth = req.body?.depth === 'quick' ? 'quick' : 'deep';
      const urls = Array.isArray(req.body?.urls)
        ? req.body.urls.map((u: unknown) => String(u || '').trim()).filter(Boolean)
        : [];
      const voiceName = String(req.body?.voiceName || 'Charon');
      const speak = req.body?.speak === true;

      if (!query) {
        return sendError(res, 400, 'Deep Research', 'Missing research query', 'Missing research query', req.originalUrl);
      }

      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const geminiTtsKey = resolveCompanionGeminiKey({ headers: req.headers, body: req.body, runtime });
      const report = await runJarvisResearch({ query, depth, urls, runtime });
      const audioBase64 = speak
        ? await synthesizeJarvisSpeech(report.spokenSummary, voiceName, geminiTtsKey)
        : null;
      return res.json({
        report,
        audioBase64,
        audioMimeType: audioBase64 ? 'audio/wav' : null,
      });
    } catch (err) {
      console.error('Research error:', err);
      return sendGeminiError(res, err, 'Research failed', 'Deep Research', req.originalUrl);
    }
  });

  // Morning Brief endpoints
  app.get('/api/brief/config', (_req, res) => {
    res.json({ config: loadBriefConfig() });
  });

  app.post('/api/brief/config', (req, res) => {
    try {
      const config = saveBriefConfig(req.body ?? {});
      return res.json({ config });
    } catch (err) {
      return sendError(res, 400, 'Morning Brief', err, 'Invalid brief config', req.originalUrl);
    }
  });

  app.get('/api/brief/today', (_req, res) => {
    res.json({ brief: getTodayBrief(), config: loadBriefConfig() });
  });

  app.get('/api/brief/history', (req, res) => {
    const limit = Number(req.query.limit || 20);
    res.json({ briefs: getBriefHistory(limit) });
  });

  app.post('/api/brief/run', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const authHeader = String(req.headers.authorization || '').trim();
      const workspaceToken = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
      const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : undefined;
      const brief = await runMorningBrief({
        runtime,
        voiceName: String(req.body?.voiceName || '').trim() || undefined,
        workspaceToken,
        tasks,
      });
      return res.json({ brief });
    } catch (err) {
      console.error('Morning brief error:', err);
      return sendGeminiError(res, err, 'Morning Brief failed', 'Morning Brief', req.originalUrl);
    }
  });

  // Visual Synthesis endpoint (generates bespoke SVG diagrams, charts, illustrations & wireframes)
  app.post('/api/visuals/generate', async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      const style = normalizeVisualStyle(req.body?.style);
      const aspectRatio = normalizeAspectRatio(req.body?.aspectRatio);
      const refineFromSvg =
        typeof req.body?.refineFromSvg === 'string' ? req.body.refineFromSvg : undefined;
      const voiceName = String(req.body?.voiceName || 'Charon');
      const speak = req.body?.speak === true;

      if (!prompt) {
        return sendError(res, 400, 'Visual Studio', 'Missing visual prompt', 'Missing visual prompt', req.originalUrl);
      }

      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const geminiTtsKey = resolveCompanionGeminiKey({ headers: req.headers, body: req.body, runtime });

      // Visuals run on either provider: Gemini native schema or OpenAI-compatible
      // json_schema (BYOK OpenRouter). Speech narration stays Gemini-only.
      const visualOptions: Parameters<typeof generateVisualAsset>[0] = {
        prompt,
        style,
        aspectRatio,
        refineFromSvg,
      };
      if (runtime?.provider === 'openrouter') {
        visualOptions.openRouter = { apiKey: runtime.apiKey, model: runtime.model };
      } else {
        visualOptions.apiKeyOverride = runtime?.apiKey;
      }

      const visual = await generateVisualAsset(visualOptions);
      const audioBase64 = speak
        ? await synthesizeJarvisSpeech(visual.summary, voiceName, geminiTtsKey)
        : null;
      return res.json({
        ok: true,
        visual,
        audioBase64,
        audioMimeType: audioBase64 ? 'audio/wav' : null,
      });
    } catch (err) {
      console.error('Visual generation error:', err);
      return sendGeminiError(res, err, 'Visual generation failed', 'Visual Studio', req.originalUrl);
    }
  });

  // Plugin registry catalog, direct test execution, and manifest URL importer
  app.get('/api/plugins/catalog', (_req, res) => {
    return res.json({ ok: true, catalog: PLUGIN_CATALOG });
  });

  app.post('/api/plugins/fetch-manifest', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!url) return sendError(res, 400, 'Plugins', 'Missing manifest URL', 'Missing manifest URL', req.originalUrl);
      const plugin = await fetchPluginManifestFromUrl(url);
      return res.json({ ok: true, plugin });
    } catch (err) {
      return sendError(res, 400, 'Plugins', err, 'Unable to load plugin manifest', req.originalUrl);
    }
  });

  app.post('/api/plugins/execute', async (req, res) => {
    try {
      const normalized = normalizePluginDescriptors([req.body?.plugin], 1);
      if (normalized.length === 0) {
        return sendError(res, 400, 'Plugins', 'Invalid plugin configuration.', 'Invalid plugin configuration.', req.originalUrl);
      }
      const plugin = normalized[0];
      const args =
        req.body?.args && typeof req.body.args === 'object'
          ? (req.body.args as Record<string, unknown>)
          : {};

      if (plugin.kind === 'laptop_command') {
        const renderedCommand = renderLaptopCommand(plugin, args);
        return res.json({
          ok: true,
          pluginId: plugin.id,
          pluginName: plugin.name,
          toolName: plugin.toolName,
          kind: plugin.kind,
          requiresClientExecution: true,
          renderedCommand,
          summary: `Prepared local command for ${plugin.name}`,
        });
      }

      const execution = await executeHttpPlugin(plugin, args);
      return res.json(execution);
    } catch (err) {
      return sendError(res, 500, 'Plugins', err, 'Plugin execution failed', req.originalUrl);
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 1: Google Workspace Integration (Gmail, Calendar, Drive)
  // Token comes strictly from Authorization: Bearer <token> held in client memory.
  // ---------------------------------------------------------------------------
  const sendWorkspaceErr = (res: express.Response, err: unknown, endpoint?: string) => {
    if (err instanceof WorkspaceApiError) {
      return sendError(
        res,
        err.status,
        'Google Workspace',
        err,
        err.message,
        endpoint,
        { needsReauth: err.needsReauth }
      );
    }
    return sendError(res, 500, 'Google Workspace', err, 'Google Workspace error', endpoint);
  };

  app.get('/api/workspace/gmail/messages', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const queryText = String(req.query.q || '').trim() || undefined;
      const unreadOnly = String(req.query.unreadOnly || '').toLowerCase() === 'true';
      const maxResults = Number(req.query.maxResults || 12);
      const messages = await listGmailMessages(token, { query: queryText, unreadOnly, maxResults });
      return res.json({ ok: true, messages });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.get('/api/workspace/gmail/message/:id', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const message = await getGmailMessageDetail(token, String(req.params.id || ''));
      return res.json({ ok: true, message });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.post('/api/workspace/gmail/summarize', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const summary = await summarizeGmailInbox(token, {
        query: String(req.body?.q || '').trim() || undefined,
        maxResults: Number(req.body?.maxResults || 10),
        runtime,
      });
      return res.json({ ok: true, ...summary });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.post('/api/workspace/gmail/draft', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const draft = await createGmailDraft(token, {
        to: String(req.body?.to || ''),
        subject: String(req.body?.subject || ''),
        body: String(req.body?.body || ''),
        threadId: req.body?.threadId ? String(req.body.threadId) : undefined,
      });
      return res.json({ ok: true, draft });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.post('/api/workspace/gmail/send', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const sent = await sendGmailMessage(token, {
        to: String(req.body?.to || ''),
        subject: String(req.body?.subject || ''),
        body: String(req.body?.body || ''),
        threadId: req.body?.threadId ? String(req.body.threadId) : undefined,
      });
      return res.json({ ok: true, sent });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.get('/api/workspace/calendar/events', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const events = await listCalendarEvents(token, {
        timeMin: String(req.query.timeMin || '').trim() || undefined,
        timeMax: String(req.query.timeMax || '').trim() || undefined,
        maxResults: Number(req.query.maxResults || 15),
      });
      return res.json({ ok: true, events });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.post('/api/workspace/calendar/events', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const event = await createCalendarEvent(token, {
        summary: String(req.body?.summary || ''),
        startIso: String(req.body?.startIso || ''),
        endIso: String(req.body?.endIso || ''),
        description: req.body?.description ? String(req.body.description) : undefined,
        location: req.body?.location ? String(req.body.location) : undefined,
        attendees: Array.isArray(req.body?.attendees) ? req.body.attendees.map(String) : undefined,
      });
      return res.json({ ok: true, event });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.delete('/api/workspace/calendar/events/:id', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      await deleteCalendarEvent(token, String(req.params.id || ''));
      return res.json({ ok: true, deletedId: String(req.params.id || '') });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.get('/api/workspace/drive/files', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const files = await listDriveFiles(token, {
        query: String(req.query.q || '').trim() || undefined,
        pageSize: Number(req.query.maxResults || 15),
      });
      return res.json({ ok: true, files });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  app.get('/api/workspace/drive/files/:id/read', async (req, res) => {
    try {
      const token = extractWorkspaceBearerToken(req);
      const runtime = resolveAiRuntime({ headers: req.headers });
      const data = await readDriveFileContent(token, String(req.params.id || ''), runtime);
      return res.json({ ok: true, ...data });
    } catch (err) {
      return sendWorkspaceErr(res, err, req.originalUrl);
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 3: Meeting & Audio Companion Mode
  // ---------------------------------------------------------------------------
  app.post('/api/meetings/transcribe', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const result = await transcribeAudioChunk({
        audioBase64: String(req.body?.audioBase64 || ''),
        mimeType: String(req.body?.mimeType || 'audio/webm'),
        promptHint: req.body?.promptHint ? String(req.body.promptHint) : undefined,
        runtime,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendGeminiError(res, err, 'Audio transcription failed', 'Meeting Companion', req.originalUrl);
    }
  });

  app.post('/api/meetings/summarize', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const result = await summarizeMeetingTranscript({
        title: req.body?.title ? String(req.body.title) : undefined,
        transcript: String(req.body?.transcript || ''),
        durationSeconds: req.body?.durationSeconds ? Number(req.body.durationSeconds) : undefined,
        runtime,
      });
      return res.json({ ok: true, summary: result });
    } catch (err) {
      return sendGeminiError(res, err, 'Meeting summarization failed', 'Meeting Companion', req.originalUrl);
    }
  });

  app.post('/api/meetings/ask', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const result = await askMeetingTranscript({
        transcript: String(req.body?.transcript || ''),
        question: String(req.body?.question || ''),
        summary: req.body?.summary ? String(req.body.summary) : undefined,
        runtime,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendGeminiError(res, err, 'Meeting Q&A failed', 'Meeting Companion', req.originalUrl);
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 4A: Personal Knowledge Base (RAG Vault)
  // ---------------------------------------------------------------------------
  app.get('/api/vault/docs', (req, res) => {
    const ownerKey = String(req.query.ownerKey || 'local');
    return res.json({ ok: true, docs: listVaultDocuments(ownerKey) });
  });

  app.post('/api/vault/ingest', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const result = await ingestVaultDocument({
        ownerKey: req.body?.ownerKey ? String(req.body.ownerKey) : 'local',
        title: String(req.body?.title || req.body?.fileName || 'Untitled Note'),
        contentText: req.body?.contentText ? String(req.body.contentText) : undefined,
        fileBase64: req.body?.fileBase64 ? String(req.body.fileBase64) : undefined,
        mimeType: req.body?.mimeType ? String(req.body.mimeType) : undefined,
        sourceType: req.body?.sourceType,
        sourceRef: req.body?.sourceRef ? String(req.body.sourceRef) : undefined,
        tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : undefined,
        runtime,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendError(res, 400, 'Knowledge Vault', err, 'Vault document ingestion failed', req.originalUrl);
    }
  });

  app.delete('/api/vault/docs/:id', (req, res) => {
    const ownerKey = String(req.query.ownerKey || req.body?.ownerKey || 'local');
    const deleted = deleteVaultDocument(String(req.params.id || ''), ownerKey);
    if (!deleted) {
      return sendError(res, 404, 'Knowledge Vault', 'Document not found', 'Document not found', req.originalUrl);
    }
    return res.json({ ok: true, deletedId: String(req.params.id || '') });
  });

  app.post('/api/vault/search', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const hits = await searchVault({
        query: String(req.body?.query || ''),
        ownerKey: req.body?.ownerKey ? String(req.body.ownerKey) : 'local',
        topK: Number(req.body?.topK || 6),
        runtime,
      });
      return res.json({ ok: true, hits });
    } catch (err) {
      return sendError(res, 400, 'Knowledge Vault', err, 'Vault search failed', req.originalUrl);
    }
  });

  app.post('/api/vault/ask', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const result = await askVault({
        query: String(req.body?.question || req.body?.query || ''),
        ownerKey: req.body?.ownerKey ? String(req.body.ownerKey) : 'local',
        topK: Number(req.body?.topK || 6),
        runtime,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendGeminiError(res, err, 'Vault Q&A failed', 'Knowledge Vault', req.originalUrl);
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 4B: GitHub & DevOps Cockpit
  // ---------------------------------------------------------------------------
  app.get('/api/devops/github/repo', async (req, res) => {
    try {
      const repo = String(req.query.repo || '').trim();
      const ghToken = String(req.headers['x-github-token'] || '').trim() || undefined;
      if (!repo) {
        return sendError(res, 400, 'GitHub & DevOps', 'Missing repo query parameter (owner/repo).', 'Missing repo query parameter', req.originalUrl);
      }
      const overview = await fetchGithubRepoOverview(repo, ghToken);
      return res.json({ ok: true, overview });
    } catch (err) {
      return sendError(res, 400, 'GitHub & DevOps', err, 'GitHub lookup failed', req.originalUrl);
    }
  });

  app.post('/api/devops/analyze', async (req, res) => {
    try {
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const repo = String(req.body?.repo || '').trim();
      const ghToken = String(req.headers['x-github-token'] || '').trim() || undefined;
      const overview = repo ? await fetchGithubRepoOverview(repo, ghToken) : null;
      const analysis = await summarizeDevopsState({
        overview,
        localGitText: req.body?.localGitSummary ? String(req.body.localGitSummary) : undefined,
        question: req.body?.question ? String(req.body.question) : undefined,
        runtime,
      });
      return res.json({ ok: true, overview, analysis });
    } catch (err) {
      return sendGeminiError(res, err, 'DevOps analysis failed', 'GitHub & DevOps', req.originalUrl);
    }
  });

  // ---------------------------------------------------------------------------
  // Feature 5: Messaging Bridges & Proactive Scheduler / Webhooks
  // ---------------------------------------------------------------------------
  app.get('/api/bridges/status', (_req, res) => {
    return res.json({
      ok: true,
      status: getMaskedBridgesStatus(),
      deliveries: getBridgeDeliveryHistory(),
    });
  });

  app.post('/api/bridges/config', (req, res) => {
    try {
      const status = updateBridgesConfig({
        telegramBotToken: req.body?.telegramBotToken,
        telegramChatId: req.body?.telegramChatId,
        discordWebhookUrl: req.body?.discordWebhookUrl,
        slackWebhookUrl: req.body?.slackWebhookUrl,
      });
      return res.json({ ok: true, status });
    } catch (err) {
      return sendError(res, 400, 'Messaging Bridges', err, 'Invalid bridge configuration', req.originalUrl);
    }
  });

  app.post('/api/bridges/send', async (req, res) => {
    try {
      const ch = String(req.body?.channel || 'all') as BridgeChannel | 'all';
      const valid = ch === 'telegram' || ch === 'discord' || ch === 'slack' || ch === 'all';
      if (!valid) {
        return sendError(res, 400, 'Messaging Bridges', 'Channel must be telegram, discord, slack, or all.', 'Invalid bridge channel', req.originalUrl);
      }
      const outcome = await dispatchBridgeMessage({
        channel: ch,
        title: req.body?.title ? String(req.body.title) : 'Shadow Dispatch',
        message: String(req.body?.message || ''),
      });
      return res.json({ ok: outcome.ok, results: outcome.results, deliveries: getBridgeDeliveryHistory() });
    } catch (err) {
      return sendError(res, 400, 'Messaging Bridges', err, 'Bridge send failed', req.originalUrl);
    }
  });

  app.post('/api/bridges/telegram/webhook', async (req, res) => {
    try {
      const expectedSecret = (process.env.WEBHOOK_SIGNING_SECRET || '').trim();
      const gotSecret = String(req.headers['x-telegram-bot-api-secret-token'] || '');
      if (expectedSecret && !timingSafeEqualStr(gotSecret, expectedSecret)) {
        return sendError(res, 401, 'Telegram Webhook', 'Unauthorized Telegram webhook secret.', 'Unauthorized Telegram webhook secret.', req.originalUrl);
      }
      const msg = req.body?.message || req.body?.edited_message;
      const chatId = msg?.chat?.id;
      const text = String(msg?.text || '').trim();
      if (chatId && text) {
        const runtime = resolveAiRuntime({});
        const ai = getGeminiClient(runtime?.apiKey);
        const reply = await withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: getModelConfig().fastText,
              contents: `Reply concisely (2-3 crisp sentences) to this Telegram message sent to Shadow Assistant:\n${text.slice(0, 1000)}`,
            }),
          0
        ).catch(() => ({ text: 'Shadow received your message.' }));
        await sendTelegramDirectReply(chatId, (reply.text || 'Shadow received your message.').trim()).catch(() => {});
      }
      return res.json({ ok: true });
    } catch (err) {
      return sendError(res, 500, 'Telegram Webhook', err, 'Telegram hook failed', req.originalUrl);
    }
  });

  app.get('/api/scheduler/state', (_req, res) => {
    return res.json({ ok: true, ...listSchedulerState() });
  });

  app.post('/api/scheduler/jobs', (req, res) => {
    try {
      const job = createScheduledJob({
        name: String(req.body?.name || 'Scheduled Trigger'),
        kind: String(req.body?.kind || 'reminder_ping') as ScheduleJobKind,
        intervalMinutes: Number(req.body?.intervalMinutes || 60),
        targetUrl: req.body?.targetUrl ? String(req.body.targetUrl) : undefined,
        promptOrNote: req.body?.promptOrNote ? String(req.body.promptOrNote) : undefined,
        notifyBridge: Boolean(req.body?.notifyBridge),
      });
      return res.json({ ok: true, job });
    } catch (err) {
      return sendError(res, 400, 'Proactive Scheduler', err, 'Invalid job', req.originalUrl);
    }
  });

  app.patch('/api/scheduler/jobs/:id', (req, res) => {
    const updated = toggleScheduledJob(String(req.params.id || ''), Boolean(req.body?.enabled));
    if (!updated) return sendError(res, 404, 'Proactive Scheduler', 'Job not found', 'Job not found', req.originalUrl);
    return res.json({ ok: true, job: updated });
  });

  app.delete('/api/scheduler/jobs/:id', (req, res) => {
    const ok = deleteScheduledJob(String(req.params.id || ''));
    if (!ok) return sendError(res, 404, 'Proactive Scheduler', 'Job not found', 'Job not found', req.originalUrl);
    return res.json({ ok: true });
  });

  app.post('/api/scheduler/jobs/:id/run', async (req, res) => {
    try {
      const log = await runScheduledJobNow(String(req.params.id || ''));
      return res.json({ ok: true, log });
    } catch (err) {
      return sendError(res, 404, 'Proactive Scheduler', err, 'Job failed', req.originalUrl);
    }
  });

  app.post('/api/scheduler/webhooks', (req, res) => {
    const created = createInboundWebhook({
      name: String(req.body?.name || 'External Event'),
      notifyBridge: req.body?.notifyBridge !== false,
    });
    return res.json({ ok: true, ...created });
  });

  app.delete('/api/scheduler/webhooks/:id', (req, res) => {
    const ok = deleteInboundWebhook(String(req.params.id || ''));
    if (!ok) return sendError(res, 404, 'Proactive Scheduler', 'Webhook not found', 'Webhook not found', req.originalUrl);
    return res.json({ ok: true });
  });

  app.post('/api/hooks/:hookId', async (req, res) => {
    try {
      const rawAuth = String(req.headers.authorization || '').trim();
      const providedSecret =
        String(req.headers['x-webhook-secret'] || '').trim() ||
        (rawAuth.toLowerCase().startsWith('bearer ') ? rawAuth.slice(7).trim() : '');
      const result = await processInboundWebhook({
        hookId: String(req.params.hookId || ''),
        providedSecret,
        payload: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
      });
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Webhook failed';
      const status = msg.toLowerCase().includes('unauthorized')
        ? 401
        : msg.toLowerCase().includes('not found')
          ? 404
          : 400;
      return sendError(res, status, 'Inbound Webhook', err, 'Webhook failed', req.originalUrl);
    }
  });

  // Shared domain tool executor for Features 1-5 used by both REST /api/assistant/command and WS /ws/live
  const executeExtendedDomainToolCall = async (input: {
    name: string;
    args: Record<string, unknown>;
    runtime?: ReturnType<typeof resolveAiRuntime>;
    workspaceToken?: string | null;
    ownerKey?: string;
  }): Promise<{ handled: boolean; result: Record<string, unknown>; summary: string }> => {
    const { name, args, runtime, workspaceToken, ownerKey } = input;

    if (name === 'manage_workspace') {
      const service = String(args.service || 'gmail').toLowerCase();
      const action = String(args.action || 'list').toLowerCase();

      // Mutating Workspace actions NEVER execute blindly — always emit pending confirmation action
      if (
        (service === 'gmail' && action === 'send') ||
        (service === 'calendar' && (action === 'create_event' || action === 'delete_event'))
      ) {
        return {
          handled: true,
          summary: `Prepared confirmation dialog for ${service}.${action}`,
          result: {
            ok: true,
            requiresConfirmation: true,
            pendingAction: {
              id: `wsact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              service,
              action,
              title:
                service === 'gmail'
                  ? `Send Email to ${String(args.to || '')}`
                  : action === 'create_event'
                    ? `Schedule "${String(args.subject || 'Meeting')}"`
                    : `Delete Calendar Event ${String(args.id || '')}`,
              payload: args,
            },
          },
        };
      }

      if (!workspaceToken) {
        return {
          handled: true,
          summary: 'Workspace sign-in required',
          result: {
            ok: false,
            needsReauth: true,
            error: 'Google Workspace is not connected yet. Open the Workspace tab and click Connect Google Workspace.',
          },
        };
      }

      if (service === 'gmail') {
        if (action === 'summarize') {
          const sum = await summarizeGmailInbox(workspaceToken, {
            query: args.query ? String(args.query) : undefined,
            runtime: runtime ?? null,
          });
          return {
            handled: true,
            summary: `Summarized ${sum.messages.length} emails`,
            result: { ok: true, ...sum },
          };
        }
        if (action === 'draft') {
          const draft = await createGmailDraft(workspaceToken, {
            to: String(args.to || ''),
            subject: String(args.subject || ''),
            body: String(args.body || ''),
          });
          return { handled: true, summary: `Created draft for ${args.to}`, result: { ok: true, draft } };
        }
        if (action === 'read' && args.id) {
          const msg = await getGmailMessageDetail(workspaceToken, String(args.id));
          return { handled: true, summary: `Read email "${msg.subject}"`, result: { ok: true, message: msg } };
        }
        const msgs = await listGmailMessages(workspaceToken, {
          query: args.query ? String(args.query) : undefined,
          maxResults: 8,
        });
        return { handled: true, summary: `Fetched ${msgs.length} emails`, result: { ok: true, messages: msgs } };
      }

      if (service === 'calendar') {
        const events = await listCalendarEvents(workspaceToken, { maxResults: 10 });
        return { handled: true, summary: `Listed ${events.length} calendar events`, result: { ok: true, events } };
      }

      if (service === 'drive') {
        if (action === 'read' && args.id) {
          const docData = await readDriveFileContent(workspaceToken, String(args.id), runtime ?? null);
          return { handled: true, summary: `Read Drive file "${docData.file.name}"`, result: { ok: true, ...docData } };
        }
        const files = await listDriveFiles(workspaceToken, {
          query: args.query ? String(args.query) : undefined,
          pageSize: 10,
        });
        return { handled: true, summary: `Found ${files.length} Drive files`, result: { ok: true, files } };
      }
    }

    if (name === 'manage_tasks_reminders') {
      return {
        handled: true,
        summary: `Task action: ${String(args.action || 'list')}`,
        result: {
          ok: true,
          taskAction: String(args.action || 'create'),
          title: args.title ? String(args.title).slice(0, 200) : '',
          dueAt: args.dueAt ? String(args.dueAt).slice(0, 64) : '',
          priority:
            args.priority === 'low' || args.priority === 'high' ? args.priority : 'medium',
          taskId: args.taskId ? String(args.taskId) : '',
        },
      };
    }

    if (name === 'search_knowledge_vault') {
      const query = String(args.query || '');
      const mode = String(args.mode || 'ask');
      if (mode === 'search') {
        const hits = await searchVault({ query, ownerKey: ownerKey || 'local', runtime: runtime ?? null });
        return { handled: true, summary: `Found ${hits.length} Vault matches`, result: { ok: true, hits } };
      }
      const qa = await askVault({ query, ownerKey: ownerKey || 'local', runtime: runtime ?? null });
      return {
        handled: true,
        summary: `Vault answer with ${qa.citations.length} citations`,
        result: { ok: true, ...qa },
      };
    }

    if (name === 'inspect_github_repo') {
      const repo = String(args.repo || '');
      const overview = await fetchGithubRepoOverview(repo);
      const analysis = args.question
        ? await summarizeDevopsState({ overview, question: String(args.question), runtime: runtime ?? null })
        : undefined;
      return {
        handled: true,
        summary: `Inspected ${overview.repo.fullName}`,
        result: { ok: true, overview, ...(analysis ? { analysis } : {}) },
      };
    }

    if (name === 'trigger_bridge_message') {
      const ch = (String(args.channel || 'all') as BridgeChannel | 'all');
      const outcome = await dispatchBridgeMessage({
        channel: ch,
        title: args.title ? String(args.title) : 'Shadow Update',
        message: String(args.message || ''),
      });
      return {
        handled: true,
        summary: outcome.ok ? `Sent message to ${ch}` : `Bridge ${ch} delivery notice`,
        result: { ok: outcome.ok, results: outcome.results },
      };
    }

    if (name === 'manage_schedules') {
      const action = String(args.action || 'list').toLowerCase();
      if (action === 'create') {
        const job = createScheduledJob({
          name: String(args.name || 'Scheduled Job'),
          kind: String(args.kind || 'reminder_ping') as ScheduleJobKind,
          intervalMinutes: Number(args.intervalMinutes || 60),
          targetUrl: args.targetUrl ? String(args.targetUrl) : undefined,
          promptOrNote: args.note ? String(args.note) : undefined,
          notifyBridge: Boolean(args.notifyBridge),
        });
        return { handled: true, summary: `Scheduled "${job.name}"`, result: { ok: true, job } };
      }
      if (action === 'run' && args.jobId) {
        const log = await runScheduledJobNow(String(args.jobId));
        return { handled: true, summary: `Ran job ${log.name}`, result: { ok: true, log } };
      }
      const state = listSchedulerState();
      return { handled: true, summary: `${state.jobs.length} scheduled job(s)`, result: { ok: true, ...state } };
    }

    return { handled: false, result: { ok: true }, summary: name };
  };

  // Session context cache so Gemini Live WS receives custom assistant name, user name, permissions, memories & plugins
  const sessionContexts = new Map<string, { context: AssistantSessionContext; expiresAt: number }>();

  const pruneSessionContexts = () => {
    const now = Date.now();
    for (const [key, entry] of sessionContexts.entries()) {
      if (entry.expiresAt < now) sessionContexts.delete(key);
    }
  };

  const isToolPermitted = (toolName: string, perms?: AssistantSessionContext['permissions']): boolean => {
    if (!perms) return true;
    if (toolName === 'manage_laptop_files' && perms.files === false) return false;
    if (toolName === 'control_laptop_apps' && perms.apps === false) return false;
    if (toolName === 'execute_terminal_command' && perms.terminal === false) return false;
    if (
      (toolName === 'execute_browser_automation' ||
        toolName === 'inspect_web_page' ||
        toolName === 'run_autonomous_web_agent') &&
      perms.browser === false
    ) {
      return false;
    }
    if (toolName === 'research_topic' && perms.research === false) return false;
    if ((toolName === 'play_youtube_media' || toolName === 'control_youtube_player') && perms.youtube === false) {
      return false;
    }
    if ((toolName === 'save_memory' || toolName === 'forget_memory') && perms.memory === false) return false;
    return true;
  };

  app.post('/api/assistant/context', (req, res) => {
    pruneSessionContexts();
    const ctxId = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = (req.body ?? {}) as AssistantSessionContext;
    sessionContexts.set(ctxId, {
      context: {
        assistantName: typeof body.assistantName === 'string' ? body.assistantName.slice(0, 60) : 'Shadow',
        userPreferredName: typeof body.userPreferredName === 'string' ? body.userPreferredName.slice(0, 80) : '',
        permissions: body.permissions ?? {},
        memories: Array.isArray(body.memories) ? body.memories.slice(0, 50) : [],
        plugins: normalizePluginDescriptors(body.plugins, 30),
        workspace: body.workspace,
      },
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    return res.json({ ok: true, ctxId });
  });

  // Natural language multi-turn & multimodal agent endpoint
  let preferLiteUntil = 0;

  app.post('/api/assistant/command', async (req, res) => {
    try {
      const command = String(req.body?.command || '').trim();
      const voiceName = String(req.body?.voiceName || 'Charon');
      const speak = req.body?.speak !== false;
      const deepThinking = req.body?.deepThinking === true || req.body?.preferDeep === true;
      const context = (req.body?.context ?? undefined) as AssistantSessionContext | undefined;
      const rawHistory = Array.isArray(req.body?.history)
        ? (req.body.history as Array<{ speaker?: string; text?: string }>)
        : [];
      const rawAttachments = Array.isArray(req.body?.attachments)
        ? (req.body.attachments as Array<{ name?: string; mimeType?: string; dataBase64?: string }>)
        : [];
      if (!command && rawAttachments.length === 0) {
        return sendError(res, 400, 'Assistant Command', 'Missing command', 'Missing command', req.originalUrl);
      }
      const effectiveCommand = command || 'Analyze the attached image and summarize what you see.';

      const activePlugins = normalizePluginDescriptors(context?.plugins, 30).filter((p) => p.enabled);
      const pluginMap = new Map(activePlugins.map((p) => [p.toolName, p]));
      const combinedDeclarations = [
        ...getActiveToolDeclarations(context?.permissions),
        ...buildPluginToolDeclarations(activePlugins),
      ];
      const normalizedContext: AssistantSessionContext = {
        ...(context ?? {}),
        plugins: activePlugins,
      };
      const systemInstruction = buildShadowSystemInstruction(normalizedContext);
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const authHdr = String(req.headers.authorization || '').trim();
      const requestWorkspaceToken = authHdr.toLowerCase().startsWith('bearer ')
        ? authHdr.slice(7).trim()
        : null;

      // Build sanitized multi-turn conversation history + multimodal current user turn
      const historyContents: Content[] = [];
      for (const item of rawHistory.slice(-10)) {
        const text = String(item?.text || '').trim().slice(0, 1200);
        if (!text) continue;
        const role = item?.speaker === 'shadow' ? 'model' : 'user';
        const prev = historyContents[historyContents.length - 1];
        if (prev && prev.role === role) {
          prev.parts = [...(prev.parts || []), { text }];
        } else {
          historyContents.push({ role, parts: [{ text }] });
        }
      }
      // Gemini requires history to start with a user turn if non-empty
      while (historyContents.length > 0 && historyContents[0].role !== 'user') {
        historyContents.shift();
      }
      // Ensure last history item is model so current user turn alternates cleanly
      if (historyContents.length > 0 && historyContents[historyContents.length - 1].role === 'user') {
        historyContents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
      }

      const currentUserParts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [{ text: effectiveCommand }];
      for (const att of rawAttachments.slice(0, 3)) {
        const mimeType = String(att?.mimeType || '').trim();
        const dataBase64 = String(att?.dataBase64 || '').trim();
        if (mimeType && dataBase64 && dataBase64.length < 5_000_000) {
          currentUserParts.push({ inlineData: { mimeType, data: dataBase64 } });
        }
      }
      const initialContents: Content[] = [
        ...historyContents,
        { role: 'user', parts: currentUserParts },
      ];

      // Shared tool executor — identical semantics for both provider paths.
      const executeToolCalls = async (
        calls: FunctionCall[]
      ): Promise<{
        actions: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }>;
        traces: Array<{ id: string; name: string; summary: string; ok: boolean; durationMs: number }>;
        toolResponseParts: Array<{
          functionResponse: { id?: string; name: string; response: Record<string, unknown> };
        }>;
      }> => {
        const actions: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }> = [];
        const traces: Array<{ id: string; name: string; summary: string; ok: boolean; durationMs: number }> = [];
        const toolResponseParts: Array<{
          functionResponse: { id?: string; name: string; response: Record<string, unknown> };
        }> = [];

        for (const call of calls) {
          const startedTool = Date.now();
          const args = (call.args ?? {}) as Record<string, unknown>;
          let result: Record<string, unknown> = { ok: true };
          let traceSummary = call.name || 'tool';

          if (!isToolPermitted(call.name || '', context?.permissions)) {
            result = {
              ok: false,
              permissionDenied: true,
              error: `Permission for ${call.name} is currently disabled in Setup.`,
            };
            traceSummary = `Permission denied for ${call.name}`;
          } else if (call.name === 'play_youtube_media') {
            const query = String(args.query || effectiveCommand);
            const mediaType = args.mediaType === 'song' ? 'song' : 'video';
            const results = await searchYouTube(
              query,
              runtime?.provider === 'openrouter'
                ? { openRouter: { apiKey: runtime.apiKey, model: runtime.model } }
                : { geminiKeyOverride: runtime?.apiKey }
            );
            if (results.length > 0) {
              result = { ok: true, mediaType, selected: results[0], alternatives: results.slice(1, 4) };
              traceSummary = `Queued "${results[0].title}"`;
            } else {
              result = { ok: false, error: `No playable YouTube videos found for "${query}".` };
              traceSummary = `No YouTube results for ${query}`;
            }
          } else if (call.name === 'inspect_web_page') {
            const targetUrl = String(args.url || '');
            const inspection = await inspectWebPage(targetUrl);
            result = {
              ok: inspection.statusCode >= 200 && inspection.statusCode < 400,
              inspection,
            };
            traceSummary = `Inspected ${inspection.title || targetUrl} (${inspection.fields.length} fields)`;
          } else if (call.name === 'run_autonomous_web_agent') {
            const goal = String(args.goal || effectiveCommand);
            const startUrl = String(args.startUrl || 'https://news.ycombinator.com');
            const maxSteps = Number(args.maxSteps || 4);
            const agentResult = await runAutonomousWebAgent({
              goal,
              startUrl,
              maxSteps,
              preferDeep: deepThinking,
              runtime,
            });
            result = agentResult as unknown as Record<string, unknown>;
            traceSummary = `${agentResult.iterations.length} iterations on ${agentResult.finalUrl}`;
          } else if (call.name === 'execute_browser_automation') {
            const goal = String(args.goal || 'Browser Automation');
            const targetUrl = String(args.targetUrl || '');
            const steps = Array.isArray(args.steps) ? args.steps : [];
            const hasArrangeStep = steps.some(
              (s) =>
                s &&
                typeof s === 'object' &&
                String((s as Record<string, unknown>).action || '').toLowerCase() === 'arrange_windows'
            );
            const isDesktopLayout = targetUrl.toLowerCase().startsWith('desktop://') || hasArrangeStep;
            if (isDesktopLayout) {
              const inspection = buildDesktopLayoutInspection(steps, targetUrl || 'desktop://window-layout');
              result = {
                ok: true,
                goal,
                targetUrl: inspection.finalUrl,
                steps,
                inspection,
                requiresClientExecution: true,
              };
              traceSummary = `Desktop layout ${goal}`;
            } else {
              const execution = await executeBrowserPlan({ goal, targetUrl, steps });
              result = {
                ok: execution.ok,
                goal: execution.goal,
                targetUrl: execution.targetUrl,
                engine: execution.engine,
                playwrightAvailable: execution.playwrightAvailable,
                screenshotBase64: execution.screenshotBase64 || null,
                steps: execution.steps,
                inspection: execution.inspection,
                extractedItems: execution.extractedItems,
                submissionResult: execution.submissionResult,
                totalDurationMs: execution.totalDurationMs,
                ...(execution.error ? { error: execution.error } : {}),
              };
              traceSummary = `${execution.steps.length} step(s) on ${execution.targetUrl}`;
            }
          } else if (call.name === 'control_youtube_player') {
            result = { ok: true, action: args.action, seconds: args.seconds ?? null };
            traceSummary = `Player ${String(args.action || 'play')}`;
          } else if (call.name === 'set_focus_timer') {
            const timerAction = String(args.action || 'start');
            const minutes = Math.min(180, Math.max(1, Number(args.minutes) || 25));
            const label = String(args.label || 'Focus Timer').slice(0, 60);
            result = { ok: true, action: timerAction, minutes, label };
            traceSummary = `Timer ${timerAction}${timerAction === 'start' ? ` (${minutes}m)` : ''}`;
          } else if (call.name === 'save_voice_macro') {
            result = { ok: true, macro: args };
            traceSummary = `Saved macro "${String(args.name || 'Macro')}"`;
          } else if (call.name === 'save_memory') {
            result = {
              ok: true,
              saved: true,
              content: String(args.content || '').slice(0, 600),
              category: String(args.category || 'fact'),
              importance: String(args.importance || 'normal'),
            };
            traceSummary = `Saved memory (${String(args.category || 'fact')})`;
          } else if (call.name === 'forget_memory') {
            result = {
              ok: true,
              query: String(args.query || ''),
            };
            traceSummary = `Forgot memory matching "${String(args.query || '')}"`;
          } else if (call.name === 'research_topic') {
            const report = await runJarvisResearch({
              query: String(args.query || effectiveCommand),
              depth: args.depth === 'quick' ? 'quick' : 'deep',
              urls: Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : [],
              runtime,
            });
            result = { ok: true, report };
            traceSummary = `Researched ${report.sources.length} sources`;
          } else if (call.name === 'generate_visual') {
            const visualOpts: Parameters<typeof generateVisualAsset>[0] = {
              prompt: String(args.prompt || effectiveCommand),
              style: normalizeVisualStyle(args.style),
              aspectRatio: normalizeAspectRatio(args.aspectRatio),
            };
            if (runtime?.provider === 'openrouter') {
              visualOpts.openRouter = { apiKey: runtime.apiKey, model: runtime.model };
            } else {
              visualOpts.apiKeyOverride = runtime?.apiKey;
            }
            const visual = await generateVisualAsset(visualOpts);
            result = { ok: true, visual };
            traceSummary = `Generated ${visual.kind}: ${visual.title}`;
          } else if (
            call.name === 'manage_laptop_files' ||
            call.name === 'control_laptop_apps' ||
            call.name === 'execute_terminal_command'
          ) {
            result = {
              ok: true,
              requiresClientExecution: true,
              tool: call.name,
              args,
            };
            traceSummary = `Client tool ${call.name}`;
          } else {
            const ext = await executeExtendedDomainToolCall({
              name: call.name || '',
              args,
              runtime,
              workspaceToken: requestWorkspaceToken,
            });
            if (ext.handled) {
              result = ext.result;
              traceSummary = ext.summary;
            } else if (call.name && pluginMap.has(call.name)) {
              const plugin = pluginMap.get(call.name)!;
              if (plugin.kind === 'laptop_command') {
                if (context?.permissions?.terminal === false) {
                  result = {
                    ok: false,
                    permissionDenied: true,
                    pluginId: plugin.id,
                    pluginName: plugin.name,
                    toolName: plugin.toolName,
                    error: 'Terminal permission is required to run laptop command plugins.',
                  };
                } else {
                  const renderedCommand = renderLaptopCommand(plugin, args);
                  result = {
                    ok: true,
                    requiresClientExecution: true,
                    pluginId: plugin.id,
                    pluginName: plugin.name,
                    toolName: plugin.toolName,
                    kind: plugin.kind,
                    renderedCommand,
                  };
                }
                traceSummary = `Plugin ${plugin.name}`;
              } else {
                const pluginExec = await executeHttpPlugin(plugin, args);
                result = pluginExec as unknown as Record<string, unknown>;
                traceSummary = `${plugin.name} (${pluginExec.ok ? 'OK' : 'Failed'})`;
              }
            }
          }

          actions.push({ name: call.name || 'unknown', args, result });
          traces.push({
            id: `trace-${Date.now()}-${traces.length}`,
            name: call.name || 'unknown',
            summary: traceSummary,
            ok: result.ok !== false,
            durationMs: Math.max(1, Date.now() - startedTool),
          });
          toolResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name || 'unknown',
              response: result,
            },
          });
        }

        return { actions, traces, toolResponseParts };
      };

      if (runtime?.provider === 'openrouter') {
        const orContents: Content[] = [...initialContents];
        let spokenText = '';
        const actions: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }> = [];
        const toolTraces: Array<{ id: string; name: string; summary: string; ok: boolean; durationMs: number }> = [];

        for (let round = 0; round < 4; round++) {
          const turn = await openRouterGenerate({
            apiKey: runtime.apiKey,
            model: runtime.model,
            systemInstruction,
            contents: orContents,
            tools: combinedDeclarations,
          });
          if (turn.text) spokenText = turn.text;
          if (turn.functionCalls.length === 0) break;

          const executed = await executeToolCalls(turn.functionCalls);
          actions.push(...executed.actions);
          toolTraces.push(...executed.traces);
          if (!turn.modelContent) break;
          orContents.push(turn.modelContent, { role: 'user', parts: executed.toolResponseParts });
        }

        if (!spokenText) {
          spokenText = actions.length > 0 ? 'Command executed.' : 'Ready.';
        }

        const companionGeminiKey = resolveCompanionGeminiKey({
          headers: req.headers,
          body: req.body,
          runtime,
        });
        const audioBase64 = speak
          ? await synthesizeJarvisSpeech(spokenText, voiceName, companionGeminiKey)
          : null;
        return res.json({
          spokenText,
          actions,
          toolTraces,
          modelUsed: runtime.model,
          audioBase64,
          audioMimeType: audioBase64 ? 'audio/wav' : null,
          provider: 'openrouter',
        });
      }

      // Gemini path: Gemini 4 Hydrogen with adaptive ThinkingLevel + multi-round agentic tool loop
      const ai = getGeminiClient(runtime?.apiKey);
      const models = getModelConfig();
      const useDeepFirst =
        deepThinking ||
        preferDeepCommandDefault() ||
        rawAttachments.length > 0 ||
        rawHistory.length > 0;

      const runDeepTurn = (contents: Content[], retries = 0) =>
        withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: models.deepText,
              contents,
              config: {
                systemInstruction,
                tools: [{ functionDeclarations: combinedDeclarations }],
                thinkingConfig: {
                  thinkingLevel: deepThinking ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
                },
              },
            }),
          retries
        );

      const runFastTurn = (contents: Content[], retries = 1) =>
        withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: models.fastText,
              contents,
              config: {
                systemInstruction,
                tools: [{ functionDeclarations: combinedDeclarations }],
              },
            }),
          retries
        );

      let activeModelLabel = models.fastText;
      const runCommandTurn = async (contents: Content[]) => {
        if (useDeepFirst && Date.now() >= preferLiteUntil) {
          try {
            activeModelLabel = models.deepText;
            return await runDeepTurn(contents);
          } catch (err) {
            if (!isOverloadOrQuotaError(err)) throw err;
            preferLiteUntil = Date.now() + 60_000;
            activeModelLabel = models.fastText;
            return runFastTurn(contents);
          }
        }
        try {
          activeModelLabel = models.fastText;
          return await runFastTurn(contents);
        } catch (err) {
          if (!isOverloadOrQuotaError(err)) throw err;
          activeModelLabel = models.deepText;
          return runDeepTurn(contents);
        }
      };

      const workingContents: Content[] = [...initialContents];
      let spokenText = '';
      const actions: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }> = [];
      const toolTraces: Array<{ id: string; name: string; summary: string; ok: boolean; durationMs: number }> = [];

      for (let round = 0; round < 4; round++) {
        const response = await runCommandTurn(workingContents);
        const turnText = (response.text || '').trim();
        if (turnText) spokenText = turnText;

        const calls = response.functionCalls ?? [];
        if (calls.length === 0) break;

        const executed = await executeToolCalls(calls);
        actions.push(...executed.actions);
        toolTraces.push(...executed.traces);

        const previousContent = response.candidates?.[0]?.content;
        if (!previousContent) break;
        workingContents.push(previousContent, {
          role: 'user',
          parts: executed.toolResponseParts,
        });
      }

      if (!spokenText) {
        spokenText = actions.length > 0 ? 'Command executed.' : 'Ready.';
      }

      const audioBase64 = speak
        ? await synthesizeJarvisSpeech(spokenText, voiceName, runtime?.apiKey)
        : null;
      return res.json({
        spokenText,
        actions,
        toolTraces,
        modelUsed: activeModelLabel,
        audioBase64,
        audioMimeType: audioBase64 ? 'audio/wav' : null,
        provider: 'gemini',
      });
    } catch (err) {
      console.error('Assistant command error:', err);
      return sendGeminiError(res, err, 'Assistant command failed', 'Assistant Command', req.originalUrl);
    }
  });

  // Unmatched /api/* handler & Express global error middleware returning detailed JSON
  app.use('/api', (req, res) => {
    return sendError(
      res,
      404,
      'Server API',
      `API route not found: ${req.method} ${req.originalUrl}`,
      'API route not found',
      req.originalUrl
    );
  });

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status =
      typeof err === 'object' && err && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    console.error('Unhandled Express error:', err);
    return sendError(res, status, 'Server API', err, 'Unhandled server request error', req.originalUrl);
  });

  const server = http.createServer(app);

  // Vite middleware or production static serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: {
          server,
          path: '/__vite_hmr',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // WebSocket Server for Gemini Live Voice Streaming (/ws/live)
  // Uses noServer so it shares the HTTP server cleanly alongside Vite's /__vite_hmr WS handler.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
      if (pathname === '/ws/live') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    const reqUrl = new URL(req.url || '/ws/live', `http://${req.headers.host || 'localhost'}`);
    const requestedVoice = reqUrl.searchParams.get('voice') || 'Charon';
    const ctxId = reqUrl.searchParams.get('ctx') || '';
    const sessionContext = ctxId ? sessionContexts.get(ctxId)?.context : undefined;
    const validVoices = new Set(['Charon', 'Fenrir', 'Zephyr', 'Kore', 'Puck']);
    const voiceName = validVoices.has(requestedVoice) ? requestedVoice : 'Charon';

    let session: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null = null;
    let isClosed = false;
    const pendingClientTools = new Map<
      string,
      {
        resolve: (value: Record<string, unknown>) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();

    const safeSend = (payload: Record<string, unknown>) => {
      if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const requestClientToolExecution = (
      name: string,
      args: Record<string, unknown>
    ): Promise<Record<string, unknown>> => {
      return new Promise((resolve) => {
        if (isClosed || clientWs.readyState !== WebSocket.OPEN) {
          resolve({ ok: false, error: 'Client socket closed before executing laptop action.' });
          return;
        }
        const callId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timer = setTimeout(() => {
          pendingClientTools.delete(callId);
          resolve({
            ok: false,
            error:
              'Timed out waiting for local Shadow Laptop Agent or Tauri shell. Open the Desktop tab to start the background agent.',
          });
        }, 22000);
        pendingClientTools.set(callId, { resolve, timer });
        safeSend({ type: 'client_tool_request', callId, name, args });
      });
    };

    // BYOK auth handshake: the client announces provider/key as its first WS
    // message ({type:'ai_auth'}). Legacy clients fall back to server env keys
    // after a short grace period. Messages received early are queued & flushed.
    let processMessage: ((raw: string) => void) | null = null;
    const preAuthQueue: string[] = [];
    let authTimer: ReturnType<typeof setTimeout> | null = null;
    let authResolved = false;
    // Transient Workspace OAuth access token scoped ONLY to this active WebSocket memory lifetime
    let wsWorkspaceToken: string | null = null;

    clientWs.on('message', (raw) => {
      const text = raw.toString();
      if (!authResolved) {
        try {
          const authMsg = JSON.parse(text) as {
            type?: string;
            provider?: string;
            apiKey?: string;
            model?: string;
            workspaceToken?: string;
          };
          if (authMsg?.type === 'ai_auth') {
            authResolved = true;
            if (typeof authMsg.workspaceToken === 'string' && authMsg.workspaceToken.trim()) {
              wsWorkspaceToken = authMsg.workspaceToken.trim();
            }
            if (authTimer) {
              clearTimeout(authTimer);
              authTimer = null;
            }
            void startLiveSession(authMsg);
            return;
          }
        } catch {
          // Not JSON (legacy client) — queue it; server env keys will be used.
        }
        preAuthQueue.push(text);
        return;
      }
      if (processMessage) processMessage(text);
      else preAuthQueue.push(text);
    });

    authTimer = setTimeout(() => {
      authResolved = true;
      void startLiveSession(null);
    }, 600);

    const startLiveSession = async (
      auth: { provider?: string; apiKey?: string; model?: string; geminiKey?: string } | null
    ): Promise<void> => {
    try {
      const liveGeminiKey =
        (auth?.geminiKey || '').trim() ||
        ((auth?.provider || '').toLowerCase() !== 'openrouter' ? (auth?.apiKey || '').trim() : '');
      if ((auth?.provider || '').toLowerCase() === 'openrouter' && !liveGeminiKey && !resolveServerGeminiKey()) {
        const msg =
          'Live voice audio requires a Gemini API key (OpenRouter powers text commands, research, and visuals). Add a Gemini key in AI Settings to use Live Voice alongside OpenRouter.';
        safeSend({
          type: 'error',
          message: msg,
          detail: buildErrorDetail(400, 'Gemini Live WS', msg, msg, '/ws/live'),
        });
        clientWs.close();
        return;
      }
      const ai = getGeminiLiveClient(liveGeminiKey || undefined);
      const activePlugins = normalizePluginDescriptors(sessionContext?.plugins, 30).filter(
        (p) => p.enabled
      );
      const pluginMap = new Map(activePlugins.map((p) => [p.toolName, p]));
      const liveToolDeclarations = [
        ...getActiveToolDeclarations(sessionContext?.permissions),
        ...buildPluginToolDeclarations(activePlugins),
      ];
      const liveModel = getModelConfig().live;
      const liveThinking = resolveLiveThinkingLevel(liveModel);
      let reportedLiveError = false;

      session = await ai.live.connect({
        model: liveModel,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Only extended-thinking live models accept thinkingConfig (LOW/MEDIUM/HIGH).
          ...(liveThinking ? { thinkingConfig: { thinkingLevel: liveThinking } } : {}),
          tools: [{ functionDeclarations: liveToolDeclarations }],
          systemInstruction: buildShadowSystemInstruction({
            ...(sessionContext ?? {}),
            plugins: activePlugins,
          }),
        },
        callbacks: {
          onopen: () => {
            safeSend({ type: 'ready', voiceName });
          },
          onmessage: async (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              safeSend({ type: 'input_transcript', text: content.inputTranscription.text });
            }
            if (content?.outputTranscription?.text) {
              safeSend({ type: 'output_transcript', text: content.outputTranscription.text });
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                safeSend({ type: 'audio', data: part.inlineData.data });
              }
            }
            if (content?.interrupted) {
              safeSend({ type: 'interrupted' });
            }
            if (content?.turnComplete) {
              safeSend({ type: 'turn_complete' });
            }

            // Handle Gemini Live Function Calls
            const toolCalls = message.toolCall?.functionCalls ?? [];
            if (toolCalls.length > 0 && session) {
              const responses: Array<{
                id?: string;
                name: string;
                response: Record<string, unknown>;
              }> = [];

              for (const call of toolCalls) {
                const args = (call.args ?? {}) as Record<string, unknown>;
                let result: Record<string, unknown> = { ok: true };

                // Immediately notify UI so 3D Arc Reactor & live status transition seamlessly
                safeSend({
                  type: 'tool_started',
                  name: call.name,
                  args,
                });

                try {
                  if (!isToolPermitted(call.name || '', sessionContext?.permissions)) {
                    result = {
                      ok: false,
                      permissionDenied: true,
                      error: `Permission for ${call.name} is disabled in laptop setup.`,
                    };
                  } else if (call.name === 'play_youtube_media') {
                    const query = String(args.query || '');
                    const mediaType = args.mediaType === 'song' ? 'song' : 'video';
                    const results = await searchYouTube(query, {
                      geminiKeyOverride: liveGeminiKey || undefined,
                    });
                    if (results.length > 0) {
                      result = {
                        ok: true,
                        mediaType,
                        selected: results[0],
                        alternatives: results.slice(1, 4),
                      };
                    } else {
                      result = { ok: false, error: `No YouTube results found for ${query}` };
                    }
                  } else if (call.name === 'execute_browser_automation') {
                    const goal = String(args.goal || 'Browser Automation');
                    const targetUrl = String(args.targetUrl || '');
                    const steps = Array.isArray(args.steps) ? args.steps : [];
                    const hasArrangeStep = steps.some(
                      (s) =>
                        s &&
                        typeof s === 'object' &&
                        String((s as Record<string, unknown>).action || '').toLowerCase() ===
                          'arrange_windows'
                    );
                    const isDesktopLayout =
                      targetUrl.toLowerCase().startsWith('desktop://') || hasArrangeStep;

                    if (isDesktopLayout) {
                      const inspection = buildDesktopLayoutInspection(
                        steps,
                        targetUrl || 'desktop://window-layout'
                      );
                      const agentResult = await requestClientToolExecution('execute_browser_automation', {
                        goal,
                        targetUrl: targetUrl || 'desktop://window-layout',
                        steps,
                      });
                      result = {
                        ok: Boolean(agentResult.ok),
                        goal,
                        targetUrl: inspection.finalUrl,
                        steps,
                        inspection,
                        clientExecuted: true,
                        agentResult,
                        error: !agentResult.ok ? agentResult.error : undefined,
                      };
                    } else {
                      const execution = await executeBrowserPlan({ goal, targetUrl, steps });
                      result = {
                        ok: execution.ok,
                        goal: execution.goal,
                        targetUrl: execution.targetUrl,
                        engine: execution.engine,
                        playwrightAvailable: execution.playwrightAvailable,
                        screenshotBase64: execution.screenshotBase64 || null,
                        steps: execution.steps,
                        inspection: execution.inspection,
                        extractedItems: execution.extractedItems,
                        submissionResult: execution.submissionResult,
                        totalDurationMs: execution.totalDurationMs,
                        ...(execution.error ? { error: execution.error } : {}),
                      };
                    }
                  } else if (call.name === 'inspect_web_page') {
                    const targetUrl = String(args.url || '');
                    const inspection = await inspectWebPage(targetUrl);
                    result = {
                      ok: inspection.statusCode >= 200 && inspection.statusCode < 400,
                      inspection,
                    };
                  } else if (call.name === 'run_autonomous_web_agent') {
                    const agentRes = await runAutonomousWebAgent({
                      goal: String(args.goal || ''),
                      startUrl: String(args.startUrl || 'https://news.ycombinator.com'),
                      maxSteps: Number(args.maxSteps || 4),
                      runtime: liveGeminiKey
                        ? { provider: 'gemini', apiKey: liveGeminiKey, model: '', byok: true }
                        : undefined,
                    });
                    result = agentRes as unknown as Record<string, unknown>;
                  } else if (call.name === 'set_focus_timer') {
                    result = {
                      ok: true,
                      action: String(args.action || 'start'),
                      minutes: Math.min(180, Math.max(1, Number(args.minutes) || 25)),
                      label: String(args.label || 'Focus Timer').slice(0, 60),
                    };
                  } else if (call.name === 'control_youtube_player') {
                    result = { ok: true, action: args.action, seconds: args.seconds ?? null };
                  } else if (call.name === 'save_voice_macro') {
                    result = { ok: true, macro: args };
                  } else if (call.name === 'save_memory') {
                    result = {
                      ok: true,
                      saved: true,
                      content: String(args.content || '').slice(0, 600),
                      category: String(args.category || 'fact'),
                      importance: String(args.importance || 'normal'),
                    };
                  } else if (call.name === 'forget_memory') {
                    result = {
                      ok: true,
                      query: String(args.query || ''),
                    };
                  } else if (call.name === 'research_topic') {
                    const report = await runJarvisResearch({
                      query: String(args.query || ''),
                      depth: args.depth === 'quick' ? 'quick' : 'deep',
                      urls: Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : [],
                      runtime: liveGeminiKey
                        ? { provider: 'gemini', apiKey: liveGeminiKey, model: '', byok: true }
                        : undefined,
                    });
                    result = { ok: true, report };
                  } else if (call.name === 'generate_visual') {
                    const visual = await generateVisualAsset({
                      prompt: String(args.prompt || ''),
                      style: normalizeVisualStyle(args.style),
                      aspectRatio: normalizeAspectRatio(args.aspectRatio),
                      apiKeyOverride: liveGeminiKey || undefined,
                    });
                    result = { ok: true, visual };
                  } else if (
                    call.name === 'manage_laptop_files' ||
                    call.name === 'control_laptop_apps' ||
                    call.name === 'execute_terminal_command'
                  ) {
                    result = await requestClientToolExecution(call.name, args);
                  } else {
                    const ext = await executeExtendedDomainToolCall({
                      name: call.name || '',
                      args,
                      runtime: liveGeminiKey
                        ? { provider: 'gemini', apiKey: liveGeminiKey, model: '', byok: true }
                        : null,
                      workspaceToken: wsWorkspaceToken,
                    });
                    if (ext.handled) {
                      result = ext.result;
                    } else if (call.name && pluginMap.has(call.name)) {
                      const plugin = pluginMap.get(call.name)!;
                      if (plugin.kind === 'laptop_command') {
                        if (sessionContext?.permissions?.terminal === false) {
                          result = {
                            ok: false,
                            permissionDenied: true,
                            pluginId: plugin.id,
                            pluginName: plugin.name,
                            toolName: plugin.toolName,
                            kind: plugin.kind,
                            error: 'Terminal permission is disabled in Laptop Setup.',
                          };
                        } else {
                          const renderedCommand = renderLaptopCommand(plugin, args);
                          const laptopRes = await requestClientToolExecution('execute_terminal_command', {
                            command: renderedCommand,
                            background: false,
                          });
                          result = {
                            ...laptopRes,
                            pluginId: plugin.id,
                            pluginName: plugin.name,
                            toolName: plugin.toolName,
                            kind: plugin.kind,
                            renderedCommand,
                          };
                        }
                      } else {
                        const pluginExec = await executeHttpPlugin(plugin, args);
                        result = pluginExec as unknown as Record<string, unknown>;
                      }
                    }
                  }
                } catch (toolErr) {
                  const detail = buildErrorDetail(500, 'Live Tool Execution', toolErr, 'Tool execution failed', `/ws/live:${call.name || 'tool'}`);
                  result = {
                    ok: false,
                    error: detail.summary,
                    errorDetail: detail,
                  };
                }

                // Forward action event to connected desktop/browser UI
                safeSend({
                  type: 'tool_action',
                  name: call.name,
                  args,
                  result,
                });

                responses.push({
                  id: call.id,
                  name: call.name || 'unknown',
                  response: result,
                });
              }

              session.sendToolResponse({ functionResponses: responses });
            }
          },
          onerror: (err: unknown) => {
            console.error('Gemini Live session error:', err);
            reportedLiveError = true;
            const detail = buildErrorDetail(
              500,
              'Gemini Live WS',
              err,
              'Gemini Live session error',
              '/ws/live'
            );
            safeSend({
              type: 'error',
              message: detail.summary,
              detail,
            });
          },
          onclose: (ev?: { code?: number; reason?: string }) => {
            if (!isClosed && !reportedLiveError && ev && ((ev.code && ev.code !== 1000 && ev.code !== 1005) || ev.reason)) {
              reportedLiveError = true;
              const msg = ev.reason
                ? `Voice session closed (code ${ev.code || 'ws'}): ${ev.reason}`
                : `Voice session closed unexpectedly (code ${ev.code}).`;
              safeSend({
                type: 'error',
                message: msg,
                detail: buildErrorDetail(
                  ev.code || 1006,
                  'Gemini Live WS',
                  { code: ev.code, reason: ev.reason, message: msg },
                  msg,
                  '/ws/live'
                ),
              });
            }
            safeSend({ type: 'closed' });
          },
        },
      });
    } catch (err) {
      console.error('Failed to open Gemini Live session:', err);
      if (!isClosed) {
        const { status, message, detail } = parseGeminiHttpError(
          err,
          'Could not start Gemini Live voice session.',
          'Gemini Live WS'
        );
        safeSend({
          type: 'error',
          message,
          detail: {
            ...detail,
            status,
            endpoint: '/ws/live',
          },
        });
      }
      clientWs.close();
      return;
    }

    const handleLiveClientMessage = (raw: string) => {
      if (!session || isClosed) return;
      try {
        const msg = JSON.parse(raw) as {
          type?: string;
          data?: string;
          mimeType?: string;
          text?: string;
          callId?: string;
          result?: Record<string, unknown>;
        };
        if (msg.type === 'workspace_token') {
          wsWorkspaceToken = typeof msg.data === 'string' && msg.data.trim() ? msg.data.trim() : null;
        } else if (msg.type === 'audio' && msg.data) {
          session.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'video' && msg.data) {
          session.sendRealtimeInput({
            video: { data: msg.data, mimeType: msg.mimeType || 'image/jpeg' },
          });
        } else if (msg.type === 'text' && msg.text) {
          session.sendRealtimeInput({ text: msg.text });
        } else if (msg.type === 'context_note' && msg.text) {
          session.sendRealtimeInput({ text: `[Workspace Context Update] ${msg.text}` });
        } else if (msg.type === 'client_tool_response' && msg.callId) {
          const pending = pendingClientTools.get(msg.callId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingClientTools.delete(msg.callId);
            pending.resolve(msg.result ?? { ok: false, error: 'Empty client tool result' });
          }
        }
      } catch (err) {
        console.warn('Invalid WS message from client:', err);
        const detail = buildErrorDetail(400, 'Gemini Live WS Client', err, 'Invalid WS message from client', '/ws/live');
        safeSend({ type: 'error', message: detail.summary, detail });
      }
    };

    processMessage = handleLiveClientMessage;
    for (const queued of preAuthQueue.splice(0)) {
      handleLiveClientMessage(queued);
    }
    };

    clientWs.on('close', () => {
      isClosed = true;
      wsWorkspaceToken = null;
      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }
      for (const [, pending] of pendingClientTools) {
        clearTimeout(pending.timer);
        pending.resolve({ ok: false, error: 'Client disconnected.' });
      }
      pendingClientTools.clear();
      if (session) {
        try {
          session.close();
        } catch {
          // ignore close errors
        }
      }
    });
  });

  startBriefScheduler();
  startProactiveScheduler();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Shadow Desktop server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
