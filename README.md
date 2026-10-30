# LOOPKIND

Connect neighbors through consented, time-feasible cycles of help, so useful exchanges can happen without requiring each pair to trade directly.

You mend a jacket, Theo tends your plants, Jules untangles Theo's spreadsheet. No pair trades directly, but the three of you form a circle. LOOPKIND finds circles of 2 to 4 people where everyone gives once and receives once, finds a schedule that fits everyone's availability and conditions, and then asks each person to review the exact plan. All people in the bundled example are fictional and approvals are simulated in this local demo; nothing is sent to anyone.

## Quick start

Requires Node 22 or newer. There are no npm dependencies.

```sh
export NEBIUS_API_KEY=...        # optional: enables the Nemotron note-to-fields step
npm start                        # or: LOOPKIND_PORT=4418 node server.mjs
npm test                         # 45 tests
```

Open the printed URL (default `http://127.0.0.1:4173`, or the port you set with `LOOPKIND_PORT`).

1. Pick an example scenario or edit the people.
2. Press **Find circles** to see a feasible schedule.
3. Choose a person in the review box and simulate their approval, or decline.
4. Scroll to **Write a note** and paste free text to have Nemotron draft a person's fields.

Without `NEBIUS_API_KEY` the app works fully; only the note step reports that interpretation is not configured and you enter fields by hand.

## How it uses NVIDIA Nemotron on Nebius Token Factory

The language step is real runtime inference. `src/provider.mjs` sends a server-side request to `https://api.tokenfactory.nebius.com/v1/chat/completions` (OpenAI-compatible) with `NEBIUS_API_KEY`. The browser never sees the key.

- Model: `nvidia/nemotron-3-super-120b-a12b` by default (override with `LOOPKIND_NEBIUS_MODEL`; only `nvidia/*` models are accepted). It is a reasoning model, so requests use `max_tokens: 1600` and only `message.content` is read. The 120B-total, 12B-active mixture-of-experts size is enough to follow a strict JSON contract with quoted evidence, while keeping latency low enough for an interactive form.
- Job: turn a free-text note ("I can mend clothing for 45 minutes. I need plant care. I am free 09:00 to 11:00...") into a structured draft: offer, need, session length, availability windows, whether the person must receive help first, and whether materials are ready.
- The model only proposes. The app's own code (`validateModelProposal`) rejects the answer unless:
  - every non-null value has an exact quotation that appears in the note;
  - skills come from the circle's catalog; durations are exact 15-minute steps that the quote actually states; windows match a quoted 24-hour interval on the selected date and UTC offset;
  - unknown facts stay `null` with a clarification question, never guessed;
  - the model cannot set approval, identity or activity flags.
- The draft is applied as **unreviewed**. The person must review it, and the deterministic planner (`src/planner.mjs`) and independent verifier (`src/verify.mjs`) never take the model's word for a schedule. Matching, cycle finding and time feasibility use no model at all.

## How the matching works

- Graph cycles of 2 to 4 people are enumerated where each person's offer is the next person's need.
- A bounded constraint search places each session on a 15-minute grid inside both people's availability; a person cannot be in two overlapping sessions; "I give only after I receive" conditions are respected; circular prerequisites are reported.
- `verifyPlan` re-checks every plan from scratch. Approvals bind to the exact project revision and schedule; any edit or withdrawal invalidates them.

## Honest limits

- Local single-user demo: fictional people, simulated approvals, no invitations, no accounts, one date, 15-minute slots, up to 12 people and cycles of up to 4.
- The search is bounded and the result reports when it is incomplete; it does not prove the best schedule.
- Nemotron can still misread a note. Validation catches unsupported values but a quoted sentence can still mean something a person did not intend, which is why review is required.

## Layout

`server.mjs` local server and API, `src/` planner, verifier, review book, provider, `public/` UI, `test/` (`node --test`), `scripts/smoke.mjs` end-to-end smoke test, `demo/` narrated demo script and submission answers.

## License

MIT, see `LICENSE`.
