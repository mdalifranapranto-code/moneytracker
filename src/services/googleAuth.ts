import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { addSyncLog, getGoogleConnection, saveGoogleConnection } from '../db/repository';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of GOOGLE_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  prompt: 'select_account',
});

// Strictly in-memory OAuth access token caching (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;
let tokenExpiredFlag = false;

type AuthListener = (state: {
  user: User | null;
  hasToken: boolean;
  tokenExpired: boolean;
}) => void;

const listeners = new Set<AuthListener>();

function emitAuthState(user: User | null) {
  for (const l of listeners) {
    l({
      user,
      hasToken: !!cachedAccessToken,
      tokenExpired: tokenExpiredFlag,
    });
  }
}

export function subscribeAuthState(listener: AuthListener): () => void {
  listeners.add(listener);
  listener({
    user: auth.currentUser,
    hasToken: !!cachedAccessToken,
    tokenExpired: tokenExpiredFlag,
  });
  return () => {
    listeners.delete(listener);
  };
}

export function initGoogleAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        tokenExpiredFlag = false;
        emitAuthState(user);
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        const conn = await getGoogleConnection();
        if (conn.accountEmail || conn.spreadsheetId) {
          tokenExpiredFlag = true;
        }
        emitAuthState(user);
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      const conn = await getGoogleConnection();
      tokenExpiredFlag = !!(conn.accountEmail || conn.spreadsheetId);
      emitAuthState(null);
      onAuthFailure?.();
    }
  });
}

export async function googleSignIn(): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google OAuth access token.');
    }

    cachedAccessToken = credential.accessToken;
    tokenExpiredFlag = false;

    const existing = await getGoogleConnection();
    await saveGoogleConnection({
      ...existing,
      accountEmail: result.user.email,
      accountName: result.user.displayName,
      accountUid: result.user.uid,
    });

    await addSyncLog(
      'success',
      'Google account authorized',
      result.user.email ?? result.user.uid
    );
    emitAuthState(result.user);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Google sign-in failed';
    await addSyncLog('error', 'Google authorization failed', msg);
    throw err;
  } finally {
    isSigningIn = false;
  }
}

export function getAccessToken(): string | null {
  return cachedAccessToken;
}

export function isTokenExpired(): boolean {
  return tokenExpiredFlag;
}

export function markTokenExpired(reason = 'Google OAuth session expired. Please reconnect.'): void {
  cachedAccessToken = null;
  tokenExpiredFlag = true;
  addSyncLog('warn', 'Google authorization expired', reason).catch(() => {});
  emitAuthState(auth.currentUser);
}

export async function disconnectGoogleAccount(): Promise<void> {
  cachedAccessToken = null;
  tokenExpiredFlag = false;
  try {
    await auth.signOut();
  } catch {
    // Ignore offline signOut errors
  }
  await saveGoogleConnection({
    accountEmail: null,
    accountName: null,
    accountUid: null,
    spreadsheetId: null,
    spreadsheetTitle: null,
    spreadsheetUrl: null,
    verifiedAt: null,
  });
  await addSyncLog('info', 'Disconnected Google Sheets integration', null);
  emitAuthState(null);
}
