## What and why

<!-- What changes, and why. Link the issue if there is one: Closes #123 -->

## Checklist

- [ ] `cargo test`, `cargo clippy --all-targets` and `( cd frontend && bun run check )` pass
- [ ] `./test-local.sh` passes if this touches the server, the board or anything the e2e tests cover
- [ ] No board links, participant names or card text in this PR, its description, screenshots or test data (this repo is public)
- [ ] No secrets, tokens or `.env` values
