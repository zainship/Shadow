import React, { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { CheckCircle2, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';

interface DesktopAuthBridgeProps {
  nonce: string;
}

export const DesktopAuthBridge: React.FC<DesktopAuthBridgeProps> = ({ nonce }) => {
  const [status, setStatus] = useState<'ready' | 'signing-in' | 'completed' | 'error'>('ready');
  const [email, setEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const finishHandoff = async (
    idToken?: string | null,
    accessToken?: string | null,
    userEmail?: string | null
  ) => {
    const res = await fetch('/api/desktop-auth/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce,
        idToken: idToken || null,
        accessToken: accessToken || null,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Could not hand off sign-in to Shadow Desktop.');
    }
    setEmail(userEmail || '');
    setStatus('completed');
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // Browsers may block closing a tab opened from desktop; user can close manually.
      }
    }, 900);
  };

  useEffect(() => {
    let active = true;
    void getRedirectResult(auth)
      .then(async (result) => {
        if (!active || !result) return;
        const cred = GoogleAuthProvider.credentialFromResult(result);
        if (!cred?.idToken && !cred?.accessToken) {
          throw new Error('Google sign-in completed without an OAuth token.');
        }
        setStatus('signing-in');
        await finishHandoff(cred.idToken, cred.accessToken, result.user?.email);
      })
      .catch((err) => {
        if (!active) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const handleContinue = async () => {
    setError(null);
    setStatus('signing-in');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      if (!cred?.idToken && !cred?.accessToken) {
        throw new Error('Google sign-in completed without an OAuth token.');
      }
      await finishHandoff(cred.idToken, cred.accessToken, result.user?.email);
    } catch (err) {
      const code =
        typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code) : '';
      if (code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#06090F] text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-[28px] bg-[#070B12]/90 border border-white/15 backdrop-blur-3xl shadow-[0_32px_90px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.16)] p-7 space-y-5 text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-400/35 flex items-center justify-center">
          {status === 'completed' ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          ) : (
            <ShieldCheck className="w-6 h-6 text-sky-400" />
          )}
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-white">
            {status === 'completed' ? 'Signed in to Shadow Desktop' : 'Sign in to Shadow Desktop'}
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            {status === 'completed'
              ? `Authenticated${email ? ` as ${email}` : ''}. You can close this browser tab and return to the Shadow Desktop window.`
              : 'Authenticate once with Google in your default browser to sync your Shadow profile, memories, and workflows.'}
          </p>
        </div>

        {error && (
          <div className="px-3.5 py-2.5 rounded-xl bg-rose-950/60 border border-rose-400/35 text-xs text-rose-200">
            {error}
          </div>
        )}

        {status !== 'completed' && (
          <button
            type="button"
            disabled={status === 'signing-in'}
            onClick={() => void handleContinue()}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-b from-sky-400 to-sky-500 text-slate-950 text-sm font-semibold shadow-[0_10px_28px_rgba(56,189,248,0.32),inset_0_1px_0_rgba(255,255,255,0.5)] hover:brightness-110 disabled:opacity-60 transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            {status === 'signing-in' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Continue with Google</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
