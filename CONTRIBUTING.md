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

CI runs the type check, unit tests, `cargo test` and clippy on every PR, but please run them locally first and make sure they pass:

```bash
cargo test
cargo clippy --all-targets
( cd frontend && bun run check )
./test-local.sh    # runs an isolated local instance + the full suite; see tests/README.md
```

## How PRs are reviewed

`main` is protected: every change goes through a pull request, CI must pass, and the maintainer reviews and merges it. Anything merged to `main` is built and can reach production, so reviews are careful and may ask for changes. PRs from first-time contributors need a maintainer to approve the CI run before it starts. The full end-to-end suite runs when a maintainer adds the `e2e` label.

Changes to `.github/`, `scripts/`, the build files and dependency lockfiles get extra scrutiny, so keep those PRs small and explain them.

## Making changes

- **Branch naming**: `fix/`, `feat/`, `chore/`, or `docs/` prefixes, e.g. `fix/timer-no-op`.
- **Commits**: one logical change per commit; a short imperative summary line, with a body explaining *why* when the reasoning isn't obvious from the diff.
- **Scope**: prefer small, focused PRs over large ones — easier to review, easier to revert if something's wrong.
- **Comments**: only where the *why* isn't obvious from the code (a subtle invariant, a workaround for a specific bug). Well-named functions and variables should carry the *what*.

## Reporting bugs

Open a GitHub issue with steps to reproduce, what you expected, and what happened instead. For security vulnerabilities, see [SECURITY.md](./SECURITY.md) instead of filing a public issue.

## Questions

Open a GitHub issue — there's no separate chat/forum for this project.
