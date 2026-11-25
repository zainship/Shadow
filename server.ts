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
  getGeminiClient,
  getGeminiLiveClient,
  getModelConfig,
  isOverloadOrQuotaError,
  parseGeminiHttpError,
  preferDeepCommandDefault,
  resolveLiveThinkingLevel,
  resolveServerGeminiKey,
  withGeminiRetry,
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

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
        'Content-Type, Accept, x-shadow-provider, x-shadow-key, x-shadow-model, x-shadow-gemini-key'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    res.json({ ok: true, service: 'shadow-desktop-server' });
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
        return res.status(400).json({
          ok: false,
          error: 'No API key provided. Enter an OpenRouter or Gemini key in Settings/Setup.',
        });
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
      const { status, message } = parseGeminiHttpError(err, 'API key verification failed');
      return res.status(status).json({ ok: false, error: message });
    }
  });

  // Downloadable / copyable standalone Shadow Laptop Agent & background service installers
  app.get('/api/desktop/scripts', (_req, res) => {
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
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to load agent scripts',
      });
    }
  });

  // YouTube search endpoint
  app.get('/api/youtube/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) {
        return res.status(400).json({ error: 'Missing query parameter q' });
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
      const msg = err instanceof Error ? err.message : 'YouTube search failed';
      return res.status(500).json({ error: msg });
    }
  });

  // Web page inspector endpoint for real DOM form & link discovery
  app.post('/api/automation/inspect', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!url) {
        return res.status(400).json({ error: 'Missing url' });
      }
      const inspection = await inspectWebPage(url);
      return res.json(inspection);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Page inspection failed';
      return res.status(500).json({ error: msg });
    }
  });

  // Real multi-step HTTP/DOM browser automation executor
  app.post('/api/automation/execute', async (req, res) => {
    try {
      const goal = String(req.body?.goal || 'Browser Automation').trim();
      const targetUrl = String(req.body?.targetUrl || '').trim();
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
      if (!targetUrl && steps.length === 0) {
        return res.status(400).json({ ok: false, error: 'Missing targetUrl or steps' });
      }
      const execution = await executeBrowserPlan({ goal, targetUrl, steps });
      return res.json(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Browser automation failed';
      return res.status(500).json({ ok: false, error: msg });
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
        return res.status(400).json({ ok: false, error: 'Missing goal or startUrl' });
      }
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const result = await runAutonomousWebAgent({ goal, startUrl, maxSteps, preferDeep, runtime });
      return res.json(result);
    } catch (err) {
      const { status, message } = parseGeminiHttpError(err, 'Autonomous web agent failed');
      return res.status(status).json({ ok: false, error: message });
    }
  });

  // Text-to-speech endpoint (Gemini Flash Lite TTS -> WAV)
  app.post('/api/assistant/tts', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const voiceName = String(req.body?.voiceName || 'Charon');
      if (!text) return res.status(400).json({ error: 'Missing text' });
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
      const msg = err instanceof Error ? err.message : 'TTS failed';
      return res.status(500).json({ error: msg });
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
        return res.status(400).json({ error: 'Missing research query' });
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
      const { status, message } = parseGeminiHttpError(err, 'Research failed');
      return res.status(status).json({ error: message });
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
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid brief config' });
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
      const brief = await runMorningBrief({
        runtime,
        voiceName: String(req.body?.voiceName || '').trim() || undefined,
      });
      return res.json({ brief });
    } catch (err) {
      console.error('Morning brief error:', err);
      const { status, message } = parseGeminiHttpError(err, 'Morning Brief failed');
      return res.status(status).json({ error: message });
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
        return res.status(400).json({ error: 'Missing visual prompt' });
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
      const { status, message } = parseGeminiHttpError(err, 'Visual generation failed');
      return res.status(status).json({ error: message });
    }
  });

  // Plugin registry catalog, direct test execution, and manifest URL importer
  app.get('/api/plugins/catalog', (_req, res) => {
    return res.json({ ok: true, catalog: PLUGIN_CATALOG });
  });

  app.post('/api/plugins/fetch-manifest', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!url) return res.status(400).json({ ok: false, error: 'Missing manifest URL' });
      const plugin = await fetchPluginManifestFromUrl(url);
      return res.json({ ok: true, plugin });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to load plugin manifest',
      });
    }
  });

  app.post('/api/plugins/execute', async (req, res) => {
    try {
      const normalized = normalizePluginDescriptors([req.body?.plugin], 1);
      if (normalized.length === 0) {
        return res.status(400).json({ ok: false, error: 'Invalid plugin configuration.' });
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
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Plugin execution failed',
      });
    }
  });

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
        return res.status(400).json({ error: 'Missing command' });
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
      const { status, message } = parseGeminiHttpError(err, 'Assistant command failed');
      return res.status(status).json({ error: message });
    }
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

    clientWs.on('message', (raw) => {
      const text = raw.toString();
      if (!authResolved) {
        try {
          const authMsg = JSON.parse(text) as {
            type?: string;
            provider?: string;
            apiKey?: string;
            model?: string;
          };
          if (authMsg?.type === 'ai_auth') {
            authResolved = true;
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
        safeSend({
          type: 'error',
          message:
            "Live voice audio requires a Gemini API key (OpenRouter powers text commands, research, and visuals). Add a Gemini key in AI Settings to use Live Voice alongside OpenRouter.",
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
                } catch (toolErr) {
                  result = {
                    ok: false,
                    error: toolErr instanceof Error ? toolErr.message : 'Tool execution failed',
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
            safeSend({
              type: 'error',
              message: err instanceof Error ? err.message : 'Gemini Live session error',
            });
          },
          onclose: (ev?: { code?: number; reason?: string }) => {
            if (!isClosed && !reportedLiveError && ev && ((ev.code && ev.code !== 1000 && ev.code !== 1005) || ev.reason)) {
              reportedLiveError = true;
              safeSend({
                type: 'error',
                message: ev.reason
                  ? `Voice session closed (${ev.code || 'ws'}): ${ev.reason}`
                  : `Voice session closed unexpectedly (code ${ev.code}).`,
              });
            }
            safeSend({ type: 'closed' });
          },
        },
      });
    } catch (err) {
      console.error('Failed to open Gemini Live session:', err);
      if (!isClosed) {
        safeSend({
          type: 'error',
          message: err instanceof Error ? err.message : 'Could not start Gemini Live voice session.',
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
        if (msg.type === 'audio' && msg.data) {
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
      }
    };

    processMessage = handleLiveClientMessage;
    for (const queued of preAuthQueue.splice(0)) {
      handleLiveClientMessage(queued);
    }
    };

    clientWs.on('close', () => {
      isClosed = true;
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Shadow Desktop server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
