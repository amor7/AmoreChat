// Step-by-step "Back" (phone back button / browser back): an open dialog, menu or full-screen
// voice view closes first, before going back from a chat to the chat list.
// Each open layer adds one history entry; Back pops the top layer instead of navigating.
import { useEffect, useRef } from 'react';

const stack = []; // [{ id, close }]
let seq = 0;

window.addEventListener('popstate', (e) => {
  const top = stack.at(-1);
  if (top && e.state?.layer !== top.id) {
    stack.pop();
    top.closedByBack = true;
    top.close();
    return;
  }
  // An entry left behind by a layer that was closed another way: skip over it.
  if (!top && e.state?.layer) history.back();
});

/** Registers a closable layer while `open` is true. */
export function useBackClose(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const entry = { id: ++seq, close: () => closeRef.current(), closedByBack: false };
    stack.push(entry);
    history.pushState({ layer: entry.id }, '');
    return () => {
      // Closed by its own button (not by Back): remove our history entry too, but only if it
      // is still the current one (opening a chat from a dialog already moved forward).
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (!entry.closedByBack && history.state?.layer === entry.id) history.back();
    };
  }, [open]);
}
