import React, { useState } from 'react';
import { Alert, Button, Paper, TextField, MenuItem, Typography } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import Grid from '@mui/material/Grid';
import { doc, runTransaction } from 'firebase/firestore';

import { db } from '../database/firebase';
import { GROUPS, STARTING_STATS, isValidGroup } from '../constants';

const theme = createTheme({ typography: { fontFamily: 'Ubuntu' } });

export default function JoinGroup({ setGroup }) {
  const [choice, setChoice] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (joining) return;
    if (!isValidGroup(choice)) {
      setError('Please choose a group.');
      return;
    }

    setJoining(true);
    setError(null);
    const id = String(Number(choice));

    try {
      // The group account is shared, so the first person to join creates it and
      // everyone after simply attaches. A transaction makes that race safe: two
      // phones joining at the same instant cannot both create it, and neither
      // can reset stats that the other has already earned.
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'groups', id);
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          tx.set(ref, { ...STARTING_STATS, group: Number(id) });
        }
      });
      setGroup(id);
    } catch (err) {
      console.error('Could not join group', err);
      setError('Could not join. Check your connection and try again.');
    } finally {
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
                every scan adds to the same score.
              </Typography>
            </Grid>
            <Grid item xs={8}>
              <TextField
                required
                id="group-select"
                size="large"
                value={choice}
                label="Group"
                onChange={(e) => setChoice(e.target.value)}
                sx={{ width: '20em' }}
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
              <Button variant="contained" type="submit" sx={{ width: '20em' }} disabled={joining}>
                {joining ? 'Joining...' : 'Join'}
              </Button>
            </Grid>
            {error && (
              <Grid item xs={8}>
                <Alert severity="error" sx={{ width: '20em' }}>{error}</Alert>
              </Grid>
            )}
          </Grid>
        </form>
      </Paper>
    </ThemeProvider>
  );
}
