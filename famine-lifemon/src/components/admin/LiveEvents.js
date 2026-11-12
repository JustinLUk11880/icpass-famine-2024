import React, { useState } from 'react';
import {
  Alert, Box, Button, Card, CardActions, CardContent, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, TextField, Typography,
} from '@mui/material';
import { doc } from 'firebase/firestore';
import { useDocumentData } from 'react-firebase-hooks/firestore';

import { db } from '../../database/firebase';
import { GLOBAL_EVENTS, formatDelta } from '../../game/engine.js';
import { broadcast, clearBroadcast, performGlobalEvent } from '../../game/firestore.js';

const PRESETS = [
  { label: '🚨 Robbery started', kind: 'alert', message: '🚨 A bank robbery is in progress! Police - stop the robbers!' },
  { label: '🗳 Final Will voting', kind: 'info', message: '🗳 The Final Will: every team votes for the team that deserves $1000 most. You cannot vote for your own team.' },
  { label: '🎓 Exam starting', kind: 'info', message: '🎓 An exam is starting at RSM 1.31 now.' },
  { label: '🎡 Raffle draw soon', kind: 'info', message: '🎡 The raffle wheel spins soon - last chance to buy tickets ($50 each).' },
];

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
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>Secret tasks that hit everyone</Typography>
        <Stack spacing={2}>
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
                      Applied to {applied.length} group{applied.length === 1 ? '' : 's'}
                      {skipped.length > 0 && `, ${skipped.length} already had it`}
                      {failed.length > 0 && `, ${failed.length} FAILED (groups ${failed.map((f) => f.gid).join(', ')}) - press again to retry them`}
                      .
                      {applied.length > 0 && (
                        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                          {applied.sort((a, b) => a.gid - b.gid).map((a) => (
                            <li key={a.gid}>Group {a.gid}: {formatDelta(a.summary) || 'no change'}</li>
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
