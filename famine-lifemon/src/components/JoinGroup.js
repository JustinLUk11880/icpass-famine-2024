import React, { useState } from 'react';
import { Alert, Button, Paper, TextField, MenuItem, Typography } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import Grid from '@mui/material/Grid';

import { doc } from 'firebase/firestore';
import { useDocumentData } from 'react-firebase-hooks/firestore';

import { db } from '../database/firebase';
import { isValidGroupId } from '../game/engine.js';
import { clampGroupCount, joinGroup } from '../game/firestore.js';

const theme = createTheme({ typography: { fontFamily: 'Ubuntu' } });

export default function JoinGroup({ setGroup }) {
  // How many groups to offer is set on the helper page (default 10).
  const [config] = useDocumentData(doc(db, 'config', 'game'));
  const count = clampGroupCount(config?.groupCount);
  const GROUPS = Array.from({ length: count }, (_, i) => i + 1);
  const [choice, setChoice] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (joining) return;
    const id = String(choice);
    if (!isValidGroupId(id)) {
      setError('Please choose a group.');
      return;
    }
    setJoining(true);
    setError(null);
    try {
      // The first person in a group rolls its random starting profile; everyone
      // after joins the same account. Safe if several phones join at once.
      const res = await joinGroup(db, id);
      if (!res.ok) throw new Error(res.reason);
      // This screen unmounts as soon as the group is set, so no state may be
      // touched after this line.
      setGroup(id);
    } catch (err) {
      console.error('Could not join group', err);
      setError('Could not join. Check your connection and try again.');
      setJoining(false);
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <Paper elevation={0}>
        <form onSubmit={handleSubmit}>
          <Grid container spacing={2} direction="column" justifyContent="center" alignItems="center">
            <Grid item xs={8}>
              <Typography variant="body2" sx={{ maxWidth: '20em', textAlign: 'center' }}>
                Choose your group. Everyone in the group shares one passport, so
                every scan counts for the whole group.
              </Typography>
            </Grid>
            <Grid item xs={8}>
              <TextField
                required
                id="group-select"
                value={choice}
                label="Group"
                onChange={(e) => setChoice(e.target.value)}
                sx={{ width: '20em', maxWidth: '100%' }}
                select
                fullWidth
                margin="dense"
              >
                {GROUPS.map((i) => (
                  <MenuItem key={i} value={i}>Group {i}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={8}>
              <Button variant="contained" type="submit" sx={{ width: '20em', maxWidth: '100%' }} disabled={joining}>
                {joining ? 'Joining...' : 'Join'}
              </Button>
            </Grid>
            {error && (
              <Grid item xs={8}>
                <Alert severity="error" sx={{ width: '20em', maxWidth: '100%' }}>{error}</Alert>
              </Grid>
            )}
          </Grid>
        </form>
      </Paper>
    </ThemeProvider>
  );
}
