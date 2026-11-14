import React, { useEffect, useState } from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import {
	APPLE_MAX, EDU, EDUCATION_LABELS, MINUTE, cooldownLabel, cooldownMsFor,
} from '../game/catalog.js';

const theme = createTheme({ typography: { fontFamily: 'Karla, sans-serif' } });

function Row({ label, children }) {
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', py: 0.6, gap: 1.5 }}>
			<Typography sx={{ width: 92, flexShrink: 0, fontSize: 13, fontWeight: 500, color: '#111A2D' }}>
				{label}
			</Typography>
			<Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
		</Box>
	);
}

// Apples are capped at 8, so they read best as eight slots.
function Apples({ count }) {
	const n = Math.max(0, Math.min(APPLE_MAX, Math.floor(Number(count) || 0)));
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap' }}>
			{Array.from({ length: APPLE_MAX }, (_, i) => (
				<span key={i} style={{ fontSize: 18, opacity: i < n ? 1 : 0.18, filter: i < n ? 'none' : 'grayscale(1)' }}>
					🍎
				</span>
			))}
			<Typography component="span" sx={{ ml: 0.75, fontSize: 13, fontWeight: 700, color: '#111A2D' }}>
				{n}/{APPLE_MAX}
			</Typography>
		</Box>
	);
}

// Re-renders every 30s so a cooldown counts down on screen.
function useNow(intervalMs = 30000) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(id);
	}, [intervalMs]);
	return now;
}

export default function Stats({ snapshot, loading, groupId, marriage }) {
	const now = useNow();
	const g = snapshot || {};
	const value = (node) => (loading ? <Typography fontSize={14}>Loading...</Typography> : node);

	const edu = Math.max(EDU.NONE, Math.min(EDU.PHD, Math.floor(Number(g.education) || 0)));
	// "Play again in N min" for every station this group is cooling down on,
	// so a helper can check the passport before the group plays.
	const waits = Object.entries(g.cooldowns || {})
		.map(([key, at]) => ({ key, min: Math.ceil((cooldownMsFor(key) - (now - (Number(at) || 0))) / MINUTE) }))
		.filter((w) => w.min > 0)
		.sort((a, b) => a.min - b.min);

	const me = String(groupId ?? g.group ?? '');
	const partner = g.married && Array.isArray(marriage?.participants)
		? marriage.participants.map(String).find((p) => p !== me)
		: null;
	const myDeposits = Number(marriage?.deposits?.[me]) || 0;

	const chips = [];
	if (edu === EDU.PHD) chips.push({ label: '⚡ PhD: line priority at every minigame', color: 'warning' });
	if (g.gymMember) chips.push({ label: '🏋️ Gym member' });
	if (g.raffleTickets > 0) chips.push({ label: `🎟 ${g.raffleTickets} raffle ticket${g.raffleTickets === 1 ? '' : 's'}` });
	if (g.once?.teacher) chips.push({ label: '✓ Teacher pay received' });
	if (g.once?.artist) chips.push({ label: '✓ Concert performed' });
	if (g.married && myDeposits > 0) chips.push({ label: `🏦 You have put $${myDeposits.toLocaleString('en-US')} in the marriage pot` });
	waits.forEach((w) => chips.push({ label: `⏳ ${cooldownLabel(w.key)} again in ${w.min} min` }));

	return (
		<ThemeProvider theme={theme}>
			<Paper elevation={6} sx={{ background: 'linear-gradient(45deg, #FFE078 10%, #FFC14F 100%)', px: 2, py: 1.5 }}>
				<Typography sx={{ fontSize: 22, fontWeight: 800, color: '#111A2D', letterSpacing: 0.5, mb: 0.5 }}>
					GROUP {groupId ?? g.group ?? '?'}
				</Typography>
				<Row label="Money">
					{value(
						<Typography sx={{ fontSize: 20, fontWeight: 800, color: '#111A2D' }}>
							${Number(g.money || 0).toLocaleString('en-US')}
						</Typography>,
					)}
				</Row>
				<Row label="Apples">{value(<Apples count={g.food} />)}</Row>
				<Row label="Happiness">
					{value(
						<Typography sx={{ fontSize: 17, fontWeight: 700, color: '#111A2D' }}>
							😄 × {Math.max(0, Math.floor(Number(g.happiness) || 0))}
						</Typography>,
					)}
				</Row>
			</Paper>

			<Paper elevation={6} sx={{ background: 'linear-gradient(45deg, #4FB2AA 10%, #3F8F89 100%)', px: 2, py: 1.5, color: '#fff' }}>
				<Row label={<span style={{ color: '#fff', fontWeight: 300 }}>Qualification</span>}>
					{value(
						<Typography sx={{ fontSize: 15, fontWeight: 800, textTransform: 'uppercase', color: '#fff' }}>
							🎓 {EDUCATION_LABELS[edu]}
						</Typography>,
					)}
				</Row>
				<Row label={<span style={{ color: '#fff', fontWeight: 300 }}>Marital status</span>}>
					{value(
						<Typography sx={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
							{g.married ? `💍 MARRIED${partner ? ` TO GROUP ${partner}` : ' (waiting for partner to scan)'}` : 'SINGLE'}
						</Typography>,
					)}
				</Row>
				{!loading && chips.length > 0 && (
					<Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
						{chips.map((c) => (
							<Chip
								key={c.label}
								label={c.label}
								size="small"
								color={c.color || 'default'}
								sx={c.color ? { fontWeight: 700 } : { bgcolor: 'rgba(255,255,255,0.9)', fontWeight: 600 }}
							/>
						))}
					</Stack>
				)}
			</Paper>
		</ThemeProvider>
	);
}
