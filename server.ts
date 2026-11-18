import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { LiveServerMessage, Modality, ThinkingLevel } from '@google/genai';
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
  openRouterGenerate,
  resolveAiRuntime,
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
  inspectWebPage,
  jarvisToolDeclarations,
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
  app.use(express.json({ limit: '1mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'shadow-desktop-server' });
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

  // Text-to-speech endpoint (Gemini Flash Lite TTS -> WAV)
  app.post('/api/assistant/tts', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const voiceName = String(req.body?.voiceName || 'Charon');
      if (!text) return res.status(400).json({ error: 'Missing text' });
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      if (runtime?.provider === 'openrouter' && !resolveServerGeminiKey()) {
        return res.status(400).json({
          error:
            'Speech synthesis runs on Gemini models. Add a Gemini key in AI Settings (or set GEMINI_API_KEY on the server) — OpenRouter keys cannot generate audio.',
        });
      }
      const audioBase64 = await synthesizeJarvisSpeech(
        text,
        voiceName,
        runtime?.provider === 'gemini' ? runtime.apiKey : undefined
      );
      return res.json({ audioBase64, mimeType: 'audio/wav' });
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
      const speak = req.body?.speak !== false;

      if (!query) {
        return res.status(400).json({ error: 'Missing research query' });
      }

      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });
      const report = await runJarvisResearch({ query, depth, urls, runtime });
      const audioBase64 = speak
        ? await synthesizeJarvisSpeech(
            report.spokenSummary,
            voiceName,
            runtime?.provider === 'gemini' ? runtime.apiKey : undefined
          )
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
        ? await synthesizeJarvisSpeech(
            visual.summary,
            voiceName,
            runtime?.provider === 'gemini' ? runtime.apiKey : undefined
          )
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
    if (toolName === 'execute_browser_automation' && perms.browser === false) return false;
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
      },
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    return res.json({ ok: true, ctxId });
  });

  // Natural language command endpoint (for quick-prompts, macro triggers, or text fallback with voice TTS)
  let preferLiteUntil = 0;

  app.post('/api/assistant/command', async (req, res) => {
    try {
      const command = String(req.body?.command || '').trim();
      const voiceName = String(req.body?.voiceName || 'Charon');
      const speak = req.body?.speak !== false;
      const context = (req.body?.context ?? undefined) as AssistantSessionContext | undefined;
      if (!command) {
        return res.status(400).json({ error: 'Missing command' });
      }

      const activePlugins = normalizePluginDescriptors(context?.plugins, 30).filter((p) => p.enabled);
      const pluginMap = new Map(activePlugins.map((p) => [p.toolName, p]));
      const combinedDeclarations = [
        ...jarvisToolDeclarations,
        ...buildPluginToolDeclarations(activePlugins),
      ];
      const normalizedContext: AssistantSessionContext = {
        ...(context ?? {}),
        plugins: activePlugins,
      };
      const systemInstruction = buildShadowSystemInstruction(normalizedContext);
      const runtime = resolveAiRuntime({ headers: req.headers, body: req.body });

      // Shared tool executor — identical semantics for both provider paths.
      const executeToolCalls = async (
        calls: FunctionCall[]
      ): Promise<{
        actions: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }>;
        toolResponseParts: Array<{
          functionResponse: { id?: string; name: string; response: Record<string, unknown> };
        }>;
      }> => {
        const actions: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }> = [];
        const toolResponseParts: Array<{
          functionResponse: { id?: string; name: string; response: Record<string, unknown> };
        }> = [];

        for (const call of calls) {
          const args = (call.args ?? {}) as Record<string, unknown>;
          let result: Record<string, unknown> = { ok: true };

          if (!isToolPermitted(call.name || '', context?.permissions)) {
            result = {
              ok: false,
              permissionDenied: true,
              error: `Permission for ${call.name} is currently disabled in laptop setup.`,
            };
          } else if (call.name === 'play_youtube_media') {
            const query = String(args.query || command);
            const mediaType = args.mediaType === 'song' ? 'song' : 'video';
            const results = await searchYouTube(
              query,
              runtime?.provider === 'openrouter'
                ? { openRouter: { apiKey: runtime.apiKey, model: runtime.model } }
                : { geminiKeyOverride: runtime?.apiKey }
            );
            if (results.length > 0) {
              result = { ok: true, mediaType, selected: results[0], alternatives: results.slice(1, 4) };
            } else {
              result = { ok: false, error: `No playable YouTube videos found for "${query}".` };
            }
          } else if (call.name === 'execute_browser_automation') {
            const targetUrl = String(args.targetUrl || '');
            const steps = Array.isArray(args.steps) ? args.steps : [];
            const hasArrangeStep = steps.some(
              (s) =>
                s &&
                typeof s === 'object' &&
                String((s as Record<string, unknown>).action || '').toLowerCase() === 'arrange_windows'
            );
            const isDesktopLayout = targetUrl.toLowerCase().startsWith('desktop://') || hasArrangeStep;
            const inspection = targetUrl.toLowerCase().startsWith('desktop://')
              ? buildDesktopLayoutInspection(steps, targetUrl)
              : targetUrl
                ? await inspectWebPage(targetUrl)
                : isDesktopLayout
                  ? buildDesktopLayoutInspection(steps, 'desktop://window-layout')
                  : null;
            result = {
              ok: true,
              goal: args.goal,
              targetUrl: inspection?.finalUrl || targetUrl || 'desktop://window-layout',
              steps,
              inspection,
              requiresClientExecution: isDesktopLayout,
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
              query: String(args.query || command),
              depth: args.depth === 'quick' ? 'quick' : 'deep',
              urls: Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : [],
              runtime,
            });
            result = { ok: true, report };
          } else if (call.name === 'generate_visual') {
            const visual = await generateVisualAsset({
              prompt: String(args.prompt || command),
              style: normalizeVisualStyle(args.style),
              aspectRatio: normalizeAspectRatio(args.aspectRatio),
              apiKeyOverride: runtime?.provider === 'gemini' ? runtime.apiKey : undefined,
            });
            result = { ok: true, visual };
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
            } else {
              const pluginExec = await executeHttpPlugin(plugin, args);
              result = pluginExec as unknown as Record<string, unknown>;
            }
          }

          actions.push({ name: call.name || 'unknown', args, result });
          toolResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name || 'unknown',
              response: result,
            },
          });
        }

        return { actions, toolResponseParts };
      };

      if (runtime?.provider === 'openrouter') {
        // BYOK OpenRouter path (OpenAI-compatible tool calling)
        const orContents: Content[] = [{ role: 'user', parts: [{ text: command }] }];
        const firstTurn = await openRouterGenerate({
          apiKey: runtime.apiKey,
          model: runtime.model,
          systemInstruction,
          contents: orContents,
          tools: combinedDeclarations,
        });
        let spokenText = firstTurn.text;
        let actions: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }> = [];

        if (firstTurn.functionCalls.length > 0) {
          const executed = await executeToolCalls(firstTurn.functionCalls);
          actions = executed.actions;
          if (firstTurn.modelContent) {
            const followUp = await openRouterGenerate({
              apiKey: runtime.apiKey,
              model: runtime.model,
              systemInstruction,
              contents: [...orContents, firstTurn.modelContent, { role: 'user', parts: executed.toolResponseParts }],
              tools: combinedDeclarations,
            });
            spokenText = followUp.text || spokenText || 'Command executed.';
          }
        }

        if (!spokenText) {
          spokenText = 'Ready.';
        }

        // Voice readout still rides on Gemini TTS (server key) when available.
        const audioBase64 = speak ? await synthesizeJarvisSpeech(spokenText, voiceName) : null;
        return res.json({
          spokenText,
          actions,
          audioBase64,
          audioMimeType: audioBase64 ? 'audio/wav' : null,
          provider: 'openrouter',
        });
      }

      // Gemini path (server key or BYOK Gemini key)
      const ai = getGeminiClient(runtime?.apiKey);
      const models = getModelConfig();
      const deepFirst = preferDeepCommandDefault() || req.body?.preferDeep === true;

      const runDeepTurn = (contents: Content[], retries = 0) =>
        withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: models.deepText,
              contents,
              config: {
                systemInstruction,
                tools: [{ functionDeclarations: combinedDeclarations }],
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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

      // Fast-first by default: quick commands no longer wait on the deep model's
      // thinking phase. Deep model is opt-in (SHADOW_USE_DEEP_COMMAND=1 / preferDeep).
      const runCommandTurn = async (contents: Content[]) => {
        if (deepFirst) {
          if (Date.now() < preferLiteUntil) {
            return runFastTurn(contents);
          }
          try {
            return await runDeepTurn(contents);
          } catch (err) {
            if (!isOverloadOrQuotaError(err)) throw err;
            preferLiteUntil = Date.now() + 60_000;
            return runFastTurn(contents);
          }
        }
        try {
          return await runFastTurn(contents);
        } catch (err) {
          if (!isOverloadOrQuotaError(err)) throw err;
          // Fast model temporarily unavailable — one deep attempt before failing.
          return runDeepTurn(contents);
        }
      };

      const firstResponse = await runCommandTurn([{ role: 'user', parts: [{ text: command }] }]);

      const functionCalls = firstResponse.functionCalls ?? [];
      let spokenText = (firstResponse.text || '').trim();
      let actions: Array<{ name: string; args: Record<string, unknown>; result: Record<string, unknown> }> = [];

      if (functionCalls.length > 0) {
        const executed = await executeToolCalls(functionCalls);
        actions = executed.actions;
        const previousContent = firstResponse.candidates?.[0]?.content;
        if (previousContent) {
          const followUp = await runCommandTurn([
            { role: 'user', parts: [{ text: command }] },
            previousContent,
            { role: 'user', parts: executed.toolResponseParts },
          ]);
          spokenText = (followUp.text || spokenText || 'Command executed.').trim();
        }
      }

      if (!spokenText) {
        spokenText = 'Ready.';
      }

      const audioBase64 = speak
        ? await synthesizeJarvisSpeech(spokenText, voiceName, runtime?.apiKey)
        : null;
      return res.json({
        spokenText,
        actions,
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

  // Vite middleware or production static serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  const server = http.createServer(app);

  // WebSocket Server for Gemini Live Voice Streaming (/ws/live)
  const wss = new WebSocketServer({ server, path: '/ws/live' });

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
    }, 2500);

    const startLiveSession = async (
      auth: { provider?: string; apiKey?: string; model?: string } | null
    ): Promise<void> => {
    try {
      if ((auth?.provider || '').toLowerCase() === 'openrouter') {
        safeSend({
          type: 'error',
          message:
            "OpenRouter keys can't drive the Live voice engine (that protocol is Gemini-only). Switch AI provider to Gemini in AI Settings for voice sessions — OpenRouter still powers text commands and research.",
        });
        clientWs.close();
        return;
      }
      const ai = getGeminiLiveClient((auth?.apiKey || '').trim() || undefined);
      const activePlugins = normalizePluginDescriptors(sessionContext?.plugins, 30).filter(
        (p) => p.enabled
      );
      const pluginMap = new Map(activePlugins.map((p) => [p.toolName, p]));
      const liveToolDeclarations = [
        ...jarvisToolDeclarations,
        ...buildPluginToolDeclarations(activePlugins),
      ];
      const liveThinking = resolveLiveThinkingLevel();

      session = await ai.live.connect({
        model: getModelConfig().live,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // MINIMAL thinking keeps first-audio latency low on the voice path.
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
                      geminiKeyOverride: (auth?.apiKey || '').trim() || undefined,
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
                    const inspection = targetUrl.toLowerCase().startsWith('desktop://')
                      ? buildDesktopLayoutInspection(steps, targetUrl)
                      : targetUrl
                        ? await inspectWebPage(targetUrl)
                        : isDesktopLayout
                          ? buildDesktopLayoutInspection(steps, 'desktop://window-layout')
                          : null;

                    let clientExecuted = false;
                    let agentResult: Record<string, unknown> | null = null;
                    if (isDesktopLayout) {
                      agentResult = await requestClientToolExecution('execute_browser_automation', {
                        goal: args.goal,
                        targetUrl: targetUrl || 'desktop://window-layout',
                        steps,
                      });
                      clientExecuted = true;
                    }

                    result = {
                      ok: agentResult ? Boolean(agentResult.ok) : true,
                      goal: args.goal,
                      targetUrl: inspection?.finalUrl || targetUrl || 'desktop://window-layout',
                      steps,
                      inspection,
                      clientExecuted,
                      agentResult,
                      error: agentResult && !agentResult.ok ? agentResult.error : undefined,
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
                    });
                    result = { ok: true, report };
                  } else if (call.name === 'generate_visual') {
                    const visual = await generateVisualAsset({
                      prompt: String(args.prompt || ''),
                      style: normalizeVisualStyle(args.style),
                      aspectRatio: normalizeAspectRatio(args.aspectRatio),
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
            safeSend({
              type: 'error',
              message: err instanceof Error ? err.message : 'Gemini Live session error',
            });
          },
          onclose: () => {
            safeSend({ type: 'closed' });
          },
        },
      });
    } catch (err) {
      console.error('Failed to open Gemini Live session:', err);
      safeSend({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not start Gemini Live voice session.',
      });
      clientWs.close();
      return;
    }

    const handleLiveClientMessage = (raw: string) => {
      if (!session || isClosed) return;
      try {
        const msg = JSON.parse(raw) as {
          type?: string;
          data?: string;
          text?: string;
          callId?: string;
          result?: Record<string, unknown>;
        };
        if (msg.type === 'audio' && msg.data) {
          session.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && msg.text) {
          session.sendRealtimeInput({ text: msg.text });
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
