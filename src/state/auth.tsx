import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthError, currentSession, isConfigured, onAuthChange, signIn as gsiSignIn, signOut as gsiSignOut } from '@/lib/google/auth'

type AuthCtx = {
  configured: boolean
  signedIn: boolean
  email: string
  busy: boolean
  error: string | null
  signIn: () => Promise<void>
  signOut: () => void
  clearError: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(() => currentSession())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => onAuthChange(setSession), [])

  const signIn = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await gsiSignIn()
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(() => {
    gsiSignOut()
    setSession(null)
  }, [])

  const value = useMemo<AuthCtx>(
    () => ({
      configured: isConfigured,
      signedIn: Boolean(session && session.expiresAt > Date.now()),
      email: session?.email ?? '',
      busy,
      error,
      signIn,
      signOut,
      clearError: () => setError(null),
    }),
    [session, busy, error, signIn, signOut],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
