import * as React from 'react';
import ReactDOM from 'react-dom';

import '@fontsource/roboto/400.css';

import './index.css';
import App from './components/App';
import ErrorBoundary from './components/ErrorBoundary';

const rootEl = document.getElementById('root');

// Last-resort UI for an error thrown before React ever mounts. This must never
// run against an app that is already on screen - see the note below.
function mountErrorUI(initialError) {
	try {
		ReactDOM.render(
			<ErrorBoundary initialError={initialError}>
				<div />
			</ErrorBoundary>,
			rootEl
		);
	} catch (e) {
		if (rootEl) {
			rootEl.innerHTML =
				'<div style="padding:20px;font-family:sans-serif">' +
				'<h1>Something went wrong</h1><p>An unexpected error occurred.</p></div>';
		}
	}
}

// These handlers LOG ONLY. They used to call mountErrorUI, which replaced the
// whole running app: closing the QR scanner fires a resource `error` event on
// the torn-down <video> element, and that event carries neither .error nor
// .message, so ErrorBoundary rendered with hasError=false - an empty <div>,
// i.e. a blank page that only a reload cleared. Runtime errors inside React
// are already handled by the ErrorBoundary wrapping <App />.
if (typeof window !== 'undefined') {
	window.addEventListener('error', (event) => {
		console.error('Global error caught', event.error || event.message, event);
	});

	window.addEventListener('unhandledrejection', (event) => {
		console.error('Unhandled promise rejection', event.reason, event);
	});
}

try {
	ReactDOM.render(
		<ErrorBoundary>
			<App />
		</ErrorBoundary>,
		rootEl
	);
} catch (e) {
	// A throw during the very first render, before ErrorBoundary can catch it.
	mountErrorUI(e);
}
