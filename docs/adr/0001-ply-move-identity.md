# Ply-based move identity

Identity key is (game_id, ply, source) with ply as half-move index. move_number and side are derived display fields only. Full-move count alone collides White and Black at the same number, turning every Black move into a false correction.

## Considered Options

- (game_id, move_number, source): rejected, collides on every move pair.
- (game_id, ply, source): accepted, unambiguous per half-move.
