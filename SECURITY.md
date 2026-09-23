# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them
privately through GitHub: on this repository, go to **Security > Report a
vulnerability**. You will get a response as soon as possible.

Include what you found, how to reproduce it, and its impact if you know it.

## Scope

LiveChess stores only public game data from the Lichess broadcast API. The
most sensitive value is a deployment's `LICHESS_TOKEN`, which must stay in
`server/.env` (git-ignored) and needs only the `study:read` scope.
