# Outbox ordering and source mapping

outbox_events.id is bigserial so the publisher polls WHERE published=false ORDER BY id ASC in happened-order. games carries source/source_id mirroring tournaments, so MoveReceived resolves external Lichess game to internal game_id.

## Consequences

Publisher must order by id explicitly. UUID ids would silently XADD out of order. Gateway stays stateless for restarts but tracks live per-connection subscriptions in memory.
