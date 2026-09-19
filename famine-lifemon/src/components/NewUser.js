import React, { useState } from 'react';
import { Alert, Button, Paper, TextField, MenuItem } from '@mui/material';
import { ThemeProvider,createTheme } from '@mui/material/styles';
import Grid from '@mui/material/Grid';
import { setDoc, doc } from 'firebase/firestore';

import { db, auth } from '../database/firebase';

export default function NewUser(props) {
  const theme_3 = createTheme({
    typography: {
      fontFamily:'Ubuntu'
    }
  });
  const [name, setName] = useState("");
  
  const characters ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  function generateString(length) {
      // Must not start with a space: the id goes into the recovery link as
      // ?id=..., and a leading space is easily mangled in transit.
      let result = '';
      const charactersLength = characters.length;
      for ( let i = 0; i < length; i++ ) {
          result += characters.charAt(Math.floor(Math.random() * charactersLength));
      }

      return result;
  }

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return; // a double tap must not create two accounts
    const id = generateString(20);

    /* Randomize Stats*/
    const educations = [
      {education: 0, pct: 12}, // Primary    60%
      {education: 1, pct: 7},  // Secondary  30%
      {education: 2, pct: 1},  // University 5%
      {education: 3, pct: 0}   // Graduate   0%
    ];

    const moneyList = [
      {money: 100, pct: 14},
      {money: 200, pct: 5},
      {money: 500, pct: 1},
    ];

    const foods = [
      {food: 2, pct: 7},
      {food: 6, pct: 10},
      {food: 10, pct: 3},
    ];
    
    function handleRandom(table) {
      const expanded = table.flatMap(entry => Array(entry.pct).fill(entry));
      return expanded[Math.floor(Math.random() * expanded.length)];
    }
  

    const payload = {
      // Ties the doc to this browser's anonymous uid so nobody else can edit it.
      owner: auth.currentUser.uid,
      name: name,
      group: group,
      charityFood: 0,
      food: handleRandom(foods).food,
      happiness: 5,
      money: handleRandom(moneyList).money,
      education: handleRandom(educations).education,
      charity: 0,
      married: false,
    };

    // This used to be fire-and-forget: setId ran even when the write failed,
    // leaving the participant pointed at a document that does not exist.
    setSubmitting(true);
    setSubmitError(null);
    try {
      await setDoc(doc(db, "users", id), payload);
      props.setId(id);
    } catch (err) {
      console.error('Could not create account', err);
      setSubmitError('Could not create your passport. Check the connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const [group, setGroup] = useState('');

  return (
    <>	
    <ThemeProvider theme = {theme_3}>
      <Paper elevation={0}>
        <form onSubmit={handleSubmit}>
          <Grid container spacing={2} direction="column" justifyContent="center" alignItems="center">
            <Grid item xs={8}>
              <TextField 
                required
                id="name-textfield"
                variant="outlined"
                sx={{width: '20em'}}
                size="large"
                label="Name"
                onChange={e => setName(e.target.value)}
                fullWidth
                margin="dense"
              />
            </Grid>
            <Grid item xs={8}>
              <TextField
                required
                id="group-select"
                size='large'
                value={group}
                label="Group"
                onChange={e => { setGroup(e.target.value) }}
                sx={{width: '20em'}}
                select
                fullWidth
                margin='dense'
              >
                {
                  Array.from({length: 10}, (_, i) => i + 1).map((i) => 
                    <MenuItem key={i} value={i}>Group {i}</MenuItem>
                  )
                }
              </TextField>
            </Grid>
            <Grid item xs={8}>
              <Button
                variant="contained"
                type="submit"
                sx={{width: '20em'}}
                disabled={submitting}
              >
                {submitting ? 'Creating...' : 'Submit'}
              </Button>
              {submitError && (
                <Alert severity="error" sx={{ mt: 2, width: '20em' }}>{submitError}</Alert>
              )}
            </Grid>
          </Grid>
        </form>
      </Paper>
    </ThemeProvider>
    </>
  );
}