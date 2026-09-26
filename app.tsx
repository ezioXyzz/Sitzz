import { useEffect, useMemo, useRef, useState } from 'react'
import { FileBrowser, FileBrowserAdapterError, FileBrowserProvider } from '@harryy/react-file-browser'
import type { FileBrowserAdapter, FileBrowserProps, FileNode } from '@harryy/react-file-browser'
import { InMemoryFileBrowserAdapter } from '@harryy/react-file-browser/adapters/in-memory'
import { GoogleDriveFileBrowserAdapter } from '@harryy/react-file-browser/adapters/google-drive'
import { getFileBrowserDensityAttributes } from '@harryy/react-file-browser/theme'
import { useGoogleDriveAuth } from './use-google-drive-auth'

// Set VITE_GOOGLE_CLIENT_ID in a .env file for your own deployment. Falls back
// to the client ID created for this project's OAuth consent screen.
const GOOGLE_CLIENT_ID =
	import.meta.env.VITE_GOOGLE_CLIENT_ID ??
	'976988131433-ce43n07m38rvnrmg6ats4ivp6pcvcc6m.apps.googleusercontent.com'

type DemoMode = {
	id: 'full' | 'readonly' | 'minimal' | 'policy' | 'compact' | 'empty' | 'denied' | 'gdrive'
	label: string
	description: string
}

const DEMO_MODES: DemoMode[] = [
	{
		id: 'full',
		label: 'Full',
		description: 'All optional in-memory capabilities enabled.'
	},
	{
		id: 'readonly',
		label: 'Read-only',
		description: 'Viewer mode with mutation affordances removed.'
	},
	{
		id: 'minimal',
		label: 'Minimal',
		description: 'Mutations, server zip, and client-zip fallback omitted.'
	},
	{
		id: 'policy',
		label: 'Upload policy',
		description: 'MIME, size, and quota rejection paths enabled.'
	},
	{
		id: 'compact',
		label: 'Compact',
		description: 'Same markup with compact density tokens.'
	},
	{
		id: 'empty',
		label: 'Host empty',
		description: 'Custom root label and React content for a host-specific empty state.'
	},
	{
		id: 'denied',
		label: 'Denied',
		description: 'Access-denied loading state from the adapter.'
	},
	{
		id: 'gdrive',
		label: 'Google Drive',
		description: 'Your real Google Drive, connected via OAuth.'
	}
]

const demoFile = (name: string, contents: string, type: string) => new File([contents], name, { type })

export function App() {
	const fullAdapter = useMemo(
		() =>
			new InMemoryFileBrowserAdapter({
				capabilities: { multipart: true },
				multipartPartSize: 4
			}),
		[]
	)
	const minimalAdapter = useMemo(
		() =>
			new InMemoryFileBrowserAdapter({
				capabilities: {
					bulkDownloadUrl: false,
					copy: false,
					createFolder: false,
					exists: false,
					move: false,
					rename: false
				}
			}),
		[]
	)
	const emptyAdapter = useMemo(() => new InMemoryFileBrowserAdapter(), [])
	const deniedAdapter = useMemo(() => createAccessDeniedAdapter(), [])
	const googleDrive = useGoogleDriveAuth(GOOGLE_CLIENT_ID)
	const gdriveAdapter = useMemo(
		() => new GoogleDriveFileBrowserAdapter({ getAccessToken: googleDrive.getAccessToken }),
		[googleDrive.getAccessToken]
	)
	const seededRef = useRef(false)
	const [mode, setMode] = useState<DemoMode['id']>('full')
	const [ready, setReady] = useState(false)

	useEffect(() => {
		if (seededRef.current) {
			return
		}
		seededRef.current = true

		async function seedDemo() {
			await Promise.all([seedAdapter(fullAdapter), seedAdapter(minimalAdapter)])
			setReady(true)
		}

		void seedDemo()
	}, [fullAdapter, minimalAdapter])

	const activeMode = DEMO_MODES.find((item) => item.id === mode) ?? DEMO_MODES[0]
	const adapter =
		mode === 'minimal'
			? minimalAdapter
			: mode === 'empty'
				? emptyAdapter
				: mode === 'denied'
					? deniedAdapter
					: mode === 'gdrive'
						? gdriveAdapter
						: fullAdapter
	const density: NonNullable<FileBrowserProps['density']> = mode === 'compact' ? 'compact' : 'comfortable'
	const uploadPolicy: FileBrowserProps['uploadPolicy'] =
		mode === 'policy'
			? {
					allowedMimeTypes: ['image/*', 'application/pdf', '.md'],
					maxFileSizeBytes: 1024 * 1024,
					remainingQuotaBytes: 2 * 1024 * 1024
				}
			: undefined

	return (
		<main
			className="demo-shell min-h-svh min-w-0 bg-[var(--fb-bg)] font-sans text-[var(--fb-text)]"
			{...getFileBrowserDensityAttributes(density)}
		>
			<div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-3">
				<FileBrowserProvider>
					<section className="flex flex-wrap items-center gap-2 rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-2">
						<div className="mr-auto w-full min-w-0 px-1 lg:w-auto">
							<h1 className="m-0 text-[14px] font-semibold">React File Browser</h1>
							<p className="m-0 mt-0.5 text-[12px] text-[var(--fb-muted)]">{activeMode.description}</p>
						</div>
						<select
							aria-label="Demo mode"
							className="min-h-[calc(var(--fb-gap)*11)] w-full min-w-0 rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] px-[calc(var(--fb-gap)*2)] text-[16px] sm:hidden"
							onChange={(event) => setMode(event.target.value as DemoMode['id'])}
							value={mode}
						>
							{DEMO_MODES.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
						<div className="hidden min-w-0 flex-wrap gap-[calc(var(--fb-gap)*2)] sm:flex">
							{DEMO_MODES.map((item) => (
								<button
									aria-pressed={mode === item.id}
									className={`min-h-[calc(var(--fb-gap)*11)] shrink-0 whitespace-nowrap rounded-[calc(var(--fb-radius)-3px)] border px-2.5 text-[12px] font-medium outline-none transition focus:ring-2 focus:ring-[var(--fb-accent-soft)] sm:min-h-8 [@media(pointer:coarse)]:min-h-[calc(var(--fb-gap)*11)] ${
										mode === item.id
											? 'border-[var(--fb-accent)] bg-[var(--fb-accent-soft)] text-[var(--fb-accent)]'
											: 'border-[var(--fb-border)] bg-[var(--fb-surface)] text-[var(--fb-text)] hover:bg-[var(--fb-bg)]'
									}`}
									key={item.id}
									onClick={() => setMode(item.id)}
									type="button"
								>
									{item.label}
								</button>
							))}
						</div>
					</section>

					{mode === 'gdrive' && !googleDrive.isConnected ? (
						<div className="grid min-h-[min(520px,100svh)] place-items-center rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] p-6 text-center">
							<div className="flex max-w-[320px] flex-col items-center gap-3">
								<h2 className="m-0 text-[14px] font-semibold">Connect Google Drive</h2>
								<p className="m-0 text-[12px] text-[var(--fb-muted)]">
									Sign in with Google to browse, upload, and manage files in your Drive.
								</p>
								<button
									className="min-h-9 rounded-[calc(var(--fb-radius)-3px)] border border-[var(--fb-accent)] bg-[var(--fb-accent)] px-3 text-[13px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
									disabled={googleDrive.status === 'connecting'}
									onClick={() => void googleDrive.connect()}
									type="button"
								>
									{googleDrive.status === 'connecting' ? 'Connecting…' : 'Connect Google Drive'}
								</button>
								{googleDrive.error ? <p className="m-0 text-[12px] text-red-600">{googleDrive.error}</p> : null}
							</div>
						</div>
					) : ready || mode === 'empty' || mode === 'denied' || mode === 'gdrive' ? (
						<FileBrowser
							allowClientZipFallback={mode !== 'minimal'}
							adapter={adapter}
							density={density}
							emptyState={
								mode === 'empty'
									? {
											description: <span>Upload a source to begin indexing.</span>,
											title: <strong>No RAG sources</strong>
										}
									: undefined
							}
							key={mode}
							readOnly={mode === 'readonly'}
							rootLabel={mode === 'empty' ? 'RAG' : 'Files'}
							uploadConflictResolutions={mode === 'policy' ? ['keep-both', 'skip'] : undefined}
							uploadPolicy={uploadPolicy}
							warnZipSizeBytes={64}
						/>
					) : (
						<div className="grid min-h-[min(520px,100svh)] place-items-center rounded-[var(--fb-radius)] border border-[var(--fb-border)] bg-[var(--fb-surface)] text-[12px] text-[var(--fb-muted)]">
							Loading demo files
						</div>
					)}
				</FileBrowserProvider>
			</div>
		</main>
	)
}

async function seedAdapter(adapter: InMemoryFileBrowserAdapter) {
	if (!adapter.createFolder) {
		await adapter.upload('/quarterly-report.pdf', demoFile('quarterly-report.pdf', 'PDF', 'application/pdf'))
		await adapter.upload('/hero-banner.jpg', demoFile('hero-banner.jpg', 'image', 'image/jpeg'))
		await adapter.upload('/release-notes.md', demoFile('release-notes.md', '# Release notes', 'text/markdown'))
		return
	}

	await adapter.createFolder('/assets')
	await adapter.createFolder('/assets/brand')
	await adapter.createFolder('/docs')
	await adapter.createFolder('/campaigns')
	await adapter.createFolder('/campaigns/q3-launch')
	await adapter.upload('/docs/quarterly-report.pdf', demoFile('quarterly-report.pdf', 'PDF', 'application/pdf'))
	await adapter.upload('/docs/release-notes.md', demoFile('release-notes.md', '# Release notes', 'text/markdown'))
	await adapter.upload('/hero-banner.jpg', demoFile('hero-banner.jpg', 'image', 'image/jpeg'))
	await adapter.upload('/assets/brand/logo.svg', demoFile('logo.svg', '<svg />', 'image/svg+xml'))
	await adapter.upload('/campaigns/q3-launch/brief.txt', demoFile('brief.txt', 'Launch brief', 'text/plain'))
}

function createAccessDeniedAdapter(): FileBrowserAdapter {
	const denied = (method: string) =>
		Promise.reject(new FileBrowserAdapterError('access_denied', `Demo access denied from ${method}`))

	return {
		createFolder: (path: string) => denied(`createFolder ${path}`),
		delete: (paths: string[]) => denied(`delete ${paths.join(', ')}`),
		list: (path: string) => denied(`list ${path}`),
		signedUrl: (path: string) => denied(`signedUrl ${path}`),
		upload: (path: string, file: File): Promise<FileNode> => {
			void file
			return denied(`upload ${path}`)
		}
	}
}
