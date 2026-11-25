import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  AssistantMemory,
  AutomationStep,
  AutomationWorkflow,
  CommandExecution,
  DefaultBrowser,
  FaceAuthProfile,
  MemoryCategory,
  MemoryImportance,
  MemorySource,
  ResearchReport,
  RuntimeKind,
  SetupConfig,
  ShadowPermissions,
  ShadowPlugin,
  ShadowTask,
  MeetingNote,
  VaultDocumentMeta,
  UserProfile,
  VoiceName,
  WakeMode,
  YouTubeTrack,
} from '../types/assistant';
import { sanitizePermissions, sanitizePluginDraft } from './setupStorage';

const VALID_ACTIONS = new Set([
  'navigate',
  'click',
  'fill',
  'select',
  'submit',
  'wait',
  'extract',
  'scroll',
]);

function sanitizeSteps(steps: AutomationStep[]): AutomationStep[] {
  const bounded = steps.slice(0, 15).map((s) => ({
    action: (VALID_ACTIONS.has(s.action) ? s.action : 'navigate') as AutomationStep['action'],
    selector: String(s.selector || '').slice(0, 240),
    value: String(s.value || '').slice(0, 500),
    description: (String(s.description || '').trim() || 'Execute browser step').slice(0, 240),
  }));
  if (bounded.length === 0) {
    bounded.push({
      action: 'navigate',
      selector: 'body',
      value: 'https://news.ycombinator.com',
      description: 'Open target page',
    });
  }
  return bounded;
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;
  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      if (user.email) {
        const privSnap = await getDoc(privateRef);
        if (!privSnap.exists()) {
          await setDoc(privateRef, {
            uid: user.uid,
            email: user.email.slice(0, 320),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      return existing;
    }

    const displayName = (user.displayName || user.email?.split('@')[0] || 'Operator').slice(0, 120);
    const initialProfile: UserProfile = {
      uid: user.uid,
      displayName,
      voiceName: 'Charon',
      wakeMode: 'push-to-talk',
      defaultBrowser: 'chromium',
      assistantName: 'Shadow',
      userPreferredName: displayName.split(' ')[0].slice(0, 80),
      setupCompleted: false,
      faceAuthEnabled: false,
      clapWakeEnabled: true,
      permissions: sanitizePermissions(null),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(userRef, initialProfile);

    if (user.email) {
      await setDoc(privateRef, {
        uid: user.uid,
        email: user.email.slice(0, 320),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return initialProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${userPath} | ${privatePath}`);
  }
}

export async function updateUserPreferences(
  uid: string,
  updates: Partial<{
    displayName: string;
    voiceName: VoiceName;
    wakeMode: WakeMode;
    defaultBrowser: DefaultBrowser;
    assistantName: string;
    userPreferredName: string;
    setupCompleted: boolean;
    faceAuthEnabled: boolean;
    clapWakeEnabled: boolean;
    permissions: ShadowPermissions;
  }>
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.displayName !== undefined) {
      payload.displayName = updates.displayName.trim().slice(0, 120) || 'Operator';
    }
    if (updates.voiceName !== undefined) payload.voiceName = updates.voiceName;
    if (updates.wakeMode !== undefined) payload.wakeMode = updates.wakeMode;
    if (updates.defaultBrowser !== undefined) payload.defaultBrowser = updates.defaultBrowser;
    if (updates.assistantName !== undefined) {
      payload.assistantName = (updates.assistantName.trim() || 'Shadow').slice(0, 60);
    }
    if (updates.userPreferredName !== undefined) {
      payload.userPreferredName = updates.userPreferredName.trim().slice(0, 80);
    }
    if (updates.setupCompleted !== undefined) {
      payload.setupCompleted = Boolean(updates.setupCompleted);
    }
    if (updates.faceAuthEnabled !== undefined) {
      payload.faceAuthEnabled = Boolean(updates.faceAuthEnabled);
    }
    if (updates.clapWakeEnabled !== undefined) {
      payload.clapWakeEnabled = Boolean(updates.clapWakeEnabled);
    }
    if (updates.permissions !== undefined) {
      payload.permissions = sanitizePermissions(updates.permissions);
    }
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveSetupConfigToFirestore(
  uid: string,
  config: SetupConfig
): Promise<void> {
  await updateUserPreferences(uid, {
    assistantName: config.assistantName,
    userPreferredName: config.userPreferredName,
    setupCompleted: config.setupCompleted,
    faceAuthEnabled: config.faceAuthEnabled,
    clapWakeEnabled: config.clapWakeEnabled,
    permissions: config.permissions,
  });
}

export async function getFaceAuthProfile(uid: string): Promise<FaceAuthProfile | null> {
  const path = `users/${uid}/private/faceAuth`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'faceAuth'));
    if (!snap.exists()) return null;
    return snap.data() as FaceAuthProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveFaceAuthProfile(
  uid: string,
  profile: Omit<FaceAuthProfile, 'uid' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${uid}/private/faceAuth`;
  const ref = doc(db, 'users', uid, 'private', 'faceAuth');
  const safeDescriptor = profile.descriptor
    .slice(0, 128)
    .map((n) => (Number.isFinite(n) ? Number(n.toFixed(6)) : 0));
  if (safeDescriptor.length < 16) {
    throw new Error('Face descriptor requires at least 16 dimensions.');
  }
  const safeSampleCount = Math.max(1, Math.min(10, Math.trunc(profile.sampleCount || 1)));
  const safeThreshold = Math.max(0.5, Math.min(0.99, Number(profile.threshold || 0.88)));
  const safePasscodeHash = String(profile.passcodeHash || '').slice(0, 128);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        descriptor: safeDescriptor,
        sampleCount: safeSampleCount,
        threshold: safeThreshold,
        passcodeHash: safePasscodeHash,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid,
        descriptor: safeDescriptor,
        sampleCount: safeSampleCount,
        threshold: safeThreshold,
        passcodeHash: safePasscodeHash,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteFaceAuthProfile(uid: string): Promise<void> {
  const path = `users/${uid}/private/faceAuth`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'private', 'faceAuth'));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeWorkflows(
  uid: string,
  onData: (workflows: AutomationWorkflow[]) => void
): Unsubscribe {
  const path = 'workflows';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(40)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: AutomationWorkflow[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AutomationWorkflow, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createWorkflow(
  uid: string,
  input: {
    name: string;
    voiceTrigger: string;
    targetUrl: string;
    category: AutomationWorkflow['category'];
    steps: AutomationStep[];
  }
): Promise<string> {
  const path = 'workflows';
  try {
    const ref = doc(collection(db, path));
    await setDoc(ref, {
      ownerId: uid,
      name: (input.name.trim() || 'Untitled Macro').slice(0, 120),
      voiceTrigger: (input.voiceTrigger.trim() || input.name.trim() || 'Run macro').slice(0, 200),
      targetUrl: String(input.targetUrl || '').slice(0, 1000),
      category: input.category,
      steps: sanitizeSteps(input.steps),
      runCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function incrementWorkflowRunCount(
  workflowId: string,
  currentCount: number
): Promise<void> {
  const path = `workflows/${workflowId}`;
  try {
    await updateDoc(doc(db, 'workflows', workflowId), {
      runCount: currentCount + 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const path = `workflows/${workflowId}`;
  try {
    await deleteDoc(doc(db, 'workflows', workflowId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeExecutions(
  uid: string,
  onData: (executions: CommandExecution[]) => void
): Unsubscribe {
  const path = 'executions';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: CommandExecution[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CommandExecution, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createExecutionLog(
  uid: string,
  input: {
    transcript: string;
    intent: CommandExecution['intent'];
    targetUrl: string;
    stepsCount: number;
    summary: string;
    runtime: RuntimeKind;
  }
): Promise<string> {
  const path = 'executions';
  try {
    const ref = doc(collection(db, path));
    await setDoc(ref, {
      ownerId: uid,
      transcript: (input.transcript.trim() || 'Voice command').slice(0, 500),
      intent: input.intent,
      targetUrl: String(input.targetUrl || '').slice(0, 1000),
      status: 'running',
      stepsCount: Math.max(0, Math.min(50, Math.trunc(input.stepsCount))),
      summary: String(input.summary || '').slice(0, 1000),
      runtime: input.runtime,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function finalizeExecutionLog(
  executionId: string,
  updates: {
    status: 'completed' | 'failed';
    stepsCount: number;
    summary: string;
    targetUrl: string;
  }
): Promise<void> {
  const path = `executions/${executionId}`;
  try {
    await updateDoc(doc(db, 'executions', executionId), {
      status: updates.status,
      stepsCount: Math.max(0, Math.min(50, Math.trunc(updates.stepsCount))),
      summary: String(updates.summary || '').slice(0, 1000),
      targetUrl: String(updates.targetUrl || '').slice(0, 1000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeMediaQueue(
  uid: string,
  onData: (items: YouTubeTrack[]) => void
): Unsubscribe {
  const path = 'mediaQueue';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(25)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: YouTubeTrack[] = snapshot.docs.map((d) => {
        const raw = d.data() as Omit<YouTubeTrack, 'id'>;
        return {
          id: d.id,
          videoId: raw.videoId,
          title: raw.title,
          channel: raw.channel,
          thumbnailUrl: raw.thumbnailUrl,
          mediaType: raw.mediaType,
          status: raw.status,
          url: `https://www.youtube.com/watch?v=${raw.videoId}`,
        };
      });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function addMediaQueueItem(
  uid: string,
  track: Omit<YouTubeTrack, 'id' | 'status'> & { status?: YouTubeTrack['status'] }
): Promise<string> {
  const path = 'mediaQueue';
  const safeVideoId = track.videoId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  if (safeVideoId.length < 4) {
    throw new Error('Invalid YouTube video ID');
  }
  try {
    const ref = doc(collection(db, path));
    await setDoc(ref, {
      ownerId: uid,
      videoId: safeVideoId,
      title: (track.title.trim() || 'YouTube Media').slice(0, 200),
      channel: (track.channel.trim() || 'YouTube').slice(0, 120),
      thumbnailUrl: String(track.thumbnailUrl || '').slice(0, 500),
      mediaType: track.mediaType === 'song' ? 'song' : 'video',
      status: track.status || 'playing',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMediaQueueStatus(
  itemId: string,
  status: YouTubeTrack['status']
): Promise<void> {
  const path = `mediaQueue/${itemId}`;
  try {
    await updateDoc(doc(db, 'mediaQueue', itemId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMediaQueueItem(itemId: string): Promise<void> {
  const path = `mediaQueue/${itemId}`;
  try {
    await deleteDoc(doc(db, 'mediaQueue', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeResearchReports(
  uid: string,
  onData: (reports: ResearchReport[]) => void
): Unsubscribe {
  const path = 'researchReports';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(25)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ResearchReport[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ResearchReport, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveResearchReport(
  uid: string,
  report: Omit<ResearchReport, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const path = 'researchReports';
  try {
    const ref = doc(collection(db, path));
    const safeKeyFindings = (report.keyFindings || [])
      .map((f) => String(f || '').trim().slice(0, 400))
      .filter(Boolean)
      .slice(0, 10);

    const safeComparisonPoints = (report.comparisonPoints || [])
      .map((c) => ({
        label: String(c.label || '').trim().slice(0, 120),
        detail: String(c.detail || '').trim().slice(0, 500),
      }))
      .filter((c) => c.label && c.detail)
      .slice(0, 8);

    const safeFollowUps = (report.followUpQuestions || [])
      .map((q) => String(q || '').trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 6);

    const safeSources = (report.sources || [])
      .map((s) => ({
        title: String(s.title || s.domain || 'Web Source').trim().slice(0, 200),
        url: String(s.url || '').trim().slice(0, 1000),
        domain: String(s.domain || 'web').trim().slice(0, 160),
      }))
      .filter((s) => s.title && s.url && s.domain)
      .slice(0, 12);

    const safeSearchQueries = (report.groundingSearchQueries || [])
      .map((q) => String(q || '').trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 8);

    await setDoc(ref, {
      ownerId: uid,
      query: (report.query.trim() || 'Research').slice(0, 400),
      depth: report.depth === 'quick' ? 'quick' : 'deep',
      executiveSummary: (report.executiveSummary.trim() || 'Research complete.').slice(0, 2000),
      keyFindings: safeKeyFindings,
      comparisonPoints: safeComparisonPoints,
      followUpQuestions: safeFollowUps,
      sources: safeSources,
      groundingSearchQueries: safeSearchQueries,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteResearchReport(reportId: string): Promise<void> {
  const path = `researchReports/${reportId}`;
  try {
    await deleteDoc(doc(db, 'researchReports', reportId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

const VALID_MEMORY_CATEGORIES = new Set<MemoryCategory>([
  'preference',
  'fact',
  'project',
  'routine',
  'person',
]);
const VALID_MEMORY_IMPORTANCE = new Set<MemoryImportance>(['low', 'normal', 'high']);
const VALID_MEMORY_SOURCE = new Set<MemorySource>(['voice', 'manual', 'setup']);

export function subscribeMemories(
  uid: string,
  onData: (memories: AssistantMemory[]) => void
): Unsubscribe {
  const path = 'memories';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(80)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: AssistantMemory[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AssistantMemory, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createMemory(
  uid: string,
  input: {
    category: MemoryCategory;
    content: string;
    importance?: MemoryImportance;
    source?: MemorySource;
  }
): Promise<string> {
  const path = 'memories';
  const cleanContent = input.content.trim().slice(0, 600);
  if (!cleanContent) {
    throw new Error('Memory content cannot be empty.');
  }
  const category = VALID_MEMORY_CATEGORIES.has(input.category) ? input.category : 'fact';
  const importance =
    input.importance && VALID_MEMORY_IMPORTANCE.has(input.importance)
      ? input.importance
      : 'normal';
  const source =
    input.source && VALID_MEMORY_SOURCE.has(input.source) ? input.source : 'manual';

  try {
    const ref = doc(collection(db, path));
    await setDoc(ref, {
      ownerId: uid,
      category,
      content: cleanContent,
      importance,
      source,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMemory(
  memoryId: string,
  updates: Partial<{
    category: MemoryCategory;
    content: string;
    importance: MemoryImportance;
  }>
): Promise<void> {
  const path = `memories/${memoryId}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.category && VALID_MEMORY_CATEGORIES.has(updates.category)) {
    payload.category = updates.category;
  }
  if (updates.content !== undefined) {
    const clean = updates.content.trim().slice(0, 600);
    if (clean) payload.content = clean;
  }
  if (updates.importance && VALID_MEMORY_IMPORTANCE.has(updates.importance)) {
    payload.importance = updates.importance;
  }
  try {
    await updateDoc(doc(db, 'memories', memoryId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const path = `memories/${memoryId}`;
  try {
    await deleteDoc(doc(db, 'memories', memoryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribePlugins(
  uid: string,
  onData: (plugins: ShadowPlugin[]) => void
): Unsubscribe {
  const path = 'plugins';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(40)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ShadowPlugin[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ShadowPlugin, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function installPluginInFirestore(
  uid: string,
  draft: Partial<ShadowPlugin> & { name: string; description: string }
): Promise<string> {
  const path = 'plugins';
  const clean = sanitizePluginDraft(draft);
  try {
    const ref = doc(collection(db, path));
    await setDoc(ref, {
      ownerId: uid,
      ...clean,
      runCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePluginInFirestore(
  plugin: ShadowPlugin,
  updates: Partial<{
    name: string;
    description: string;
    category: ShadowPlugin['category'];
    enabled: boolean;
    version: string;
    author: string;
    parameters: ShadowPlugin['parameters'];
    endpointUrl: string;
    httpMethod: ShadowPlugin['httpMethod'];
    headers: ShadowPlugin['headers'];
    bodyTemplate: string;
    commandTemplate: string;
  }>
): Promise<void> {
  const path = `plugins/${plugin.id}`;
  const clean = sanitizePluginDraft({
    ...plugin,
    ...updates,
    slug: plugin.slug,
    toolName: plugin.toolName,
    kind: plugin.kind,
  });
  try {
    await updateDoc(doc(db, 'plugins', plugin.id), {
      name: clean.name,
      description: clean.description,
      category: clean.category,
      enabled: clean.enabled,
      version: clean.version,
      author: clean.author,
      parameters: clean.parameters,
      endpointUrl: clean.endpointUrl,
      httpMethod: clean.httpMethod,
      headers: clean.headers,
      bodyTemplate: clean.bodyTemplate,
      commandTemplate: clean.commandTemplate,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function incrementPluginRunCount(
  pluginId: string,
  currentCount: number
): Promise<void> {
  const path = `plugins/${pluginId}`;
  try {
    await updateDoc(doc(db, 'plugins', pluginId), {
      runCount: Math.max(0, Math.trunc(currentCount)) + 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deletePluginInFirestore(pluginId: string): Promise<void> {
  const path = `plugins/${pluginId}`;
  try {
    await deleteDoc(doc(db, 'plugins', pluginId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeTasks(
  uid: string,
  onData: (tasks: ShadowTask[]) => void
): Unsubscribe {
  const path = 'tasks';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(80)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ShadowTask[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ShadowTask, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createTaskInFirestore(
  uid: string,
  input: {
    title: string;
    priority?: ShadowTask['priority'];
    dueAt?: string;
    notes?: string;
  }
): Promise<string> {
  const path = 'tasks';
  const cleanTitle = input.title.trim().slice(0, 200);
  if (!cleanTitle) throw new Error('Task title is required.');
  try {
    const ref = doc(collection(db, path));
    await setDoc(ref, {
      ownerId: uid,
      title: cleanTitle,
      status: 'pending',
      priority: input.priority === 'low' || input.priority === 'high' ? input.priority : 'medium',
      dueAt: String(input.dueAt || '').trim().slice(0, 64),
      notes: String(input.notes || '').trim().slice(0, 600),
      reminded: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTaskInFirestore(
  taskId: string,
  updates: Partial<{
    title: string;
    status: ShadowTask['status'];
    priority: ShadowTask['priority'];
    dueAt: string;
    notes: string;
    reminded: boolean;
  }>
): Promise<void> {
  const path = `tasks/${taskId}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.title !== undefined) payload.title = updates.title.trim().slice(0, 200) || 'Task';
  if (updates.status !== undefined) payload.status = updates.status === 'done' ? 'done' : 'pending';
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.dueAt !== undefined) payload.dueAt = String(updates.dueAt).trim().slice(0, 64);
  if (updates.notes !== undefined) payload.notes = String(updates.notes).trim().slice(0, 600);
  if (updates.reminded !== undefined) payload.reminded = Boolean(updates.reminded);
  try {
    await updateDoc(doc(db, 'tasks', taskId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTaskInFirestore(taskId: string): Promise<void> {
  const path = `tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeMeetings(
  uid: string,
  onData: (meetings: MeetingNote[]) => void
): Unsubscribe {
  const path = 'meetings';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(25)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: MeetingNote[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<MeetingNote, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveMeetingInFirestore(
  uid: string,
  input: Omit<MeetingNote, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const path = 'meetings';
  try {
    const ref = doc(collection(db, path));
    await setDoc(ref, {
      ownerId: uid,
      title: (input.title.trim() || 'Meeting Notes').slice(0, 140),
      summary: (input.summary.trim() || 'Meeting recorded.').slice(0, 1500),
      transcript: (input.transcript.trim() || 'Transcript unavailable.').slice(0, 16000),
      keyDecisions: (input.keyDecisions || [])
        .map((d) => String(d).trim().slice(0, 260))
        .filter(Boolean)
        .slice(0, 10),
      actionItems: (input.actionItems || [])
        .map((a) => ({
          text: String(a.text || '').trim().slice(0, 240),
          assignee: String(a.assignee || '').trim().slice(0, 80),
          dueHint: String(a.dueHint || '').trim().slice(0, 80),
        }))
        .filter((a) => a.text)
        .slice(0, 10),
      topics: (input.topics || [])
        .map((t) => String(t).trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 8),
      durationSeconds: Math.max(0, Math.min(86400, Math.trunc(input.durationSeconds || 0))),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteMeetingInFirestore(meetingId: string): Promise<void> {
  const path = `meetings/${meetingId}`;
  try {
    await deleteDoc(doc(db, 'meetings', meetingId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeVaultDocs(
  uid: string,
  onData: (docs: VaultDocumentMeta[]) => void
): Unsubscribe {
  const path = 'vaultDocs';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(60)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: VaultDocumentMeta[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<VaultDocumentMeta, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveVaultDocMetaInFirestore(
  uid: string,
  meta: Omit<VaultDocumentMeta, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const path = 'vaultDocs';
  try {
    const ref = doc(collection(db, path));
    await setDoc(ref, {
      ownerId: uid,
      vaultId: String(meta.vaultId || ref.id).slice(0, 64),
      title: (meta.title.trim() || 'Knowledge Document').slice(0, 140),
      sourceType: meta.sourceType || 'note',
      summary: String(meta.summary || '').slice(0, 400),
      chunkCount: Math.max(0, Math.min(500, Math.trunc(meta.chunkCount || 1))),
      embedded: Boolean(meta.embedded),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteVaultDocMetaInFirestore(docId: string): Promise<void> {
  const path = `vaultDocs/${docId}`;
  try {
    await deleteDoc(doc(db, 'vaultDocs', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}


