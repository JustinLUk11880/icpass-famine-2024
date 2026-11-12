import React, { useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { useCollection } from 'react-firebase-hooks/firestore';

import { db } from '../../database/firebase';
import { EDUCATION_LABELS, LIMITS, MAX_GROUPS, getStation } from '../../game/catalog.js';
import { GLOBAL_EVENTS, isValidGroupId, reasonMessage, summaryText } from '../../game/engine.js';
import { createGroups, performAdjust, resetGame } from '../../game/firestore.js';

const H = ({ children }) => (
  <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>{children}</Typography>
);

function optionText(station, inputs) {
  if (!station || !inputs) return '';
  return station.fields
    .map((f) => {
      const v = inputs[f.key];
      if (f.type === 'select') return f.options.find((o) => o.value === v)?.label;
      if (f.type === 'number') return `${f.label}: ${v}`;
      return v ? f.label : null;
    })
    .filter(Boolean)
    .join(', ');
}

function activityLine(r) {
  const who = `Group ${r.groupId}`;
  const what = summaryText(r.summary || {});
  if (r.kind === 'event') return `${who} · ${GLOBAL_EVENTS[r.eventId]?.label || r.eventId} · ${what}`;
  if (r.kind === 'adjust') return `${who} · Manual${r.note ? `: ${r.note}` : ''} · ${what}`;
  const station = getStation(r.stationId);
  const opt = optionText(station, r.inputs);
  return `${who} · ${station?.label || r.stationId}${opt ? ` (${opt})` : ''} · ${what}`;
}

function Adjust({ groupIds }) {
  const [gid, setGid] = useState('');
  const [d, setD] = useState({ money: '', food: '', happiness: '', education: '' });
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));

  const apply = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await performAdjust(db, gid, {
        money: Number(d.money) || 0,
        food: Number(d.food) || 0,
        happiness: Number(d.happiness) || 0,
        education: d.education === '' ? null : Number(d.education),
      }, note);
      if (!res.ok) setMsg({ severity: 'error', text: reasonMessage(res.reason) });
      else {
        setMsg({ severity: 'success', text: `Group ${gid}: ${summaryText(res.summary)}` });
        setD({ money: '', food: '', happiness: '', education: '' });
        setNote('');
      }
    } catch (e) {
      setMsg({ severity: 'error', text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  const nothing = !d.money && !d.food && !d.happiness && d.education === '';
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography fontWeight={800} sx={{ mb: 0.5 }}>Fix a mistake / award a prize</Typography>
      <Typography fontSize={13} color="text.secondary" sx={{ mb: 1.5 }}>
        Adds or removes from a group directly. Nothing goes below 0 and apples stay within 8.
      </Typography>
      <Stack spacing={1.5}>
        <TextField select size="small" label="Group" value={gid} onChange={(e) => setGid(e.target.value)}>
          {groupIds.map((g) => <MenuItem key={g} value={g}>Group {g}</MenuItem>)}
        </TextField>
        <Stack direction="row" spacing={1}>
          <TextField size="small" type="number" label="± $" value={d.money} onChange={set('money')} />
          <TextField size="small" type="number" label="± 🍎" value={d.food} onChange={set('food')} />
          <TextField size="small" type="number" label="± 😄" value={d.happiness} onChange={set('happiness')} />
        </Stack>
        <TextField select size="small" label="Set degree (optional)" value={d.education} onChange={set('education')}>
          <MenuItem value="">No change</MenuItem>
          {EDUCATION_LABELS.map((l, i) => <MenuItem key={l} value={String(i)}>{l}</MenuItem>)}
        </TextField>
        <TextField size="small" label="Reason (shown in the activity log)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="contained" disabled={!gid || nothing || busy} onClick={apply}>
          {busy ? 'Applying...' : 'Apply'}
        </Button>
        {msg && <Alert severity={msg.severity}>{msg.text}</Alert>}
      </Stack>
    </Paper>
  );
}

function Raffle({ groups }) {
  const [winners, setWinners] = useState(null);
  const entries = groups.filter((g) => g.raffleTickets > 0);
  const total = entries.reduce((s, g) => s + g.raffleTickets, 0);

  // Weighted by tickets; the second prize excludes the first winner.
  const draw = () => {
    const pickFrom = (pool) => {
      const sum = pool.reduce((s, g) => s + g.raffleTickets, 0);
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      let n = buf[0] % sum;
      for (const g of pool) {
        if (n < g.raffleTickets) return g;
        n -= g.raffleTickets;
      }
      return pool[pool.length - 1];
    };
    const first = pickFrom(entries);
    const rest = entries.filter((g) => g.id !== first.id);
    setWinners({ first: first.id, second: rest.length ? pickFrom(rest).id : null });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography fontWeight={800} sx={{ mb: 0.5 }}>Raffle - {total} ticket{total === 1 ? '' : 's'}</Typography>
      <Typography fontSize={13} color="text.secondary" sx={{ mb: 1 }}>Helpers only: groups never see each other's tickets.</Typography>
      {entries.length === 0 ? (
        <Typography fontSize={14}>No tickets sold yet.</Typography>
      ) : (
        <>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
            {entries.sort((a, b) => a.id - b.id).map((g) => (
              <Chip key={g.id} label={`Group ${g.id}: ${g.raffleTickets} (${Math.round((100 * g.raffleTickets) / total)}%)`} />
            ))}
          </Stack>
          <Button variant="outlined" onClick={draw}>Draw 1st and 2nd prize</Button>
          {winners && (
            <Alert severity="success" sx={{ mt: 1.5 }}>
              🥇 Group {winners.first}{winners.second ? `  ·  🥈 Group ${winners.second}` : ''}. Award prizes with "Fix a mistake / award a prize".
            </Alert>
          )}
        </>
      )}
    </Paper>
  );
}

function Reset() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      const n = await resetGame(db);
      setDone(`Reset complete - ${n} records deleted. Every phone returns to the join screen.`);
      setOpen(false);
      setTyped('');
    } catch (e) {
      setDone(`Reset failed: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: 'error.light' }}>
      <Typography fontWeight={800} color="error" sx={{ mb: 0.5 }}>Reset the whole game</Typography>
      <Typography fontSize={13} color="text.secondary" sx={{ mb: 1.5 }}>
        Deletes every group, scan, marriage, limit and announcement. Use before the event starts.
      </Typography>
      <Button color="error" variant="outlined" onClick={() => setOpen(true)}>Reset game...</Button>
      {done && <Alert severity="info" sx={{ mt: 1.5 }}>{done}</Alert>}
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth>
        <DialogTitle>Reset the whole game?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>This cannot be undone. All groups lose everything.</Typography>
          <TextField autoFocus fullWidth label="Type RESET to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" disabled={typed.trim() !== 'RESET' || busy} onClick={run}>
            {busy ? 'Resetting...' : 'Reset everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function CreateGroups() {
  const [count, setCount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      const n = await createGroups(db, Number(count));
      setMsg(`${n} new group${n === 1 ? '' : 's'} created with random starting profiles. Existing groups were left alone.`);
    } catch (e) {
      setMsg(`Failed: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography fontWeight={800} sx={{ mb: 0.5 }}>Create groups in advance</Typography>
      <Typography fontSize={13} color="text.secondary" sx={{ mb: 1.5 }}>
        Optional. Rolls each group's random profile now so you can see it before anyone joins.
        Otherwise a group is created when its first member joins.
      </Typography>
      <Stack direction="row" spacing={1}>
        <TextField size="small" type="number" label="How many groups" value={count} onChange={(e) => setCount(e.target.value)} inputProps={{ min: 1, max: MAX_GROUPS }} sx={{ width: 160 }} />
        <Button variant="outlined" disabled={busy || !(Number(count) >= 1)} onClick={run}>{busy ? 'Creating...' : 'Create'}</Button>
      </Stack>
      {msg && <Alert severity="info" sx={{ mt: 1.5 }}>{msg}</Alert>}
    </Paper>
  );
}

export default function GroupsPanel() {
  const [groupsSnap] = useCollection(collection(db, 'groups'));
  const [limitsSnap] = useCollection(collection(db, 'limits'));
  const [logSnap] = useCollection(query(collection(db, 'redemptions'), orderBy('at', 'desc'), limit(40)));

  const groups = (groupsSnap?.docs || [])
    .filter((d) => isValidGroupId(d.id))
    .map((d) => ({ id: Number(d.id), ...d.data(), raffleTickets: Number(d.data().raffleTickets) || 0 }))
    .sort((a, b) => a.id - b.id);
  const limits = Object.fromEntries((limitsSnap?.docs || []).map((d) => [d.id, d.data().holders || []]));

  return (
    <Stack spacing={3}>
      <Box>
        <H>Groups ({groups.length})</H>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Group</TableCell>
                <TableCell align="right">$</TableCell>
                <TableCell align="right">🍎</TableCell>
                <TableCell align="right">😄</TableCell>
                <TableCell>Degree</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.length === 0 && (
                <TableRow><TableCell colSpan={6}>No groups yet.</TableCell></TableRow>
              )}
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell><strong>{g.id}</strong></TableCell>
                  <TableCell align="right">{Number(g.money || 0).toLocaleString('en-US')}</TableCell>
                  <TableCell align="right">{g.food ?? 0}</TableCell>
                  <TableCell align="right">{g.happiness ?? 0}</TableCell>
                  <TableCell>{EDUCATION_LABELS[g.education] ?? '?'}</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    {[g.married && '💍', g.gymMember && '🏋️', g.raffleTickets > 0 && `🎟${g.raffleTickets}`,
                      g.once?.teacher && 'teacher✓', g.once?.artist && 'artist✓'].filter(Boolean).join(' ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Box>
        <H>Limited awards</H>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          {Object.entries(LIMITS).map(([key, info]) => {
            const holders = limits[key] || [];
            return (
              <Chip
                key={key}
                color={holders.length >= info.max ? 'warning' : 'default'}
                label={`${info.label}: ${holders.length}/${info.max}${holders.length ? ` (group ${holders.join(', ')})` : ''}`}
              />
            );
          })}
        </Stack>
      </Box>

      <Adjust groupIds={groups.map((g) => String(g.id))} />
      <Raffle groups={groups} />

      <Box>
        <H>Recent activity</H>
        <Paper variant="outlined" sx={{ maxHeight: 360, overflowY: 'auto' }}>
          {(logSnap?.docs || []).length === 0 && <Typography sx={{ p: 1.5 }} fontSize={14}>Nothing yet.</Typography>}
          {(logSnap?.docs || []).map((d) => {
            const r = d.data();
            return (
              <Box key={d.id} sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <Typography fontSize={11} color="text.secondary">
                  {r.at ? new Date(r.at).toLocaleTimeString() : ''}
                </Typography>
                <Typography fontSize={13}>{activityLine(r)}</Typography>
              </Box>
            );
          })}
        </Paper>
      </Box>

      <CreateGroups />
      <Reset />
    </Stack>
  );
}
