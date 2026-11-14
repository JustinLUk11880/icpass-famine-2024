import React, { useState } from 'react';
import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { collection } from 'firebase/firestore';
import { useCollection } from 'react-firebase-hooks/firestore';

import { db } from '../database/firebase';
import { APPLE_MAX, SUBGROUPS } from '../game/catalog.js';
import { groupTotals, parentOf } from '../game/engine.js';

const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };

// The three awards from the LifeMon rules. Each is ranked on its own stat;
// there is no combined score.
export const AWARDS = [
  { key: 'money', title: 'Monopoly', subtitle: 'most money', icon: '💰' },
  { key: 'happiness', title: 'Joy Master', subtitle: 'most happiness', icon: '😄' },
  { key: 'food', title: 'Wellness King/Queen', subtitle: 'most health', icon: '🍎' },
];

const statOf = (g, key) => Math.max(0, Math.floor(Number(g?.[key]) || 0));

// Ties share a rank: 1, 2, 2, 4.
export function rankBy(groups, key) {
  const sorted = [...groups].sort((a, b) => statOf(b, key) - statOf(a, key) || a.id - b.id);
  const ranks = new Map();
  let prev = null;
  let rank = 0;
  sorted.forEach((g, i) => {
    const v = statOf(g, key);
    if (v !== prev) {
      rank = i + 1;
      prev = v;
    }
    ranks.set(g.id, rank);
  });
  return { sorted, ranks };
}

export default function Result({ highlightGroup }) {
  // Live: every scan by any group updates every phone showing this board.
  const [snap, loading, error] = useCollection(collection(db, 'groups'));
  const [awardKey, setAwardKey] = useState('money');
  const award = AWARDS.find((a) => a.key === awardKey) || AWARDS[0];

  // A group's score is the sum of its teams (1.1 + 1.2). Only groups with at
  // least one joined team are listed. Raffle tickets are deliberately absent:
  // groups must not learn how many tickets the others hold.
  const groups = groupTotals((snap?.docs || []).map((d) => ({ id: d.id, data: d.data() })));

  const myGroup = highlightGroup != null ? parentOf(highlightGroup) : null;
  const isMine = (id) => myGroup != null && Number(id) === myGroup;
  const { sorted, ranks } = rankBy(groups, award.key);
  const rows = sorted.map((g) => ({ ...g, rank: ranks.get(g.id) }));
  const mine = groups.find((g) => isMine(g.id));
  const myRanks = mine ? Object.fromEntries(AWARDS.map((a) => [a.key, rankBy(groups, a.key).ranks.get(mine.id)])) : null;

  if (error) {
    return <Typography sx={{ textAlign: 'center', py: 2 }}>Could not load the leaderboard.</Typography>;
  }

  const statColumn = (key, headerName, render) => ({
    field: key,
    headerName,
    flex: 1,
    minWidth: 70,
    sortable: false,
    align: 'center',
    headerAlign: 'center',
    cellClassName: key === award.key ? 'col-active' : '',
    headerClassName: key === award.key ? 'col-active-header' : '',
    renderCell: ({ value }) => (
      <Typography component="span" fontSize={14} fontWeight={key === award.key ? 800 : 500} sx={{ whiteSpace: 'nowrap' }}>
        {render(value)}
      </Typography>
    ),
  });

  const columns = [
    {
      field: 'rank',
      headerName: '#',
      width: 52,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: ({ value }) => (
        <Typography component="span" fontWeight="bold" fontSize={15}>{medals[value] || value}</Typography>
      ),
    },
    {
      field: 'id',
      headerName: 'Group',
      flex: 1,
      minWidth: 74,
      sortable: false,
      renderCell: ({ value }) => (
        // "(you)" overflowed at phone width; the row is already tinted and
        // the banner above names the group, so a star is enough.
        <Typography component="span" fontSize={14} fontWeight={isMine(value) ? 800 : 500} sx={{ whiteSpace: 'nowrap' }}>
          {isMine(value) ? '★ ' : ''}Group {value}
        </Typography>
      ),
    },
    statColumn('money', '💰 Money', (v) => `$${Number(v).toLocaleString('en-US')}`),
    statColumn('happiness', '😄 Joy', (v) => `😄 × ${v}`),
    statColumn('food', '🍎 Health', (v) => `${v}/${APPLE_MAX * SUBGROUPS}`),
  ];

  return (
    <Box>
      {mine && myRanks && (
        <Paper
          elevation={0}
          sx={{
            mb: 1.5, px: 2, py: 1.25, borderRadius: 2,
            background: 'linear-gradient(135deg, #3F8F89 0%, #4FB2AA 100%)', color: '#fff',
          }}
        >
          <Typography fontSize={12} sx={{ opacity: 0.85, letterSpacing: 0.6, mb: 0.5 }}>
            YOUR GROUP · OUT OF {groups.length}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            {AWARDS.map((a) => (
              <Box key={a.key} sx={{ textAlign: 'center', flex: 1 }}>
                <Typography fontSize={20} fontWeight={800} lineHeight={1.15}>
                  {medals[myRanks[a.key]] || `#${myRanks[a.key]}`}
                </Typography>
                <Typography fontSize={11} sx={{ opacity: 0.9 }}>{a.icon} {a.title}</Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={award.key}
        onChange={(_, v) => v && setAwardKey(v)}
        sx={{ mb: 1 }}
      >
        {AWARDS.map((a) => (
          <ToggleButton key={a.key} value={a.key} sx={{ textTransform: 'none', lineHeight: 1.2, py: 0.75 }}>
            <Box>
              <Typography fontSize={13} fontWeight={700}>{a.icon} {a.title}</Typography>
              <Typography fontSize={10} sx={{ opacity: 0.75 }}>{a.subtitle}</Typography>
            </Box>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Paper elevation={2} sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          autoHeight
          density="compact"
          hideFooter
          // Read-only board: no sorting, no filtering, no "Manage columns".
          // The column menu stays so "Hide column" remains available.
          disableColumnFilter
          disableColumnSelector
          disableRowSelectionOnClick
          localeText={{ noRowsLabel: 'No groups have joined yet' }}
          getRowClassName={({ id }) => (isMine(id) ? 'row-mine' : '')}
          sx={{
            border: 'none',
            fontFamily: 'Karla, sans-serif',
            minHeight: 120,
            '& .MuiDataGrid-columnHeaders': {
              background: 'linear-gradient(45deg, #FFE078 10%, #FFC14F 100%)',
              borderBottom: '2px solid rgba(0,0,0,0.12)',
            },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 700, fontSize: 12, letterSpacing: 0.3 },
            '& .col-active-header .MuiDataGrid-columnHeaderTitle': { fontWeight: 900, textDecoration: 'underline' },
            '& .col-active': { backgroundColor: 'rgba(255,193,79,0.14)' },
            '& .MuiDataGrid-columnSeparator': { display: 'none' },
            '& .MuiDataGrid-cell': { borderBottom: '1px solid rgba(0,0,0,0.06)' },
            '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
            '& .MuiDataGrid-row:hover': { backgroundColor: 'rgba(79,178,170,0.08)' },
            '& .row-mine': {
              backgroundColor: 'rgba(79,178,170,0.22)',
              '&:hover': { backgroundColor: 'rgba(79,178,170,0.30)' },
            },
          }}
        />
      </Paper>
    </Box>
  );
}
