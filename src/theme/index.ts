export type FileBrowserDensity = 'comfortable' | 'compact'

export const FILE_BROWSER_THEME_CONTRACT = {
	accent: 'var(--color-primary-500, oklch(.62 .19 255))',
	accentSoft: 'var(--color-primary-50, oklch(.62 .19 255 / .16))',
	bg: '#060a18',
	surface: 'oklch(.32 .06 255 / .38)',
	surface2: 'oklch(.4 .07 255 / .32)',
	border: 'oklch(.75 .08 255 / .16)',
	borderStrong: 'oklch(.8 .1 255 / .3)',
	text: 'oklch(.96 .02 250)',
	muted: 'oklch(.72 .05 255 / .85)',
	ok: 'oklch(.75 .16 155)',
	okSoft: 'oklch(.75 .16 155 / .16)',
	warn: 'oklch(.8 .15 85)',
	warnSoft: 'oklch(.8 .15 85 / .16)',
	danger: 'oklch(.7 .19 20)',
	dangerSoft: 'oklch(.7 .19 20 / .16)',
	folder: 'oklch(.82 .13 85)',
	radius: 'var(--radius-lg, 14px)',
	gap: 'var(--spacing, .25rem)'
} as const

export function getFileBrowserDensityAttributes(density: FileBrowserDensity = 'comfortable'): {
	'data-fb-density': FileBrowserDensity
} {
	return { 'data-fb-density': density }
}
