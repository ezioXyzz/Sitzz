import { FileBrowserAdapterError } from '../../core/types'
import type {
	FileBrowserAdapter,
	FileBrowserListOptions,
	FileBrowserListResult,
	FileBrowserUploadOptions,
	FileNode
} from '../../core/types'
import {
	getFileBrowserBasename,
	getFileBrowserDirname,
	joinFileBrowserPath,
	normalizeFileBrowserPath,
	ROOT_PATH
} from '../../core/path'

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'
const API_BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,md5Checksum,thumbnailLink,parents'
const GOOGLE_EXPORT_MIME: Record<string, string> = {
	'application/vnd.google-apps.document': 'application/pdf',
	'application/vnd.google-apps.presentation': 'application/pdf',
	'application/vnd.google-apps.spreadsheet':
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export type GoogleDriveFileBrowserAdapterOptions<TMetadata = unknown> = {
	/**
	 * Returns a valid OAuth access token (scope `drive` or `drive.file`).
	 * Called before every API request, so it's a good place to silently refresh
	 * an expired token (e.g. via Google Identity Services' token client).
	 */
	getAccessToken: () => Promise<string> | string
	/**
	 * Restrict browsing to a specific Drive folder (e.g. an app-created "root"
	 * folder id) instead of the user's actual Drive root. Defaults to `'root'`.
	 */
	rootFolderId?: string
	/** Page size for `files.list` calls. Defaults to 100. */
	pageSize?: number
	mapMetadata?: (file: DriveFile) => TMetadata | undefined
}

export type DriveFile = {
	id: string
	name: string
	mimeType: string
	size?: string
	modifiedTime?: string
	md5Checksum?: string
	thumbnailLink?: string
	parents?: string[]
}

type CacheEntry = { id: string; mimeType: string }

/**
 * FileBrowserAdapter backed by the Google Drive API v3. Talks directly to
 * `googleapis.com` from the browser using a bearer access token supplied by
 * `getAccessToken` (see the Google Identity Services token-client flow).
 *
 * Paths are translated to Drive file/folder ids on demand and cached; the
 * cache is cleared on any mutation to stay correct rather than fast.
 */
export class GoogleDriveFileBrowserAdapter<TMetadata = unknown> implements FileBrowserAdapter<TMetadata> {
	private readonly getAccessToken: () => Promise<string> | string
	private readonly rootFolderId: string
	private readonly pageSize: number
	private readonly mapMetadata?: (file: DriveFile) => TMetadata | undefined
	private readonly idCache = new Map<string, CacheEntry>()
	private readonly objectUrls = new Set<string>()

	constructor(options: GoogleDriveFileBrowserAdapterOptions<TMetadata>) {
		this.getAccessToken = options.getAccessToken
		this.rootFolderId = options.rootFolderId ?? 'root'
		this.pageSize = options.pageSize ?? 100
		this.mapMetadata = options.mapMetadata
		this.idCache.set(ROOT_PATH, { id: this.rootFolderId, mimeType: DRIVE_FOLDER_MIME })
	}

	async list(path: string, opts: FileBrowserListOptions = {}): Promise<FileBrowserListResult<TMetadata>> {
		const folder = await this.resolvePath(path, { signal: opts.signal })
		const params = new URLSearchParams({
			fields: `nextPageToken,files(${FILE_FIELDS})`,
			pageSize: String(this.pageSize),
			q: `'${escapeDriveQueryValue(folder.id)}' in parents and trashed = false`,
			spaces: 'drive'
		})
		if (opts.cursor) {
			params.set('pageToken', opts.cursor)
		}

		const data = await this.request<{ files: DriveFile[]; nextPageToken?: string }>(
			`${API_BASE}/files?${params.toString()}`,
			{ signal: opts.signal }
		)

		const items = data.files.map((file) => {
			const childPath = joinFileBrowserPath(path, file.name)
			this.idCache.set(childPath, { id: file.id, mimeType: file.mimeType })
			return this.toFileNode(childPath, file)
		})

		return { cursor: data.nextPageToken, items }
	}

	async createFolder(path: string): Promise<FileNode<TMetadata>> {
		const normalized = normalizeFileBrowserPath(path)
		const parent = await this.resolvePath(getFileBrowserDirname(normalized))
		const file = await this.request<DriveFile>(`${API_BASE}/files?fields=${FILE_FIELDS}`, {
			body: JSON.stringify({
				mimeType: DRIVE_FOLDER_MIME,
				name: getFileBrowserBasename(normalized),
				parents: [parent.id]
			}),
			method: 'POST'
		})
		this.idCache.set(normalized, { id: file.id, mimeType: file.mimeType })
		return this.toFileNode(normalized, file)
	}

	async delete(paths: string[]): Promise<void> {
		for (const path of paths) {
			const entry = await this.resolvePath(path)
			// Trash rather than permanently delete, so it's recoverable from Drive itself.
			await this.request(`${API_BASE}/files/${entry.id}`, {
				body: JSON.stringify({ trashed: true }),
				method: 'PATCH'
			})
		}
		this.invalidateCache()
	}

	async signedUrl(path: string): Promise<string> {
		const entry = await this.resolvePath(path)
		const exportMime = GOOGLE_EXPORT_MIME[entry.mimeType]
		const url = exportMime
			? `${API_BASE}/files/${entry.id}/export?mimeType=${encodeURIComponent(exportMime)}`
			: `${API_BASE}/files/${entry.id}?alt=media`

		const token = await this.getAccessToken()
		const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
		if (!response.ok) {
			throw await this.toAdapterError(response)
		}
		const blob = await response.blob()
		const objectUrl = URL.createObjectURL(blob)
		this.objectUrls.add(objectUrl)
		return objectUrl
	}

	async upload(path: string, file: File, opts: FileBrowserUploadOptions = {}): Promise<FileNode<TMetadata>> {
		const normalized = normalizeFileBrowserPath(path)
		const parent = await this.resolvePath(getFileBrowserDirname(normalized), { signal: opts.signal })
		const name = getFileBrowserBasename(normalized)

		let existingId: string | undefined
		if (opts.onConflict === 'replace') {
			existingId = await this.findChildId(parent.id, name)
		}

		const metadata = existingId ? { name } : { name, parents: [parent.id] }
		const sessionUrl = await this.startResumableSession(existingId, metadata, file, opts.signal)
		const driveFile = await this.putResumable(sessionUrl, file, opts)

		this.idCache.set(normalized, { id: driveFile.id, mimeType: driveFile.mimeType })
		return this.toFileNode(normalized, driveFile)
	}

	async rename(path: string, newName: string): Promise<FileNode<TMetadata>> {
		const normalized = normalizeFileBrowserPath(path)
		const entry = await this.resolvePath(normalized)
		const file = await this.request<DriveFile>(`${API_BASE}/files/${entry.id}?fields=${FILE_FIELDS}`, {
			body: JSON.stringify({ name: newName }),
			method: 'PATCH'
		})
		this.invalidateCache()
		const newPath = joinFileBrowserPath(getFileBrowserDirname(normalized), newName)
		this.idCache.set(newPath, { id: file.id, mimeType: file.mimeType })
		return this.toFileNode(newPath, file)
	}

	async move(from: string[], toDir: string): Promise<void> {
		const target = await this.resolvePath(toDir)
		for (const path of from) {
			const entry = await this.resolvePath(path)
			const current = await this.request<DriveFile>(`${API_BASE}/files/${entry.id}?fields=parents`)
			const params = new URLSearchParams({
				addParents: target.id,
				removeParents: (current.parents ?? []).join(',')
			})
			await this.request(`${API_BASE}/files/${entry.id}?${params.toString()}`, { method: 'PATCH' })
		}
		this.invalidateCache()
	}

	async copy(from: string[], toDir: string): Promise<void> {
		const target = await this.resolvePath(toDir)
		for (const path of from) {
			const entry = await this.resolvePath(path)
			await this.request(`${API_BASE}/files/${entry.id}/copy?fields=${FILE_FIELDS}`, {
				body: JSON.stringify({ parents: [target.id] }),
				method: 'POST'
			})
		}
		this.invalidateCache()
	}

	async stat(path: string): Promise<FileNode<TMetadata>> {
		const normalized = normalizeFileBrowserPath(path)
		const entry = await this.resolvePath(normalized)
		const file = await this.request<DriveFile>(`${API_BASE}/files/${entry.id}?fields=${FILE_FIELDS}`)
		return this.toFileNode(normalized, file)
	}

	async exists(paths: string[]): Promise<Record<string, boolean>> {
		const result: Record<string, boolean> = {}
		for (const path of paths) {
			try {
				await this.resolvePath(path)
				result[path] = true
			} catch {
				result[path] = false
			}
		}
		return result
	}

	private toFileNode(path: string, file: DriveFile): FileNode<TMetadata> {
		return {
			etag: file.md5Checksum,
			id: file.id,
			kind: file.mimeType === DRIVE_FOLDER_MIME ? 'folder' : 'file',
			metadata: this.mapMetadata?.(file),
			mimeType: file.mimeType,
			modifiedAt: file.modifiedTime,
			name: file.name,
			path,
			size: file.size ? Number(file.size) : undefined,
			thumbnailUrl: file.thumbnailLink
		}
	}

	private invalidateCache() {
		this.idCache.clear()
		this.idCache.set(ROOT_PATH, { id: this.rootFolderId, mimeType: DRIVE_FOLDER_MIME })
	}

	private async findChildId(parentId: string, name: string): Promise<string | undefined> {
		const params = new URLSearchParams({
			fields: 'files(id,mimeType)',
			pageSize: '1',
			q: `'${escapeDriveQueryValue(parentId)}' in parents and name = '${escapeDriveQueryValue(name)}' and trashed = false`
		})
		const data = await this.request<{ files: DriveFile[] }>(`${API_BASE}/files?${params.toString()}`)
		return data.files[0]?.id
	}

	private async resolvePath(path: string, opts: { signal?: AbortSignal } = {}): Promise<CacheEntry> {
		const normalized = normalizeFileBrowserPath(path)
		const cached = this.idCache.get(normalized)
		if (cached) {
			return cached
		}

		if (normalized === ROOT_PATH) {
			const root = { id: this.rootFolderId, mimeType: DRIVE_FOLDER_MIME }
			this.idCache.set(ROOT_PATH, root)
			return root
		}

		const segments = normalized.split('/').filter(Boolean)
		let currentPath = ROOT_PATH
		let currentEntry = await this.resolvePath(ROOT_PATH, opts)

		for (const segment of segments) {
			currentPath = joinFileBrowserPath(currentPath, segment)
			const existing = this.idCache.get(currentPath)
			if (existing) {
				currentEntry = existing
				continue
			}

			throwIfAborted(opts.signal)
			const params = new URLSearchParams({
				fields: 'files(id,mimeType)',
				pageSize: '1',
				q: `'${escapeDriveQueryValue(currentEntry.id)}' in parents and name = '${escapeDriveQueryValue(segment)}' and trashed = false`
			})
			const data = await this.request<{ files: DriveFile[] }>(`${API_BASE}/files?${params.toString()}`, {
				signal: opts.signal
			})
			const found = data.files[0]
			if (!found) {
				throw new FileBrowserAdapterError('not_found', `No such file or folder: ${normalized}`)
			}
			currentEntry = { id: found.id, mimeType: found.mimeType }
			this.idCache.set(currentPath, currentEntry)
		}

		return currentEntry
	}

	private async startResumableSession(
		existingFileId: string | undefined,
		metadata: { name: string; parents?: string[] },
		file: File,
		signal?: AbortSignal
	): Promise<string> {
		const url = existingFileId
			? `${UPLOAD_BASE}/files/${existingFileId}?uploadType=resumable`
			: `${UPLOAD_BASE}/files?uploadType=resumable`
		const response = await this.request<Response>(url, {
			body: JSON.stringify(metadata),
			headers: { 'X-Upload-Content-Type': file.type || 'application/octet-stream' },
			method: existingFileId ? 'PATCH' : 'POST',
			rawResponse: true,
			signal
		})
		const location = response.headers.get('Location')
		if (!location) {
			throw new Error('Google Drive did not return a resumable upload session URL')
		}
		return location
	}

	private putResumable(sessionUrl: string, file: File, opts: FileBrowserUploadOptions): Promise<DriveFile> {
		return new Promise((resolvePromise, rejectPromise) => {
			const xhr = new XMLHttpRequest()
			xhr.open('PUT', sessionUrl, true)
			xhr.responseType = 'json'

			if (opts.signal) {
				if (opts.signal.aborted) {
					rejectPromise(new FileBrowserAdapterError('aborted', 'Upload aborted'))
					return
				}
				opts.signal.addEventListener('abort', () => xhr.abort())
			}

			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable) {
					opts.onProgress?.(event.loaded, event.total)
				}
			}
			xhr.onabort = () => rejectPromise(new FileBrowserAdapterError('aborted', 'Upload aborted'))
			xhr.onerror = () => rejectPromise(new Error('Network error while uploading to Google Drive'))
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					const body = (xhr.response ?? {}) as Partial<DriveFile>
					resolvePromise({
						id: body.id ?? '',
						mimeType: body.mimeType ?? file.type,
						modifiedTime: body.modifiedTime,
						name: body.name ?? file.name,
						size: body.size ?? String(file.size)
					})
					return
				}
				rejectPromise(new Error(`Google Drive upload failed with status ${xhr.status}`))
			}

			xhr.send(file)
		})
	}

	private async request<T>(
		url: string,
		init: {
			body?: string
			headers?: Record<string, string>
			method?: string
			rawResponse?: boolean
			signal?: AbortSignal
		} = {}
	): Promise<T> {
		throwIfAborted(init.signal)
		const token = await this.getAccessToken()
		const response = await fetch(url, {
			body: init.body,
			headers: {
				Authorization: `Bearer ${token}`,
				...(init.body ? { 'Content-Type': 'application/json' } : {}),
				...init.headers
			},
			method: init.method ?? 'GET',
			signal: init.signal
		})

		if (!response.ok) {
			throw await this.toAdapterError(response)
		}

		if (init.rawResponse) {
			return response as unknown as T
		}
		if (response.status === 204) {
			return undefined as T
		}
		return (await response.json()) as T
	}

	private async toAdapterError(response: Response): Promise<Error> {
		let message = `Google Drive request failed with status ${response.status}`
		try {
			const body = (await response.json()) as { error?: { message?: string } }
			message = body.error?.message ?? message
		} catch {
			// ignore non-JSON error bodies
		}

		if (response.status === 401 || response.status === 403) {
			return new FileBrowserAdapterError('access_denied', message)
		}
		if (response.status === 404) {
			return new FileBrowserAdapterError('not_found', message)
		}
		if (response.status === 409) {
			return new FileBrowserAdapterError('conflict', message)
		}
		return new Error(message)
	}
}

function escapeDriveQueryValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		throw new FileBrowserAdapterError('aborted', 'Operation aborted')
	}
}
