import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Laptop,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AiSettings } from '../lib/aiSettings';
import { aiRequestHeaders } from '../lib/aiSettings';
import { getApiOrigin, parseJsonSafely } from '../lib/apiBase';
import { reportExceptionError } from '../lib/errorStore';
import { executeLaptopTool, getSavedAgentToken } from '../lib/tauriBridge';
import type { VaultDocumentMeta } from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_CARD,
  MAC_GLASS_FIELD,
  MAC_GLASS_SIDEBAR,
  MAC_GLASS_SUBSURFACE,
  MAC_GLASS_TOOLBAR,
  MacSegmentedControl,
} from './MacWindowShell';

type VaultOrDevopsTab = 'vault' | 'devops';

interface VaultServerDoc {
  id: string;
  title: string;
  sourceType: 'note' | 'file' | 'pdf' | 'repo' | 'meeting' | 'url';
  summary: string;
  chunkCount: number;
  embedded: boolean;
  createdAt: number;
}

interface VaultCitation {
  docId: string;
  docTitle: string;
  chunkIndex: number;
  score: number;
  excerpt: string;
  matchedBy: string;
}

interface GithubOverview {
  repo: {
    fullName: string;
    description: string;
    stars: number;
    forks: number;
    openIssues: number;
    defaultBranch: string;
    language: string;
    htmlUrl: string;
  };
  pullRequests: Array<{
    number: number;
    title: string;
    user: string;
    draft: boolean;
    htmlUrl: string;
  }>;
  issues: Array<{
    number: number;
    title: string;
    user: string;
    comments: number;
    htmlUrl: string;
  }>;
  workflowRuns: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string;
    branch: string;
    htmlUrl: string;
  }>;
  recentCommits: Array<{
    sha: string;
    message: string;
    author: string;
    htmlUrl: string;
  }>;
}

interface KnowledgeVaultStageProps {
  ownerKey: string;
  aiSettings: AiSettings;
  syncedMeta: VaultDocumentMeta[];
  onSaveVaultDocMeta: (meta: Omit<VaultDocumentMeta, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDeleteVaultDocMeta: (vaultId: string) => Promise<void>;
  onSpeak?: (text: string) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = typeof reader.result === 'string' ? reader.result : '';
      const idx = str.indexOf(',');
      resolve(idx >= 0 ? str.slice(idx + 1) : str);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export const KnowledgeVaultStage: React.FC<KnowledgeVaultStageProps> = ({
  ownerKey,
  aiSettings,
  syncedMeta,
  onSaveVaultDocMeta,
  onDeleteVaultDocMeta,
  onSpeak,
}) => {
  const [subtab, setSubtab] = useState<VaultOrDevopsTab>('vault');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Vault State
  const [vaultDocs, setVaultDocs] = useState<VaultServerDoc[]>([]);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [vaultQuery, setVaultQuery] = useState('');
  const [vaultAnswer, setVaultAnswer] = useState<{
    answer: string;
    citations: VaultCitation[];
    modelUsed: string;
  } | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // DevOps State
  const [repoSlug, setRepoSlug] = useState('expressjs/express');
  const [githubToken, setGithubToken] = useState(''); // Memory only
  const [githubOverview, setGithubOverview] = useState<GithubOverview | null>(null);
  const [localGitText, setLocalGitText] = useState('');
  const [devopsQuestion, setDevopsQuestion] = useState('');
  const [devopsAnalysis, setDevopsAnalysis] = useState<string | null>(null);
  const [devopsBusy, setDevopsBusy] = useState(false);

  const loadVaultDocs = useCallback(async () => {
    try {
      const res = await fetch(
        `${getApiOrigin()}/api/vault/docs?ownerKey=${encodeURIComponent(ownerKey)}`
      );
      const data = await parseJsonSafely<{ docs?: VaultServerDoc[] }>(res);
      if (res.ok && data?.docs) {
        setVaultDocs(data.docs);
      }
    } catch {
      // ignore offline notice
    }
  }, [ownerKey]);

  useEffect(() => {
    void loadVaultDocs();
  }, [loadVaultDocs]);

  const handleIngestNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim() || vaultBusy) return;
    setVaultBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/vault/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettings) },
        body: JSON.stringify({
          ownerKey,
          title: noteTitle.trim(),
          contentText: noteContent.trim(),
          sourceType: 'note',
        }),
      });
      const data = await parseJsonSafely<{ doc?: VaultServerDoc; error?: string }>(res);
      if (!res.ok || !data?.doc) throw new Error(data?.error || 'Ingestion failed.');
      await onSaveVaultDocMeta({
        vaultId: data.doc.id,
        title: data.doc.title,
        sourceType: data.doc.sourceType,
        summary: data.doc.summary,
        chunkCount: data.doc.chunkCount,
        embedded: data.doc.embedded,
      });
      setNoteTitle('');
      setNoteContent('');
      setStatusMsg(`Indexed "${data.doc.title}" (${data.doc.chunkCount} chunks).`);
      void loadVaultDocs();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Vault ingestion failed.');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setVaultBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      let count = 0;
      for (const file of Array.from(files).slice(0, 6)) {
        const b64 = await fileToBase64(file);
        const res = await fetch(`${getApiOrigin()}/api/vault/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettings) },
          body: JSON.stringify({
            ownerKey,
            title: file.name,
            fileBase64: b64,
            mimeType: file.type,
          }),
        });
        const data = await parseJsonSafely<{ doc?: VaultServerDoc; error?: string }>(res);
        if (!res.ok || !data?.doc) throw new Error(data?.error || `Failed to ingest ${file.name}`);
        await onSaveVaultDocMeta({
          vaultId: data.doc.id,
          title: data.doc.title,
          sourceType: data.doc.sourceType,
          summary: data.doc.summary,
          chunkCount: data.doc.chunkCount,
          embedded: data.doc.embedded,
        });
        count += 1;
      }
      setStatusMsg(`Indexed ${count} document(s) into Vault.`);
      void loadVaultDocs();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'File upload failed.');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleIngestLaptopFolder = async () => {
    const cleanPath = folderPath.trim();
    if (!cleanPath) {
      setErrorMsg('Enter a local folder path first.');
      return;
    }
    setVaultBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const listRes = await executeLaptopTool('manage_laptop_files', {
        operation: 'list',
        path: cleanPath,
      });
      const entries = Array.isArray((listRes.result as { entries?: unknown[] }).entries)
        ? ((listRes.result as { entries: Array<{ name?: string; isDirectory?: boolean }> }).entries)
        : [];
      const candidates = entries
        .filter(
          (entry) =>
            !entry.isDirectory &&
            entry.name &&
            /\.(md|txt|ts|tsx|js|jsx|py|rs|json)$/i.test(entry.name)
        )
        .slice(0, 8);
      if (candidates.length === 0) {
        throw new Error('No supported text/code files found via Laptop Agent in that folder.');
      }

      let indexed = 0;
      for (const file of candidates) {
        const sep = cleanPath.includes('\\') ? '\\' : '/';
        const full = `${cleanPath.replace(/[\\/]+$/, '')}${sep}${file.name}`;
        const readRes = await executeLaptopTool('manage_laptop_files', {
          operation: 'read',
          path: full,
        });
        const content = String((readRes.result as { content?: string }).content || '').trim();
        if (!content) continue;
        const ingestRes = await fetch(`${getApiOrigin()}/api/vault/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettings) },
          body: JSON.stringify({
            ownerKey,
            title: file.name || 'file',
            contentText: content,
            sourceType: 'repo',
            sourceRef: full,
          }),
        });
        const ingestData = await parseJsonSafely<{ doc?: VaultServerDoc }>(ingestRes);
        if (ingestRes.ok && ingestData?.doc) {
          indexed += 1;
          await onSaveVaultDocMeta({
            vaultId: ingestData.doc.id,
            title: ingestData.doc.title,
            sourceType: 'repo',
            summary: ingestData.doc.summary,
            chunkCount: ingestData.doc.chunkCount,
            embedded: ingestData.doc.embedded,
          });
        }
      }
      setStatusMsg(`Indexed ${indexed} local files from ${cleanPath}.`);
      void loadVaultDocs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Folder ingest requires connected Laptop Agent.';
      setErrorMsg(msg);
      reportExceptionError('Knowledge Vault Folder', err, msg);
    } finally {
      setVaultBusy(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    setErrorMsg(null);
    try {
      await fetch(
        `${getApiOrigin()}/api/vault/docs/${encodeURIComponent(docId)}?ownerKey=${encodeURIComponent(ownerKey)}`,
        { method: 'DELETE' }
      );
      await onDeleteVaultDocMeta(docId);
      setVaultDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete document.');
    }
  };

  const handleAskVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultQuery.trim() || vaultBusy) return;
    setVaultBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/vault/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettings) },
        body: JSON.stringify({
          ownerKey,
          question: vaultQuery.trim(),
          topK: 6,
        }),
      });
      const data = await parseJsonSafely<{
        answer?: string;
        citations?: VaultCitation[];
        modelUsed?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data?.answer) throw new Error(data?.error || 'Vault query failed.');
      setVaultAnswer({
        answer: data.answer,
        citations: data.citations || [],
        modelUsed: data.modelUsed || 'gemini',
      });
      onSpeak?.(data.answer);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Vault query failed.');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleInspectGithub = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!repoSlug.trim() || devopsBusy) return;
    setDevopsBusy(true);
    setErrorMsg(null);
    try {
      const headers: Record<string, string> = {};
      if (githubToken.trim()) headers['x-github-token'] = githubToken.trim();
      const res = await fetch(
        `${getApiOrigin()}/api/devops/github/repo?repo=${encodeURIComponent(repoSlug.trim())}`,
        { headers }
      );
      const data = await parseJsonSafely<{ overview?: GithubOverview; error?: string }>(res);
      if (!res.ok || !data?.overview) throw new Error(data?.error || 'GitHub inspection failed.');
      setGithubOverview(data.overview);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'GitHub lookup failed.');
    } finally {
      setDevopsBusy(false);
    }
  };

  const handleInspectLocalGit = async () => {
    setDevopsBusy(true);
    setErrorMsg(null);
    try {
      const token = getSavedAgentToken();
      const res = await fetch('http://127.0.0.1:4789/git-inspect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-shadow-token': token } : {}),
        },
        body: JSON.stringify({ repoPath: folderPath.trim() || undefined }),
      });
      const data = await parseJsonSafely<{
        ok?: boolean;
        branch?: string;
        status?: string;
        recentCommits?: string;
        diffStat?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Laptop Agent /git-inspect failed.');
      const formatted = [
        `Branch: ${data.branch || 'unknown'}`,
        data.status ? `Status:\n${data.status}` : 'Working tree clean',
        data.recentCommits ? `Commits:\n${data.recentCommits}` : '',
        data.diffStat ? `Diff stat:\n${data.diffStat}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      setLocalGitText(formatted);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Laptop Agent must be running on 127.0.0.1:4789.');
    } finally {
      setDevopsBusy(false);
    }
  };

  const handleAnalyzeDevops = async () => {
    setDevopsBusy(true);
    setErrorMsg(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...aiRequestHeaders(aiSettings),
      };
      if (githubToken.trim()) headers['x-github-token'] = githubToken.trim();
      const res = await fetch(`${getApiOrigin()}/api/devops/analyze`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repo: repoSlug.trim() || undefined,
          localGitSummary: localGitText.trim() || undefined,
          question: devopsQuestion.trim() || undefined,
        }),
      });
      const data = await parseJsonSafely<{
        overview?: GithubOverview | null;
        analysis?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data?.analysis) throw new Error(data?.error || 'DevOps analysis failed.');
      if (data.overview) setGithubOverview(data.overview);
      setDevopsAnalysis(data.analysis);
      onSpeak?.(data.analysis);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'DevOps analysis failed.');
    } finally {
      setDevopsBusy(false);
    }
  };

  const combinedDocs =
    vaultDocs.length > 0
      ? vaultDocs
      : syncedMeta.map((m) => ({
          id: m.vaultId || m.id,
          title: m.title,
          sourceType: m.sourceType,
          summary: m.summary,
          chunkCount: m.chunkCount,
          embedded: m.embedded,
          createdAt: Date.now(),
        }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={MAC_GLASS_TOOLBAR}>
        <MacSegmentedControl
          layoutId="vault-devops-tabs"
          value={subtab}
          onChange={setSubtab}
          options={[
            { id: 'vault', label: `Knowledge Vault (${combinedDocs.length})` },
            { id: 'devops', label: 'GitHub & DevOps' },
          ]}
        />
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept=".txt,.md,.pdf,.json,.csv"
          className="hidden"
          onChange={(e) => {
            void handleUploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {subtab === 'vault' && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={vaultBusy}
              onClick={() => fileInputRef.current?.click()}
              className={MAC_GLASS_BTN_PRIMARY}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload PDF / Docs</span>
            </button>
          </div>
        )}
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

      {subtab === 'vault' ? (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-white/10">
          {/* Left: Ingest & Document Index */}
          <div className={`lg:col-span-5 p-4 overflow-y-auto space-y-4 ${MAC_GLASS_SIDEBAR}`}>
            <form onSubmit={handleIngestNote} className={`p-3.5 space-y-2.5 ${MAC_GLASS_CARD}`}>
              <h3 className="text-xs font-semibold text-slate-200">Add Note to Knowledge Vault</h3>
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note or document title"
                className={MAC_GLASS_FIELD}
              />
              <textarea
                rows={3}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Paste architecture docs, study notes, or project specs..."
                className={MAC_GLASS_FIELD}
              />
              <button
                type="submit"
                disabled={!noteTitle.trim() || !noteContent.trim() || vaultBusy}
                className={`w-full ${MAC_GLASS_BTN_SECONDARY}`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Index Note</span>
              </button>
            </form>

            <div className={`p-3.5 space-y-2 ${MAC_GLASS_CARD}`}>
              <h4 className="text-xs font-semibold text-slate-300">Ingest Local Folder (Laptop Agent)</h4>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/path/to/docs or project"
                  className={`${MAC_GLASS_FIELD} flex-1 font-mono`}
                />
                <button
                  type="button"
                  disabled={vaultBusy}
                  onClick={() => void handleIngestLaptopFolder()}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  <Laptop className="w-3.5 h-3.5" />
                  <span>Index</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-300">
                Indexed Sources ({combinedDocs.length})
              </h4>
              {combinedDocs.length === 0 ? (
                <p className="text-xs text-slate-500">No documents indexed yet.</p>
              ) : (
                combinedDocs.map((d) => (
                  <div
                    key={d.id}
                    className={`p-3 flex items-start justify-between gap-2 ${MAC_GLASS_SUBSURFACE}`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-medium text-slate-100 truncate">{d.title}</p>
                      <p className="text-[11px] text-slate-400">
                        {d.sourceType.toUpperCase()} · {d.chunkCount} chunks ·{' '}
                        {d.embedded ? 'Vector + Lexical' : 'Lexical'}
                      </p>
                      <p className="text-[11px] text-slate-500 line-clamp-2">{d.summary}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteDoc(d.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                      aria-label={`Delete ${d.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Semantic RAG Q&A */}
          <div className="lg:col-span-7 p-5 overflow-y-auto space-y-4">
            <form onSubmit={handleAskVault} className="flex items-center gap-2">
              <input
                type="text"
                value={vaultQuery}
                onChange={(e) => setVaultQuery(e.target.value)}
                placeholder="Ask across your uploaded PDFs, notes, and meeting transcripts..."
                className={`${MAC_GLASS_FIELD} flex-1`}
              />
              <button
                type="submit"
                disabled={!vaultQuery.trim() || vaultBusy}
                className={MAC_GLASS_BTN_PRIMARY}
              >
                {vaultBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>Ask Vault</span>
              </button>
            </form>

            {vaultAnswer ? (
              <div className="space-y-4">
                <div className={`p-4 space-y-2 ${MAC_GLASS_CARD}`}>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-sky-300">Cited Knowledge Answer</span>
                    <span>{vaultAnswer.modelUsed}</span>
                  </div>
                  <p className="text-xs text-slate-100 leading-relaxed whitespace-pre-wrap">
                    {vaultAnswer.answer}
                  </p>
                </div>

                {vaultAnswer.citations.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-300">
                      Retrieved Passages ({vaultAnswer.citations.length})
                    </h4>
                    {vaultAnswer.citations.map((c, idx) => (
                      <div key={`${c.docId}-${c.chunkIndex}-${idx}`} className={`p-3 space-y-1 ${MAC_GLASS_SUBSURFACE}`}>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                          <span className="font-medium text-sky-300">
                            {c.docTitle} · Chunk #{c.chunkIndex + 1}
                          </span>
                          <span className="font-mono tabular-nums">
                            score {c.score} · {c.matchedBy}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{c.excerpt}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className={`p-10 text-center space-y-2 ${MAC_GLASS_SUBSURFACE}`}>
                <BookOpen className="w-8 h-8 text-sky-300 mx-auto" />
                <p className="text-sm font-medium text-slate-100">Personal RAG Knowledge Vault</p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Upload PDFs, Markdown files, project directories, or meeting transcripts on the left, then ask grounded questions with exact passage citations.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          <form onSubmit={handleInspectGithub} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={repoSlug}
              onChange={(e) => setRepoSlug(e.target.value)}
              placeholder="owner/repo (e.g. facebook/react)"
              className={`${MAC_GLASS_FIELD} flex-1 min-w-[200px] font-mono`}
            />
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="Optional GitHub PAT (session memory only)"
              className={`${MAC_GLASS_FIELD} max-w-xs`}
            />
            <button type="submit" disabled={devopsBusy} className={MAC_GLASS_BTN_PRIMARY}>
              {devopsBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FolderGit2 className="w-3.5 h-3.5" />
              )}
              <span>Inspect Repo</span>
            </button>
            <button
              type="button"
              disabled={devopsBusy}
              onClick={() => void handleInspectLocalGit()}
              className={MAC_GLASS_BTN_SECONDARY}
            >
              <GitBranch className="w-3.5 h-3.5 text-emerald-300" />
              <span>Local Git Status</span>
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={devopsQuestion}
              onChange={(e) => setDevopsQuestion(e.target.value)}
              placeholder="Ask DevOps question (e.g. Why did CI fail or what needs review?)"
              className={`${MAC_GLASS_FIELD} flex-1 min-w-[220px]`}
            />
            <button
              type="button"
              disabled={devopsBusy || (!githubOverview && !localGitText)}
              onClick={() => void handleAnalyzeDevops()}
              className={MAC_GLASS_BTN_SECONDARY}
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-300" />
              <span>AI DevOps Briefing</span>
            </button>
          </div>

          {devopsAnalysis && (
            <div className={`p-4 space-y-2 ${MAC_GLASS_CARD}`}>
              <h4 className="text-xs font-semibold text-sky-300">AI DevOps Diagnosis</h4>
              <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                {devopsAnalysis}
              </p>
            </div>
          )}

          {localGitText && (
            <div className={`p-4 space-y-2 ${MAC_GLASS_SUBSURFACE}`}>
              <h4 className="text-xs font-semibold text-emerald-300">Local Git Workspace</h4>
              <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">
                {localGitText}
              </pre>
            </div>
          )}

          {githubOverview && (
            <div className="space-y-4">
              <div className={`p-4 flex flex-wrap items-center justify-between gap-3 ${MAC_GLASS_CARD}`}>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    {githubOverview.repo.fullName}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {githubOverview.repo.description || 'Repository overview'} ·{' '}
                    {githubOverview.repo.language} · ★ {githubOverview.repo.stars.toLocaleString()} ·{' '}
                    Branch {githubOverview.repo.defaultBranch}
                  </p>
                </div>
                <a
                  href={githubOverview.repo.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  <span>Open GitHub</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className={`p-4 space-y-2 ${MAC_GLASS_SUBSURFACE}`}>
                  <h4 className="text-xs font-semibold text-sky-300 inline-flex items-center gap-1.5">
                    <GitPullRequest className="w-3.5 h-3.5" />
                    <span>Open Pull Requests ({githubOverview.pullRequests.length})</span>
                  </h4>
                  {githubOverview.pullRequests.length === 0 ? (
                    <p className="text-xs text-slate-500">No open pull requests.</p>
                  ) : (
                    githubOverview.pullRequests.map((pr) => (
                      <a
                        key={pr.number}
                        href={pr.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block py-1.5 border-b border-white/6 last:border-0 text-xs hover:text-sky-300"
                      >
                        <p className="text-slate-100 truncate">
                          #{pr.number} {pr.title}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          by {pr.user} {pr.draft ? '· Draft' : ''}
                        </p>
                      </a>
                    ))
                  )}
                </div>

                <div className={`p-4 space-y-2 ${MAC_GLASS_SUBSURFACE}`}>
                  <h4 className="text-xs font-semibold text-emerald-300">
                    Recent CI Workflow Runs ({githubOverview.workflowRuns.length})
                  </h4>
                  {githubOverview.workflowRuns.length === 0 ? (
                    <p className="text-xs text-slate-500">No workflow runs available.</p>
                  ) : (
                    githubOverview.workflowRuns.map((run) => (
                      <a
                        key={run.id}
                        href={run.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 py-1.5 border-b border-white/6 last:border-0 text-xs hover:text-sky-300"
                      >
                        <span className="truncate text-slate-100">{run.name}</span>
                        <span
                          className={`text-[11px] shrink-0 ${
                            run.conclusion === 'success'
                              ? 'text-emerald-300'
                              : run.conclusion === 'failure'
                                ? 'text-rose-300'
                                : 'text-amber-300'
                          }`}
                        >
                          {run.conclusion || run.status}
                        </span>
                      </a>
                    ))
                  )}
                </div>

                <div className={`p-4 space-y-2 ${MAC_GLASS_SUBSURFACE}`}>
                  <h4 className="text-xs font-semibold text-amber-300">
                    Open Issues ({githubOverview.issues.length})
                  </h4>
                  {githubOverview.issues.length === 0 ? (
                    <p className="text-xs text-slate-500">No open issues.</p>
                  ) : (
                    githubOverview.issues.map((iss) => (
                      <a
                        key={iss.number}
                        href={iss.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block py-1.5 border-b border-white/6 last:border-0 text-xs hover:text-sky-300"
                      >
                        <p className="text-slate-100 truncate">
                          #{iss.number} {iss.title}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {iss.user} · {iss.comments} comments
                        </p>
                      </a>
                    ))
                  )}
                </div>

                <div className={`p-4 space-y-2 ${MAC_GLASS_SUBSURFACE}`}>
                  <h4 className="text-xs font-semibold text-slate-200">
                    Recent Commits ({githubOverview.recentCommits.length})
                  </h4>
                  {githubOverview.recentCommits.map((c) => (
                    <a
                      key={c.sha}
                      href={c.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block py-1.5 border-b border-white/6 last:border-0 text-xs hover:text-sky-300"
                    >
                      <p className="text-slate-100 truncate">
                        <span className="font-mono text-sky-300">{c.sha}</span> {c.message}
                      </p>
                      <p className="text-[11px] text-slate-500">{c.author}</p>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
