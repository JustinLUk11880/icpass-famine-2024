import React, { useState, useEffect } from 'react';

import '@fontsource/roboto/400.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import { helperPath } from './secret/Secret';
import { doc, getDoc } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { db, auth } from '../database/firebase';
import Passport from './Passport';
import Layout from './Layout';
import NewUser from './NewUser';
import Admin from './Admin';
import Result from './Result';

// Hook
function useLocalStorage(key, initialValue) {
  // State to store our value
  // Pass initial state function to useState so logic is only executed once
  const [storedValue, setStoredValue] = useState(() => {
    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key);
      // Parse stored json or if none return initialValue
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      // If error also return initialValue
      console.log(error);
      return initialValue;
    }
  });
  // Return a wrapped version of useState's setter function that ...
  // ... persists the new value to localStorage.
  const setValue = (value) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      // Save state
      setStoredValue(valueToStore);
      // Save to local storage
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      // A more advanced implementation would handle the error case
      console.log(error);
    }
  };
  return [storedValue, setValue];
}

export default function App() {
	const [id, setId] = useLocalStorage("id", null);
	// Firestore rules require request.auth, so nothing may run until the
	// anonymous sign-in kicked off in database/firebase.js has resolved.
	const [user, authLoading, authError] = useAuthState(auth);

  // If the app is opened at root and URL has an ?id=... param, check if that
  // id exists in the users collection and, if so, set it in localStorage.
  useEffect(() => {
    if (!user) return; // reads are denied until signed in
    try {
      const params = new URLSearchParams(window.location.search);
      const idParam = params.get('id');
      // Remove the id param from the URL regardless of whether we accept it.
      if (params.has('id')) {
        params.delete('id');
        const newSearch = params.toString();
        const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
        // Replace state so we don't cause a navigation.
        window.history.replaceState(null, '', newUrl);
      }
      console.log('checking id param', idParam);
      // Only act when there's an id param and no id already set
      if (idParam && !id) {
        console.log('found id param', idParam);
        // Only perform this check on the root path (no path after host)
        const path = window.location.pathname || '/';
        if (path === '/' || path === '') {
          console.log('at root path, checking id in firestore');
          // Check Firestore for the user doc
          (async () => {
            try {
              const ref = doc(db, 'users', idParam);
              const snap = await getDoc(ref);
              console.log('firestore check complete', snap.exists());
              if (snap.exists()) {
                setId(idParam);
              } else {
                console.log('id param does not exist in firestore');
              }
            } catch (e) {
              console.log('error checking id param', e);
            }
          })();
        }
      }
    } catch (e) {
      console.log('error parsing search params', e);
    }
  }, [id, setId, user]);

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
          {
            <>
              <Route path={helperPath} element={<Admin />} />
              <Route path='result' element={<Result />} />
              {
                id ? (
                  <>
                    <Route index element={<Passport id={id} result={false} />} />
                  </>
                ) : (
                  <>
                    <Route index element={<NewUser setId={setId} />} />
                    <Route path='*' element={<NewUser setId={setId} />} />
                  </>
                )
              }
            </>
          }
				</Route>
			</Routes>
		</BrowserRouter>
	);
}