import React, { useEffect, useState } from 'react';
import { Paper } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { db } from '../database/firebase';
import { collection, getDocs } from 'firebase/firestore';

import { repeatSymbol, perMember } from '../utils/display';

const charitySymbol = "\u{1F525}";
const happySymbol = "\u{1F604}";

const NUM_GROUPS = 10;
const MARRIAGE_BONUS = 1000;

// One read of the whole marriages collection, turned into
// userId -> number of marriages that were never dissolved.
// This used to be a per-user query inside the loop, which meant one round trip
// per participant - over 200 of them, run serially.
const buildMarriageCounts = async () => {
  const counts = new Map();
  try {
    const snap = await getDocs(collection(db, 'marriages'));
    for (const d of snap.docs) {
      const m = d.data();
      // marriages/counter is a bookkeeping doc with no participants
      if (m.hasDivorced || !Array.isArray(m.participants)) continue;
      for (const uid of m.participants) {
        counts.set(uid, (counts.get(uid) || 0) + 1);
      }
    }
  } catch (e) {
    console.error('Could not read marriages; bonuses will be 0.', e);
  }
  return counts;
};

const renderRows = (groups) => groups.map(g => ({
  id: g.id,
  happiness: repeatSymbol(happySymbol, perMember(g.happiness, g.numMembers)),
  charity: repeatSymbol(charitySymbol, perMember(g.charity, g.numMembers)),
  total: perMember(
    g.charity * 30 + g.money * 20 + g.food * 20 + g.happiness * 30,
    g.numMembers
  ),
}));

const Result = () => {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const calcGroupTotal = async () => {
      const [usersSnapshot, marriageCounts] = await Promise.all([
        getDocs(collection(db, 'users')),
        buildMarriageCounts(),
      ]);

      const groups = Array.from({ length: NUM_GROUPS }, (_, i) => ({
        id: i + 1,
        numMembers: 0,
        happiness: 0,
        money: 0,
        food: 0,
        charity: 0,
      }));

      for (const docSnap of usersSnapshot.docs) {
        const data = docSnap.data();
        const index = Number(data.group) - 1;
        // A document with a missing or out-of-range group used to index the
        // array with undefined and crash the whole scoreboard.
        if (!Number.isInteger(index) || index < 0 || index >= NUM_GROUPS) {
          console.warn(`Skipping user ${docSnap.id}: bad group ${JSON.stringify(data.group)}`);
          continue;
        }
        const g = groups[index];
        g.numMembers += 1;
        g.happiness += Number(data.happiness) || 0;
        g.money += (Number(data.money) || 0)
                 + (marriageCounts.get(docSnap.id) || 0) * MARRIAGE_BONUS;
        g.food += (Number(data.food) || 0) + (Number(data.charityFood) || 0);
        g.charity += Number(data.charity) || 0;
      }

      setRows(renderRows(groups));
    };
    calcGroupTotal().catch(e => console.error('Scoreboard failed to load', e));
  }, []);

  return (
    <Paper elevation={6} style={{ background: 'linear-gradient(45deg, #FFE078 10%, #FFC14F 100%)' }} >
      <DataGrid
        columns={[
          { field: 'id', headerName: 'Group', flex: 2 },
          { field: 'happiness', headerName: 'Happiness', flex: 3 },
          { field: 'charity', headerName: 'Charity', flex: 3 },
          { field: 'total', headerName: 'Total', flex: 2 },
        ]}
        rows={rows}
        getRowHeight={() => 'auto'}
        sx={{
          '&.MuiDataGrid-root--densityStandard .MuiDataGrid-cell': {
            py: '15px'
          },
        }}
        hideFooter
      />
    </Paper>
  )
}

export default Result;
