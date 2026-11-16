import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material';
import { doc } from 'firebase/firestore';
import { useDocumentData } from 'react-firebase-hooks/firestore';

import Code from '../Code';
import { db } from '../../database/firebase';
import { debug } from '../secret/Secret';
import { LIMITS, STAGES, getStation, stationsForStage } from '../../game/catalog.js';
import {
  buildPayload, describeStation, missingFields, newQrId, poolCount, sanitizeInputs,
} from '../../game/engine.js';

// The QR's timestamp refreshes so a screenshot goes stale; its id does not,
// so each group can still redeem the code exactly once.
const REFRESH_MS = 10000;

const initialRaw = (station) => Object.fromEntries(station.fields.map((f) => [
  f.key,
  f.type === 'toggle' ? !!f.default : (f.default ?? ''),
]));

function Field({ field, value, onChange }) {
  if (field.type === 'select') {
    return (
      <TextField select fullWidth label={field.label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {field.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    );
  }
  if (field.type === 'number') {
    return (
      <TextField
        fullWidth
        type="number"
        label={field.label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        inputProps={{ min: field.min, max: field.max, step: 1, inputMode: 'numeric' }}
        helperText={`${field.min} to ${field.max}`}
      />
    );
  }
  return (
    <FormControlLabel
      control={<Switch checked={!!value} onChange={(e) => onChange(e.target.checked)} />}
      label={field.label}
    />
  );
}

function LimitStatus({ limitKey }) {
  const [data] = useDocumentData(doc(db, 'limits', limitKey));
  const info = LIMITS[limitKey];
  const holders = Array.isArray(data?.holders) ? data.holders : [];
  const left = Math.max(0, info.max - holders.length);
  return (
    <Alert severity={left ? 'info' : 'warning'}>
      <strong>{info.label}: {left} of {info.max} left.</strong>
      {holders.length > 0 && ` Taken by team ${holders.join(', ')}.`}
      {!left && ' Do not run this - nobody else can receive it.'}
    </Alert>
  );
}

function PoolStatus({ poolKey }) {
  const [data] = useDocumentData(doc(db, 'pools', poolKey));
  const n = poolCount(data);
  return <Alert severity={n ? 'info' : 'warning'}>Donation box: <strong>{n}</strong> apple{n === 1 ? '' : 's'}.</Alert>;
}

function VoteStatus() {
  const [voting] = useDocumentData(doc(db, 'voting', 'finalWill'));
  if (voting?.status === 'done') {
    return <Alert severity="success">Vote winner: <strong>Group {voting.winner}</strong>. Only a team of that group can scan this QR (first scan takes it).</Alert>;
  }
  return <Alert severity="warning">No winner announced yet (Live events → The Final Will vote).</Alert>;
}

export default function StationQR() {
  const [stageId, setStageId] = useState('');
  const [stationId, setStationId] = useState('');
  const [raw, setRaw] = useState({});
  const [qrId, setQrId] = useState(() => newQrId());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const station = getStation(stationId);
  const inputs = station ? sanitizeInputs(station, raw) : {};
  const missing = station ? missingFields(station, inputs) : [];
  const complete = !!station && missing.length === 0;
  const desc = station ? describeStation(station, inputs) : null;
  const payload = complete ? buildPayload(station.id, inputs, qrId, now) : null;

  // Any change to what the QR does makes it a new QR: groups that already
  // scanned the old one may scan the new one once.
  const fresh = () => setQrId(newQrId());
  const pickStage = (v) => { setStageId(v); setStationId(''); setRaw({}); fresh(); };
  const pickStation = (v) => {
    const s = getStation(v);
    setStationId(v);
    setRaw(s ? initialRaw(s) : {});
    fresh();
  };
  const setField = (key, v) => { setRaw((r) => ({ ...r, [key]: v })); fresh(); };

  return (
    <Stack spacing={2}>
      <TextField select fullWidth label="Stage" value={stageId} onChange={(e) => pickStage(e.target.value)}>
        {STAGES.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
      </TextField>

      {stageId && (
        <TextField select fullWidth label="Station" value={stationId} onChange={(e) => pickStation(e.target.value)}>
          {stationsForStage(stageId).map((s) => (
            <MenuItem key={s.id} value={s.id}>{s.label}{s.custom ? ' (enter amounts)' : ''}</MenuItem>
          ))}
        </TextField>
      )}

      {station && (
        <>
          {station.notes && <Alert severity={station.custom ? 'warning' : 'info'}>{station.notes}</Alert>}
          {station.limitKey && <LimitStatus limitKey={station.limitKey} />}
          {station.poolKey && <PoolStatus poolKey={station.poolKey} />}
          {station.id === 'secret.finalWill' && <VoteStatus />}

          {station.fields.map((f) => (
            <Field key={f.key} field={f} value={raw[f.key]} onChange={(v) => setField(f.key, v)} />
          ))}

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            {desc.req.length > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography fontSize={12} fontWeight={700} sx={{ mb: 0.5, letterSpacing: 0.4 }}>REQUIREMENTS</Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                  {desc.req.map((r) => <Chip key={r} label={r} size="small" color="warning" variant="outlined" />)}
                </Stack>
              </Box>
            )}
            <Typography fontSize={12} fontWeight={700} sx={{ mb: 0.5, letterSpacing: 0.4 }}>WHAT THE GROUP GETS</Typography>
            {complete ? (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {desc.fx.map((r) => <Chip key={r} label={r} size="small" color="primary" sx={{ fontWeight: 700 }} />)}
              </Stack>
            ) : (
              <Typography fontSize={14} color="text.secondary">
                Fill in: {missing.map((k) => station.fields.find((f) => f.key === k)?.label).join(', ')}
              </Typography>
            )}
          </Paper>

          {complete && (
            <>
              <Code payload={payload} />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                <Typography fontSize={13} color="text.secondary">
                  QR <strong>{qrId.slice(0, 4)}</strong> · {station.repeatable
                    ? 'reusable: teams can scan it again'
                    : station.id === 'wed.wedding' ? 'one scan marries both teams' : 'each team can scan it once'}
                </Typography>
                {!station.repeatable && (
                  <Button size="small" variant="outlined" onClick={fresh}>New QR for the next team</Button>
                )}
              </Box>
            </>
          )}

          {debug && payload && (
            <pre style={{ background: '#f6f6f6', padding: 8, borderRadius: 4, fontSize: 12, overflowX: 'auto' }}>
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
        </>
      )}
    </Stack>
  );
}
