import { isTauriEnvironment } from './tauriBridge';

export type OsPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export interface OsPermissionSnapshot {
  microphone: OsPermissionState;
  camera: OsPermissionState;
  notifications: OsPermissionState;
  osPlatform: string;
  filesAccessGranted: boolean;
  automationGranted: boolean;
  shellAvailable: boolean;
  isTauri: boolean;
}

async function queryBrowserPermission(name: 'microphone' | 'camera'): Promise<OsPermissionState> {
  if (typeof navigator === 'undefined') return 'unsupported';
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: name as PermissionName,
      });
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
        return status.state;
      }
    }
  } catch {
    // WebView2 / Safari / some Tauri webviews reject permissions.query for mic/cam
  }
  return typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'prompt' : 'unsupported';
}

export async function probeSystemPermissions(): Promise<OsPermissionSnapshot> {
  const [microphone, camera] = await Promise.all([
    queryBrowserPermission('microphone'),
    queryBrowserPermission('camera'),
  ]);

  let notifications: OsPermissionState = 'unsupported';
  if (typeof window !== 'undefined' && 'Notification' in window) {
    const p = Notification.permission;
    notifications = p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
  }

  let osPlatform =
    typeof navigator !== 'undefined' ? navigator.platform || 'browser' : 'browser';
  let filesAccessGranted = false;
  let automationGranted = false;
  let shellAvailable = false;
  const inTauri = isTauriEnvironment();

  if (inTauri && window.__TAURI_INTERNALS__) {
    try {
      const nativeStatus = await window.__TAURI_INTERNALS__.invoke<{
        platform: string;
        filesAccessGranted: boolean;
        automationGranted: boolean;
        shellAvailable: boolean;
      }>('get_os_permission_status');
      osPlatform = nativeStatus.platform || osPlatform;
      filesAccessGranted = Boolean(nativeStatus.filesAccessGranted);
      automationGranted = Boolean(nativeStatus.automationGranted);
      shellAvailable = Boolean(nativeStatus.shellAvailable);
    } catch {
      // keep safe defaults if native probe fails
    }
  }

  return {
    microphone,
    camera,
    notifications,
    osPlatform,
    filesAccessGranted,
    automationGranted,
    shellAvailable,
    isTauri: inTauri,
  };
}

export async function requestMicrophoneAccess(): Promise<{
  state: OsPermissionState;
  error?: string;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { state: 'unsupported', error: 'Audio capture API is unavailable in this runtime.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { state: 'granted' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Microphone permission denied by OS.';
    return { state: 'denied', error: msg };
  }
}

export async function requestCameraAccess(): Promise<{
  state: OsPermissionState;
  error?: string;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { state: 'unsupported', error: 'Camera capture API is unavailable in this runtime.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    return { state: 'granted' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Camera permission denied by OS.';
    return { state: 'denied', error: msg };
  }
}

export async function requestNotificationAccess(): Promise<OsPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const res = await Notification.requestPermission();
    return res === 'granted' ? 'granted' : res === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'denied';
  }
}

export async function requestNativeOsPermission(
  kind: 'microphone' | 'camera' | 'notifications' | 'files' | 'automation'
): Promise<{ ok: boolean; granted?: boolean; message?: string }> {
  if (!isTauriEnvironment() || !window.__TAURI_INTERNALS__) {
    return {
      ok: false,
      message: 'Native OS privacy settings are available inside the Shadow Desktop app.',
    };
  }
  try {
    return await window.__TAURI_INTERNALS__.invoke<{
      ok: boolean;
      granted?: boolean;
      message?: string;
    }>('request_os_permission', { kind });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Failed requesting native OS permission.',
    };
  }
}
