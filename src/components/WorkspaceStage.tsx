import React, { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AiSettings } from '../lib/aiSettings';
import { aiRequestHeaders } from '../lib/aiSettings';
import { getApiOrigin, parseJsonSafely } from '../lib/apiBase';
import { reportExceptionError, reportShadowError } from '../lib/errorStore';
import { getWorkspaceAccessToken } from '../lib/firebase';
import type { PendingWorkspaceAction, ShadowTask, TaskPriority } from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_CARD,
  MAC_GLASS_FIELD,
  MAC_GLASS_SUBSURFACE,
  MAC_GLASS_TOOLBAR,
  MacSegmentedControl,
} from './MacWindowShell';

type WorkspaceSubtab = 'tasks' | 'gmail' | 'calendar' | 'drive';

interface GmailMessageSummary {
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

interface CalendarEventItem {
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

interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  size: string;
}

interface WorkspaceStageProps {
  tasks: ShadowTask[];
  workspaceConnected: boolean;
  aiSettings: AiSettings;
  onConnectWorkspace: () => Promise<void>;
  onCreateTask: (input: {
    title: string;
    priority: TaskPriority;
    dueAt?: string;
    notes?: string;
  }) => Promise<void>;
  onToggleTask: (task: ShadowTask) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onRequestConfirmWorkspaceAction: (action: PendingWorkspaceAction) => void;
  onSaveToVault?: (input: {
    title: string;
    contentText: string;
    sourceType: 'note';
  }) => Promise<void>;
  onSpeak?: (text: string) => void;
}

function defaultEventWindow(): { startLocal: string; endLocal: string } {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const toLocalInput = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return { startLocal: toLocalInput(start), endLocal: toLocalInput(end) };
}

export const WorkspaceStage: React.FC<WorkspaceStageProps> = ({
  tasks,
  workspaceConnected,
  aiSettings,
  onConnectWorkspace,
  onCreateTask,
  onToggleTask,
  onDeleteTask,
  onRequestConfirmWorkspaceAction,
  onSaveToVault,
  onSpeak,
}) => {
  const [subtab, setSubtab] = useState<WorkspaceSubtab>('tasks');
  const [connecting, setConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tasks State
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);

  // Gmail State
  const [gmailQuery, setGmailQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<GmailMessageSummary | null>(null);
  const [inboxDigest, setInboxDigest] = useState<{
    digest: string;
    priorityItems: string[];
  } | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');

  // Calendar State
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const initialWindow = defaultEventWindow();
  const [eventSummary, setEventSummary] = useState('');
  const [eventStart, setEventStart] = useState(initialWindow.startLocal);
  const [eventEnd, setEventEnd] = useState(initialWindow.endLocal);
  const [eventLocation, setEventLocation] = useState('');

  // Drive State
  const [driveQuery, setDriveQuery] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveRead, setDriveRead] = useState<{
    file: DriveFileItem;
    content: string;
    summary: string;
  } | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getWorkspaceAccessToken();
    return {
      ...aiRequestHeaders(aiSettings),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [aiSettings]);

  const handleConnect = async () => {
    setConnecting(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      await onConnectWorkspace();
      setStatusMessage('Google Workspace connected in memory for this session.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Workspace connection failed.';
      setErrorMsg(msg);
      reportExceptionError('Google Workspace OAuth', err, msg);
    } finally {
      setConnecting(false);
    }
  };

  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || taskBusy) return;
    setTaskBusy(true);
    setErrorMsg(null);
    try {
      const dueIso = taskDueAt ? new Date(taskDueAt).toISOString() : '';
      await onCreateTask({
        title: taskTitle.trim(),
        priority: taskPriority,
        dueAt: dueIso,
        notes: taskNotes.trim(),
      });
      setTaskTitle('');
      setTaskDueAt('');
      setTaskNotes('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create task.';
      setErrorMsg(msg);
      reportExceptionError('Workspace Tasks', err, msg);
    } finally {
      setTaskBusy(false);
    }
  };

  const loadGmail = useCallback(async () => {
    setGmailLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({ maxResults: '12' });
      if (gmailQuery.trim()) params.set('q', gmailQuery.trim());
      if (unreadOnly) params.set('unreadOnly', 'true');
      const res = await fetch(`${getApiOrigin()}/api/workspace/gmail/messages?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await parseJsonSafely<{ messages?: GmailMessageSummary[]; error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error || 'Could not load Gmail messages.');
      setMessages(data.messages || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load Gmail.');
    } finally {
      setGmailLoading(false);
    }
  }, [gmailQuery, unreadOnly, authHeaders]);

  const handleSummarizeInbox = async () => {
    setGmailLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/workspace/gmail/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ q: gmailQuery.trim() || undefined, maxResults: 10 }),
      });
      const data = await parseJsonSafely<{
        messages?: GmailMessageSummary[];
        digest?: string;
        priorityItems?: string[];
        error?: string;
      }>(res);
      if (!res.ok || !data) throw new Error(data?.error || 'Inbox digest failed.');
      if (data.messages) setMessages(data.messages);
      if (data.digest) {
        setInboxDigest({ digest: data.digest, priorityItems: data.priorityItems || [] });
        onSpeak?.(data.digest);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not summarize inbox.');
    } finally {
      setGmailLoading(false);
    }
  };

  const handleOpenEmail = async (msg: GmailMessageSummary) => {
    setSelectedEmail(msg);
    try {
      const res = await fetch(
        `${getApiOrigin()}/api/workspace/gmail/message/${encodeURIComponent(msg.id)}`,
        { headers: authHeaders() }
      );
      const data = await parseJsonSafely<{ message?: GmailMessageSummary }>(res);
      if (res.ok && data?.message) setSelectedEmail(data.message);
    } catch {
      // keep snippet preview
    }
  };

  const handleSaveGmailDraft = async () => {
    if (!mailTo.trim()) {
      setErrorMsg('Recipient email address is required.');
      return;
    }
    setGmailLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/workspace/gmail/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          to: mailTo.trim(),
          subject: mailSubject.trim(),
          body: mailBody,
        }),
      });
      const data = await parseJsonSafely<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}: Could not save Gmail draft.`);
      setStatusMessage(`Draft saved for ${mailTo.trim()}.`);
      setComposeOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Draft failed.';
      setErrorMsg(msg);
      reportExceptionError('Gmail Draft', err, msg, { endpoint: '/api/workspace/gmail/draft' });
    } finally {
      setGmailLoading(false);
    }
  };

  const handlePrepareSendEmail = () => {
    if (!mailTo.trim() || !mailTo.includes('@')) {
      setErrorMsg('Enter a valid recipient email address.');
      return;
    }
    onRequestConfirmWorkspaceAction({
      id: `ws-send-${Date.now()}`,
      service: 'gmail',
      action: 'send',
      title: `Send Email to ${mailTo.trim()}`,
      payload: {
        to: mailTo.trim(),
        subject: mailSubject.trim() || '(No subject)',
        body: mailBody,
      },
    });
  };

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/workspace/calendar/events?maxResults=15`, {
        headers: authHeaders(),
      });
      const data = await parseJsonSafely<{ events?: CalendarEventItem[]; error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error || 'Could not load Calendar events.');
      setEvents(data.events || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Calendar load failed.');
    } finally {
      setCalendarLoading(false);
    }
  }, [authHeaders]);

  const handlePrepareCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventSummary.trim() || !eventStart || !eventEnd) {
      setErrorMsg('Title, start time, and end time are required.');
      return;
    }
    onRequestConfirmWorkspaceAction({
      id: `ws-cal-${Date.now()}`,
      service: 'calendar',
      action: 'create_event',
      title: `Schedule "${eventSummary.trim()}"`,
      payload: {
        summary: eventSummary.trim(),
        startIso: new Date(eventStart).toISOString(),
        endIso: new Date(eventEnd).toISOString(),
        location: eventLocation.trim() || undefined,
      },
    });
  };

  const loadDriveFiles = useCallback(async () => {
    setDriveLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({ maxResults: '15' });
      if (driveQuery.trim()) params.set('q', driveQuery.trim());
      const res = await fetch(`${getApiOrigin()}/api/workspace/drive/files?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await parseJsonSafely<{ files?: DriveFileItem[]; error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error || 'Could not list Google Drive files.');
      setDriveFiles(data.files || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Drive load failed.');
    } finally {
      setDriveLoading(false);
    }
  }, [driveQuery, authHeaders]);

  const handleReadDriveFile = async (file: DriveFileItem) => {
    setDriveLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${getApiOrigin()}/api/workspace/drive/files/${encodeURIComponent(file.id)}/read`,
        { headers: authHeaders() }
      );
      const data = await parseJsonSafely<{
        file?: DriveFileItem;
        content?: string;
        summary?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data?.file) throw new Error(data?.error || 'Could not read Drive file.');
      setDriveRead({
        file: data.file,
        content: data.content || '',
        summary: data.summary || '',
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Drive read failed.');
    } finally {
      setDriveLoading(false);
    }
  };

  useEffect(() => {
    if (!workspaceConnected) return;
    if (subtab === 'gmail' && messages.length === 0) void loadGmail();
    if (subtab === 'calendar' && events.length === 0) void loadCalendar();
    if (subtab === 'drive' && driveFiles.length === 0) void loadDriveFiles();
  }, [
    workspaceConnected,
    subtab,
    messages.length,
    events.length,
    driveFiles.length,
    loadGmail,
    loadCalendar,
    loadDriveFiles,
  ]);

  const pendingTasksCount = tasks.filter((t) => t.status === 'pending').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={MAC_GLASS_TOOLBAR}>
        <MacSegmentedControl
          layoutId="workspace-stage-tabs"
          value={subtab}
          onChange={setSubtab}
          options={[
            { id: 'tasks', label: `Tasks (${pendingTasksCount})` },
            { id: 'gmail', label: 'Gmail' },
            { id: 'calendar', label: 'Calendar' },
            { id: 'drive', label: 'Drive' },
          ]}
        />

        <div className="ml-auto flex items-center gap-2.5 flex-wrap">
          <span className="text-xs text-slate-400">
            {workspaceConnected ? 'Google Workspace connected' : 'Workspace not connected'}
          </span>
          <button
            type="button"
            disabled={connecting}
            onClick={() => void handleConnect()}
            className={workspaceConnected ? MAC_GLASS_BTN_SECONDARY : MAC_GLASS_BTN_PRIMARY}
          >
            {connecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Link2 className="w-3.5 h-3.5" />
            )}
            <span>{workspaceConnected ? 'Reconnect Google' : 'Connect Google Workspace'}</span>
          </button>
        </div>
      </div>

      {(errorMsg || statusMessage) && (
        <div
          className={`px-5 py-2.5 text-xs border-b border-white/10 flex items-start justify-between gap-3 ${
            errorMsg ? 'bg-rose-500/12 text-rose-200' : 'bg-emerald-500/12 text-emerald-200'
          }`}
        >
          <span className="whitespace-pre-wrap break-words leading-relaxed min-w-0">
            {errorMsg || statusMessage}
          </span>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setStatusMessage(null);
            }}
            className="text-[11px] underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {subtab === 'tasks' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <form
              onSubmit={handleCreateTaskSubmit}
              className={`lg:col-span-4 p-4 space-y-3 self-start ${MAC_GLASS_CARD}`}
            >
              <h3 className="text-xs font-semibold text-slate-200">New Task or Reminder</h3>
              <input
                type="text"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="e.g. Send Q3 report to Maya"
                className={MAC_GLASS_FIELD}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value as TaskPriority)}
                  className={MAC_GLASS_FIELD}
                >
                  <option value="low">Low priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="high">High priority</option>
                </select>
                <input
                  type="datetime-local"
                  value={taskDueAt}
                  onChange={(e) => setTaskDueAt(e.target.value)}
                  className={MAC_GLASS_FIELD}
                />
              </div>
              <textarea
                rows={2}
                value={taskNotes}
                onChange={(e) => setTaskNotes(e.target.value)}
                placeholder="Optional notes..."
                className={MAC_GLASS_FIELD}
              />
              <button
                type="submit"
                disabled={!taskTitle.trim() || taskBusy}
                className={`w-full ${MAC_GLASS_BTN_PRIMARY}`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Task</span>
              </button>
            </form>

            <div className="lg:col-span-8 space-y-2.5">
              {tasks.length === 0 ? (
                <div className={`p-8 text-center text-xs text-slate-400 ${MAC_GLASS_SUBSURFACE}`}>
                  No tasks yet. Add a task here or ask Shadow by voice to set a reminder.
                </div>
              ) : (
                tasks.map((task) => {
                  const dueTime = task.dueAt ? Date.parse(task.dueAt) : NaN;
                  const overdue =
                    task.status === 'pending' && Number.isFinite(dueTime) && dueTime < Date.now();
                  return (
                    <div
                      key={task.id}
                      className={`p-3.5 flex items-start justify-between gap-3 ${MAC_GLASS_CARD}`}
                    >
                      <button
                        type="button"
                        onClick={() => void onToggleTask(task)}
                        className="flex items-start gap-3 text-left min-w-0 flex-1 cursor-pointer"
                      >
                        {task.status === 'done' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 space-y-1">
                          <p
                            className={`text-sm font-medium ${
                              task.status === 'done'
                                ? 'line-through text-slate-500'
                                : 'text-slate-100'
                            }`}
                          >
                            {task.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                            <span
                              className={
                                task.priority === 'high'
                                  ? 'text-rose-300'
                                  : task.priority === 'low'
                                    ? 'text-slate-400'
                                    : 'text-sky-300'
                              }
                            >
                              {task.priority} priority
                            </span>
                            {task.dueAt && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className={overdue ? 'text-rose-300 font-medium' : ''}>
                                  {overdue ? 'Overdue: ' : 'Due: '}
                                  {new Date(task.dueAt).toLocaleString()}
                                </span>
                              </>
                            )}
                          </div>
                          {task.notes && (
                            <p className="text-xs text-slate-400 leading-snug">{task.notes}</p>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteTask(task.id)}
                        aria-label={`Delete ${task.title}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/[0.06] cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {subtab === 'gmail' && !workspaceConnected && (
          <div className={`p-8 text-center space-y-3 ${MAC_GLASS_SUBSURFACE}`}>
            <Mail className="w-8 h-8 text-sky-300 mx-auto" />
            <p className="text-sm font-medium text-slate-100">Connect Google Workspace for Gmail</p>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Tokens stay strictly in session memory. Click Connect Google Workspace above to search, summarize, draft, or confirm sending emails.
            </p>
          </div>
        )}

        {subtab === 'gmail' && workspaceConnected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={gmailQuery}
                onChange={(e) => setGmailQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadGmail();
                }}
                placeholder="Search Gmail (e.g. from:alex invoice)..."
                className={`${MAC_GLASS_FIELD} flex-1 min-w-[200px]`}
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 px-2 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                />
                <span>Unread only</span>
              </label>
              <button
                type="button"
                disabled={gmailLoading}
                onClick={() => void loadGmail()}
                className={MAC_GLASS_BTN_SECONDARY}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${gmailLoading ? 'animate-spin' : ''}`} />
                <span>Load</span>
              </button>
              <button
                type="button"
                disabled={gmailLoading}
                onClick={() => void handleSummarizeInbox()}
                className={MAC_GLASS_BTN_SECONDARY}
              >
                <Sparkles className="w-3.5 h-3.5 text-sky-300" />
                <span>Summarize Inbox</span>
              </button>
              <button
                type="button"
                onClick={() => setComposeOpen((prev) => !prev)}
                className={MAC_GLASS_BTN_PRIMARY}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Compose</span>
              </button>
            </div>

            {inboxDigest && (
              <div className={`p-4 space-y-2 ${MAC_GLASS_CARD}`}>
                <h4 className="text-xs font-semibold text-sky-300">Inbox Priority Digest</h4>
                <p className="text-xs text-slate-200 leading-relaxed">{inboxDigest.digest}</p>
                {inboxDigest.priorityItems.length > 0 && (
                  <ul className="space-y-1 text-xs text-slate-300">
                    {inboxDigest.priorityItems.map((item, i) => (
                      <li key={i}>· {item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {composeOpen && (
              <div className={`p-4 space-y-2.5 ${MAC_GLASS_CARD}`}>
                <h4 className="text-xs font-semibold text-slate-200">Compose Email</h4>
                <input
                  type="email"
                  value={mailTo}
                  onChange={(e) => setMailTo(e.target.value)}
                  placeholder="Recipient (to@example.com)"
                  className={MAC_GLASS_FIELD}
                />
                <input
                  type="text"
                  value={mailSubject}
                  onChange={(e) => setMailSubject(e.target.value)}
                  placeholder="Subject"
                  className={MAC_GLASS_FIELD}
                />
                <textarea
                  rows={4}
                  value={mailBody}
                  onChange={(e) => setMailBody(e.target.value)}
                  placeholder="Write your email..."
                  className={MAC_GLASS_FIELD}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveGmailDraft()}
                    disabled={gmailLoading}
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    <span>Save Draft</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePrepareSendEmail}
                    disabled={gmailLoading}
                    className={MAC_GLASS_BTN_PRIMARY}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Review &amp; Send</span>
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className={`lg:col-span-6 divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                {messages.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    {gmailLoading ? 'Loading Gmail messages...' : 'No messages matched.'}
                  </div>
                ) : (
                  messages.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => void handleOpenEmail(m)}
                      className={`w-full p-3 text-left hover:bg-white/[0.04] transition-colors cursor-pointer space-y-1 ${
                        selectedEmail?.id === m.id ? 'bg-sky-500/12' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-100 truncate">
                          {m.unread ? 'Unread · ' : ''}
                          {m.subject}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {m.from} {m.date ? `· ${m.date}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">{m.snippet}</p>
                    </button>
                  ))
                )}
              </div>

              <div className={`lg:col-span-6 p-4 ${MAC_GLASS_CARD}`}>
                {selectedEmail ? (
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-100">
                        {selectedEmail.subject}
                      </h4>
                      <p className="text-xs text-slate-400 mt-1">From: {selectedEmail.from}</p>
                      {selectedEmail.date && (
                        <p className="text-[11px] text-slate-500">{selectedEmail.date}</p>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap text-xs text-slate-200 leading-relaxed max-h-72 overflow-y-auto font-sans">
                      {selectedEmail.bodyText || selectedEmail.snippet}
                    </pre>
                  </div>
                ) : (
                  <div className="h-44 flex items-center justify-center text-xs text-slate-500">
                    Select a message to read the full email body.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {subtab === 'calendar' && !workspaceConnected && (
          <div className={`p-8 text-center space-y-3 ${MAC_GLASS_SUBSURFACE}`}>
            <Calendar className="w-8 h-8 text-sky-300 mx-auto" />
            <p className="text-sm font-medium text-slate-100">
              Connect Google Workspace for Calendar
            </p>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Inspect upcoming meetings and schedule or delete events with confirmation.
            </p>
          </div>
        )}

        {subtab === 'calendar' && workspaceConnected && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <form
              onSubmit={handlePrepareCreateEvent}
              className={`lg:col-span-5 p-4 space-y-3 self-start ${MAC_GLASS_CARD}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-200">Schedule Calendar Event</h3>
                <button
                  type="button"
                  onClick={() => void loadCalendar()}
                  className="text-xs text-sky-300 hover:underline cursor-pointer"
                >
                  Refresh
                </button>
              </div>
              <input
                type="text"
                value={eventSummary}
                onChange={(e) => setEventSummary(e.target.value)}
                placeholder="Event title (e.g. Architecture Sync)"
                className={MAC_GLASS_FIELD}
              />
              <div className="space-y-2">
                <label className="block text-[11px] text-slate-400">
                  Start
                  <input
                    type="datetime-local"
                    value={eventStart}
                    onChange={(e) => setEventStart(e.target.value)}
                    className={`mt-1 ${MAC_GLASS_FIELD}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-400">
                  End
                  <input
                    type="datetime-local"
                    value={eventEnd}
                    onChange={(e) => setEventEnd(e.target.value)}
                    className={`mt-1 ${MAC_GLASS_FIELD}`}
                  />
                </label>
              </div>
              <input
                type="text"
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
                placeholder="Location or Meet link (optional)"
                className={MAC_GLASS_FIELD}
              />
              <button
                type="submit"
                disabled={calendarLoading}
                className={`w-full ${MAC_GLASS_BTN_PRIMARY}`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Review &amp; Schedule</span>
              </button>
            </form>

            <div className="lg:col-span-7 space-y-2.5">
              {events.length === 0 ? (
                <div className={`p-8 text-center text-xs text-slate-400 ${MAC_GLASS_SUBSURFACE}`}>
                  {calendarLoading
                    ? 'Loading upcoming events...'
                    : 'No upcoming events in the next 7 days.'}
                </div>
              ) : (
                events.map((ev) => (
                  <div
                    key={ev.id}
                    className={`p-3.5 flex items-start justify-between gap-3 ${MAC_GLASS_CARD}`}
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-slate-100">{ev.summary}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(ev.start).toLocaleString()}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </p>
                      {ev.description && (
                        <p className="text-xs text-slate-500 line-clamp-2">{ev.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ev.htmlLink && (
                        <a
                          href={ev.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-sky-400 hover:bg-white/[0.06]"
                          title="Open in Google Calendar"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onRequestConfirmWorkspaceAction({
                            id: `ws-del-${ev.id}`,
                            service: 'calendar',
                            action: 'delete_event',
                            title: `Delete "${ev.summary}"`,
                            payload: { id: ev.id, summary: ev.summary },
                          })
                        }
                        aria-label={`Delete ${ev.summary}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/[0.06] cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {subtab === 'drive' && !workspaceConnected && (
          <div className={`p-8 text-center space-y-3 ${MAC_GLASS_SUBSURFACE}`}>
            <FolderOpen className="w-8 h-8 text-sky-300 mx-auto" />
            <p className="text-sm font-medium text-slate-100">
              Connect Google Workspace for Drive
            </p>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Search Drive docs, read and summarize content, or index excerpts into your Knowledge Vault.
            </p>
          </div>
        )}

        {subtab === 'drive' && workspaceConnected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={driveQuery}
                onChange={(e) => setDriveQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadDriveFiles();
                }}
                placeholder="Search Google Drive file names..."
                className={`${MAC_GLASS_FIELD} flex-1`}
              />
              <button
                type="button"
                disabled={driveLoading}
                onClick={() => void loadDriveFiles()}
                className={MAC_GLASS_BTN_SECONDARY}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${driveLoading ? 'animate-spin' : ''}`} />
                <span>Search</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className={`lg:col-span-6 divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                {driveFiles.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    {driveLoading ? 'Searching Drive...' : 'No files matched.'}
                  </div>
                ) : (
                  driveFiles.map((f) => (
                    <div
                      key={f.id}
                      className="p-3 flex items-center justify-between gap-2 hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-100 truncate">{f.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">{f.mimeType}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleReadDriveFile(f)}
                        disabled={driveLoading}
                        className={MAC_GLASS_BTN_SECONDARY}
                      >
                        <FileText className="w-3 h-3" />
                        <span>Read</span>
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className={`lg:col-span-6 p-4 space-y-3 ${MAC_GLASS_CARD}`}>
                {driveRead ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-slate-100 truncate">
                        {driveRead.file.name}
                      </h4>
                      {onSaveToVault && (
                        <button
                          type="button"
                          onClick={() =>
                            void onSaveToVault({
                              title: driveRead.file.name,
                              contentText: driveRead.content || driveRead.summary,
                              sourceType: 'note',
                            })
                          }
                          className={MAC_GLASS_BTN_PRIMARY}
                        >
                          <span>Save to Vault</span>
                        </button>
                      )}
                    </div>
                    {driveRead.summary && (
                      <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-400/25 text-xs text-slate-200 whitespace-pre-wrap">
                        {driveRead.summary}
                      </div>
                    )}
                    <pre className="whitespace-pre-wrap text-xs text-slate-300 max-h-60 overflow-y-auto font-sans">
                      {driveRead.content}
                    </pre>
                  </>
                ) : (
                  <div className="h-44 flex items-center justify-center text-xs text-slate-500">
                    Click Read on a Drive file to inspect and summarize it.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
