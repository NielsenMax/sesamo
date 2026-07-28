/*
  Google auth, browser side.

  Sésamo asks for `drive.file` and nothing else: it can touch the spreadsheets
  it creates and the ones you hand it through the file picker. It cannot see the
  rest of your Drive, and Google enforces that, not us.

  There is no server, so there is no refresh token. Access tokens last about an
  hour; when one lapses we ask for another silently and only fall back to a
  visible prompt if Google refuses.
*/

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'email'].join(' ')
const STORAGE_KEY = 'sesamo.token'
/** Treat a token as spent a minute early rather than fail mid-write. */
const SKEW_MS = 60_000

export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
export const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY ?? ''
export const PROJECT_NUMBER = import.meta.env.VITE_GOOGLE_PROJECT_NUMBER ?? ''

export const isConfigured = Boolean(CLIENT_ID && API_KEY)

export class AuthError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'denied' | 'expired' | 'network' = 'denied',
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

type Session = { token: string; expiresAt: number; email: string }

let session: Session | null = null
let tokenClient: google.accounts.oauth2.TokenClient | null = null
let scriptPromise: Promise<void> | null = null
const listeners = new Set<(s: Session | null) => void>()

function emit() {
  for (const fn of listeners) fn(session)
}

export function onAuthChange(fn: (s: Session | null) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function currentSession(): Session | null {
  if (session && session.expiresAt - SKEW_MS > Date.now()) return session
  return session // expired sessions still identify the account for the UI
}

export function isSignedIn(): boolean {
  return Boolean(session && session.expiresAt - SKEW_MS > Date.now())
}

function restore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Session
    if (parsed?.token && parsed.expiresAt > Date.now()) session = parsed
  } catch {
    /* a malformed cache just means we sign in again */
  }
}
restore()

function persist() {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode: we simply re-auth next load */
  }
}

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const el = document.createElement('script')
    el.src = GIS_SRC
    el.async = true
    el.defer = true
    el.onload = () => resolve()
    el.onerror = () => reject(new AuthError('Could not load Google Identity Services', 'network'))
    document.head.appendChild(el)
  })
  return scriptPromise
}

async function fetchEmail(token: string): Promise<string> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return ''
    const body = (await res.json()) as { email?: string }
    return body.email ?? ''
  } catch {
    return ''
  }
}

/** Resolves with a live access token, prompting the user only when it must. */
export function requestToken(prompt: '' | 'consent' | 'select_account' = ''): Promise<string> {
  if (!isConfigured) {
    return Promise.reject(new AuthError('VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_API_KEY are not set', 'config'))
  }
  return loadScript().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const finish = async (response: google.accounts.oauth2.TokenResponse) => {
          if (response.error || !response.access_token) {
            reject(new AuthError(response.error_description || response.error || 'Access denied', 'denied'))
            return
          }
          const ttl = Number(response.expires_in ?? 3600) * 1000
          const email = session?.email || (await fetchEmail(response.access_token))
          session = { token: response.access_token, expiresAt: Date.now() + ttl, email }
          persist()
          emit()
          resolve(session.token)
        }

        // The client is rebuilt per request: GIS fires the callback captured at
        // init time, so reusing one client would resolve the wrong promise.
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: (response) => void finish(response),
          error_callback: (err) =>
            reject(new AuthError(err.message || 'Access denied', err.type === 'popup_closed' ? 'denied' : 'network')),
        })
        tokenClient.requestAccessToken({ prompt })
      }),
  )
}

/**
 * The single entry point for every API call. Returns the cached token while it
 * is good, renews it quietly when it lapses, and throws `expired` if Google
 * wants the user to look at a dialog — which the caller surfaces rather than
 * popping a window nobody asked for.
 */
export async function getToken(): Promise<string> {
  if (session && session.expiresAt - SKEW_MS > Date.now()) return session.token
  try {
    return await requestToken('')
  } catch (err) {
    session = null
    persist()
    emit()
    throw new AuthError(
      err instanceof Error ? err.message : 'Session expired',
      err instanceof AuthError && err.kind === 'network' ? 'network' : 'expired',
    )
  }
}

export async function signIn(): Promise<string> {
  return requestToken(session ? '' : 'select_account')
}

export function signOut() {
  const token = session?.token
  session = null
  persist()
  emit()
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token)
}
