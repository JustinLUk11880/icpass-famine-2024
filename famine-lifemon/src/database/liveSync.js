import { useEffect } from 'react';
import { disableNetwork, enableNetwork } from 'firebase/firestore';

import { db } from './firebase';

// Phones freeze a background tab's network connection. Firestore usually
// recovers by itself, but on some phones the live stream stays stalled after
// the screen wakes, so the passport keeps showing old numbers until a reload.
// Cycling the network on wake / reconnect forces every listener to resync.
const MIN_HIDDEN_MS = 10000; // a quick app switch needs no resync
const MIN_GAP_MS = 5000;

let lastResync = 0;
export async function resyncNow() {
  const now = Date.now();
  if (now - lastResync < MIN_GAP_MS) return;
  lastResync = now;
  try {
    await disableNetwork(db);
  } finally {
    await enableNetwork(db);
  }
}

export function useLiveSync() {
  useEffect(() => {
    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt >= MIN_HIDDEN_MS) {
        hiddenAt = 0;
        resyncNow().catch((e) => console.warn('Resync failed', e));
      } else {
        hiddenAt = 0;
      }
    };
    const onOnline = () => resyncNow().catch((e) => console.warn('Resync failed', e));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, []);
}
