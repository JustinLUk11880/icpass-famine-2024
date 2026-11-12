import React, { useRef } from 'react';
import { QrReader } from '@blackbox-vision/react-qr-reader';
import { Alert } from '@mui/material';
import { verify } from 'jsonwebtoken';

import { db } from '../database/firebase';
import { secret } from './secret/Secret';
import { performScan, isRetryableError } from '../game/firestore.js';
import { reasonMessage, summaryText, validatePayload } from '../game/engine.js';

// The reader reports the same code about once a second for as long as it is
// in view, so a code just handled is ignored for a few seconds rather than
// being re-submitted (which would only say "already used").
const REPEAT_WINDOW_MS = 4000;

// Results are reported through `notify` because a successful scan closes
// the scanner, and a message rendered in here would vanish with it.
export default function Scanner({ setChecked, groupId, notify }) {
	const busy = useRef(false);
	const last = useRef({ text: null, at: 0 });
	const show = (severity, message) => notify(severity, message);

	const handleScan = async (result) => {
		if (!result || busy.current) return;
		const text = result.getText ? result.getText() : result.text;
		if (!text) return;
		const now = Date.now();
		if (text === last.current.text && now - last.current.at < REPEAT_WINDOW_MS) return;
		last.current = { text, at: now };

		busy.current = true;
		try {
			let payload;
			try {
				payload = verify(text, secret);
			} catch (e) {
				show('error', reasonMessage('invalid'));
				return;
			}
			const problem = validatePayload(payload);
			if (problem) {
				show('error', reasonMessage(problem));
				return;
			}
			const res = await performScan(db, groupId, payload);
			if (!res.ok) {
				show('warning', reasonMessage(res.reason, res.detail));
				return;
			}
			show('success', summaryText(res.summary));
			setChecked(false);
		} catch (e) {
			console.error('Scan failed', e);
			if (isRetryableError(e)) show('warning', reasonMessage('busy'));
			else if (e?.code === 'permission-denied') show('error', reasonMessage('internal'));
			else show('error', 'Could not reach the server - check your connection and scan again.');
		} finally {
			busy.current = false;
		}
	};

	// navigator.mediaDevices only exists in a secure context. https:// and
	// localhost qualify; a plain http:// LAN address does not, and the QR
	// library then silently does nothing.
	const cameraAvailable = typeof navigator !== 'undefined' && !!navigator.mediaDevices;

	if (!cameraAvailable) {
		return (
			<Alert severity="error" sx={{ width: '100%' }}>
				Camera unavailable. The scanner needs a secure connection - open the
				https:// address of the site rather than an http:// LAN address.
			</Alert>
		);
	}

	return (
		<QrReader
			scanDelay={500}
			constraints={{ facingMode: 'environment' }}
			onResult={handleScan}
			style={{ width: '100%' }}
		/>
	);
}
