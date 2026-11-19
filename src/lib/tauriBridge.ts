import type {
  AutomationStep,
  LaptopAgentHealth,
  LaptopBackgroundJob,
  RuntimeKind,
} from '../types/assistant';

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

export interface DesktopRuntimeInfo {
  isTauri: boolean;
  runtime: RuntimeKind;
  os: string;
  arch: string;
  sidecarAvailable: boolean;
}

const AGENT_BASE_URL = 'http://127.0.0.1:4789';
const TOKEN_STORAGE_KEY = 'shadow_agent_token';

export function getSavedAgentToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setSavedAgentToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = token.trim();
    if (clean) window.localStorage.setItem(TOKEN_STORAGE_KEY, clean);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__?.invoke);
}

export async function detectRuntimeEnvironment(): Promise<DesktopRuntimeInfo> {
  if (isTauriEnvironment() && window.__TAURI_INTERNALS__) {
    try {
      const res = await window.__TAURI_INTERNALS__.invoke<{
        isTauri: boolean;
        os: string;
        arch: string;
        sidecarAvailable: boolean;
      }>('get_runtime_environment');
      return {
        isTauri: res.isTauri,
        runtime: 'tauri-desktop',
        os: res.os,
        arch: res.arch,
        sidecarAvailable: res.sidecarAvailable,
      };
    } catch {
      // Fall back to web detection
    }
  }
  return {
    isTauri: false,
    runtime: 'web-sandbox',
    os: typeof navigator !== 'undefined' ? navigator.platform || 'browser' : 'browser',
    arch: 'web',
    sidecarAvailable: false,
  };
}

export async function ensureDesktopBackendServer(): Promise<{
  reachable: boolean;
  root?: string;
  reason?: string;
}> {
  if (!isTauriEnvironment() || !window.__TAURI_INTERNALS__) {
    return { reachable: false, reason: 'not-tauri' };
  }
  try {
    return await window.__TAURI_INTERNALS__.invoke<{
      reachable: boolean;
      root?: string;
      reason?: string;
    }>('ensure_backend_server');
  } catch (err) {
    return {
      reachable: false,
      reason: err instanceof Error ? err.message : 'invoke-failed',
    };
  }
}

export async function checkLaptopAgentHealth(tokenOverride?: string): Promise<LaptopAgentHealth> {
  const token = (tokenOverride ?? getSavedAgentToken()).trim();
  try {
    const res = await fetch(`${AGENT_BASE_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      return { reachable: false, authenticated: false };
    }
    const info = (await res.json()) as {
      ok?: boolean;
      platform?: string;
      arch?: string;
      hostname?: string;
      homeDir?: string;
      pid?: number;
      uptimeSeconds?: number;
      jobsCount?: number;
    };

    let authenticated = false;
    if (token) {
      try {
        const authRes = await fetch(`${AGENT_BASE_URL}/auth-verify`, {
          headers: { 'x-shadow-token': token },
          signal: AbortSignal.timeout(1500),
        });
        authenticated = authRes.ok;
      } catch {
        authenticated = false;
      }
    }

    return {
      reachable: Boolean(info.ok),
      authenticated,
      platform: info.platform,
      arch: info.arch,
      hostname: info.hostname,
      homeDir: info.homeDir,
      pid: info.pid,
      uptimeSeconds: info.uptimeSeconds,
      jobsCount: info.jobsCount,
    };
  } catch {
    return { reachable: false, authenticated: false };
  }
}

export async function fetchLaptopAgentJobs(tokenOverride?: string): Promise<LaptopBackgroundJob[]> {
  const token = (tokenOverride ?? getSavedAgentToken()).trim();
  if (!token) return [];
  try {
    const res = await fetch(`${AGENT_BASE_URL}/jobs`, {
      headers: { 'x-shadow-token': token },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { jobs?: LaptopBackgroundJob[] };
    return data.jobs ?? [];
  } catch {
    return [];
  }
}

export async function killLaptopAgentJob(jobId: string, tokenOverride?: string): Promise<boolean> {
  const token = (tokenOverride ?? getSavedAgentToken()).trim();
  if (!token) return false;
  const res = await fetch(`${AGENT_BASE_URL}/jobs/kill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-shadow-token': token,
    },
    body: JSON.stringify({ jobId }),
  });
  return res.ok;
}

export async function launchTauriBackgroundAgent(): Promise<{
  ok: boolean;
  token?: string;
  stdout?: string;
  stderr?: string;
}> {
  if (!isTauriEnvironment() || !window.__TAURI_INTERNALS__) {
    return { ok: false, stderr: 'Not running inside Tauri desktop shell.' };
  }
  const res = await window.__TAURI_INTERNALS__.invoke<{
    ok: boolean;
    token?: string;
    stdout?: string;
    stderr?: string;
  }>('launch_background_agent');
  if (res.ok && res.token) {
    setSavedAgentToken(res.token);
  }
  return res;
}

async function callAgentEndpoint(
  endpoint: '/files' | '/apps' | '/terminal' | '/browser',
  payload: Record<string, unknown>,
  token: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${AGENT_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-shadow-token': token,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(26000),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, error: String(data.error || `Agent request failed (${res.status})`) };
  }
  return data;
}

export async function executeLaptopTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{
  result: Record<string, unknown>;
  runtime: 'laptop-agent' | 'tauri-native' | 'web-sandbox';
}> {
  const token = getSavedAgentToken();

  // 1. Prefer authenticated Shadow Laptop Agent background daemon if reachable
  if (token) {
    const health = await checkLaptopAgentHealth(token);
    if (health.reachable && health.authenticated) {
      if (toolName === 'manage_laptop_files') {
        return {
          runtime: 'laptop-agent',
          result: await callAgentEndpoint('/files', args, token),
        };
      }
      if (toolName === 'control_laptop_apps') {
        return {
          runtime: 'laptop-agent',
          result: await callAgentEndpoint('/apps', args, token),
        };
      }
      if (toolName === 'execute_terminal_command') {
        return {
          runtime: 'laptop-agent',
          result: await callAgentEndpoint('/terminal', args, token),
        };
      }
      if (toolName === 'execute_browser_automation') {
        return {
          runtime: 'laptop-agent',
          result: await callAgentEndpoint('/browser', args, token),
        };
      }
    }
  }

  // 2. Fallback to native Tauri v2 Rust commands when inside desktop bundle
  if (isTauriEnvironment() && window.__TAURI_INTERNALS__) {
    if (toolName === 'manage_laptop_files') {
      const res = await window.__TAURI_INTERNALS__.invoke<Record<string, unknown>>(
        'manage_local_files',
        {
          operation: String(args.operation || 'list'),
          path: String(args.path || '~'),
          destinationPath: args.destinationPath ? String(args.destinationPath) : null,
          content: args.content !== undefined ? String(args.content) : null,
          pattern: args.pattern ? String(args.pattern) : null,
        }
      );
      return { runtime: 'tauri-native', result: res };
    }
    if (toolName === 'control_laptop_apps') {
      const res = await window.__TAURI_INTERNALS__.invoke<Record<string, unknown>>(
        'control_local_app',
        {
          action: String(args.action || 'open_app'),
          appName: args.appName ? String(args.appName) : null,
          instruction: args.instruction ? String(args.instruction) : null,
          args: args.args ? String(args.args) : null,
        }
      );
      return { runtime: 'tauri-native', result: res };
    }
    if (toolName === 'execute_terminal_command') {
      const res = await window.__TAURI_INTERNALS__.invoke<Record<string, unknown>>(
        'execute_local_terminal',
        {
          command: String(args.command || ''),
          cwd: args.cwd ? String(args.cwd) : null,
          background: Boolean(args.background),
        }
      );
      return { runtime: 'tauri-native', result: res };
    }
  }

  return {
    runtime: 'web-sandbox',
    result: {
      ok: false,
      error:
        'Laptop agent is not paired yet. Open Desktop -> Connect Agent and run shadow-laptop-agent.mjs on your laptop to enable full file, app, and terminal control.',
    },
  };
}

export async function invokeDesktopBrowserAutomation(plan: {
  goal: string;
  targetUrl: string;
  steps: AutomationStep[];
  gap?: number;
}): Promise<{ executedInDesktop: boolean; stdout?: string; stderr?: string }> {
  // Try Shadow Laptop Agent first if paired so even browser-preview users get real Chromium control
  const token = getSavedAgentToken();
  if (token) {
    const health = await checkLaptopAgentHealth(token);
    if (health.reachable && health.authenticated) {
      const res = await callAgentEndpoint('/browser', plan, token);
      return {
        executedInDesktop: Boolean(res.ok),
        stdout: res.stdout ? String(res.stdout) : JSON.stringify(res),
        stderr: res.stderr ? String(res.stderr) : undefined,
      };
    }
  }

  if (!isTauriEnvironment() || !window.__TAURI_INTERNALS__) {
    return { executedInDesktop: false };
  }
  const response = await window.__TAURI_INTERNALS__.invoke<{
    ok: boolean;
    stdout: string;
    stderr: string;
  }>('execute_browser_automation', {
    planJson: JSON.stringify(plan),
  });
  return {
    executedInDesktop: response.ok,
    stdout: response.stdout,
    stderr: response.stderr,
  };
}

export async function invokeDesktopOpenUrl(url: string): Promise<boolean> {
  if (!isTauriEnvironment() || !window.__TAURI_INTERNALS__) {
    return false;
  }
  await window.__TAURI_INTERNALS__.invoke('open_external_url', { url });
  return true;
}
