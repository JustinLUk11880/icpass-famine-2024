import React, { useState } from 'react';
import {
  Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { doc } from 'firebase/firestore';
import { useDocumentData } from 'react-firebase-hooks/firestore';

import { db } from '../database/firebase';
import { canVoteFor, parentOf, teamsOf } from '../game/engine.js';
import { castVote, clampGroupCount } from '../game/firestore.js';

// The Final Will: while the helper has voting open, every team votes for the
// team it thinks deserves $1000 most - never itself and never its sister
// team. Anyone in the team can cast or change the team's single vote until
// voting closes.
export default function FinalWillVote({ groupId }) {
  const team = String(groupId);
  const [voting] = useDocumentData(doc(db, 'voting', 'finalWill'));
  const [myVote] = useDocumentData(doc(db, 'votes', team));
  const [config] = useDocumentData(doc(db, 'config', 'game'));
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const status = voting?.status;
  if (status !== 'open' && status !== 'closed' && status !== 'done') return null;

  const box = (children, color = '#7B4FB2') => (
    <Paper elevation={6} sx={{ px: 2, py: 1.5, background: `linear-gradient(45deg, ${color} 10%, #9C6FD6 100%)`, color: '#fff' }}>
      <Typography sx={{ fontSize: 18, fontWeight: 800, mb: 0.5 }}>🗳 The Final Will</Typography>
      {children}
    </Paper>
  );

  if (status === 'done') {
    const won = String(voting.winner) === team;
    return box(won ? (
      <Typography fontWeight={700}>
        🎉 Your team won $1000! Go to <strong>{voting.room || 'the helper'}</strong> and scan the QR there to collect it.
      </Typography>
    ) : (
      <Typography>The Final Will went to Team {voting.winner}.</Typography>
    ));
  }

  if (status === 'closed') {
    return box(<Typography>Voting has closed - the winner will be announced soon.</Typography>);
  }

  const count = clampGroupCount(config?.groupCount);
  const options = Array.from({ length: count }, (_, i) => teamsOf(i + 1)).flat().filter((t) => canVoteFor(team, t));
  const current = myVote?.for;

  const vote = async () => {
    setBusy(true);
    setError(null);
    try {
      await castVote(db, team, choice);
      setChoice('');
    } catch (e) {
      console.error('Vote failed', e);
      setError(e?.code === 'permission-denied' ? 'Voting has closed.' : 'Could not vote - check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return box(
    <Stack spacing={1.25}>
      <Typography fontSize={14}>
        Vote for the team you think deserves the $1000 most. You cannot vote for your own team or your
        sister team (Group {parentOf(team)}). One vote per team - anyone in your team can change it until voting closes.
      </Typography>
      {current != null && (
        <Typography fontWeight={800}>Your team is voting for Team {current}.</Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, bgcolor: '#fff', borderRadius: 1, p: 1 }}>
        <TextField
          select
          size="small"
          fullWidth
          label={current != null ? 'Change vote to' : 'Vote for'}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          {options.map((t) => <MenuItem key={t} value={t}>Team {t}</MenuItem>)}
        </TextField>
        <Button variant="contained" disabled={!choice || busy} onClick={vote}>
          {busy ? '...' : 'Vote'}
        </Button>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>,
  );
}
