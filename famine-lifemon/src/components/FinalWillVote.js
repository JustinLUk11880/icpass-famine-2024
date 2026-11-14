import React, { useState } from 'react';
import {
  Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { doc } from 'firebase/firestore';
import { useDocumentData } from 'react-firebase-hooks/firestore';

import { db } from '../database/firebase';
import { parentOf } from '../game/engine.js';
import { castVote, clampGroupCount } from '../game/firestore.js';

// The Final Will: while the helper has voting open, every group votes for
// the team that deserves $1000 most (not itself). Anyone in the group can
// cast or change the group's single vote until voting closes.
// Votes are per whole group: either team of a group casts the group's vote.
export default function FinalWillVote({ groupId }) {
  const gid = String(parentOf(groupId));
  const [voting] = useDocumentData(doc(db, 'voting', 'finalWill'));
  const [myVote] = useDocumentData(doc(db, 'votes', gid));
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
    const won = String(voting.winner) === gid;
    return box(won ? (
      <Typography fontWeight={700}>
        🎉 Your group won $1000! Send someone from either team to <strong>{voting.room || 'the helper'}</strong> to scan the QR there.
        The $1000 goes to the team that scans, and counts for the whole group.
      </Typography>
    ) : (
      <Typography>The Final Will went to Group {voting.winner}.</Typography>
    ));
  }

  if (status === 'closed') {
    return box(<Typography>Voting has closed - the winner will be announced soon.</Typography>);
  }

  const count = clampGroupCount(config?.groupCount);
  const others = Array.from({ length: count }, (_, i) => i + 1).filter((n) => String(n) !== gid);
  const current = myVote?.for;

  const vote = async () => {
    setBusy(true);
    setError(null);
    try {
      await castVote(db, gid, Number(choice));
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
        Vote for the group you think deserves the $1000 most. You cannot vote for your own group.
        One vote per group - anyone in your group (either team) can change it until voting closes.
      </Typography>
      {current != null && (
        <Typography fontWeight={800}>Your group is voting for Group {current}.</Typography>
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
          {others.map((n) => <MenuItem key={n} value={n}>Group {n}</MenuItem>)}
        </TextField>
        <Button variant="contained" disabled={!choice || busy} onClick={vote}>
          {busy ? '...' : 'Vote'}
        </Button>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>,
  );
}
