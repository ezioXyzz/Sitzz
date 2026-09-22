import { useState } from 'react'
import type { FormEvent } from 'react'

const VALID_USERNAME = 'imira'
const VALID_PASSWORD = 'ezio'
const SESSION_KEY = 'demo-authed'

export function isAuthed() {
	if (typeof window === 'undefined') {
		return false
	}
	return window.sessionStorage.getItem(SESSION_KEY) === '1'
}

export function Login({ onSuccess }: { onSuccess: () => void }) {
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState(false)

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()

		if (username === VALID_USERNAME && password === VALID_PASSWORD) {
			window.sessionStorage.setItem(SESSION_KEY, '1')
			setError(false)
			onSuccess()
			return
		}

		setError(true)
		setPassword('')
	}

	return (
		<main className="grid min-h-svh place-items-center bg-[var(--fb-bg)] px-4 font-sans text-[var(--fb-text)]">
			<form
				className="flex w-full max-w-[320px] flex-col gap-3 rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-6 shadow-sm"
				onSubmit={handleSubmit}
			>
				<div>
					<h1 className="m-0 text-[16px] font-semibold">Sign in</h1>
					<p className="m-0 mt-1 text-[12px] text-[var(--fb-muted)]">This demo is private. Enter your credentials.</p>
				</div>

				<label className="flex flex-col gap-1 text-[12px] font-medium">
					Username
					<input
						autoComplete="username"
						autoFocus
						className="min-h-9 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-bg)] px-2.5 text-[14px] outline-none focus:ring-2 focus:ring-[var(--fb-accent-soft)]"
						onChange={(event) => {
							setUsername(event.target.value)
							setError(false)
						}}
						type="text"
						value={username}
					/>
				</label>

				<label className="flex flex-col gap-1 text-[12px] font-medium">
					Password
					<input
						autoComplete="current-password"
						className="min-h-9 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-border)] bg-[var(--fb-bg)] px-2.5 text-[14px] outline-none focus:ring-2 focus:ring-[var(--fb-accent-soft)]"
						onChange={(event) => {
							setPassword(event.target.value)
							setError(false)
						}}
						type="password"
						value={password}
					/>
				</label>

				{error ? <p className="m-0 text-[12px] text-[var(--fb-danger)]">Incorrect username or password.</p> : null}

				<button
					className="mt-1 min-h-9 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-accent)] bg-[var(--fb-accent)] px-2.5 text-[14px] font-medium text-white transition hover:opacity-90"
					type="submit"
				>
					Sign in
				</button>
			</form>
		</main>
	)
}
