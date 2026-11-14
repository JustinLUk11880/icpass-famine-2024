import React, { useState } from 'react';
import {
  Alert, Box, Button, Card, CardActions, CardContent, Dialog, DialogActions, DialogContent,
  DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { collection, doc } from 'firebase/firestore';
import { useCollection, useDocumentData } from 'react-firebase-hooks/firestore';

import { db } from '../../database/firebase';
import { GLOBAL_EVENTS, formatDelta, potOf, tallyVotes } from '../../game/engine.js';
import {
  announceWinner, broadcast, clearBroadcast, closeVoting, openVoting, performGlobalEvent,
  performMarriagePayout,
} from '../../game/firestore.js';

const PRESETS = [
  { label: '🚨 Robbery started', kind: 'alert', message: '🚨 A bank robbery is in progress! Police - stop the robbers!' },
  { label: '🎓 Exam starting', kind: 'info', message: '🎓 An exam is starting at RSM 1.31 now.' },
  { label: '🎡 Raffle draw soon', kind: 'info', message: '🎡 The raffle wheel spins soon - last chance to buy tickets ($50 each).' },
];

function FinalWillPanel() {
  const [voting] = useDocumentData(doc(db, 'voting', 'finalWill'));
  const [votesSnap] = useCollection(collection(db, 'votes'));
  const [winner, setWinner] = useState('');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const status = voting?.status || 'not started';
  const votes = (votesSnap?.docs || []).map((d) => ({ voter: d.id, for: d.data().for }));
  const { rows, leaders } = tallyVotes(votes);
  const pick = winner || (leaders.length === 1 ? String(leaders[0]) : '');

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { console.error(e); setError(String(e?.message || e)); }
    setBusy(false);
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography fontWeight={800}>
          The Final Will vote <Typography component="span" color="text.secondary" fontSize={14}>· 15:40 · status: {status}</Typography>
        </Typography>
        <Typography fontSize={14} sx={{ mt: 0.5 }}>
          Opening the vote puts a voting card on every passport. Each group gets one vote (changeable while open) and
          cannot vote for itself. Announcing the winner tells every phone which room to go to, and from then on only
          the winner can scan the Final Will QR.
        </Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
          <Button variant="contained" disabled={busy || status === 'open'} onClick={() => run(async () => {
            await openVoting(db);
            await broadcast(db, '🗳 The Final Will: vote now on your passport for the team that deserves $1000 most. You cannot vote for your own team.', 'info');
          })}>
            {status === 'not started' ? 'Open voting' : 'Restart voting (clears votes)'}
          </Button>
          <Button variant="outlined" disabled={busy || status !== 'open'} onClick={() => run(() => closeVoting(db))}>Close voting</Button>
        </Stack>

        <Typography fontWeight={700} fontSize={14} sx={{ mt: 2 }}>
          {votes.length} group{votes.length === 1 ? '' : 's'} voted{votes.length ? ` (${votes.map((v) => v.voter).sort((a, b) => a - b).join(', ')})` : ''}
        </Typography>
        {rows.length > 0 && (
          <Box component="ul" sx={{ fontFamily: 'Roboto, Helvetica, Arial, sans-serif', fontSize: 14, m: 0, pl: 2.5 }}>
            {rows.map((r) => <li key={r.group}>Group {r.group}: {r.count} vote{r.count === 1 ? '' : 's'}</li>)}
          </Box>
        )}
        {leaders.length > 1 && (
          <Alert severity="warning" sx={{ mt: 1 }}>Tie between groups {leaders.join(', ')} - pick the winner below (e.g. spin a wheel).</Alert>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <TextField select size="small" label="Winner" value={pick} onChange={(e) => setWinner(e.target.value)} sx={{ minWidth: 130 }}>
            {(rows.length ? rows.map((r) => r.group) : []).map((g) => <MenuItem key={g} value={String(g)}>Group {g}</MenuItem>)}
          </TextField>
          <TextField size="small" fullWidth label="Room to collect the prize" placeholder="e.g. RSM 1.31" value={room} onChange={(e) => setRoom(e.target.value)} />
        </Stack>
        <Button
          sx={{ mt: 1.5 }}
          color="secondary"
          variant="contained"
          disabled={busy || !pick || !room.trim() || status === 'open'}
          onClick={() => run(() => announceWinner(db, pick, room))}
        >
          Announce winner to every phone
        </Button>
        {status === 'open' && <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.5 }}>Close voting before announcing.</Typography>}
        {status === 'done' && (
          <Alert severity="success" sx={{ mt: 1.5 }}>Announced: Group {voting.winner} → {voting.room}. Make the Final Will QR there.</Alert>
        )}
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      </CardContent>
    </Card>
  );
}

function MarriagePayout() {
  const [snap] = useCollection(collection(db, 'marriages'));
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const marriages = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  const active = marriages.filter((m) => !m.hasDivorced && !m.paidOut && (m.participants || []).length === 2);

  const run = async () => {
    setBusy(true);
    try {
      const r = await performMarriagePayout(db);
      setRes(r);
      setOpen(false);
      setTyped('');
    } catch (e) {
      setRes([{ status: 'failed', reason: String(e?.message || e) }]);
    }
    setBusy(false);
  };
  const applied = (res || []).filter((r) => r.status === 'applied');
  const failed = (res || []).filter((r) => r.status === 'failed');

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography fontWeight={800}>Pay out marriages <Typography component="span" color="text.secondary" fontSize={14}>· end of LifeMon</Typography></Typography>
        <Typography fontSize={14} sx={{ mt: 0.5 }}>Each married group gets the pot x 2 and +10 apples (capped at 8). Divorced marriages get nothing.</Typography>
        <Box component="ul" sx={{ fontFamily: 'Roboto, Helvetica, Arial, sans-serif', fontSize: 14, m: 0, mt: 1, pl: 2.5 }}>
          {active.length === 0 && <li>No active marriages.</li>}
          {active.map((m) => (
            <li key={m.id}>Teams {m.participants.join(' + ')}: pot ${potOf(m).toLocaleString('en-US')} → each gets ${(potOf(m) * 2).toLocaleString('en-US')}</li>
          ))}
        </Box>
        {res && (
          <Alert severity={failed.length ? 'error' : 'success'} sx={{ mt: 1.5 }}>
            Paid {applied.length} marriage{applied.length === 1 ? '' : 's'}.
            {failed.length > 0 && ` ${failed.length} FAILED - press again to retry them.`}
          </Alert>
        )}
      </CardContent>
      <CardActions>
        <Button color="error" variant="contained" disabled={!active.length} onClick={() => setOpen(true)}>Pay out all marriages</Button>
      </CardActions>
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth>
        <DialogTitle>Pay out every marriage now?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>Each marriage pays once; pressing again later does not pay twice.</Typography>
          <TextField autoFocus fullWidth label="Type PAYOUT to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" disabled={typed.trim().toUpperCase() !== 'PAYOUT' || busy} onClick={run}>
            {busy ? 'Paying...' : 'Pay out'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function ConfirmEvent({ event, onClose, onDone }) {
  const word = event.id.toUpperCase();
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const results = await performGlobalEvent(db, event.id);
      await broadcast(db, event.announcement, 'alert');
      // onDone closes (unmounts) this dialog, so it must be the last thing.
      onDone(results);
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
      setRunning(false);
    }
  };

  return (
    <Dialog open onClose={running ? undefined : onClose} fullWidth>
      <DialogTitle>Apply {event.label} to every group?</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{event.description}</Typography>
        <Typography sx={{ mb: 1 }} fontSize={14}>
          Each group is hit once, even if this is pressed twice. It also sends an announcement to every phone.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label={`Type ${word} to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={running}>Cancel</Button>
        <Button color="error" variant="contained" disabled={typed.trim().toUpperCase() !== word || running} onClick={run}>
          {running ? 'Applying...' : `Apply ${event.label}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function LiveEvents() {
  const [current] = useDocumentData(doc(db, 'announcements', 'current'));
  const [custom, setCustom] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [results, setResults] = useState({});
  const [sending, setSending] = useState(false);

  const send = async (message, kind = 'info') => {
    if (!message.trim()) return;
    setSending(true);
    try {
      await broadcast(db, message.trim(), kind);
      setCustom('');
    } finally {
      setSending(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>Announcement to every phone</Typography>
        {current?.message ? (
          <Alert
            severity={current.kind === 'alert' ? 'error' : 'info'}
            action={<Button color="inherit" size="small" onClick={() => clearBroadcast(db)}>Clear</Button>}
            sx={{ mb: 1.5 }}
          >
            <strong>Showing now:</strong> {current.message}
          </Alert>
        ) : (
          <Typography color="text.secondary" fontSize={14} sx={{ mb: 1.5 }}>Nothing is being shown.</Typography>
        )}
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          {PRESETS.map((p) => (
            <Button key={p.label} variant="outlined" size="small" disabled={sending} onClick={() => send(p.message, p.kind)}>
              {p.label}
            </Button>
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField fullWidth size="small" label="Custom message" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button variant="contained" disabled={!custom.trim() || sending} onClick={() => send(custom)}>Send</Button>
        </Stack>
      </Box>

      <Box>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>Secret tasks</Typography>
        <Stack spacing={2}>
          <FinalWillPanel />
          {Object.values(GLOBAL_EVENTS).map((e) => {
            const res = results[e.id];
            const applied = res?.filter((r) => r.status === 'applied') || [];
            const skipped = res?.filter((r) => r.status === 'skipped') || [];
            const failed = res?.filter((r) => r.status === 'failed') || [];
            return (
              <Card key={e.id} variant="outlined">
                <CardContent>
                  <Typography fontWeight={800}>{e.label} <Typography component="span" color="text.secondary" fontSize={14}>· {e.when}</Typography></Typography>
                  <Typography fontSize={14} sx={{ mt: 0.5 }}>{e.description}</Typography>
                  {res && (
                    <Alert severity={failed.length ? 'error' : 'success'} sx={{ mt: 1.5 }}>
                      Applied to {applied.length} team{applied.length === 1 ? '' : 's'}
                      {skipped.length > 0 && `, ${skipped.length} already had it`}
                      {failed.length > 0 && `, ${failed.length} FAILED (teams ${failed.map((f) => f.gid).join(', ')}) - press again to retry them`}
                      .
                      {applied.length > 0 && (
                        <Box component="ul" sx={{ fontFamily: 'Roboto, Helvetica, Arial, sans-serif', fontSize: 14, m: 0, mt: 0.5, pl: 2.5 }}>
                          {applied.sort((a, b) => a.gid - b.gid).map((a) => (
                            <li key={a.gid}>Team {a.gid}: {formatDelta(a.summary) || 'no change'}</li>
                          ))}
                        </Box>
                      )}
                    </Alert>
                  )}
                </CardContent>
                <CardActions>
                  <Button color="error" variant="contained" onClick={() => setConfirming(e)}>Apply to all groups</Button>
                </CardActions>
              </Card>
            );
          })}
          <MarriagePayout />
        </Stack>
      </Box>

      {confirming && (
        <ConfirmEvent
          event={confirming}
          onClose={() => setConfirming(null)}
          onDone={(r) => {
            setResults((prev) => ({ ...prev, [confirming.id]: r }));
            setConfirming(null);
          }}
        />
      )}
    </Stack>
  );
}
