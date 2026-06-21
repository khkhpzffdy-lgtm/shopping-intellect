import { useEffect, useRef } from 'react';

/**
 * Makes a mobile edge-swipe/hardware back gesture close the topmost open
 * screen/overlay instead of falling through to real browser back history —
 * this app has no router, so without this a back-gesture just leaves
 * whatever single history entry the page loaded with (which can look like
 * "back to login" since that's what was rendered at load time).
 *
 * Call unconditionally on every render, passing whether this screen/overlay
 * is currently the open one. Several of these can be mounted-and-active at
 * once (a list open behind an item-detail overlay, a bucket behind a
 * drilled-into child bucket, ...) without each one reacting to the same
 * gesture — a single shared stack + a single real `popstate` listener
 * ensures only the most-recently-opened (topmost) one responds, mirroring
 * how a real navigation stack behaves.
 */

type BackEntry = {
  onBack: () => void;
  consumed: boolean;
};

const stack: BackEntry[] = [];
let listenerAttached = false;
// Counter, not a boolean: several screens can close in the same React
// commit (e.g. logout while overlays are stacked open), each issuing its
// own programmatic history.back() — every one of those needs its matching
// popstate ignored, not just the first.
let suppressedPopStateCount = 0;

const ensureListener = () => {
  if (listenerAttached) return;
  listenerAttached = true;

  window.addEventListener('popstate', () => {
    if (suppressedPopStateCount > 0) {
      suppressedPopStateCount -= 1;
      return;
    }

    const top = stack.pop();
    if (top) {
      top.consumed = true;
      top.onBack();
    }
  });
};

export const useBackHandler = (active: boolean, onBack: () => void) => {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;

    ensureListener();

    const entry: BackEntry = { onBack: () => onBackRef.current(), consumed: false };
    stack.push(entry);
    window.history.pushState({ siBack: true }, '');

    return () => {
      if (entry.consumed) return;

      // Closed via an in-app button rather than a back-gesture: drop our
      // entry and pop the matching history entry ourselves, suppressing the
      // popstate that triggers so it doesn't also pop whatever's now on top
      // of the stack (the next ancestor screen down).
      const index = stack.indexOf(entry);
      if (index !== -1) stack.splice(index, 1);

      if (window.history.state?.siBack) {
        suppressedPopStateCount += 1;
        window.history.back();
      }
    };
  }, [active]);
};
