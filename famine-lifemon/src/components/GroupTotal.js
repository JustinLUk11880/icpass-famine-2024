import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { doc } from 'firebase/firestore';
import { useDocumentData } from 'react-firebase-hooks/firestore';

import { db } from '../database/firebase';
import { parentOf, teamsOf } from '../game/engine.js';

const n = (v) => Math.max(0, Math.floor(Number(v) || 0));

// The leaderboard counts a group as the sum of its teams, so each passport
// also shows the whole group's running total.
export default function GroupTotal({ teamId, mine }) {
  const group = parentOf(teamId);
  const sister = teamsOf(group).find((t) => t !== String(teamId));
  const [other] = useDocumentData(sister ? doc(db, 'groups', sister) : null);
  if (!mine) return null;
  const teams = [{ id: String(teamId), d: mine }, ...(sister ? [{ id: sister, d: other }] : [])];
  const sum = (k) => teams.reduce((s, t) => s + n(t.d?.[k]), 0);
  const cell = (label, value) => (
    <Box sx={{ textAlign: 'center', flex: 1 }}>
      <Typography fontSize={17} fontWeight={800} lineHeight={1.2}>{value}</Typography>
      <Typography fontSize={11} sx={{ opacity: 0.85 }}>{label}</Typography>
    </Box>
  );
  return (
    <Paper elevation={3} sx={{ px: 2, py: 1.25 }}>
      <Typography fontSize={12} fontWeight={700} sx={{ letterSpacing: 0.6, mb: 0.75 }}>
        GROUP {group} TOTAL · {teams.map((t) => (t.d ? `TEAM ${t.id}` : `TEAM ${t.id} (NOT JOINED)`)).join(' + ')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {cell('💰 Money', `$${sum('money').toLocaleString('en-US')}`)}
        {cell('😄 Happiness', `× ${sum('happiness')}`)}
        {cell('🍎 Apples', sum('food'))}
        {cell('💝 Charity', sum('charity'))}
      </Box>
    </Paper>
  );
}
