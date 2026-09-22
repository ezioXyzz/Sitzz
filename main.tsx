import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './root'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
	throw new Error('Demo root element was not found')
}

createRoot(root).render(
	<StrictMode>
		<Root />
	</StrictMode>
)
