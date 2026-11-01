import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { RoomSnapshot } from '@table21/protocol';
import { subscribePrefs, reducedMotion } from '../prefs.ts';
import { TableTimeline } from './timeline.ts';

/**
 * The table a screen shows: the server snapshot played through the visual event queue (anim/timeline.ts).
 * One timeline per table session; `resyncKey` changes on reconnect and makes the next state appear without replay.
 */
export function useTableTimeline(snap: RoomSnapshot | null, sessionKey: string, meId: string, resyncKey = 0) {
  const tl = useMemo(() => new TableTimeline(meId), [sessionKey, meId]);
  useEffect(() => () => tl.dispose(), [tl]);
  const lastResync = useRef(resyncKey);
  useLayoutEffect(() => {
    if (!snap) return;
    if (lastResync.current !== resyncKey) {
      lastResync.current = resyncKey;
      tl.setTarget(snap, true);
      return;
    }
    if (tl.lastInput !== snap) tl.setTarget(snap);
  }, [snap, resyncKey, tl]);
  useEffect(
    () =>
      subscribePrefs(() => {
        if (reducedMotion() && tl.pending) tl.skip();
        else tl.speedChanged();
      }),
    [tl],
  );
  const shown = useSyncExternalStore(tl.subscribe, tl.getDisplay);
  // Before the first layout effect, show the server state as is (first render = hydrate).
  const view = shown && snap && shown.roomId === snap.roomId ? shown : snap;
  return { view, pending: tl.pending, skip: () => tl.skip(), timeline: tl, presentation: tl.presentation };
}
