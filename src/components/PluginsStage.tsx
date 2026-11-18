import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Check,
  Code2,
  Download,
  Globe,
  Loader2,
  Play,
  Plus,
  Search,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  PluginCategory,
  PluginExecutionResult,
  PluginHeader,
  PluginHttpMethod,
  PluginKind,
  PluginParameter,
  ShadowPlugin,
} from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_CARD,
  MAC_GLASS_FIELD,
  MAC_GLASS_INPUT_WRAP,
  MAC_GLASS_SIDEBAR,
  MAC_GLASS_SUBSURFACE,
  MAC_GLASS_TOOLBAR,
  MacSegmentedControl,
  MacToggleSwitch,
} from './MacWindowShell';

export interface PluginActivityLog {
  id: string;
  pluginName: string;
  toolName: string;
  ok: boolean;
  summary: string;
  latencyMs?: number;
  statusCode?: number;
  timestamp: number;
}

interface PluginsStageProps {
  plugins: ShadowPlugin[];
  assistantName: string;
  recentLogs: PluginActivityLog[];
  onInstallPlugin: (
    draft: Partial<ShadowPlugin> & { name: string; description: string }
  ) => Promise<void>;
  onUpdatePlugin: (
    plugin: ShadowPlugin,
    updates: Partial<ShadowPlugin>
  ) => Promise<void>;
  onDeletePlugin: (pluginId: string) => Promise<void>;
  onTestRunPlugin: (
    plugin: ShadowPlugin,
    args: Record<string, unknown>
  ) => Promise<PluginExecutionResult>;
}

type StageTab = 'installed' | 'catalog' | 'builder';

export const PluginsStage: React.FC<PluginsStageProps> = ({
  plugins,
  assistantName,
  recentLogs,
  onInstallPlugin,
  onUpdatePlugin,
  onDeletePlugin,
  onTestRunPlugin,
}) => {
  const [tab, setTab] = useState<StageTab>('installed');
  const [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState<Array<Omit<ShadowPlugin, 'id' | 'runCount'>>>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogCategory, setCatalogCategory] = useState<'all' | PluginCategory>('all');
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const prefersReduced = useReducedMotion();

  // Runner state
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<PluginExecutionResult | null>(null);

  // Builder / Editor state
  const [editingPlugin, setEditingPlugin] = useState<ShadowPlugin | null>(null);
  const [formName, setFormName] = useState('');
  const [formToolName, setFormToolName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState<PluginCategory>('webhook');
  const [formKind, setFormKind] = useState<PluginKind>('http_api');
  const [formMethod, setFormMethod] = useState<PluginHttpMethod>('GET');
  const [formEndpointUrl, setFormEndpointUrl] = useState('');
  const [formBodyTemplate, setFormBodyTemplate] = useState('');
  const [formCommandTemplate, setFormCommandTemplate] = useState('');
  const [formParams, setFormParams] = useState<PluginParameter[]>([
    { name: 'query', type: 'string', description: 'Primary input value', required: true },
  ]);
  const [formHeaders, setFormHeaders] = useState<PluginHeader[]>([
    { key: 'Accept', value: 'application/json' },
  ]);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [builderSaving, setBuilderSaving] = useState(false);

  // Manifest import state
  const [manifestUrl, setManifestUrl] = useState('');
  const [manifestJson, setManifestJson] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    fetch('/api/plugins/catalog')
      .then((r) => r.json())
      .then((d: { ok?: boolean; catalog?: Array<Omit<ShadowPlugin, 'id' | 'runCount'>> }) => {
        if (active && Array.isArray(d.catalog)) {
          setCatalog(d.catalog);
        }
      })
      .catch(() => null)
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Keep selected plugin synced
  const selectedPlugin = useMemo(() => {
    if (selectedPluginId) {
      const found = plugins.find((p) => p.id === selectedPluginId);
      if (found) return found;
    }
    return plugins[0] || null;
  }, [plugins, selectedPluginId]);

  useEffect(() => {
    if (!selectedPlugin) return;
    setArgValues((prev) => {
      const next: Record<string, string> = {};
      for (const p of selectedPlugin.parameters) {
        next[p.name] = prev[p.name] ?? (p.type === 'boolean' ? 'false' : '');
      }
      return next;
    });
  }, [selectedPlugin?.id]);

  const installedSlugs = useMemo(() => new Set(plugins.map((p) => p.slug)), [plugins]);
  const installedToolNames = useMemo(() => new Set(plugins.map((p) => p.toolName)), [plugins]);

  const filteredInstalled = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.toolName.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }, [plugins, search]);

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((item) => {
      if (catalogCategory !== 'all' && item.category !== catalogCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.toolName.toLowerCase().includes(q)
      );
    });
  }, [catalog, catalogCategory, search]);

  const resetBuilder = () => {
    setEditingPlugin(null);
    setFormName('');
    setFormToolName('');
    setFormDescription('');
    setFormCategory('webhook');
    setFormKind('http_api');
    setFormMethod('GET');
    setFormEndpointUrl('');
    setFormBodyTemplate('');
    setFormCommandTemplate('');
    setFormParams([
      { name: 'query', type: 'string', description: 'Primary input value', required: true },
    ]);
    setFormHeaders([{ key: 'Accept', value: 'application/json' }]);
    setBuilderError(null);
  };

  const loadPluginIntoBuilder = (plugin: ShadowPlugin) => {
    setEditingPlugin(plugin);
    setFormName(plugin.name);
    setFormToolName(plugin.toolName);
    setFormDescription(plugin.description);
    setFormCategory(plugin.category);
    setFormKind(plugin.kind);
    setFormMethod(plugin.httpMethod);
    setFormEndpointUrl(plugin.endpointUrl);
    setFormBodyTemplate(plugin.bodyTemplate);
    setFormCommandTemplate(plugin.commandTemplate);
    setFormParams(plugin.parameters.length > 0 ? plugin.parameters : []);
    setFormHeaders(plugin.headers.length > 0 ? plugin.headers : []);
    setBuilderError(null);
    setTab('builder');
  };

  const handleInstallCatalogItem = async (item: Omit<ShadowPlugin, 'id' | 'runCount'>) => {
    if (installedSlugs.has(item.slug)) return;
    setInstallingSlug(item.slug);
    try {
      await onInstallPlugin(item);
    } finally {
      setInstallingSlug(null);
    }
  };

  const handleExecuteSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlugin || isRunning) return;
    setIsRunning(true);
    setLastResult(null);
    try {
      const typedArgs: Record<string, unknown> = {};
      for (const param of selectedPlugin.parameters) {
        const raw = argValues[param.name] ?? '';
        if (raw === '' && !param.required) continue;
        if (param.type === 'number') {
          const num = Number(raw);
          typedArgs[param.name] = Number.isFinite(num) ? num : raw;
        } else if (param.type === 'boolean') {
          typedArgs[param.name] = raw === 'true';
        } else {
          typedArgs[param.name] = raw;
        }
      }
      const res = await onTestRunPlugin(selectedPlugin, typedArgs);
      setLastResult(res);
    } finally {
      setIsRunning(false);
    }
  };

  const handleExportJson = (plugin: ShadowPlugin) => {
    const manifest = {
      slug: plugin.slug,
      name: plugin.name,
      description: plugin.description,
      category: plugin.category,
      kind: plugin.kind,
      toolName: plugin.toolName,
      version: plugin.version,
      author: plugin.author,
      parameters: plugin.parameters,
      endpointUrl: plugin.endpointUrl,
      httpMethod: plugin.httpMethod,
      headers: plugin.headers,
      bodyTemplate: plugin.bodyTemplate,
      commandTemplate: plugin.commandTemplate,
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plugin.slug}.shadow-plugin.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveBuilder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuilderError(null);

    if (!formName.trim() || !formDescription.trim()) {
      setBuilderError('Plugin name and description are required.');
      return;
    }
    if (formKind === 'http_api' && !formEndpointUrl.trim()) {
      setBuilderError('Endpoint URL is required for HTTP API / Webhook plugins.');
      return;
    }
    if (formKind === 'laptop_command' && !formCommandTemplate.trim()) {
      setBuilderError('Shell command template is required for Laptop Command plugins.');
      return;
    }

    setBuilderSaving(true);
    try {
      const cleanParams = formParams.filter((p) => p.name.trim());
      const cleanHeaders = formHeaders.filter((h) => h.key.trim());

      if (editingPlugin) {
        await onUpdatePlugin(editingPlugin, {
          name: formName.trim(),
          description: formDescription.trim(),
          category: formCategory,
          parameters: cleanParams,
          endpointUrl: formKind === 'http_api' ? formEndpointUrl.trim() : '',
          httpMethod: formMethod,
          headers: formKind === 'http_api' ? cleanHeaders : [],
          bodyTemplate: formKind === 'http_api' ? formBodyTemplate : '',
          commandTemplate: formKind === 'laptop_command' ? formCommandTemplate.trim() : '',
        });
      } else {
        const derivedTool =
          formToolName.trim() ||
          `plugin_${formName
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')}`;
        await onInstallPlugin({
          name: formName.trim(),
          toolName: derivedTool,
          slug: derivedTool.replace(/_/g, '-'),
          description: formDescription.trim(),
          category: formCategory,
          kind: formKind,
          enabled: true,
          version: '1.0.0',
          author: 'Custom',
          parameters: cleanParams,
          endpointUrl: formKind === 'http_api' ? formEndpointUrl.trim() : '',
          httpMethod: formMethod,
          headers: formKind === 'http_api' ? cleanHeaders : [],
          bodyTemplate: formKind === 'http_api' ? formBodyTemplate : '',
          commandTemplate: formKind === 'laptop_command' ? formCommandTemplate.trim() : '',
        });
      }
      resetBuilder();
      setTab('installed');
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Unable to save plugin.');
    } finally {
      setBuilderSaving(false);
    }
  };

  const handleFetchManifestUrl = async () => {
    if (!manifestUrl.trim()) return;
    setImportBusy(true);
    setImportStatus(null);
    try {
      const res = await fetch('/api/plugins/fetch-manifest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: manifestUrl.trim() }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        plugin?: Partial<ShadowPlugin> & { name: string; description: string };
        error?: string;
      };
      if (!res.ok || !data.plugin) throw new Error(data.error || 'Manifest fetch failed');
      await onInstallPlugin({ ...data.plugin, enabled: true });
      setManifestUrl('');
      setImportStatus(`Installed "${data.plugin.name}" from manifest URL.`);
      setTab('installed');
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : 'Unable to import manifest.');
    } finally {
      setImportBusy(false);
    }
  };

  const handleImportJsonText = async () => {
    if (!manifestJson.trim()) return;
    setImportBusy(true);
    setImportStatus(null);
    try {
      const parsed = JSON.parse(manifestJson) as Partial<ShadowPlugin>;
      if (!parsed.name || !parsed.description) {
        throw new Error('Manifest JSON must include "name" and "description".');
      }
      await onInstallPlugin({
        ...parsed,
        name: String(parsed.name),
        description: String(parsed.description),
        enabled: true,
      });
      setManifestJson('');
      setImportStatus(`Installed "${parsed.name}" successfully.`);
      setTab('installed');
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : 'Invalid JSON manifest.');
    } finally {
      setImportBusy(false);
    }
  };

  const handleUploadManifestFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setManifestJson(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Toolbar */}
      <div className={`${MAC_GLASS_TOOLBAR} justify-between`}>
        <MacSegmentedControl
          layoutId="mac-plugins-tab"
          size="md"
          value={tab}
          onChange={(next) => {
            if (next === 'builder' && tab !== 'builder') resetBuilder();
            setTab(next);
          }}
          options={[
            { id: 'installed', label: `Installed (${plugins.length})` },
            { id: 'catalog', label: 'Plugin Catalog' },
            { id: 'builder', label: editingPlugin ? 'Edit Plugin' : 'Create / Import' },
          ]}
        />

        {tab !== 'builder' && (
          <div className={`${MAC_GLASS_INPUT_WRAP} w-full sm:w-64`}>
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'catalog' ? 'Search catalog...' : 'Filter installed plugins...'}
              className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {tab === 'installed' && (
            <motion.div
              key="plugins-installed"
              initial={prefersReduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="grid grid-cols-1 lg:grid-cols-12 h-full divide-y lg:divide-y-0 lg:divide-x divide-white/10"
            >
              {/* Left: Installed Plugins List */}
              <div className="lg:col-span-7 overflow-auto">
                {filteredInstalled.length === 0 ? (
                  <div className="py-16 px-6 text-center space-y-3">
                    <p className="text-sm font-medium text-slate-100">
                      {plugins.length === 0
                        ? `No plugins installed for ${assistantName} yet.`
                        : 'No plugins match your filter.'}
                    </p>
                    <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                      Install live API or laptop CLI plugins from the Catalog so {assistantName} can call them directly by voice, or build a custom webhook plugin.
                    </p>
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setTab('catalog')}
                        className={MAC_GLASS_BTN_PRIMARY}
                      >
                        Browse Plugin Catalog
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetBuilder();
                          setTab('builder');
                        }}
                        className={MAC_GLASS_BTN_SECONDARY}
                      >
                        Create Custom Plugin
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-white/8">
                    {filteredInstalled.map((plugin) => {
                      const isSelected = selectedPlugin?.id === plugin.id;
                      return (
                        <div
                          key={plugin.id}
                          className={`px-5 py-4 transition-colors ${
                            isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPluginId(plugin.id);
                                setLastResult(null);
                              }}
                              className="text-left min-w-0 flex-1 cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                {plugin.kind === 'laptop_command' ? (
                                  <Terminal className="w-4 h-4 text-amber-300 shrink-0" />
                                ) : (
                                  <Globe className="w-4 h-4 text-emerald-300 shrink-0" />
                                )}
                                <h3 className="text-sm font-semibold text-slate-100 truncate">
                                  {plugin.name}
                                </h3>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                                <span className="font-mono text-sky-300">{plugin.toolName}</span>
                                <span aria-hidden="true">·</span>
                                <span>{plugin.kind === 'laptop_command' ? 'Laptop CLI' : 'HTTP API'}</span>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">v{plugin.version}</span>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">{plugin.runCount} runs</span>
                                <span aria-hidden="true">·</span>
                                <span className={plugin.enabled ? 'text-emerald-400' : 'text-slate-500'}>
                                  {plugin.enabled ? 'Active' : 'Paused'}
                                </span>
                              </div>
                              <p className="mt-1.5 text-xs text-slate-300 leading-relaxed line-clamp-2">
                                {plugin.description}
                              </p>
                            </button>

                            {/* Controls */}
                            <div className="flex items-center gap-2 shrink-0">
                              <MacToggleSwitch
                                checked={plugin.enabled}
                                accent="emerald"
                                label={`Toggle ${plugin.name}`}
                                onChange={() =>
                                  void onUpdatePlugin(plugin, { enabled: !plugin.enabled })
                                }
                              />

                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPluginId(plugin.id);
                                  setLastResult(null);
                                }}
                                title="Test & Run"
                                className="px-2.5 py-1.5 rounded-lg border border-white/12 bg-white/[0.05] text-xs font-medium text-slate-100 hover:bg-white/[0.1] inline-flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer"
                              >
                                <Play className="w-3 h-3 text-emerald-300" />
                                <span>Run</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => loadPluginIntoBuilder(plugin)}
                                title="Edit plugin"
                                className="p-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-100 hover:bg-white/[0.08] transition-colors cursor-pointer"
                              >
                                <Code2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleExportJson(plugin)}
                                title="Export JSON manifest"
                                className="p-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-100 hover:bg-white/[0.08] transition-colors cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => void onDeletePlugin(plugin.id)}
                                title="Uninstall plugin"
                                className="p-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-slate-400 hover:text-rose-400 hover:bg-white/[0.08] transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right: Live Test Runner & Activity */}
              <div className={`lg:col-span-5 flex flex-col overflow-auto ${MAC_GLASS_SIDEBAR}`}>
                {selectedPlugin ? (
                  <div className="p-5 space-y-4">
                    <div>
                      <p className="text-[11px] font-medium text-slate-400">
                        Plugin Runner · <span className="font-mono text-sky-300">{selectedPlugin.toolName}</span>
                      </p>
                      <h4 className="text-sm font-semibold text-slate-50 mt-0.5">
                        {selectedPlugin.name}
                      </h4>
                    </div>

                    <form onSubmit={handleExecuteSelected} className="space-y-3">
                      {selectedPlugin.parameters.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          This plugin takes no required parameters. Click Execute to run it live.
                        </p>
                      ) : (
                        selectedPlugin.parameters.map((param) => (
                          <label key={param.name} className="block space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-mono text-slate-200">
                                {param.name}
                                {param.required ? ' *' : ''}
                              </span>
                              <span className="text-[11px] text-slate-500">{param.type}</span>
                            </div>
                            {param.type === 'boolean' ? (
                              <select
                                value={argValues[param.name] ?? 'false'}
                                onChange={(e) =>
                                  setArgValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                                }
                                className={MAC_GLASS_FIELD}
                              >
                                <option value="false">false</option>
                                <option value="true">true</option>
                              </select>
                            ) : (
                              <input
                                type={param.type === 'number' ? 'number' : 'text'}
                                required={param.required}
                                value={argValues[param.name] ?? ''}
                                onChange={(e) =>
                                  setArgValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                                }
                                placeholder={param.description}
                                className={MAC_GLASS_FIELD}
                              />
                            )}
                          </label>
                        ))
                      )}

                      <button
                        type="submit"
                        disabled={isRunning}
                        className={`w-full py-2 ${MAC_GLASS_BTN_PRIMARY}`}
                      >
                        {isRunning ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Executing Live...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            <span>Execute Plugin</span>
                          </>
                        )}
                      </button>
                    </form>

                    {lastResult && (
                      <div className="pt-3 border-t border-white/10 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span
                            className={
                              lastResult.ok ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'
                            }
                          >
                            {lastResult.ok ? 'Execution Succeeded' : 'Execution Failed'}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {lastResult.statusCode ? `HTTP ${lastResult.statusCode} · ` : ''}
                            {lastResult.latencyMs !== undefined ? `${lastResult.latencyMs}ms` : ''}
                          </span>
                        </div>
                        {lastResult.summary && (
                          <p className="text-xs text-slate-200 leading-relaxed">{lastResult.summary}</p>
                        )}
                        {lastResult.error && (
                          <p className="text-xs text-rose-300 font-mono break-words">
                            {lastResult.error}
                          </p>
                        )}
                        {(lastResult.data !== undefined || lastResult.stdout) && (
                          <pre
                            className={`p-3 text-[11px] font-mono text-slate-200 overflow-auto max-h-64 whitespace-pre-wrap break-words ${MAC_GLASS_SUBSURFACE}`}
                          >
                            {lastResult.stdout
                              ? lastResult.stdout
                              : JSON.stringify(lastResult.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}

                    {recentLogs.length > 0 && (
                      <div className="pt-3 border-t border-white/10 space-y-2">
                        <p className="text-[11px] font-medium text-slate-400">Recent Plugin Calls</p>
                        <div className="divide-y divide-white/8">
                          {recentLogs.slice(0, 6).map((log) => (
                            <div key={log.id} className="py-2 text-xs flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-slate-100 font-medium truncate">{log.pluginName}</p>
                                <p className="text-[11px] text-slate-400 truncate">{log.summary}</p>
                              </div>
                              <span
                                className={`text-[11px] font-mono tabular-nums shrink-0 ${
                                  log.ok ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {log.latencyMs !== undefined
                                  ? `${log.latencyMs}ms`
                                  : log.ok
                                    ? 'OK'
                                    : 'ERR'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-slate-400 m-auto">
                    Select or install a plugin to test it live.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {tab === 'catalog' && (
            <motion.div
              key="plugins-catalog"
              initial={prefersReduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="h-full overflow-auto p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-50">
                    Verified Real Plugin Catalog
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Install live REST API connectors and local laptop CLI plugins. Once active, ask {assistantName} by voice to use them.
                  </p>
                </div>
                <MacSegmentedControl
                  layoutId="mac-catalog-cat"
                  value={catalogCategory}
                  onChange={setCatalogCategory}
                  options={[
                    { id: 'all', label: 'All' },
                    { id: 'utilities', label: 'Utilities' },
                    { id: 'developer', label: 'Developer' },
                    { id: 'knowledge', label: 'Knowledge' },
                    { id: 'automation', label: 'Automation' },
                  ]}
                />
              </div>

              {catalogLoading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-300" />
                  <span>Loading plugin directory...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredCatalog.map((item) => {
                    const isInstalled =
                      installedSlugs.has(item.slug) || installedToolNames.has(item.toolName);
                    const isInstalling = installingSlug === item.slug;

                    return (
                      <div
                        key={item.slug}
                        className={`p-4 flex flex-col justify-between gap-3 hover:bg-white/[0.05] transition-colors ${MAC_GLASS_CARD}`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {item.kind === 'laptop_command' ? (
                                <Terminal className="w-4 h-4 text-amber-300 shrink-0" />
                              ) : (
                                <Globe className="w-4 h-4 text-emerald-300 shrink-0" />
                              )}
                              <h4 className="text-sm font-semibold text-slate-100 truncate">
                                {item.name}
                              </h4>
                            </div>
                            <span className="text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
                              v{item.version}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 font-mono">
                            {item.toolName} · {item.kind === 'laptop_command' ? 'Laptop CLI' : 'Live HTTP API'} · {item.category}
                          </p>

                          <p className="text-xs text-slate-300 leading-relaxed">{item.description}</p>
                        </div>

                        <div className="pt-2.5 border-t border-white/10 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400 truncate">
                            Params: {item.parameters.map((p) => p.name).join(', ') || 'none'}
                          </span>
                          {isInstalled ? (
                            <button
                              type="button"
                              onClick={() => setTab('installed')}
                              className="px-3 py-1.5 rounded-[10px] border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Installed</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isInstalling}
                              onClick={() => void handleInstallCatalogItem(item)}
                              className={MAC_GLASS_BTN_PRIMARY}
                            >
                              {isInstalling ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Plus className="w-3.5 h-3.5" />
                              )}
                              <span>Install</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'builder' && (
            <motion.div
              key="plugins-builder"
              initial={prefersReduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="grid grid-cols-1 lg:grid-cols-12 h-full divide-y lg:divide-y-0 lg:divide-x divide-white/10 overflow-auto"
            >
              {/* Custom Plugin Form */}
              <form onSubmit={handleSaveBuilder} className="lg:col-span-7 p-5 space-y-4 overflow-auto">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-50">
                      {editingPlugin ? `Edit "${editingPlugin.name}"` : 'Author Custom Voice Plugin'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Define an HTTP/Webhook endpoint or Laptop CLI command template with typed voice arguments.
                    </p>
                  </div>
                  {editingPlugin && (
                    <button
                      type="button"
                      onClick={resetBuilder}
                      className={MAC_GLASS_BTN_SECONDARY}
                    >
                      New Instead
                    </button>
                  )}
                </div>

                {builderError && (
                  <div className="px-3 py-2 rounded-xl bg-rose-950/60 border border-rose-400/40 text-xs text-rose-200">
                    {builderError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs text-slate-300">
                    <span>Plugin Name</span>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Slack Standup Notifier"
                      className={MAC_GLASS_FIELD}
                    />
                  </label>

                  <label className="space-y-1 text-xs text-slate-300">
                    <span>Gemini Tool Identifier</span>
                    <input
                      type="text"
                      disabled={Boolean(editingPlugin)}
                      value={formToolName}
                      onChange={(e) => setFormToolName(e.target.value)}
                      placeholder="plugin_slack_standup"
                      className={`${MAC_GLASS_FIELD} font-mono disabled:opacity-50`}
                    />
                  </label>

                  <label className="space-y-1 text-xs text-slate-300">
                    <span>Execution Kind</span>
                    <select
                      disabled={Boolean(editingPlugin)}
                      value={formKind}
                      onChange={(e) => setFormKind(e.target.value as PluginKind)}
                      className={`${MAC_GLASS_FIELD} disabled:opacity-50`}
                    >
                      <option value="http_api">HTTP API / Webhook</option>
                      <option value="laptop_command">Laptop Shell Command</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-xs text-slate-300">
                    <span>Category</span>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value as PluginCategory)}
                      className={MAC_GLASS_FIELD}
                    >
                      <option value="webhook">Webhook</option>
                      <option value="utilities">Utilities</option>
                      <option value="developer">Developer</option>
                      <option value="knowledge">Knowledge</option>
                      <option value="automation">Automation</option>
                    </select>
                  </label>
                </div>

                <label className="block space-y-1 text-xs text-slate-300">
                  <span>
                    Description (used by {assistantName} to decide when to invoke this plugin)
                  </span>
                  <textarea
                    rows={2}
                    required
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Posts a concise team status update to a configured webhook URL."
                    className={MAC_GLASS_FIELD}
                  />
                </label>

                {formKind === 'http_api' ? (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <label className="space-y-1 text-xs text-slate-300">
                        <span>HTTP Method</span>
                        <select
                          value={formMethod}
                          onChange={(e) => setFormMethod(e.target.value as PluginHttpMethod)}
                          className={MAC_GLASS_FIELD}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="PATCH">PATCH</option>
                          <option value="DELETE">DELETE</option>
                        </select>
                      </label>
                      <label className="sm:col-span-3 space-y-1 text-xs text-slate-300">
                        <span>Endpoint URL Template (use {'{{param}}'} placeholders)</span>
                        <input
                          type="text"
                          value={formEndpointUrl}
                          onChange={(e) => setFormEndpointUrl(e.target.value)}
                          placeholder="https://api.npms.io/v2/search?q={{query}}"
                          className={`${MAC_GLASS_FIELD} font-mono`}
                        />
                      </label>
                    </div>

                    {['POST', 'PUT', 'PATCH'].includes(formMethod) && (
                      <label className="block space-y-1 text-xs text-slate-300">
                        <span>JSON Body Template</span>
                        <textarea
                          rows={3}
                          value={formBodyTemplate}
                          onChange={(e) => setFormBodyTemplate(e.target.value)}
                          placeholder={'{"text": "{{query}}"}'}
                          className={`${MAC_GLASS_FIELD} font-mono`}
                        />
                      </label>
                    )}

                    {/* Headers */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-300">Custom HTTP Headers</span>
                        <button
                          type="button"
                          onClick={() =>
                            setFormHeaders((prev) =>
                              prev.length >= 8 ? prev : [...prev, { key: '', value: '' }]
                            )
                          }
                          className="text-xs text-sky-300 hover:text-sky-200 cursor-pointer"
                        >
                          + Add Header
                        </button>
                      </div>
                      {formHeaders.map((hdr, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            value={hdr.key}
                            onChange={(e) =>
                              setFormHeaders((prev) =>
                                prev.map((h, i) => (i === idx ? { ...h, key: e.target.value } : h))
                              )
                            }
                            placeholder="Header Name"
                            className={`col-span-5 font-mono ${MAC_GLASS_FIELD}`}
                          />
                          <input
                            type="text"
                            value={hdr.value}
                            onChange={(e) =>
                              setFormHeaders((prev) =>
                                prev.map((h, i) => (i === idx ? { ...h, value: e.target.value } : h))
                              )
                            }
                            placeholder="Header Value"
                            className={`col-span-6 font-mono ${MAC_GLASS_FIELD}`}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setFormHeaders((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="col-span-1 text-slate-500 hover:text-rose-400 flex justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <label className="block space-y-1 text-xs text-slate-300">
                    <span>Laptop Shell Command Template (arguments auto-escaped cleanly)</span>
                    <input
                      type="text"
                      value={formCommandTemplate}
                      onChange={(e) => setFormCommandTemplate(e.target.value)}
                      placeholder="ls -la {{directory}}"
                      className={`${MAC_GLASS_FIELD} font-mono`}
                    />
                  </label>
                )}

                {/* Parameters */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-300">Voice &amp; Tool Parameters</span>
                    <button
                      type="button"
                      onClick={() =>
                        setFormParams((prev) =>
                          prev.length >= 8
                            ? prev
                            : [...prev, { name: '', type: 'string', description: '', required: false }]
                        )
                      }
                      className="text-xs text-sky-300 hover:text-sky-200 cursor-pointer"
                    >
                      + Add Parameter
                    </button>
                  </div>

                  {formParams.map((param, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        type="text"
                        value={param.name}
                        onChange={(e) =>
                          setFormParams((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p))
                          )
                        }
                        placeholder="paramName"
                        className={`col-span-3 font-mono ${MAC_GLASS_FIELD}`}
                      />
                      <select
                        value={param.type}
                        onChange={(e) =>
                          setFormParams((prev) =>
                            prev.map((p, i) =>
                              i === idx
                                ? { ...p, type: e.target.value as PluginParameter['type'] }
                                : p
                            )
                          )
                        }
                        className={`col-span-2 ${MAC_GLASS_FIELD}`}
                      >
                        <option value="string">string</option>
                        <option value="number">number</option>
                        <option value="boolean">bool</option>
                      </select>
                      <input
                        type="text"
                        value={param.description}
                        onChange={(e) =>
                          setFormParams((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, description: e.target.value } : p
                            )
                          )
                        }
                        placeholder="Parameter description"
                        className={`col-span-5 ${MAC_GLASS_FIELD}`}
                      />
                      <label
                        className="col-span-1 flex items-center justify-center text-[11px] text-slate-400"
                        title="Required"
                      >
                        <input
                          type="checkbox"
                          checked={param.required}
                          onChange={(e) =>
                            setFormParams((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, required: e.target.checked } : p
                              )
                            )
                          }
                          className="accent-sky-400"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setFormParams((prev) => prev.filter((_, i) => i !== idx))}
                        className="col-span-1 text-slate-500 hover:text-rose-400 flex justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={builderSaving}
                    className={`py-2 px-4 ${MAC_GLASS_BTN_PRIMARY}`}
                  >
                    {builderSaving
                      ? 'Saving...'
                      : editingPlugin
                        ? 'Save Changes'
                        : 'Install Custom Plugin'}
                  </button>
                </div>
              </form>

              {/* Right: Manifest Importer */}
              <div className={`lg:col-span-5 p-5 space-y-5 overflow-auto ${MAC_GLASS_SIDEBAR}`}>
                <div>
                  <h4 className="text-sm font-semibold text-slate-50">Import Plugin Manifest</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Load a shareable <span className="font-mono">.json</span> plugin manifest from an HTTPS URL or local file.
                  </p>
                </div>

                {importStatus && (
                  <div className={`px-3 py-2 text-xs text-slate-100 ${MAC_GLASS_CARD}`}>
                    {importStatus}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-xs text-slate-300">Manifest HTTPS URL</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={manifestUrl}
                      onChange={(e) => setManifestUrl(e.target.value)}
                      placeholder="https://example.com/shadow-plugin.json"
                      className={`flex-1 font-mono ${MAC_GLASS_FIELD}`}
                    />
                    <button
                      type="button"
                      disabled={importBusy || !manifestUrl.trim()}
                      onClick={() => void handleFetchManifestUrl()}
                      className={MAC_GLASS_BTN_SECONDARY}
                    >
                      Fetch
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-3 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-300">Paste or Upload Manifest JSON</label>
                    <label className="text-xs text-sky-300 hover:text-sky-200 cursor-pointer inline-flex items-center gap-1">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload .json</span>
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={handleUploadManifestFile}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={8}
                    value={manifestJson}
                    onChange={(e) => setManifestJson(e.target.value)}
                    placeholder={
                      '{\n  "name": "NPM Package Lookup",\n  "description": "Searches npm registry packages.",\n  "kind": "http_api",\n  "toolName": "plugin_npm_search",\n  "endpointUrl": "https://registry.npmjs.org/-/v1/search?text={{query}}&size=5",\n  "httpMethod": "GET",\n  "parameters": [{ "name": "query", "type": "string", "description": "Package keyword", "required": true }]\n}'
                    }
                    className={`w-full font-mono text-[11px] ${MAC_GLASS_FIELD}`}
                  />
                  <button
                    type="button"
                    disabled={importBusy || !manifestJson.trim()}
                    onClick={() => void handleImportJsonText()}
                    className={`w-full py-2 ${MAC_GLASS_BTN_SECONDARY}`}
                  >
                    Install from JSON Manifest
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
