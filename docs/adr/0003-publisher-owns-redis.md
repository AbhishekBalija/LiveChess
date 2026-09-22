# Publisher owns all Redis writes

Move Handler writes only to Postgres (moves + outbox_events, one transaction). Outbox Publisher performs both Redis writes (Stream XADD + cache fen/last_move/version) from the same polled row. Direct Move Handler to Redis would recreate the dual-write risk the outbox removes, leaving stale cache with no retry.

## Consequences

Duplicate XADD on publisher crash between XADD and marking published is tolerated downstream via version checks. No new infrastructure, one reliability posture for both Redis writes.
