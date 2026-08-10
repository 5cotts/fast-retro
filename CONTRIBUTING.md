# Contributing to fast-retro

Thanks for considering a contribution. This is a small project, so the process is lightweight.

## Getting set up

See the [README](./README.md#local-development) for prerequisites and the local dev loop. Short version:

```bash
git clone https://github.com/5cotts/fast-retro.git
cd fast-retro
( cd frontend && bun install )

# Terminal 1
RETRO_LEAD_TOKEN=dev-token cargo run

# Terminal 2
cd frontend && bun run dev
```

## Before opening a PR

There's no CI yet, so please run these locally and make sure they pass:

```bash
cargo test
cargo clippy --all-targets
( cd frontend && bun run check )
bun run test:e2e   # requires a running local instance; see tests/README.md
```

## Making changes

- **Branch naming**: `fix/`, `feat/`, `chore/`, or `docs/` prefixes, e.g. `fix/timer-no-op`.
- **Commits**: one logical change per commit; a short imperative summary line, with a body explaining *why* when the reasoning isn't obvious from the diff.
- **Scope**: prefer small, focused PRs over large ones — easier to review, easier to revert if something's wrong.
- **Comments**: only where the *why* isn't obvious from the code (a subtle invariant, a workaround for a specific bug). Well-named functions and variables should carry the *what*.

## Reporting bugs

Open a GitHub issue with steps to reproduce, what you expected, and what happened instead. For security vulnerabilities, see [SECURITY.md](./SECURITY.md) instead of filing a public issue.

## Questions

Open a GitHub issue — there's no separate chat/forum for this project.
