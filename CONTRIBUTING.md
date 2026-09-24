# Contributing to LiveChess

Thanks for helping. This guide covers setup, the workflow, and what a good
pull request looks like.

## Setup

Prerequisites: [Bun](https://bun.sh), Postgres and Redis running locally.
The [README](README.md#run-locally) has the full steps; in short:

```sh
cp server/.env.example server/.env        # add a free Lichess token, see README
(cd server && bun install && bun run migrate)
(cd client && bun install)
bun run dev                               # gateway, publisher, client and supervisor
```

Open http://localhost:5173.

## Before you start

- Read [`CONTEXT.md`](CONTEXT.md) for the domain words (Ply, Version,
  Correction, Truncation) and use them in code and docs.
- Architecture decisions live in [`docs/adr/`](docs/adr). If your change
  alters one, add a new ADR instead of silently diverging.
- Check [`docs/roadmap.md`](docs/roadmap.md) and the open issues; comment on
  an issue before starting larger work.

## Workflow

- Branch from `main`: `feature/...`, `fix/...`, `chore/...`, `docs/...`.
- Never push to `main`; open a pull request. CI must pass before merging.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(server): ...`, `fix(client): ...`), and user-visible changes get a
  line in [CHANGELOG.md](CHANGELOG.md) under Unreleased.

## Checks

```sh
cd server && bun run typecheck && bun run test
cd client && bun run lint && bun run build && bun run test
```

Server integration tests run only when `TEST_DATABASE_URL` and
`TEST_REDIS_URL` are set (see `server/.env.example`); CI always runs them.

## Pull requests

Describe what changed, why, and how to test it, and add screenshots for
UI changes (the template asks for these). Keep pull requests focused on one
change.

## Releases

LiveChess uses [Semantic Versioning](https://semver.org/) and stays on
0.x while it is pre-1.0: a minor bump for a finished slice or a notable
set of features, a patch bump for fixes only. A release is a
`chore/release-X.Y.Z` pull request that moves the Unreleased entries in
CHANGELOG.md into a dated section and sets `version` in the three
`package.json` files. After it merges, the merge commit is tagged
`vX.Y.Z` and published as a GitHub release with that changelog section
as its notes.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
