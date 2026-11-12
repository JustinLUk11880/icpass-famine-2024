import React, { useState } from 'react';
import { Box, Tab, Tabs } from '@mui/material';

import StationQR from './admin/StationQR';
import LiveEvents from './admin/LiveEvents';
import GroupsPanel from './admin/GroupsPanel';

// Helper page. Station helpers live on the first tab; the other two are for
// whoever is running the event.
export default function Admin() {
  const [tab, setTab] = useState(0);
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Station QR" />
        <Tab label="Live events" />
        <Tab label="Groups" />
      </Tabs>
      {tab === 0 && <StationQR />}
      {tab === 1 && <LiveEvents />}
      {tab === 2 && <GroupsPanel />}
    </Box>
  );
}
