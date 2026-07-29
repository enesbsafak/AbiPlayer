# Verified false positives

Diagnostics confirmed against the code and the rule's own validation prompt.
Re-verify with the listed code-shape check before dropping a diagnostic — never
on filename alone.

## `react-doctor/effect-needs-cleanup`

**Files:** `src/renderer/src/hooks/usePlayer.ts` (HLS lifecycle effect),
`src/renderer/src/hooks/useMpvPlayer.ts` (mpv poll effect)

**Why it fires:** the rule's own validation prompt documents this exact
asymmetry — *"the detector descends into EVERY nested function to find the
registration, but its cleanup matcher mostly looks at the effect's top-level
statements and returned function."* Both effects register their timers inside a
nested callback (`hls.on(Hls.Events.ERROR, …)` and the `poll()` function), so the
registration is found but the matching release is not.

This is the documented SUPPRESS case (2): *"a returned cleanup DOES release this
resource even if the matcher missed it … the timer is set inside an
observer/subscription callback whose returned teardown tears the whole thing
down."*

The implementation follows the rule's own fix recipe (D) — *"keep a mutable id
and clear it from one returned teardown"* — using a local array and a ref
respectively.

**Verify before suppressing** (all must still hold):

1. `usePlayer.ts` HLS effect cleanup releases every registration it makes:
   - `listenerAbort.abort()` — covers the two `{ once: true }` `loadedmetadata`
     listeners, which are registered with `signal: listenerAbort.signal`
   - `for (const timer of hlsRetryTimers) window.clearTimeout(timer)` — covers
     the network-retry timer scheduled inside the `Hls.Events.ERROR` handler
   - explicit `removeEventListener` for the textTrack / audioTrack / video
     listeners, plus `hlsRef.current.destroy()`
2. `useMpvPlayer.ts` poll effect cleanup clears both `pollTimerRef` (the
   `setInterval`) and `reconnectTimerRef` (the `setTimeout` scheduled inside
   `poll()`).

If either cleanup stops covering one of those, the diagnostic is REAL — this
rule already caught a genuine leak here once (the `{ once: true }` listeners
survived cleanup and fired on the next channel's `loadedmetadata`, writing the
previous channel's track state).
