import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openRouterGenerate, type AiRuntime } from './ai-provider.ts';
import { getGeminiClient, getModelConfig, isOverloadOrQuotaError, withGeminiRetry } from './gemini.ts';

export interface VaultDocRecord {
  id: string;
  ownerKey: string;
  title: string;
  sourceType: 'note' | 'file' | 'pdf' | 'repo' | 'meeting' | 'url';
  sourceRef: string;
  tags: string[];
  summary: string;
  charCount: number;
  chunkCount: number;
  embedded: boolean;
  createdAt: number;
  updatedAt: number;
}

interface VaultChunkRecord {
  id: string;
  docId: string;
  ownerKey: string;
  docTitle: string;
  chunkIndex: number;
  text: string;
  embedding?: number[];
}

interface VaultStore {
  docs: VaultDocRecord[];
  chunks: VaultChunkRecord[];
}

export interface VaultSearchHit {
  docId: string;
  docTitle: string;
  chunkIndex: number;
  score: number;
  excerpt: string;
  matchedBy: 'semantic+lexical' | 'lexical';
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const VAULT_STORE_PATH = path.join(DATA_DIR, 'vault-store.json');
const MAX_DOCS = 250;
const MAX_CHUNKS = 3500;

function normalizeOwnerKey(raw?: string | null): string {
  const clean = String(raw || 'local')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 128);
  return clean || 'local';
}

function loadStore(): VaultStore {
  try {
    const raw = fs.readFileSync(VAULT_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<VaultStore>;
    return {
      docs: Array.isArray(parsed.docs) ? parsed.docs : [],
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
    };
  } catch {
    return { docs: [], chunks: [] };
  }
}

function saveStore(store: VaultStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const trimmed: VaultStore = {
    docs: store.docs.slice(0, MAX_DOCS),
    chunks: store.chunks.slice(0, MAX_CHUNKS),
  };
  const tmp = `${VAULT_STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed), 'utf8');
  fs.renameSync(tmp, VAULT_STORE_PATH);
}

function splitIntoChunks(text: string, maxChars = 850, overlap = 120): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < clean.length && chunks.length < 45) {
    let end = Math.min(clean.length, cursor + maxChars);
    if (end < clean.length) {
      const nl = clean.lastIndexOf('\n', end);
      const sp = clean.lastIndexOf(' ', end);
      if (nl > cursor + 350) end = nl;
      else if (sp > cursor + 350) end = sp;
    }
    const piece = clean.slice(cursor, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    cursor = Math.max(end - overlap, cursor + 200);
  }
  return chunks;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function lexicalScore(queryTokens: string[], docText: string): number {
  if (queryTokens.length === 0) return 0;
  const lower = docText.toLowerCase();
  let hits = 0;
  for (const tok of queryTokens) {
    if (lower.includes(tok)) hits += 1;
  }
  return hits / queryTokens.length;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

async function computeEmbeddings(
  texts: string[],
  apiKeyOverride?: string
): Promise<Array<number[] | undefined>> {
  if (texts.length === 0) return [];
  try {
    const ai = getGeminiClient(apiKeyOverride);
    const results: Array<number[] | undefined> = [];
    // Batch max 16 chunks per call to respect payload bounds
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16);
      const res = await withGeminiRetry(
        () =>
          ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: batch,
          }),
        0
      );
      const embs = res.embeddings || [];
      for (let j = 0; j < batch.length; j++) {
        const vals = embs[j]?.values;
        results.push(Array.isArray(vals) && vals.length > 0 ? vals : undefined);
      }
    }
    return results;
  } catch {
    return texts.map(() => undefined);
  }
}

export async function extractDocumentText(input: {
  fileName: string;
  mimeType?: string;
  contentText?: string;
  fileBase64?: string;
}): Promise<{ text: string; detectedType: VaultDocRecord['sourceType'] }> {
  if (input.contentText && input.contentText.trim()) {
    return {
      text: input.contentText.trim().slice(0, 180_000),
      detectedType: 'note',
    };
  }
  const b64 = String(input.fileBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!b64) {
    throw new Error('Provide text content or a file payload to ingest.');
  }
  if (b64.length > 9_000_000) {
    throw new Error('Uploaded file exceeds 6MB limit.');
  }

  const lowerName = input.fileName.toLowerCase();
  const isPdf =
    lowerName.endsWith('.pdf') || String(input.mimeType || '').toLowerCase().includes('pdf');
  const buf = Buffer.from(b64, 'base64');

  if (isPdf) {
    const { extractText } = await import('unpdf');
    const extracted = await extractText(new Uint8Array(buf), { mergePages: true });
    const rawText = Array.isArray(extracted.text)
      ? extracted.text.join('\n')
      : String(extracted.text || '');
    const clean = rawText.trim();
    if (!clean) {
      throw new Error('Could not extract readable text from this PDF.');
    }
    return { text: clean.slice(0, 180_000), detectedType: 'pdf' };
  }

  const decoded = buf.toString('utf8').replace(/\0/g, '').trim();
  if (!decoded) {
    throw new Error('File contained no readable UTF-8 text.');
  }
  return { text: decoded.slice(0, 180_000), detectedType: 'file' };
}

export async function ingestVaultDocument(input: {
  ownerKey?: string;
  title: string;
  contentText?: string;
  fileBase64?: string;
  mimeType?: string;
  sourceType?: VaultDocRecord['sourceType'];
  sourceRef?: string;
  tags?: string[];
  runtime?: AiRuntime | null;
}): Promise<{ doc: VaultDocRecord; duplicate?: boolean }> {
  const ownerKey = normalizeOwnerKey(input.ownerKey);
  const title = (String(input.title || '').trim() || 'Untitled Knowledge Doc').slice(0, 140);
  const extracted = await extractDocumentText({
    fileName: title,
    mimeType: input.mimeType,
    contentText: input.contentText,
    fileBase64: input.fileBase64,
  });

  const chunksText = splitIntoChunks(extracted.text);
  if (chunksText.length === 0) {
    throw new Error('No extractable text chunks found.');
  }

  const geminiKey =
    input.runtime?.provider === 'gemini' ? input.runtime.apiKey : undefined;
  const embeddings = await computeEmbeddings(chunksText, geminiKey);
  const embeddedCount = embeddings.filter(Boolean).length;

  const docId = `vdoc-${crypto.randomBytes(6).toString('hex')}`;
  const now = Date.now();
  const cleanTags = (Array.isArray(input.tags) ? input.tags : [])
    .map((t) => String(t).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 8);

  const summary = extracted.text.replace(/\s+/g, ' ').trim().slice(0, 320);

  const docRecord: VaultDocRecord = {
    id: docId,
    ownerKey,
    title,
    sourceType: input.sourceType || extracted.detectedType,
    sourceRef: String(input.sourceRef || title).slice(0, 300),
    tags: cleanTags,
    summary,
    charCount: extracted.text.length,
    chunkCount: chunksText.length,
    embedded: embeddedCount > 0,
    createdAt: now,
    updatedAt: now,
  };

  const chunkRecords: VaultChunkRecord[] = chunksText.map((txt, idx) => ({
    id: `${docId}-c${idx}`,
    docId,
    ownerKey,
    docTitle: title,
    chunkIndex: idx,
    text: txt,
    ...(embeddings[idx] ? { embedding: embeddings[idx] } : {}),
  }));

  const store = loadStore();
  store.docs = [docRecord, ...store.docs].slice(0, MAX_DOCS);
  store.chunks = [...chunkRecords, ...store.chunks].slice(0, MAX_CHUNKS);
  saveStore(store);

  return { doc: docRecord };
}

export function listVaultDocuments(ownerKey?: string): VaultDocRecord[] {
  const key = normalizeOwnerKey(ownerKey);
  const store = loadStore();
  return store.docs.filter((d) => d.ownerKey === key || d.ownerKey === 'local');
}

export function deleteVaultDocument(docId: string, ownerKey?: string): boolean {
  const key = normalizeOwnerKey(ownerKey);
  const store = loadStore();
  const target = store.docs.find(
    (d) => d.id === docId && (d.ownerKey === key || d.ownerKey === 'local')
  );
  if (!target) return false;
  store.docs = store.docs.filter((d) => d.id !== docId);
  store.chunks = store.chunks.filter((c) => c.docId !== docId);
  saveStore(store);
  return true;
}

export async function searchVault(input: {
  query: string;
  ownerKey?: string;
  topK?: number;
  runtime?: AiRuntime | null;
}): Promise<VaultSearchHit[]> {
  const query = String(input.query || '').trim();
  if (!query) return [];
  const ownerKey = normalizeOwnerKey(input.ownerKey);
  const topK = Math.max(1, Math.min(12, Number(input.topK || 6) || 6));

  const store = loadStore();
  const chunks = store.chunks.filter(
    (c) => c.ownerKey === ownerKey || c.ownerKey === 'local'
  );
  if (chunks.length === 0) return [];

  const geminiKey =
    input.runtime?.provider === 'gemini' ? input.runtime.apiKey : undefined;
  const queryVecs = await computeEmbeddings([query], geminiKey);
  const queryVec = queryVecs[0];
  const queryTokens = tokenize(query);

  const scored = chunks.map((chunk) => {
    const lex = lexicalScore(queryTokens, `${chunk.docTitle} ${chunk.text}`);
    const sem =
      queryVec && chunk.embedding ? Math.max(0, cosineSimilarity(queryVec, chunk.embedding)) : 0;
    const combined = sem > 0 ? sem * 0.72 + lex * 0.28 : lex;
    return {
      docId: chunk.docId,
      docTitle: chunk.docTitle,
      chunkIndex: chunk.chunkIndex,
      score: Number(combined.toFixed(4)),
      excerpt: chunk.text.slice(0, 750),
      matchedBy: (sem > 0 ? 'semantic+lexical' : 'lexical') as VaultSearchHit['matchedBy'],
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0.02).slice(0, topK);
}

export async function askVault(input: {
  query: string;
  ownerKey?: string;
  topK?: number;
  runtime?: AiRuntime | null;
}): Promise<{
  answer: string;
  citations: VaultSearchHit[];
  modelUsed: string;
}> {
  const hits = await searchVault(input);
  if (hits.length === 0) {
    return {
      answer:
        'No matching passages were found in your Knowledge Vault yet. Upload notes, Markdown files, PDFs, or project folders first.',
      citations: [],
      modelUsed: 'vault-empty',
    };
  }

  const contextBlock = hits
    .map(
      (h, idx) =>
        `[Source ${idx + 1}: ${h.docTitle} #chunk-${h.chunkIndex + 1} | score=${h.score}]\n${h.excerpt}`
    )
    .join('\n\n');

  const prompt = [
    'Answer the user question accurately using ONLY the Knowledge Vault passages below. Cite sources inline like [Doc Title #chunk-1]. If the passages do not answer part of the question, state clearly what is missing.',
    `VAULT CONTEXT:\n${contextBlock}`,
    `QUESTION: ${input.query}`,
  ].join('\n\n');

  if (input.runtime?.provider === 'openrouter') {
    const turn = await openRouterGenerate({
      apiKey: input.runtime.apiKey,
      model: input.runtime.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return { answer: turn.text.trim(), citations: hits, modelUsed: input.runtime.model };
  }

  const ai = getGeminiClient(input.runtime?.apiKey);
  const models = getModelConfig();
  try {
    const res = await withGeminiRetry(
      () => ai.models.generateContent({ model: models.deepText, contents: prompt }),
      1
    );
    return {
      answer: (res.text || '').trim(),
      citations: hits,
      modelUsed: models.deepText,
    };
  } catch (err) {
    if (!isOverloadOrQuotaError(err)) throw err;
    const res = await withGeminiRetry(
      () => ai.models.generateContent({ model: models.fastText, contents: prompt }),
      1
    );
    return {
      answer: (res.text || '').trim(),
      citations: hits,
      modelUsed: models.fastText,
    };
  }
}
