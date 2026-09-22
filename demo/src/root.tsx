import { useState } from 'react'
import { App } from './app'
import { isAuthed, Login } from './login'

export function Root() {
	const [authed, setAuthed] = useState(isAuthed)

	if (!authed) {
		return <Login onSuccess={() => setAuthed(true)} />
	}

	return <App />
}
