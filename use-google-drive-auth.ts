import { useCallback, useEffect, useRef, useState } from 'react'

// Scope needed to browse/manage files anywhere in the user's Drive, not just
// files this app created. Narrow this to 'drive.file' if you only want the
// app to see files it created/opened itself (no Google verification needed then).
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const STORAGE_KEY = 'gdrive-auth'

type StoredToken = {
	accessToken: string
	expiresAt: number
}

type TokenClient = {
	requestAccessToken: (opts?: { prompt?: string }) => void
}

type TokenResponse = {
	access_token?: string
	error?: string
	expires_in?: number
}

declare global {
	interface Window {
		google?: {
			accounts: {
				oauth2: {
					initTokenClient: (config: {
						callback: (response: TokenResponse) => void
						client_id: string
						scope: string
					}) => TokenClient
				}
			}
		}
	}
}

let gisScriptPromise: Promise<void> | undefined

function loadGoogleIdentityServices(): Promise<void> {
	if (window.google?.accounts?.oauth2) {
		return Promise.resolve()
	}
	if (!gisScriptPromise) {
		gisScriptPromise = new Promise((resolvePromise, rejectPromise) => {
			const script = document.createElement('script')
			script.src = 'https://accounts.google.com/gsi/client'
			script.async = true
			script.onload = () => resolvePromise()
			script.onerror = () => rejectPromise(new Error('Failed to load Google Identity Services'))
			document.head.appendChild(script)
		})
	}
	return gisScriptPromise
}

function readStoredToken(): StoredToken | undefined {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY)
		if (!raw) return undefined
		const parsed = JSON.parse(raw) as StoredToken
		return parsed.expiresAt > Date.now() ? parsed : undefined
	} catch {
		return undefined
	}
}

function writeStoredToken(token: StoredToken | undefined) {
	if (token) {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token))
	} else {
		sessionStorage.removeItem(STORAGE_KEY)
	}
}

export function useGoogleDriveAuth(clientId: string) {
	const [token, setToken] = useState<StoredToken | undefined>(readStoredToken)
	const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle')
	const [error, setError] = useState<string | undefined>()
	const tokenClientRef = useRef<TokenClient | undefined>(undefined)
	const pendingResolveRef = useRef<((token: string) => void) | undefined>(undefined)
	const pendingRejectRef = useRef<((error: Error) => void) | undefined>(undefined)

	useEffect(() => {
		let cancelled = false
		loadGoogleIdentityServices()
			.then(() => {
				if (cancelled || !window.google) return
				tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
					callback: (response) => {
						if (response.error || !response.access_token) {
							const err = new Error(response.error ?? 'Google sign-in failed')
							setStatus('error')
							setError(err.message)
							pendingRejectRef.current?.(err)
							return
						}
						const stored: StoredToken = {
							accessToken: response.access_token,
							expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 - 60_000
						}
						writeStoredToken(stored)
						setToken(stored)
						setStatus('idle')
						setError(undefined)
						pendingResolveRef.current?.(stored.accessToken)
					},
					client_id: clientId,
					scope: DRIVE_SCOPE
				})
			})
			.catch((err: Error) => {
				if (!cancelled) {
					setStatus('error')
					setError(err.message)
				}
			})
		return () => {
			cancelled = true
		}
	}, [clientId])

	const requestToken = useCallback((prompt: '' | 'consent' = '') => {
		return new Promise<string>((resolvePromise, rejectPromise) => {
			if (!tokenClientRef.current) {
				rejectPromise(new Error('Google Identity Services has not finished loading yet'))
				return
			}
			pendingResolveRef.current = resolvePromise
			pendingRejectRef.current = rejectPromise
			setStatus('connecting')
			tokenClientRef.current.requestAccessToken({ prompt })
		})
	}, [])

	const connect = useCallback(async () => {
		await requestToken('consent')
	}, [requestToken])

	const disconnect = useCallback(() => {
		writeStoredToken(undefined)
		setToken(undefined)
	}, [])

	/** Adapter-facing accessor: returns a cached token or silently refreshes one. */
	const getAccessToken = useCallback(async () => {
		const current = readStoredToken()
		if (current) {
			return current.accessToken
		}
		return requestToken('')
	}, [requestToken])

	return {
		connect,
		disconnect,
		error,
		getAccessToken,
		isConnected: Boolean(token),
		status
	}
}
