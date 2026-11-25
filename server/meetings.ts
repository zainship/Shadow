import { Type } from '@google/genai';
import { openRouterGenerate, type AiRuntime } from './ai-provider.ts';
import { getGeminiClient, getModelConfig, isOverloadOrQuotaError, withGeminiRetry } from './gemini.ts';

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
]);

export interface MeetingActionItem {
  text: string;
  assignee?: string;
  dueHint?: string;
}

export interface MeetingSummaryResult {
  title: string;
  summary: string;
  keyDecisions: string[];
  actionItems: MeetingActionItem[];
  topics: string[];
  highlights: string[];
}

export async function transcribeAudioChunk(input: {
  audioBase64: string;
  mimeType: string;
  promptHint?: string;
  runtime?: AiRuntime | null;
}): Promise<{ transcript: string; modelUsed: string }> {
  const cleanB64 = String(input.audioBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!cleanB64 || cleanB64.length < 32) {
    throw new Error('Audio clip is empty.');
  }
  if (cleanB64.length > 5_500_000) {
    throw new Error('Audio chunk exceeds 4MB limit; send shorter segments.');
  }

  const normalizedMime = String(input.mimeType || 'audio/webm')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const mimeType = ALLOWED_AUDIO_MIMES.has(normalizedMime) ? normalizedMime : 'audio/webm';

  const geminiKey =
    input.runtime?.provider === 'gemini' ? input.runtime.apiKey : undefined;
  const ai = getGeminiClient(geminiKey);

  const promptText = input.promptHint?.trim()
    ? `Transcribe all spoken dialogue accurately into clean punctuation. Context hint: ${input.promptHint.trim().slice(0, 180)}`
    : 'Transcribe all spoken speech cleanly with punctuation. If silent or unintelligible, return an empty string.';

  const transcribeModel = 'gemini-3.5-transcribe';
  try {
    const response = await withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: transcribeModel,
          contents: {
            parts: [
              { inlineData: { mimeType, data: cleanB64 } },
              { text: promptText },
            ],
          },
        }),
      1
    );
    return {
      transcript: (response.text || '').trim(),
      modelUsed: transcribeModel,
    };
  } catch (err) {
    if (!isOverloadOrQuotaError(err)) throw err;
    const fallbackModel = getModelConfig().deepText;
    const response = await ai.models.generateContent({
      model: fallbackModel,
      contents: {
        parts: [
          { inlineData: { mimeType, data: cleanB64 } },
          { text: promptText },
        ],
      },
    });
    return {
      transcript: (response.text || '').trim(),
      modelUsed: fallbackModel,
    };
  }
}

const summarySchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    keyDecisions: { type: Type.ARRAY, items: { type: Type.STRING } },
    actionItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          assignee: { type: Type.STRING },
          dueHint: { type: Type.STRING },
        },
        required: ['text'],
      },
    },
    topics: { type: Type.ARRAY, items: { type: Type.STRING } },
    highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['title', 'summary', 'keyDecisions', 'actionItems', 'topics', 'highlights'],
};

export async function summarizeMeetingTranscript(input: {
  title?: string;
  transcript: string;
  durationSeconds?: number;
  runtime?: AiRuntime | null;
}): Promise<MeetingSummaryResult> {
  const transcript = String(input.transcript || '').trim();
  if (transcript.length < 12) {
    throw new Error('Transcript is too short to summarize.');
  }

  const prompt = [
    input.title?.trim() ? `Suggested Title: ${input.title.trim().slice(0, 120)}` : '',
    input.durationSeconds ? `Duration: ${Math.round(input.durationSeconds)}s` : '',
    'Analyze this meeting/lecture/voice-memo transcript and return structured notes as JSON with:',
    '- title: crisp meeting title (max 100 chars)',
    '- summary: thorough executive summary (2-5 sentences, max 900 chars)',
    '- keyDecisions: concrete decisions made (up to 8 bullets)',
    '- actionItems: concrete next tasks ({ text, assignee, dueHint }, up to 10 items)',
    '- topics: key themes covered (up to 6 tags)',
    '- highlights: notable quotes, numbers, or milestones (up to 6)',
    '',
    `TRANSCRIPT:\n${transcript.slice(0, 24_000)}`,
  ]
    .filter(Boolean)
    .join('\n');

  let rawJson = '';
  if (input.runtime?.provider === 'openrouter') {
    const turn = await openRouterGenerate({
      apiKey: input.runtime.apiKey,
      model: input.runtime.model,
      systemInstruction: 'Return strictly valid JSON matching the meeting summary schema.',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      jsonSchema: summarySchema as unknown as Record<string, unknown>,
    });
    rawJson = turn.text;
  } else {
    const ai = getGeminiClient(input.runtime?.apiKey);
    const models = getModelConfig();
    try {
      const res = await withGeminiRetry(
        () =>
          ai.models.generateContent({
            model: models.deepText,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: summarySchema,
            },
          }),
        1
      );
      rawJson = res.text ?? '';
    } catch (err) {
      if (!isOverloadOrQuotaError(err)) throw err;
      const res = await withGeminiRetry(
        () =>
          ai.models.generateContent({
            model: models.fastText,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: summarySchema,
            },
          }),
        1
      );
      rawJson = res.text ?? '';
    }
  }

  const cleaned = rawJson.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(cleaned || '{}') as Partial<MeetingSummaryResult>;
  return {
    title: String(parsed.title || input.title || 'Meeting Notes').slice(0, 120),
    summary: String(parsed.summary || 'Meeting transcript processed.').slice(0, 1200),
    keyDecisions: Array.isArray(parsed.keyDecisions)
      ? parsed.keyDecisions.map((d) => String(d).slice(0, 260)).slice(0, 8)
      : [],
    actionItems: Array.isArray(parsed.actionItems)
      ? parsed.actionItems
          .map((a) => ({
            text: String(a?.text || '').trim().slice(0, 240),
            assignee: a?.assignee ? String(a.assignee).slice(0, 80) : undefined,
            dueHint: a?.dueHint ? String(a.dueHint).slice(0, 80) : undefined,
          }))
          .filter((a) => a.text)
          .slice(0, 10)
      : [],
    topics: Array.isArray(parsed.topics)
      ? parsed.topics.map((t) => String(t).slice(0, 48)).slice(0, 6)
      : [],
    highlights: Array.isArray(parsed.highlights)
      ? parsed.highlights.map((h) => String(h).slice(0, 260)).slice(0, 6)
      : [],
  };
}

export async function askMeetingTranscript(input: {
  transcript: string;
  question: string;
  summary?: string;
  runtime?: AiRuntime | null;
}): Promise<{ answer: string; modelUsed: string }> {
  const question = String(input.question || '').trim().slice(0, 500);
  const transcript = String(input.transcript || '').trim();
  if (!question) throw new Error('Question is required.');
  if (!transcript) throw new Error('Transcript is required.');

  const prompt = [
    'Answer the user question strictly grounded in this meeting transcript and summary. Cite direct statements or speakers if present.',
    input.summary ? `MEETING SUMMARY:\n${input.summary.slice(0, 1500)}` : '',
    `TRANSCRIPT:\n${transcript.slice(0, 24_000)}`,
    `QUESTION: ${question}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  if (input.runtime?.provider === 'openrouter') {
    const turn = await openRouterGenerate({
      apiKey: input.runtime.apiKey,
      model: input.runtime.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return { answer: turn.text.trim(), modelUsed: input.runtime.model };
  }

  const ai = getGeminiClient(input.runtime?.apiKey);
  const model = getModelConfig().fastText;
  const res = await withGeminiRetry(
    () => ai.models.generateContent({ model, contents: prompt }),
    1
  );
  return { answer: (res.text || '').trim(), modelUsed: model };
}
