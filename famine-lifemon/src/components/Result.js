import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { collection } from 'firebase/firestore';
import { useCollection } from 'react-firebase-hooks/firestore';

import { db } from '../database/firebase';
import { GROUPS, scoreOf } from '../constants';

const charitySymbol = "\u{1F525}";
const happySymbol = "\u{1F604}";
const medals = { 1: "\u{1F947}", 2: "\u{1F948}", 3: "\u{1F949}" };

// Counts run into the dozens by the end of an event, so one emoji followed by
// a count stays readable where a repeated row of emoji does not.
const countOf = (symbol, value) => {
  const n = Number(value);
  return `${symbol} × ${Number.isFinite(n) && n > 0 ? Math.floor(n) : 0}`;
};

export default function Result({ highlightGroup }) {
  const [groupsSnap, groupsLoading, groupsError] = useCollection(collection(db, 'groups'));
  const [marriagesSnap] = useCollection(collection(db, 'marriages'));

  // groupNumber -> marriages never dissolved
  const intact = new Map();
  if (marriagesSnap) {
    for (const d of marriagesSnap.docs) {
      const m = d.data();
      if (m.hasDivorced || !Array.isArray(m.participants)) continue; // skips marriages/counter
      for (const p of m.participants) {
        const n = Number(p);
        if (Number.isInteger(n)) intact.set(n, (intact.get(n) || 0) + 1);
      }
    }
  }

  const byId = new Map();
  if (groupsSnap) for (const d of groupsSnap.docs) byId.set(String(d.id), d.data());

  const rows = GROUPS.map((n) => {
    const g = byId.get(String(n)) || {};
    return {
      id: n,
      charity: Math.max(Math.floor(Number(g.charity) || 0), 0),
      happiness: Math.max(Math.floor(Number(g.happiness) || 0), 0),
      total: scoreOf(g, intact.get(n) || 0),
    };
  });

  rows.sort((a, b) => b.total - a.total || a.id - b.id);
  let lastTotal = null;
  let lastRank = 0;
  rows.forEach((r, i) => {
    if (r.total !== lastTotal) { lastRank = i + 1; lastTotal = r.total; }
    r.rank = lastRank;
  });

  const mine = highlightGroup != null ? rows.find((r) => r.id === Number(highlightGroup)) : null;
  const isMine = (id) => highlightGroup != null && Number(id) === Number(highlightGroup);

  if (groupsError) {
    return <Typography sx={{ textAlign: 'center', py: 2 }}>Could not load the leaderboard.</Typography>;
  }

  const columns = [
    {
      field: 'rank',
      headerName: '#',
      width: 58,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: ({ value }) => (
        <Typography component="span" fontWeight="bold" fontSize={15}>
          {medals[value] || value}
        </Typography>
      ),
    },
    {
      field: 'id',
      headerName: 'Group',
      flex: 1.1,
      minWidth: 78,
      sortable: false,
      renderCell: ({ value }) => (
        <Typography component="span" fontSize={14} fontWeight={isMine(value) ? 800 : 500}>
          Group {value}{isMine(value) ? ' (you)' : ''}
        </Typography>
      ),
    },
    {
      field: 'charity',
      headerName: 'Charity',
      flex: 1,
      minWidth: 88,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: ({ value }) => (
        <Typography component="span" fontSize={14} sx={{ whiteSpace: 'nowrap' }}>
          {countOf(charitySymbol, value)}
        </Typography>
      ),
    },
    {
      field: 'happiness',
      headerName: 'Happiness',
      flex: 1,
      minWidth: 100,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: ({ value }) => (
        <Typography component="span" fontSize={14} sx={{ whiteSpace: 'nowrap' }}>
          {countOf(happySymbol, value)}
        </Typography>
      ),
    },
    {
      field: 'total',
      headerName: 'Score',
      flex: 1,
      minWidth: 84,
      sortable: false,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ value, row }) => (
        <Typography component="span" fontSize={14} fontWeight={isMine(row.id) ? 800 : 600}>
          {Number(value).toLocaleString()}
        </Typography>
      ),
    },
  ];

  return (
    <Box>
      {mine && (
        <Paper
          elevation={0}
          sx={{
            mb: 1.5, px: 2, py: 1.25, borderRadius: 2,
            background: 'linear-gradient(135deg, #3F8F89 0%, #4FB2AA 100%)',
            color: '#fff',
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          }}
        >
          <Box>
            <Typography fontSize={12} sx={{ opacity: 0.85, letterSpacing: 0.6 }}>
              YOUR GROUP
            </Typography>
            <Typography fontSize={19} fontWeight={800} lineHeight={1.15}>
              {medals[mine.rank] ? `${medals[mine.rank]} ` : ''}Rank {mine.rank} of {rows.length}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography fontSize={12} sx={{ opacity: 0.85 }}>SCORE</Typography>
            <Typography fontSize={19} fontWeight={800} lineHeight={1.15}>
              {mine.total.toLocaleString()}
            </Typography>
          </Box>
        </Paper>
      )}

      <Paper elevation={2} sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={groupsLoading}
          autoHeight
          density="compact"
          hideFooter
          // Read-only board: no sorting, no filtering, no "Manage columns".
          // The column menu stays so "Hide column" remains available.
          disableColumnFilter
          disableColumnSelector
          disableRowSelectionOnClick
          getRowClassName={({ id }) => (isMine(id) ? 'row-mine' : '')}
          sx={{
            border: 'none',
            fontFamily: 'Karla, sans-serif',
            '& .MuiDataGrid-columnHeaders': {
              background: 'linear-gradient(45deg, #FFE078 10%, #FFC14F 100%)',
              borderBottom: '2px solid rgba(0,0,0,0.12)',
            },
            '& .MuiDataGrid-columnHeaderTitle': {
              fontWeight: 700, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase',
            },
            '& .MuiDataGrid-columnSeparator': { display: 'none' },
            '& .MuiDataGrid-cell': { borderBottom: '1px solid rgba(0,0,0,0.06)' },
            '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
            '& .MuiDataGrid-row:hover': { backgroundColor: 'rgba(79,178,170,0.08)' },
            '& .row-mine': {
              backgroundColor: 'rgba(79,178,170,0.20)',
              '&:hover': { backgroundColor: 'rgba(79,178,170,0.28)' },
            },
          }}
        />
      </Paper>
    </Box>
  );
}
