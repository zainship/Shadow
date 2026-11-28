import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { extractErrorRawDetail, reportShadowError } from './errorStore';

export const WORKSPACE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

const app = initializeApp(firebaseConfig);
const firestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-4a38c93f-cd64-44d7-a590-716b466bfd8f';
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
for (const scope of WORKSPACE_OAUTH_SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Google OAuth access tokens MUST reside strictly in JS memory — never persisted to Web Storage.
let memoryWorkspaceAccessToken: string | null = null;
const tokenListeners = new Set<(connected: boolean) => void>();

function notifyWorkspaceTokenListeners(): void {
  const connected = Boolean(memoryWorkspaceAccessToken);
  for (const listener of tokenListeners) {
    try {
      listener(connected);
    } catch {
      // ignore listener errors
    }
  }
}

export function setWorkspaceAccessToken(token: string | null | undefined): void {
  const cleaned = typeof token === 'string' && token.trim().length > 10 ? token.trim() : null;
  memoryWorkspaceAccessToken = cleaned;
  notifyWorkspaceTokenListeners();
}

export function getWorkspaceAccessToken(): string | null {
  return memoryWorkspaceAccessToken;
}

export function clearWorkspaceAccessToken(): void {
  memoryWorkspaceAccessToken = null;
  notifyWorkspaceTokenListeners();
}

export function subscribeWorkspaceTokenChange(cb: (connected: boolean) => void): () => void {
  tokenListeners.add(cb);
  cb(Boolean(memoryWorkspaceAccessToken));
  return () => {
    tokenListeners.delete(cb);
  };
}

export async function connectWorkspaceScopesPopup(): Promise<string | null> {
  const workspaceProvider = new GoogleAuthProvider();
  for (const scope of WORKSPACE_OAUTH_SCOPES) {
    workspaceProvider.addScope(scope);
  }
  workspaceProvider.setCustomParameters({
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  const result = await signInWithPopup(auth, workspaceProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken ?? null;
  setWorkspaceAccessToken(accessToken);
  return accessToken;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  const { rawDetail, stack } = extractErrorRawDetail(error);
  reportShadowError({
    source: 'Firestore',
    title: `Firestore ${operationType} failed (${path ?? 'collection'})`,
    message: errInfo.error,
    rawDetail: [rawDetail, JSON.stringify({ operationType, path, authInfo: errInfo.authInfo }, null, 2)]
      .filter(Boolean)
      .join('\n\n'),
    endpoint: path ?? undefined,
    stack,
  });
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration — Firestore client is offline.');
      return false;
    }
    // A permission-denied response confirms live network connectivity to Firestore
    return true;
  }
}
