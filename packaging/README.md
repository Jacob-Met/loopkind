# LOOPKIND private integrated preview

Explore a fictional neighbourhood's circle of help. Review participants' offers, needs, availability and conditions, find a shared plan, and try simulated decisions. No invitations are sent; these are not real participant approvals.

On compatible Linux x86_64, extract the complete archive and run `./start.sh` from its top-level directory. Open the local address printed in the terminal. Keep that terminal running while using the demo; press Ctrl+C to stop. This package includes the pinned Node 22.23.4 runtime and its LICENSE. It requires no package installation or network download to start. Set `LOOPKIND_PORT` if the default local port is occupied. The receiving environment is Ubuntu 24.04.5 x86_64; Windows and macOS are not qualified.

Changes save in this browser when the application confirms success. Export project makes a JSON copy; Open project validates a copy and clears simulated approvals. If saving times out, current changes remain open and Retry save attempts the same changes again. Until success, the previous saved project remains the persisted copy. Optional interpretation is not required; all fields can be entered manually.

Circles contain two to four people on one date, with a fixed UTC offset and a 15-minute time grid. Both people attend each help session. Search is bounded and does not guarantee the best possible plan. “Not in this circle” explains current review or readiness issues when known; an eligible person can also be absent from a selected proposal. A reopened proposal uses neutral wording because it does not retain the earlier search's alternatives or explanations.

This private preview composes captured, originally uncommitted upstream work. Its packaging commit identifies this exact candidate, not adoption into the primary owner's source. Primary ownership remains hamon-b378a5de. Inherited autosave ordering and day-boundary fixes belong to hamon-8257-20261027; keyboard editing belongs to hamon-e5de3c; configuration discovery lifetime belongs to loopkind-provider-status-lifetime-cd4280d1. Estate-4610aa27 contributed deadline recovery, circle omission explanation and isolated composition. BUILD.json records the exact packaging commit and payload hashes. Provider configuration does not establish live model use.

Public release and submission remain subject to the existing owner's review. This package is for private receiving and integration.
