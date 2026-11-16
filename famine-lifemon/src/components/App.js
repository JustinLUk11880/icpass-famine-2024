import React, { useCallback, useState } from 'react';

import '@fontsource/roboto/400.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthState } from 'react-firebase-hooks/auth';

import { helperPath } from './secret/Secret';
import { auth } from '../database/firebase';
import { useLiveSync } from '../database/liveSync';
import { isValidTeamId } from '../game/engine.js';
import Passport from './Passport';
import Layout from './Layout';
import JoinGroup from './JoinGroup';
import Admin from './Admin';
import Result from './Result';

// Remembers the chosen group on this device. Wrapped in try/catch because
// localStorage throws in private mode and when site data is blocked.
function useStoredGroup() {
  const [group, setGroupState] = useState(() => {
    try {
      const raw = window.localStorage.getItem('group');
      // A pre-sub-group value such as "3" is no longer a team: rejoin.
      return isValidTeamId(raw) ? raw : null;
    } catch (e) {
      return null;
    }
  });

  const setGroup = useCallback((value) => {
    const next = value != null && isValidTeamId(String(value)) ? String(value) : null;
    setGroupState(next);
    try {
      if (next) window.localStorage.setItem('group', next);
      else window.localStorage.removeItem('group');
    } catch (e) {
      // A device that cannot persist still works for this session.
      console.warn('Could not save group to localStorage', e);
    }
  }, []);

  return [group, setGroup];
}

export default function App() {
  const [group, setGroup] = useStoredGroup();
  useLiveSync();
  const leaveGroup = useCallback(() => setGroup(null), [setGroup]);
  // Firestore rules require request.auth, so nothing may run until the
  // anonymous sign-in started in database/firebase.js has resolved.
  const [user, authLoading, authError] = useAuthState(auth);

  if (authLoading) {
    return <p style={{ textAlign: 'center' }}>Connecting...</p>;
  }
  if (authError || !user) {
    return (
      <p style={{ textAlign: 'center' }}>
        Could not connect. Check your network and reload.
      </p>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route path={helperPath} element={<Admin />} />
          {/* Public scoreboard, e.g. for a projector */}
          <Route path="result" element={<Result highlightGroup={group} />} />
          {group ? (
            <>
              <Route index element={<Passport groupId={group} onGroupMissing={leaveGroup} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
              <Route index element={<JoinGroup setGroup={setGroup} />} />
              <Route path="*" element={<JoinGroup setGroup={setGroup} />} />
            </>
          )}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
