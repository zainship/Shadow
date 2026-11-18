import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { API_ORIGIN } from '../lib/apiBase';
import {
  Check,
  CheckCircle2,
  Clock,
  Columns2,
  Copy,
  Download,
  FolderOpen,
  Laptop,
  LayoutGrid,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  checkLaptopAgentHealth,
  fetchLaptopAgentJobs,
  getSavedAgentToken,
  killLaptopAgentJob,
  launchTauriBackgroundAgent,
  setSavedAgentToken,
  type DesktopRuntimeInfo,
} from '../lib/tauriBridge';
import { computeWindowTilePlacements } from '../lib/windowLayout';
import type {
  AssistantMemory,
  AutomationWorkflow,
  CommandExecution,
  LaptopActionEvent,
  LaptopAgentHealth,
  LaptopBackgroundJob,
  MemoryCategory,
  MemoryImportance,
  SetupConfig,
  WindowLayoutMode,
} from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_CARD,
  MAC_GLASS_FIELD,
  MAC_GLASS_INPUT_WRAP,
  MAC_GLASS_SUBSURFACE,
  MAC_GLASS_TOOLBAR,
  MacSegmentedControl,
} from './MacWindowShell';
import { MemoryStageView } from './MemoryStageView';

interface WorkflowsPanelProps {
  workflows: AutomationWorkflow[];
  isAuthenticated: boolean;
  onRunWorkflow: (wf: AutomationWorkflow) => void;
  onDeleteWorkflow: (id: string) => void;
  onCreateWorkflow: (input: {
    name: string;
    voiceTrigger: string;
    targetUrl: string;
    category: AutomationWorkflow['category'];
  }) => void;
  onRequireAuth: () => void;
}

export const SavedMacrosView: React.FC<WorkflowsPanelProps> = ({
  workflows,
  isAuthenticated,
  onRunWorkflow,
  onDeleteWorkflow,
  onCreateWorkflow,
  onRequireAuth,
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | AutomationWorkflow['category']>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [voiceTrigger, setVoiceTrigger] = useState('');
  const [targetUrl, setTargetUrl] = useState('https://httpbin.org/forms/post');
  const [newCategory, setNewCategory] = useState<AutomationWorkflow['category']>('form-fill');
  const prefersReduced = useReducedMotion();

  const filtered = useMemo(() => {
    return workflows.filter((wf) => {
      if (category !== 'all' && wf.category !== category) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        wf.name.toLowerCase().includes(q) ||
        wf.voiceTrigger.toLowerCase().includes(q) ||
        wf.targetUrl.toLowerCase().includes(q)
      );
    });
  }, [workflows, search, category]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    if (!name.trim()) return;
    onCreateWorkflow({
      name: name.trim(),
      voiceTrigger: voiceTrigger.trim() || name.trim(),
      targetUrl: targetUrl.trim() || 'https://news.ycombinator.com',
      category: newCategory,
    });
    setName('');
    setVoiceTrigger('');
    setShowCreate(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={`${MAC_GLASS_TOOLBAR} justify-between`}>
        <div className="flex items-center gap-2.5 flex-1 min-w-[220px]">
          <div className={`${MAC_GLASS_INPUT_WRAP} w-full max-w-xs`}>
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter macros..."
              className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <MacSegmentedControl
            layoutId="mac-macro-cat"
            value={category}
            onChange={setCategory}
            className="hidden sm:inline-flex"
            options={[
              { id: 'all', label: 'All' },
              { id: 'navigation', label: 'Navigation' },
              { id: 'form-fill', label: 'Forms' },
              { id: 'media', label: 'Media' },
              { id: 'research', label: 'Research' },
            ]}
          />
        </div>

        <button
          type="button"
          onClick={() => (isAuthenticated ? setShowCreate((s) => !s) : onRequireAuth())}
          className={MAC_GLASS_BTN_PRIMARY}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Macro</span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showCreate && (
          <motion.form
            initial={prefersReduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleSubmit}
            className="overflow-hidden border-b border-white/10 bg-white/[0.025]"
          >
            <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <label className="space-y-1 text-xs text-slate-300">
                <span>Macro Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Morning News Briefing"
                  required
                  className={MAC_GLASS_FIELD}
                />
              </label>
              <label className="space-y-1 text-xs text-slate-300">
                <span>Voice Trigger</span>
                <input
                  type="text"
                  value={voiceTrigger}
                  onChange={(e) => setVoiceTrigger(e.target.value)}
                  placeholder="Run my morning briefing"
                  className={MAC_GLASS_FIELD}
                />
              </label>
              <label className="space-y-1 text-xs text-slate-300">
                <span>Target URL</span>
                <input
                  type="url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://news.ycombinator.com"
                  className={`${MAC_GLASS_FIELD} font-mono`}
                />
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as AutomationWorkflow['category'])}
                  className="px-2.5 py-1.5 rounded-[10px] bg-black/40 border border-white/12 text-xs text-slate-100 focus:outline-none focus:border-sky-400/60"
                >
                  <option value="form-fill">Form Fill</option>
                  <option value="navigation">Navigation</option>
                  <option value="research">Research</option>
                  <option value="media">Media</option>
                </select>
                <button type="submit" className={MAC_GLASS_BTN_PRIMARY}>
                  Save
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-auto">
        {!isAuthenticated ? (
          <div className="py-16 px-6 text-center space-y-3">
            <p className="text-sm text-slate-200">
              Sign in with Google to save and sync voice macros in Firebase Firestore.
            </p>
            <button type="button" onClick={onRequireAuth} className={MAC_GLASS_BTN_PRIMARY}>
              Sign In to Sync Macros
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-2">
            <p className="text-sm text-slate-200">No saved voice macros yet.</p>
            <p className="text-xs text-slate-400">
              Run a browser automation command and click “Save Macro” or create one above.
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-5">Macro</th>
                <th className="py-2.5 px-4">Voice Trigger</th>
                <th className="py-2.5 px-4">Target URL</th>
                <th className="py-2.5 px-4 text-right">Runs</th>
                <th className="py-2.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 text-xs">
              {filtered.map((wf) => (
                <tr key={wf.id} className="hover:bg-white/[0.035] transition-colors h-11">
                  <td className="py-2.5 px-5 font-medium text-slate-100">{wf.name}</td>
                  <td className="py-2.5 px-4 text-slate-300">“{wf.voiceTrigger}”</td>
                  <td className="py-2.5 px-4 font-mono text-slate-400 max-w-[240px] truncate">
                    {wf.targetUrl}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300">
                    {wf.runCount}
                  </td>
                  <td className="py-2.5 px-5 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onRunWorkflow(wf)}
                        className="px-2.5 py-1 rounded-lg border border-white/12 bg-white/[0.05] text-slate-100 hover:bg-white/[0.1] hover:border-sky-400/40 inline-flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer"
                      >
                        <Play className="w-3 h-3 text-sky-300" />
                        <span>Run</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteWorkflow(wf.id)}
                        aria-label={`Delete ${wf.name}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/[0.08] transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

interface ExecutionHistoryProps {
  executions: CommandExecution[];
  isAuthenticated: boolean;
  onRequireAuth: () => void;
}

export const ExecutionHistoryView: React.FC<ExecutionHistoryProps> = ({
  executions,
  isAuthenticated,
  onRequireAuth,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CommandExecution['status']>('all');

  const filtered = useMemo(() => {
    return executions.filter((ex) => {
      if (statusFilter !== 'all' && ex.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        ex.transcript.toLowerCase().includes(q) ||
        ex.summary.toLowerCase().includes(q) ||
        ex.targetUrl.toLowerCase().includes(q)
      );
    });
  }, [executions, search, statusFilter]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={`${MAC_GLASS_TOOLBAR} justify-between`}>
        <div className={`${MAC_GLASS_INPUT_WRAP} w-full max-w-xs`}>
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search voice commands..."
            className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>

        <MacSegmentedControl
          layoutId="mac-history-status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'completed', label: 'Completed' },
            { id: 'running', label: 'Running' },
            { id: 'failed', label: 'Failed' },
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {!isAuthenticated ? (
          <div className="py-16 px-6 text-center space-y-3">
            <p className="text-sm text-slate-200">
              Sign in with Google to persist voice command history in Firebase Firestore.
            </p>
            <button type="button" onClick={onRequireAuth} className={MAC_GLASS_BTN_PRIMARY}>
              Sign In to View History
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 px-6 text-center text-xs text-slate-400">
            No command executions recorded yet.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-5">Command Transcript</th>
                <th className="py-2.5 px-4">Intent</th>
                <th className="py-2.5 px-4">Runtime</th>
                <th className="py-2.5 px-4 text-right">Steps</th>
                <th className="py-2.5 px-5 text-right">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 text-xs">
              {filtered.map((ex) => (
                <tr key={ex.id} className="hover:bg-white/[0.035] transition-colors h-11">
                  <td className="py-2.5 px-5 text-slate-100 max-w-[300px] truncate">
                    {ex.transcript}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-400">{ex.intent}</td>
                  <td className="py-2.5 px-4 text-slate-400">
                    {ex.runtime === 'tauri-desktop' ? 'Tauri Desktop' : 'Web Sandbox'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300">
                    {ex.stepsCount}
                  </td>
                  <td className="py-2.5 px-5 text-right">
                    <span className="inline-flex items-center gap-1 justify-end">
                      {ex.status === 'completed' && (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300">Completed</span>
                        </>
                      )}
                      {ex.status === 'running' && (
                        <>
                          <Clock className="w-3.5 h-3.5 text-sky-400" />
                          <span className="text-sky-300">Running</span>
                        </>
                      )}
                      {ex.status === 'failed' && (
                        <>
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                          <span className="text-rose-300">Failed</span>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

interface TauriDesktopViewProps {
  runtimeInfo: DesktopRuntimeInfo;
  agentHealth: LaptopAgentHealth;
  laptopActions: LaptopActionEvent[];
  setupConfig: SetupConfig;
  hasFaceEnrolled: boolean;
  onOpenSetup: () => void;
  onLockSession: () => void;
  onAgentStatusChanged: (health: LaptopAgentHealth) => void;
  onRunLaptopTool: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<Record<string, unknown> | void>;
  onArrangeViaBrowserAutomation: (input: {
    layout: WindowLayoutMode;
    apps: string[];
    gap: number;
  }) => Promise<void>;
  onRunAutomationCommand: (command: string) => Promise<void>;
}

const DEFAULT_SAMPLE_APPS = ['Google Chrome', 'Visual Studio Code', 'Terminal', 'Notes'];

export const TauriDesktopView: React.FC<TauriDesktopViewProps> = ({
  runtimeInfo,
  agentHealth,
  laptopActions,
  setupConfig,
  hasFaceEnrolled,
  onOpenSetup,
  onLockSession,
  onAgentStatusChanged,
  onRunLaptopTool,
  onArrangeViaBrowserAutomation,
  onRunAutomationCommand,
}) => {
  const [tokenInput, setTokenInput] = useState(() => getSavedAgentToken());
  const [checking, setChecking] = useState(false);
  const [jobs, setJobs] = useState<LaptopBackgroundJob[]>([]);
  const [appToOpen, setAppToOpen] = useState('');
  const [terminalCmd, setTerminalCmd] = useState('');
  const [runInBg, setRunInBg] = useState(false);
  const [scriptsBundle, setScriptsBundle] = useState<Record<string, string> | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState(false);
  const [windowLayout, setWindowLayout] = useState<WindowLayoutMode>('side-by-side');
  const [availableApps, setAvailableApps] = useState<string[]>(DEFAULT_SAMPLE_APPS);
  const [selectedApps, setSelectedApps] = useState<string[]>(DEFAULT_SAMPLE_APPS.slice(0, 2));
  const [customAppInput, setCustomAppInput] = useState('');
  const [windowGap, setWindowGap] = useState<number>(8);
  const [layoutCommandInput, setLayoutCommandInput] = useState('');
  const [isArranging, setIsArranging] = useState(false);
  const prefersReduced = useReducedMotion();

  const refreshStatus = async (overrideToken?: string) => {
    setChecking(true);
    try {
      const next = await checkLaptopAgentHealth(overrideToken);
      onAgentStatusChanged(next);
      if (next.reachable && next.authenticated) {
        const j = await fetchLaptopAgentJobs(overrideToken);
        setJobs(j);
      } else {
        setJobs([]);
      }
    } finally {
      setChecking(false);
    }
  };

  React.useEffect(() => {
    void fetch(`${API_ORIGIN}/api/desktop/scripts`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ok?: boolean; files?: Record<string, string> } | null) => {
        if (data?.ok && data.files) setScriptsBundle(data.files);
      })
      .catch(() => null);
    if (agentHealth.reachable && agentHealth.authenticated) {
      void fetchLaptopAgentJobs().then(setJobs);
    }
  }, [agentHealth.reachable, agentHealth.authenticated]);

  const handleSaveAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedAgentToken(tokenInput);
    await refreshStatus(tokenInput);
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canControlLaptop =
    (agentHealth.reachable && agentHealth.authenticated) || runtimeInfo.isTauri;
  const isPaired = agentHealth.reachable && agentHealth.authenticated;

  const previewApps = selectedApps.length > 0 ? selectedApps : availableApps.slice(0, 4);
  const tilePlacements = useMemo(
    () =>
      computeWindowTilePlacements(
        previewApps,
        windowLayout,
        windowGap === 0 ? 0.5 : windowGap === 8 ? 1.5 : 2.6
      ),
    [previewApps, windowLayout, windowGap]
  );

  const handleRefreshOpenApps = async () => {
    setBusyTool(true);
    try {
      const res = await onRunLaptopTool('control_laptop_apps', { action: 'list_apps' });
      const running = Array.isArray(res?.runningApps)
        ? res.runningApps.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      if (running.length > 0) {
        const cleanRunning = running.filter((name) => name !== 'Finder').slice(0, 12);
        const list = cleanRunning.length > 0 ? cleanRunning : running.slice(0, 12);
        setAvailableApps(list);
        setSelectedApps(list.slice(0, windowLayout === 'side-by-side' ? 2 : 4));
      }
    } finally {
      setBusyTool(false);
    }
  };

  const handleToggleApp = (appName: string) => {
    setSelectedApps((prev) =>
      prev.includes(appName) ? prev.filter((a) => a !== appName) : [...prev, appName]
    );
  };

  const handleAddCustomApp = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customAppInput.trim();
    if (!clean) return;
    setAvailableApps((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
    setSelectedApps((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
    setCustomAppInput('');
  };

  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-white/10">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isPaired || runtimeInfo.isTauri
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                  : agentHealth.reachable
                    ? 'bg-amber-400'
                    : 'bg-slate-500'
              }`}
            />
            <span className={isPaired || runtimeInfo.isTauri ? 'text-emerald-300 font-medium' : ''}>
              {isPaired
                ? 'Background Agent Paired'
                : runtimeInfo.isTauri
                  ? 'Tauri Native Access Ready'
                  : agentHealth.reachable
                    ? 'Agent Running (Enter Pairing Token)'
                    : 'Agent Not Running'}
            </span>
            {agentHealth.hostname && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{agentHealth.hostname}</span>
              </>
            )}
            {agentHealth.pid && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">PID {agentHealth.pid}</span>
              </>
            )}
          </div>
          <h3 className="text-lg font-semibold text-slate-50">
            {setupConfig.assistantName || 'Shadow'} Laptop Agent &amp; Tauri Desktop
          </h3>
          <p className="text-sm text-slate-400">
            Give {setupConfig.assistantName || 'Shadow'} full local access to read/write files, open &amp; control apps, automate your browser, and run background terminal commands.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button type="button" onClick={onOpenSetup} className={MAC_GLASS_BTN_SECONDARY}>
            <SlidersHorizontal className="w-3.5 h-3.5 text-sky-300" />
            <span>Laptop Setup</span>
          </button>
          {hasFaceEnrolled && setupConfig.faceAuthEnabled && (
            <button type="button" onClick={onLockSession} className={MAC_GLASS_BTN_SECONDARY}>
              <Lock className="w-3.5 h-3.5 text-amber-300" />
              <span>Face Lock</span>
            </button>
          )}
          {runtimeInfo.isTauri && (
            <button
              type="button"
              onClick={async () => {
                const res = await launchTauriBackgroundAgent();
                if (res.token) setTokenInput(res.token);
                await refreshStatus(res.token);
              }}
              className={MAC_GLASS_BTN_PRIMARY}
            >
              Start Background Agent
            </button>
          )}
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={checking}
            className={MAC_GLASS_BTN_SECONDARY}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Hardware & Pairing Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 grid grid-cols-2 gap-3">
          <div className={`p-3.5 space-y-1 ${MAC_GLASS_CARD}`}>
            <p className="text-xs text-slate-400">Shell &amp; Target</p>
            <p className="text-sm font-medium text-slate-100 truncate">
              {agentHealth.platform || runtimeInfo.os} · {agentHealth.arch || runtimeInfo.arch}
            </p>
          </div>
          <div className={`p-3.5 space-y-1 ${MAC_GLASS_CARD}`}>
            <p className="text-xs text-slate-400">Background Jobs</p>
            <p className="text-sm font-mono tabular-nums text-slate-100">
              {jobs.filter((j) => j.status === 'running').length} active
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSaveAndConnect}
          className={`lg:col-span-7 p-3.5 flex flex-wrap items-center gap-2.5 ${MAC_GLASS_CARD}`}
        >
          <Laptop className="w-4 h-4 text-sky-300 shrink-0" />
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste pairing token from ~/.shadow-agent/token.txt..."
            className="flex-1 min-w-[200px] bg-transparent text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button type="submit" className={MAC_GLASS_BTN_PRIMARY}>
            {agentHealth.authenticated ? 'Paired' : 'Pair Laptop'}
          </button>
        </form>
      </div>

      {/* Live Quick Laptop Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`p-4 space-y-3 ${MAC_GLASS_CARD}`}>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-sky-300" />
              <span>Quick App &amp; File Actions</span>
            </h4>
            <button
              type="button"
              disabled={!canControlLaptop || busyTool}
              onClick={async () => {
                setBusyTool(true);
                await onRunLaptopTool('manage_laptop_files', { operation: 'list', path: '~/Desktop' });
                setBusyTool(false);
              }}
              className="text-[11px] font-medium text-sky-300 hover:text-sky-200 disabled:opacity-40 cursor-pointer"
            >
              List ~/Desktop
            </button>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!appToOpen.trim() || !canControlLaptop) return;
              setBusyTool(true);
              await onRunLaptopTool('control_laptop_apps', {
                action: 'open_app',
                appName: appToOpen.trim(),
              });
              setAppToOpen('');
              setBusyTool(false);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={appToOpen}
              onChange={(e) => setAppToOpen(e.target.value)}
              placeholder="App name (e.g. Spotify, Notes, Visual Studio Code)"
              className={`flex-1 ${MAC_GLASS_FIELD}`}
            />
            <button
              type="submit"
              disabled={!canControlLaptop || !appToOpen.trim() || busyTool}
              className={MAC_GLASS_BTN_SECONDARY}
            >
              Open App
            </button>
          </form>
        </div>

        <div className={`p-4 space-y-3 ${MAC_GLASS_CARD}`}>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-sky-300" />
              <span>Run Terminal Command</span>
            </h4>
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={runInBg}
                onChange={(e) => setRunInBg(e.target.checked)}
                className="rounded border-white/20 bg-black/40 accent-sky-400"
              />
              <span>Background daemon</span>
            </label>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!terminalCmd.trim() || !canControlLaptop) return;
              setBusyTool(true);
              await onRunLaptopTool('execute_terminal_command', {
                command: terminalCmd.trim(),
                background: runInBg,
              });
              setTerminalCmd('');
              await refreshStatus();
              setBusyTool(false);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={terminalCmd}
              onChange={(e) => setTerminalCmd(e.target.value)}
              placeholder="Shell command (e.g. ls -la ~/Desktop)"
              className={`flex-1 font-mono ${MAC_GLASS_FIELD}`}
            />
            <button
              type="submit"
              disabled={!canControlLaptop || !terminalCmd.trim() || busyTool}
              className={MAC_GLASS_BTN_SECONDARY}
            >
              Execute
            </button>
          </form>
        </div>
      </div>

      {/* Laptop Screen Window Tiling & Browser Automation Layout Manager */}
      <div className={`p-5 space-y-4 ${MAC_GLASS_CARD}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              {windowLayout === 'side-by-side' ? (
                <Columns2 className="w-4 h-4 text-sky-300" />
              ) : (
                <LayoutGrid className="w-4 h-4 text-sky-300" />
              )}
              <span>Screen Window Layout Manager</span>
            </h4>
            <p className="text-xs text-slate-400">
              Arrange open laptop app windows into a grid, side-by-side split, or primary focus stack via browser automation commands.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <MacSegmentedControl
              layoutId="mac-window-layout-mode"
              value={windowLayout}
              onChange={(next) => {
                setWindowLayout(next);
                if (next === 'grid' && selectedApps.length < 3 && availableApps.length >= 4) {
                  setSelectedApps(availableApps.slice(0, 4));
                }
              }}
              options={[
                { id: 'side-by-side', label: 'Side-by-Side' },
                { id: 'grid', label: 'Grid' },
                { id: 'focus-split', label: 'Focus + Stack' },
              ]}
            />
            <MacSegmentedControl
              layoutId="mac-window-gap"
              value={String(windowGap)}
              onChange={(v) => setWindowGap(Number(v))}
              options={[
                { id: '0', label: '0px Gap' },
                { id: '8', label: '8px Gap' },
                { id: '16', label: '16px Gap' },
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left: App Window Selection & Browser Automation Command Bar */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300">
                  Target Windows ({selectedApps.length} selected)
                </span>
                <button
                  type="button"
                  disabled={!canControlLaptop || busyTool}
                  onClick={() => void handleRefreshOpenApps()}
                  className="text-[11px] font-medium text-sky-300 hover:text-sky-200 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${busyTool ? 'animate-spin' : ''}`} />
                  <span>Scan Open Apps</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {availableApps.map((app) => {
                  const active = selectedApps.includes(app);
                  return (
                    <button
                      key={app}
                      type="button"
                      onClick={() => handleToggleApp(app)}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-sky-500/20 border-sky-400/50 text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                          : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
                      }`}
                    >
                      {app}
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleAddCustomApp} className="flex items-center gap-2">
                <input
                  type="text"
                  value={customAppInput}
                  onChange={(e) => setCustomAppInput(e.target.value)}
                  placeholder="Add app window (e.g. Safari, Slack, Finder)"
                  className={`flex-1 ${MAC_GLASS_FIELD}`}
                />
                <button
                  type="submit"
                  disabled={!customAppInput.trim()}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </form>
            </div>

            <div className="space-y-2.5 pt-2 border-t border-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isArranging || previewApps.length === 0}
                  onClick={async () => {
                    setIsArranging(true);
                    try {
                      await onArrangeViaBrowserAutomation({
                        layout: windowLayout,
                        apps: previewApps,
                        gap: windowGap,
                      });
                    } finally {
                      setIsArranging(false);
                    }
                  }}
                  className={MAC_GLASS_BTN_PRIMARY}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>{isArranging ? 'Arranging...' : 'Arrange via Browser Automation'}</span>
                </button>

                <button
                  type="button"
                  disabled={!canControlLaptop || isArranging || previewApps.length === 0}
                  onClick={async () => {
                    setIsArranging(true);
                    try {
                      await onRunLaptopTool('control_laptop_apps', {
                        action: 'arrange_windows',
                        layout: windowLayout,
                        apps: previewApps.join(', '),
                        gap: windowGap,
                      });
                    } finally {
                      setIsArranging(false);
                    }
                  }}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  <span>Tile Directly</span>
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const cmd = layoutCommandInput.trim();
                  if (!cmd || isArranging) return;
                  setIsArranging(true);
                  try {
                    await onRunAutomationCommand(cmd);
                    setLayoutCommandInput('');
                  } finally {
                    setIsArranging(false);
                  }
                }}
                className="flex items-center gap-2"
              >
                <div className={`flex-1 ${MAC_GLASS_INPUT_WRAP}`}>
                  <input
                    type="text"
                    value={layoutCommandInput}
                    onChange={(e) => setLayoutCommandInput(e.target.value)}
                    placeholder={`Or ask ${setupConfig.assistantName || 'Shadow'}: "Arrange Chrome and VS Code side by side"`}
                    className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!layoutCommandInput.trim() || isArranging}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  Run
                </button>
              </form>
            </div>
          </div>

          {/* Right: Live Interactive macOS Display Tile Preview */}
          <div className="lg:col-span-6 flex flex-col">
            <div
              className={`relative flex-1 min-h-[210px] overflow-hidden flex flex-col ${MAC_GLASS_SUBSURFACE}`}
            >
              {/* Miniature macOS Desktop Top Menu Bar */}
              <div className="h-6 px-3 border-b border-white/10 bg-white/[0.04] flex items-center justify-between text-[10px] text-slate-300 shrink-0">
                <span className="font-medium truncate">
                  Laptop Display Preview · {windowLayout === 'side-by-side' ? 'Side-by-Side' : windowLayout === 'focus-split' ? 'Focus + Stack' : 'Grid'}
                </span>
                <span className="font-mono tabular-nums text-slate-400">
                  {tilePlacements.length} windows · {windowGap}px gap
                </span>
              </div>

              {/* Miniature Screen Canvas */}
              <div className="relative flex-1 bg-gradient-to-br from-slate-900/90 via-[#0d172a]/85 to-sky-950/50">
                {tilePlacements.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
                    Select one or more app windows to preview arrangement.
                  </div>
                ) : (
                  tilePlacements.map((tile, idx) => (
                    <motion.div
                      key={`${tile.appName}-${idx}`}
                      layout={!prefersReduced}
                      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                      style={{
                        left: `${tile.xPct}%`,
                        top: `${tile.yPct}%`,
                        width: `${tile.widthPct}%`,
                        height: `${tile.heightPct}%`,
                      }}
                      className="absolute rounded-lg border border-white/20 bg-white/[0.08] backdrop-blur-md shadow-[0_8px_20px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.16)] overflow-hidden flex flex-col"
                    >
                      <div className="h-4 px-2 border-b border-white/10 bg-white/[0.04] flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F57]/85" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FEBC2E]/85" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#28C840]/85" />
                        <span className="ml-1 text-[10px] font-medium text-slate-100 truncate">
                          {tile.appName}
                        </span>
                      </div>
                      <div className="flex-1 p-2 flex flex-col items-center justify-center text-center">
                        <span className="text-[11px] font-medium text-slate-100 truncate max-w-full">
                          {tile.appName}
                        </span>
                        <span className="text-[10px] font-mono tabular-nums text-sky-300/85">
                          {Math.round(tile.widthPct)}% × {Math.round(tile.heightPct)}%
                        </span>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Download / Install Background Script (macOS Terminal Style) */}
      <div className="space-y-3 pt-2 border-t border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-sky-300" />
            <span>Install &amp; Run Laptop Script in Background</span>
          </h4>
          {scriptsBundle && (
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(scriptsBundle).map(([filename, content]) => (
                <button
                  key={filename}
                  type="button"
                  onClick={() => handleDownloadFile(filename, content)}
                  className="px-2.5 py-1 rounded-lg border border-white/12 bg-white/[0.05] text-[11px] font-mono text-slate-200 hover:bg-white/[0.1] hover:border-sky-400/40 inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  <Download className="w-3 h-3 text-sky-300" />
                  <span>{filename}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={`overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
            <div className="px-3.5 py-2 border-b border-white/8 bg-white/[0.03] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1" aria-hidden="true">
                  <span className="w-2 h-2 rounded-full bg-[#FF5F57]/80" />
                  <span className="w-2 h-2 rounded-full bg-[#FEBC2E]/80" />
                  <span className="w-2 h-2 rounded-full bg-[#28C840]/80" />
                </span>
                <span className="text-xs font-medium text-slate-200">
                  macOS / Linux (launchd &amp; systemd)
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  void handleCopyText(
                    'unix',
                    'chmod +x scripts/install-shadow-agent.sh && ./scripts/install-shadow-agent.sh'
                  )
                }
                className="text-[11px] text-sky-300 hover:text-sky-200 inline-flex items-center gap-1 cursor-pointer"
              >
                {copiedKey === 'unix' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey === 'unix' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="p-3.5 text-[11px] font-mono text-sky-300 overflow-x-auto">
{`chmod +x scripts/install-shadow-agent.sh
./scripts/install-shadow-agent.sh`}
            </pre>
          </div>

          <div className={`overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
            <div className="px-3.5 py-2 border-b border-white/8 bg-white/[0.03] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1" aria-hidden="true">
                  <span className="w-2 h-2 rounded-full bg-[#FF5F57]/80" />
                  <span className="w-2 h-2 rounded-full bg-[#FEBC2E]/80" />
                  <span className="w-2 h-2 rounded-full bg-[#28C840]/80" />
                </span>
                <span className="text-xs font-medium text-slate-200">
                  Windows (PowerShell) or Direct Node
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  void handleCopyText('win', 'node scripts/shadow-laptop-agent.mjs --daemon')
                }
                className="text-[11px] text-sky-300 hover:text-sky-200 inline-flex items-center gap-1 cursor-pointer"
              >
                {copiedKey === 'win' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey === 'win' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="p-3.5 text-[11px] font-mono text-sky-300 overflow-x-auto">
{`node scripts/shadow-laptop-agent.mjs --daemon
# Or Windows auto-start: powershell -ExecutionPolicy Bypass -File scripts/install-shadow-agent.ps1`}
            </pre>
          </div>
        </div>
      </div>

      {/* Live Laptop Actions & Background Jobs */}
      {(laptopActions.length > 0 || jobs.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-white/10">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-300">Recent Laptop Actions</h4>
            {laptopActions.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No local actions executed yet.</p>
            ) : (
              <div className={`divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                {laptopActions.slice(0, 6).map((act) => (
                  <div key={act.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-100 truncate">{act.summary}</span>
                      <span className={act.ok ? 'text-emerald-400 shrink-0' : 'text-rose-400 shrink-0'}>
                        {act.ok ? 'OK' : 'Failed'}
                      </span>
                    </div>
                    {act.output && (
                      <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                        {act.output}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-300">Managed Background Processes</h4>
            {jobs.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">No detached background jobs active.</p>
            ) : (
              <div className={`divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                {jobs.map((job) => (
                  <div key={job.id} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs font-mono text-slate-100 truncate">{job.command}</p>
                      <p className="text-[11px] text-slate-400">
                        <span>{job.status}</span>
                        {job.pid && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="font-mono tabular-nums">PID {job.pid}</span>
                          </>
                        )}
                      </p>
                    </div>
                    {job.status === 'running' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await killLaptopAgentJob(job.id);
                          await refreshStatus();
                        }}
                        className="px-2.5 py-1 rounded-lg border border-rose-500/40 bg-rose-500/15 text-[11px] text-rose-200 hover:bg-rose-500/25 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Square className="w-3 h-3" />
                        <span>Stop</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface MacrosAndHistoryProps extends WorkflowsPanelProps {
  executions: CommandExecution[];
  assistantName: string;
  memories: AssistantMemory[];
  onAddMemory: (input: {
    category: MemoryCategory;
    content: string;
    importance: MemoryImportance;
  }) => Promise<void>;
  onToggleMemoryImportance: (memory: AssistantMemory) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
}

export const MacrosAndHistoryView: React.FC<MacrosAndHistoryProps> = ({
  workflows,
  executions,
  assistantName,
  memories,
  onAddMemory,
  onToggleMemoryImportance,
  onDeleteMemory,
  isAuthenticated,
  onRunWorkflow,
  onDeleteWorkflow,
  onCreateWorkflow,
  onRequireAuth,
}) => {
  const [subTab, setSubTab] = useState<'memory' | 'macros' | 'history'>('memory');
  const prefersReduced = useReducedMotion();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-2.5 border-b border-white/10 bg-white/[0.02] flex items-center justify-between gap-3 shrink-0">
        <MacSegmentedControl
          layoutId="mac-memory-subtab"
          size="md"
          value={subTab}
          onChange={setSubTab}
          options={[
            { id: 'memory', label: `Memory (${memories.length})` },
            { id: 'macros', label: `Saved Macros (${workflows.length})` },
            { id: 'history', label: `Command History (${executions.length})` },
          ]}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={subTab}
            initial={prefersReduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="h-full"
          >
            {subTab === 'memory' ? (
              <MemoryStageView
                assistantName={assistantName}
                memories={memories}
                onAddMemory={onAddMemory}
                onToggleImportance={onToggleMemoryImportance}
                onDeleteMemory={onDeleteMemory}
              />
            ) : subTab === 'macros' ? (
              <SavedMacrosView
                workflows={workflows}
                isAuthenticated={isAuthenticated}
                onRunWorkflow={onRunWorkflow}
                onDeleteWorkflow={onDeleteWorkflow}
                onCreateWorkflow={onCreateWorkflow}
                onRequireAuth={onRequireAuth}
              />
            ) : (
              <ExecutionHistoryView
                executions={executions}
                isAuthenticated={isAuthenticated}
                onRequireAuth={onRequireAuth}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
