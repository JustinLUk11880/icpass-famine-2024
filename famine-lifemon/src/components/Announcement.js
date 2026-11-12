import React, { useEffect, useRef, useState } from 'react';
import { Alert, AlertTitle } from '@mui/material';
import { doc } from 'firebase/firestore';
import { useDocumentData } from 'react-firebase-hooks/firestore';

import { db } from '../database/firebase';

const DISMISS_KEY = 'dismissedAnnouncementAt';

const readDismissed = () => {
	try {
		return Number(window.localStorage.getItem(DISMISS_KEY)) || 0;
	} catch (e) {
		return 0;
	}
};

// Event-wide notices pushed from the helper page, e.g. "the robbery has
// started". Every phone shows the latest one until it is dismissed there.
export default function Announcement() {
	const [data] = useDocumentData(doc(db, 'announcements', 'current'));
	const [dismissedAt, setDismissedAt] = useState(readDismissed);
	const lastSeen = useRef(0);

	const at = Number(data?.at) || 0;
	const visible = !!data?.message && at > dismissedAt;

	// Buzz once for each new announcement, where the phone supports it.
	useEffect(() => {
		if (visible && at !== lastSeen.current) {
			lastSeen.current = at;
			try {
				if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
			} catch (e) {
				// vibration is a nicety
			}
		}
	}, [visible, at]);

	if (!visible) return null;

	const dismiss = () => {
		setDismissedAt(at);
		try {
			window.localStorage.setItem(DISMISS_KEY, String(at));
		} catch (e) {
			// still dismissed for this session
		}
	};

	return (
		<Alert
			severity={data.kind === 'alert' ? 'error' : 'info'}
			variant="filled"
			onClose={dismiss}
			sx={{ fontSize: 15, alignItems: 'flex-start' }}
		>
			<AlertTitle sx={{ fontWeight: 800, mb: 0.25 }}>
				Announcement · {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
			</AlertTitle>
			{data.message}
		</Alert>
	);
}
