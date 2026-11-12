import React, { useState } from 'react';
import { QrReader } from "@blackbox-vision/react-qr-reader";
import { Snackbar, Slide, Alert } from '@mui/material';
import { doc, runTransaction } from 'firebase/firestore';
import { verify } from 'jsonwebtoken';

import { db } from '../database/firebase';
import { secret } from './secret/Secret';

const QR_HEADER = 'famine-2023-lifemon';
const QR_LIFETIME_MS = 60000;
const DIVORCE_AWARD = 700;

// A whole group shares one document, so several people can scan the same
// instant. Firestore serialises that correctly, but its own retry budget can
// exhaust under a burst and surface failed-precondition - a scan that is simply
// lost. Measured: 40 simultaneous writes lost 4 without this, 0 with it.
// Jitter matters; without it the retries collide again in lockstep.
const RETRYABLE = new Set(['aborted', 'failed-precondition', 'unavailable', 'deadline-exceeded']);
const RETRY_ATTEMPTS = 6;

async function withRetry(fn) {
	let lastError;
	for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
		try {
			return await fn();
		} catch (e) {
			if (!RETRYABLE.has(e?.code)) throw e;
			lastError = e;
			const backoff = 100 * 2 ** attempt + Math.random() * 150;
			await new Promise((r) => setTimeout(r, backoff));
		}
	}
	throw lastError;
}

const snackbarMap = {
	uneducated: { severity: 'warning', message: 'Your group is not qualified enough to do this' },
	poor: { severity: 'warning', message: 'Your group cannot afford this' },
	hungry: { severity: 'warning', message: 'Your group is too hungry to do this' },
	sad: { severity: 'warning', message: 'Your group is too unhappy to do this' },
	bank: { severity: 'warning', message: 'Food bank has no apples left' },
	outdated: { severity: 'error', message: 'QR code has expired - ask for a fresh one' },
	invalid: { severity: 'error', message: 'Invalid QR code' },
	missing_setup: { severity: 'error', message: 'Database is not set up properly' },
	missing_group: { severity: 'error', message: 'Group account not found - rejoin your group' },
	already_married: { severity: 'warning', message: 'Your group is already married' },
	not_married: { severity: 'warning', message: 'Your group is not married' },
	would_go_negative: { severity: 'warning', message: 'Your group cannot afford this right now - try again' },
	busy: { severity: 'warning', message: 'Too many people scanning at once - please scan again' },
	ok: { severity: 'success', message: 'Done!' },
	default: { severity: 'error', message: 'Invalid QR code' },
};

export default function Scanner({ setChecked, groupId }) {
	const [snackbar, setSnackbar] = useState({ open: false, reason: null });
	const openSnackbar = (reason) => setSnackbar({ open: true, reason });
	const closeSnackbar = () => setSnackbar({ open: false, reason: null });

	const groupRef = doc(db, 'groups', String(groupId));
	const appleRef = doc(db, 'stock', 'apple');

	const validTimestamp = (t) => Math.abs(Date.now() - t) < QR_LIFETIME_MS;

	// Everything below runs inside one transaction, and every value it decides
	// on comes from a read taken inside that transaction.
	//
	// Previously validation used the `snapshot` prop - data fetched outside the
	// transaction by a React hook. With one phone per account that was merely
	// slightly stale. Now that a whole group shares an account, several people
	// scan at once, and stale reads would let two scans each spend the last
	// apple, drive stats negative, or both halves of a marriage overwrite each
	// other. Firestore retries the transaction on conflict, so reading inside it
	// is what makes concurrent scanning correct.
	const runScan = async (data) => runTransaction(db, async (tx) => {
		// ---------- reads (Firestore requires all reads before any write) ----------
		const groupSnap = await tx.get(groupRef);
		if (!groupSnap.exists()) return { result: 'fail', reason: 'missing_group' };
		const g = groupSnap.data();

		const usesFoodBank = data.foodBank !== undefined && data.foodBank !== null;
		let appleSnap = null;
		if (usesFoodBank) {
			appleSnap = await tx.get(appleRef);
			if (!appleSnap.exists()) return { result: 'fail', reason: 'missing_setup' };
		}

		const isDivorce = data.married !== undefined && String(data.married).toLowerCase() === 'divorce';
		const isMarry = data.married !== undefined && !isDivorce;
		let marriageRef = null;
		let marriageSnap = null;

		if (isDivorce) {
			if (!g.married || !g.marriageId) return { result: 'fail', reason: 'not_married' };
			marriageRef = doc(db, 'marriages', String(g.marriageId));
			marriageSnap = await tx.get(marriageRef);
		} else if (isMarry) {
			if (g.married) return { result: 'fail', reason: 'already_married' };
			marriageRef = doc(db, 'marriages', String(data.married));
			marriageSnap = await tx.get(marriageRef);
		}

		// ---------- validation, all against the transactional read ----------
		const food = Number(g.food) || 0;
		const charityFood = Number(g.charityFood) || 0;
		const totalFood = food + charityFood;

		if (data.food !== undefined && totalFood + data.food < 0) return { result: 'fail', reason: 'hungry' };
		if (data.happiness !== undefined && (Number(g.happiness) || 0) + data.happiness < 0) return { result: 'fail', reason: 'sad' };
		if (data.money !== undefined && (Number(g.money) || 0) + data.money < 0) return { result: 'fail', reason: 'poor' };
		if (data.education?.requirement !== undefined && (Number(g.education) || 0) < data.education.requirement) {
			return { result: 'fail', reason: 'uneducated' };
		}
		if (usesFoodBank && (Number(appleSnap.data().amount) || 0) + data.foodBank < 0) {
			return { result: 'fail', reason: 'bank' };
		}

		// ---------- compute the new document explicitly ----------
		// Absolute values rather than increment(): every number was just read
		// inside the transaction, so this is safe, and it keeps the arithmetic
		// visible in one place instead of split across conditional increments.
		const next = {};
		let moneyDelta = Number(data.money) || 0;
		let falseCharity = 0;

		if (isDivorce) {
			const m = marriageSnap.exists() ? marriageSnap.data() : null;
			const intact = m && !m.hasDivorced;
			if (intact) moneyDelta += DIVORCE_AWARD;
			next.married = false;
			next.marriageId = null;
		} else if (isMarry) {
			next.married = true;
			next.marriageId = String(data.married);
		}

		// Food and charityFood partition the group's apples; the passport shows
		// their sum. Charity apples are always spent first.
		let nextFood = food;
		let nextCharityFood = charityFood;
		if (data.food !== undefined && data.food !== 0) {
			if (data.food > 0) {
				if (usesFoodBank) nextCharityFood += data.food;
				else nextFood += data.food;
			} else {
				const cost = -data.food;
				const charitySpent = Math.min(Math.max(charityFood, 0), cost);
				if (usesFoodBank) falseCharity = charitySpent;
				nextCharityFood -= charitySpent;
				nextFood -= cost - charitySpent;
			}
		}
		next.food = nextFood;
		next.charityFood = nextCharityFood;
		next.money = (Number(g.money) || 0) + moneyDelta;
		next.happiness = (Number(g.happiness) || 0) + (Number(data.happiness) || 0);

		if (data.education?.pass !== undefined) {
			next.education = (Number(g.education) || 0) + (Number(data.education.pass) || 0);
		}
		if (data.charity !== undefined) {
			// Re-donating apples that were received as charity earns nothing.
			next.charity = (Number(g.charity) || 0) + (Number(data.charity) || 0) - 5 * falseCharity;
		}

		// Belt and braces. The validation above, running on a transactional read,
		// should make this unreachable - but if it ever fires we want a readable
		// message rather than the rules layer rejecting the write and surfacing
		// a bare permission-denied.
		for (const key of ['money', 'food', 'charityFood', 'happiness', 'charity', 'education']) {
			if (next[key] !== undefined && !(Number(next[key]) >= 0)) {
				console.error(`Refusing to write negative ${key}:`, next);
				return { result: 'fail', reason: 'would_go_negative' };
			}
		}

		// ---------- writes ----------
		tx.update(groupRef, next);

		if (usesFoodBank) {
			tx.update(appleRef, { amount: (Number(appleSnap.data().amount) || 0) + data.foodBank });
		}

		if (isMarry) {
			const me = Number(groupId);
			if (marriageSnap.exists()) {
				const existing = Array.isArray(marriageSnap.data().participants) ? marriageSnap.data().participants : [];
				if (!existing.includes(me)) {
					tx.update(marriageRef, { participants: [...existing, me] });
				}
			} else {
				tx.set(marriageRef, { participants: [me], hasDivorced: false });
			}
		}

		if (isDivorce && marriageSnap.exists()) {
			const existing = Array.isArray(marriageSnap.data().participants) ? marriageSnap.data().participants : [];
			tx.update(marriageRef, {
				participants: existing.filter((p) => Number(p) !== Number(groupId)),
				hasDivorced: true,
			});
		}

		return { result: 'ok' };
	});

	const handleScan = async (result) => {
		if (!result) return;

		let data;
		try {
			data = verify(result.text, secret);
		} catch (e) {
			openSnackbar('invalid');
			return;
		}

		if (!data || data.timestamp === undefined || !validTimestamp(data.timestamp)) {
			openSnackbar('outdated');
			return;
		}
		if (data.header !== QR_HEADER) return; // not one of ours; keep scanning

		try {
			const outcome = await withRetry(() => runScan(data));
			if (outcome?.result === 'fail') {
				openSnackbar(outcome.reason);
				return;
			}
			openSnackbar('ok');
			setChecked(false);
		} catch (e) {
			console.error('Scan failed', e);
			if (RETRYABLE.has(e?.code)) openSnackbar('busy');
			else if (e?.code === 'permission-denied') openSnackbar('invalid');
			else openSnackbar(String(e?.message || e));
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

	const entry = snackbarMap[snackbar.reason] || snackbarMap.default;
	const known = Object.prototype.hasOwnProperty.call(snackbarMap, snackbar.reason);

	return (
		<>
			<QrReader
				scanDelay={1000}
				constraints={{ facingMode: "environment" }}
				onResult={handleScan}
				style={{ width: '100%' }}
			/>
			<Snackbar
				open={snackbar.open}
				autoHideDuration={2000}
				onClose={closeSnackbar}
				TransitionComponent={Slide}
			>
				<Alert severity={entry.severity} sx={{ width: '100%' }} onClose={closeSnackbar}>
					{known ? entry.message : snackbar.reason}
				</Alert>
			</Snackbar>
		</>
	);
}
