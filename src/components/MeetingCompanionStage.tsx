import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Loader2,
  Mic,
  MonitorSpeaker,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AiSettings } from '../lib/aiSettings';
import { aiRequestHeaders } from '../lib/aiSettings';
import { getApiOrigin, parseJsonSafely } from '../lib/apiBase';
import { reportExceptionError, reportShadowError } from '../lib/errorStore';
import type { MeetingActionItem, MeetingNote, TaskPriority } from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_CARD,
  MAC_GLASS_FIELD,
  MAC_GLASS_SIDEBAR,
  MAC_GLASS_SUBSURFACE,
  MAC_GLASS_TOOLBAR,
} from './MacWindowShell';

interface MeetingSummaryOutput {
  title: string;
  summary: string;
  keyDecisions: string[];
  actionItems: MeetingActionItem[];
  topics: string[];
  highlights: string[];
}

interface MeetingCompanionStageProps {
  meetings: MeetingNote[];
  aiSettings: AiSettings;
  onSaveMeeting: (note: Omit<MeetingNote, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDeleteMeeting: (meetingId: string) => Promise<void>;
  onAddTask: (input: { title: string; priority: TaskPriority; notes?: string }) => Promise<void>;
  onSaveToVault?: (input: { title: string; contentText: string; sourceType: 'meeting' }) => Promise<void>;
  onSpeak?: (text: string) => void;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = typeof reader.result === 'string' ? reader.result : '';
      const idx = str.indexOf(',');
      resolve(idx >= 0 ? str.slice(idx + 1) : str);
    };
    reader.onerror = () => reject(new Error('Failed to read audio blob'));
    reader.readAsDataURL(blob);
  });
}

export const MeetingCompanionStage: React.FC<MeetingCompanionStageProps> = ({
  meetings,
  aiSettings,
  onSaveMeeting,
  onDeleteMeeting,
  onAddTask,
  onSaveToVault,
  onSpeak,
}) => {
  const [title, setTitle] = useState('Team Sync');
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [summaryData, setSummaryData] = useState<MeetingSummaryOutput | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState<string | null>(null);

  const [recording, setRecording] = useState<'idle' | 'mic' | 'tab'>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<{ blob: Blob; mimeType: string } | null>(null);
  const [busyAction, setBusyAction] = useState<'transcribe' | 'summarize' | 'ask' | 'save' | null>(
    null
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addedTaskIndexes, setAddedTaskIndexes] = useState<Set<number>>(new Set());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const speechRef = useRef<{ stop: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (recording === 'idle') return;
    const id = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const stopRecording = () => {
    if (speechRef.current) {
      try {
        speechRef.current.stop();
      } catch {
        // ignore
      }
      speechRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRecording('idle');
    setInterimText('');
  };

  useEffect(() => () => stopRecording(), []);

  const startRecording = async (source: 'mic' | 'tab') => {
    setErrorMsg(null);
    setStatusMessage(null);
    setRecordedBlob(null);
    setElapsedSeconds(0);
    try {
      let stream: MediaStream;
      if (source === 'tab') {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        displayStream.getVideoTracks().forEach((t) => t.stop());
        if (displayStream.getAudioTracks().length === 0) {
          throw new Error('No audio track shared. Check "Share tab audio" when capturing.');
        }
        stream = new MediaStream(displayStream.getAudioTracks());
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          setRecordedBlob({ blob, mimeType: mimeType.split(';')[0] });
        }
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecording(source);

      if (source === 'mic') {
        const SpeechRecCtor =
          (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: new () => unknown })
            .webkitSpeechRecognition;
        if (SpeechRecCtor) {
          const rec = new SpeechRecCtor() as {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: ((ev: {
              resultIndex: number;
              results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>;
            }) => void) | null;
            start: () => void;
            stop: () => void;
          };
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = navigator.language || 'en-US';
          rec.onresult = (ev) => {
            let interim = '';
            let finals = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
              const item = ev.results[i];
              const chunk = item?.[0]?.transcript || '';
              if (item?.isFinal) finals += `${chunk} `;
              else interim += chunk;
            }
            if (finals.trim()) {
              setTranscript((prev) => `${prev}${prev ? ' ' : ''}${finals.trim()}`);
            }
            setInterimText(interim.trim());
          };
          rec.start();
          speechRef.current = rec;
        }
      }
    } catch (err) {
      stopRecording();
      const msg = err instanceof Error ? err.message : 'Unable to start audio capture.';
      setErrorMsg(msg);
      reportExceptionError('Meeting Audio Capture', err, msg);
    }
  };

  const transcribePayload = async (blob: Blob, mimeType: string) => {
    setBusyAction('transcribe');
    setErrorMsg(null);
    try {
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch(`${getApiOrigin()}/api/meetings/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettings) },
        body: JSON.stringify({
          audioBase64,
          mimeType,
          promptHint: title.trim() || undefined,
        }),
      });
      const data = await parseJsonSafely<{
        transcript?: string;
        modelUsed?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data) throw new Error(data?.error || 'Transcription failed.');
      if (data.transcript) {
        setTranscript((prev) => (prev.trim() ? `${prev.trim()}\n${data.transcript}` : data.transcript || ''));
        setStatusMessage(`Transcribed via ${data.modelUsed || 'Gemini Audio'}.`);
      } else {
        setStatusMessage('No speech detected in audio clip.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Audio transcription failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadAudio = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setErrorMsg('Audio file exceeds 4MB limit.');
      return;
    }
    await transcribePayload(file, file.type || 'audio/mp3');
  };

  const handleSummarize = async () => {
    if (!transcript.trim()) {
      setErrorMsg('Record, upload, or paste a transcript first.');
      return;
    }
    setBusyAction('summarize');
    setErrorMsg(null);
    setAddedTaskIndexes(new Set());
    try {
      const res = await fetch(`${getApiOrigin()}/api/meetings/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettings) },
        body: JSON.stringify({
          title: title.trim() || undefined,
          transcript: transcript.trim(),
          durationSeconds: elapsedSeconds,
        }),
      });
      const data = await parseJsonSafely<{ summary?: MeetingSummaryOutput; error?: string }>(res);
      if (!res.ok || !data?.summary) throw new Error(data?.error || 'Meeting summary failed.');
      setSummaryData(data.summary);
      if (data.summary.title) setTitle(data.summary.title);
      onSpeak?.(data.summary.summary);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Meeting summarization failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAskMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qaQuestion.trim() || !transcript.trim()) return;
    setBusyAction('ask');
    setErrorMsg(null);
    try {
      const res = await fetch(`${getApiOrigin()}/api/meetings/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettings) },
        body: JSON.stringify({
          transcript: transcript.trim(),
          question: qaQuestion.trim(),
          summary: summaryData?.summary,
        }),
      });
      const data = await parseJsonSafely<{ answer?: string; error?: string }>(res);
      if (!res.ok || !data?.answer) throw new Error(data?.error || 'Meeting Q&A failed.');
      setQaAnswer(data.answer);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Meeting Q&A failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveNote = async () => {
    if (!transcript.trim()) return;
    setBusyAction('save');
    setErrorMsg(null);
    try {
      await onSaveMeeting({
        title: (summaryData?.title || title).trim() || 'Meeting Notes',
        summary: summaryData?.summary || transcript.slice(0, 400),
        transcript: transcript.trim(),
        keyDecisions: summaryData?.keyDecisions || [],
        actionItems: summaryData?.actionItems || [],
        topics: summaryData?.topics || [],
        durationSeconds: elapsedSeconds,
      });
      setStatusMessage('Meeting notes saved.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save meeting.');
    } finally {
      setBusyAction(null);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={MAC_GLASS_TOOLBAR}>
        <input
          type="file"
          ref={fileInputRef}
          accept="audio/*,.webm,.mp3,.wav,.m4a,.ogg"
          className="hidden"
          onChange={(e) => {
            void handleUploadAudio(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting title..."
          className={`${MAC_GLASS_FIELD} max-w-xs`}
        />

        {recording === 'idle' ? (
          <>
            <button
              type="button"
              onClick={() => void startRecording('mic')}
              className={MAC_GLASS_BTN_PRIMARY}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Record Mic</span>
            </button>
            <button
              type="button"
              onClick={() => void startRecording('tab')}
              className={MAC_GLASS_BTN_SECONDARY}
            >
              <MonitorSpeaker className="w-3.5 h-3.5 text-sky-300" />
              <span>Capture Tab Audio</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="px-3.5 py-1.5 rounded-[10px] bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Stop Recording · {formatDuration(elapsedSeconds)}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busyAction !== null}
          className={MAC_GLASS_BTN_SECONDARY}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Upload Audio</span>
        </button>

        {recordedBlob && (
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void transcribePayload(recordedBlob.blob, recordedBlob.mimeType)}
            className={MAC_GLASS_BTN_SECONDARY}
          >
            {busyAction === 'transcribe' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-sky-300" />
            )}
            <span>Transcribe Recording</span>
          </button>
        )}
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

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-white/10">
        {/* Saved Meetings List */}
        <div className={`lg:col-span-3 p-4 overflow-y-auto space-y-2.5 ${MAC_GLASS_SIDEBAR}`}>
          <h3 className="text-xs font-semibold text-slate-300">Saved Meetings ({meetings.length})</h3>
          {meetings.length === 0 ? (
            <p className="text-xs text-slate-500">Saved meeting notes will appear here.</p>
          ) : (
            meetings.map((m) => (
              <div
                key={m.id}
                className={`p-2.5 rounded-xl border transition-colors ${
                  selectedMeetingId === m.id
                    ? 'bg-sky-500/12 border-sky-400/35'
                    : 'bg-white/[0.03] border-white/8 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMeetingId(m.id);
                      setTitle(m.title);
                      setTranscript(m.transcript);
                      setSummaryData({
                        title: m.title,
                        summary: m.summary,
                        keyDecisions: m.keyDecisions,
                        actionItems: m.actionItems,
                        topics: m.topics,
                        highlights: [],
                      });
                    }}
                    className="text-left min-w-0 flex-1 cursor-pointer"
                  >
                    <p className="text-xs font-medium text-slate-100 truncate">{m.title}</p>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{m.summary}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteMeeting(m.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                    aria-label={`Delete ${m.title}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Live / Editable Transcript */}
        <div className="lg:col-span-4 p-4 flex flex-col gap-3 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-300">Transcript</h3>
            <button
              type="button"
              onClick={() => void handleSummarize()}
              disabled={!transcript.trim() || busyAction !== null}
              className={MAC_GLASS_BTN_PRIMARY}
            >
              {busyAction === 'summarize' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>Summarize &amp; Extract</span>
            </button>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Record audio, upload an audio file, or paste transcript text here..."
            className={`${MAC_GLASS_FIELD} flex-1 min-h-[220px] resize-none leading-relaxed`}
          />
          {interimText && (
            <p className="text-xs text-sky-300 italic truncate">Listening: {interimText}</p>
          )}
        </div>

        {/* Structured Notes, Action Items & Grounded Q&A */}
        <div className="lg:col-span-5 p-4 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs font-semibold text-slate-300">Structured Notes &amp; Q&amp;A</h3>
            <div className="flex items-center gap-2">
              {onSaveToVault && transcript.trim() && (
                <button
                  type="button"
                  onClick={() =>
                    void onSaveToVault({
                      title: (summaryData?.title || title).trim() || 'Meeting Transcript',
                      contentText: `${summaryData?.summary || ''}\n\n${transcript}`.trim(),
                      sourceType: 'meeting',
                    })
                  }
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  <Database className="w-3.5 h-3.5 text-indigo-300" />
                  <span>Index to Vault</span>
                </button>
              )}
              <button
                type="button"
                disabled={!transcript.trim() || busyAction === 'save'}
                onClick={() => void handleSaveNote()}
                className={MAC_GLASS_BTN_SECONDARY}
              >
                <span>Save Note</span>
              </button>
            </div>
          </div>

          {summaryData ? (
            <div className="space-y-3">
              <div className={`p-3.5 space-y-2 ${MAC_GLASS_CARD}`}>
                <p className="text-sm font-semibold text-slate-100">{summaryData.title}</p>
                <p className="text-xs text-slate-300 leading-relaxed">{summaryData.summary}</p>
                {summaryData.topics.length > 0 && (
                  <p className="text-[11px] text-slate-400">
                    Topics: {summaryData.topics.join(' · ')}
                  </p>
                )}
              </div>

              {summaryData.keyDecisions.length > 0 && (
                <div className={`p-3.5 space-y-1.5 ${MAC_GLASS_SUBSURFACE}`}>
                  <h4 className="text-xs font-semibold text-emerald-300">Key Decisions</h4>
                  <ul className="space-y-1 text-xs text-slate-200">
                    {summaryData.keyDecisions.map((d, i) => (
                      <li key={i}>· {d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {summaryData.actionItems.length > 0 && (
                <div className={`p-3.5 space-y-2 ${MAC_GLASS_SUBSURFACE}`}>
                  <h4 className="text-xs font-semibold text-sky-300">Action Items</h4>
                  <div className="space-y-2">
                    {summaryData.actionItems.map((item, idx) => {
                      const added = addedTaskIndexes.has(idx);
                      return (
                        <div
                          key={idx}
                          className="flex items-start justify-between gap-2 text-xs text-slate-200"
                        >
                          <div className="min-w-0">
                            <p>{item.text}</p>
                            {(item.assignee || item.dueHint) && (
                              <p className="text-[11px] text-slate-400">
                                {[item.assignee, item.dueHint].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={added}
                            onClick={() => {
                              setAddedTaskIndexes((prev) => new Set(prev).add(idx));
                              void onAddTask({
                                title: item.text,
                                priority: 'medium',
                                notes: [item.assignee, item.dueHint].filter(Boolean).join(' · '),
                              });
                            }}
                            className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-sky-300 inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            {added ? (
                              <>
                                <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                                <span>Added</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" />
                                <span>Add Task</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={`p-5 text-center text-xs text-slate-400 ${MAC_GLASS_SUBSURFACE}`}>
              Click Summarize &amp; Extract to generate structured decisions and tasks.
            </div>
          )}

          {/* Grounded Q&A */}
          <form onSubmit={handleAskMeeting} className="space-y-2 pt-2 border-t border-white/10">
            <h4 className="text-xs font-semibold text-slate-300">Ask About This Meeting</h4>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={qaQuestion}
                onChange={(e) => setQaQuestion(e.target.value)}
                placeholder="What did we agree on for pricing or timeline?"
                className={`${MAC_GLASS_FIELD} flex-1`}
              />
              <button
                type="submit"
                disabled={!qaQuestion.trim() || !transcript.trim() || busyAction === 'ask'}
                className={MAC_GLASS_BTN_PRIMARY}
              >
                {busyAction === 'ask' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Ask</span>
              </button>
            </div>
            {qaAnswer && (
              <div className={`p-3 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap ${MAC_GLASS_CARD}`}>
                {qaAnswer}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
