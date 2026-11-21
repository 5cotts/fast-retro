## What and why

<!-- What changes, and why. Link the issue if there is one: Closes #123 -->

## Visible changes

<!-- What a user will see or do differently. Add screenshots or a short clip. Write "None" for internal-only changes. -->
<!-- Screenshots are public: no board links, participant names or card text. -->

## Verification steps

- [ ] `cargo test`, `cargo clippy --all-targets` and `( cd frontend && bun run check )` pass
- [ ] `./test-local.sh` passes if this touches the server, the board or anything the e2e tests cover
- [ ] Manual steps a reviewer can follow to see it working: <!-- list them, or "n/a" -->
- [ ] No board links, participant names or card text in this PR, its description, screenshots or test data (this repo is public)
- [ ] No secrets, tokens or `.env` values

## Before release

<!-- Anything to do before this ships: QA a build (`make qa-deploy PR=<n>`), set an env var, add the `doc-model-change` label if the Yjs board shape changes. Write "None" if nothing. -->

## After release

<!-- Anything to check or do once it is live: `make release-status`, a smoke test on prod, a follow-up PR. Write "None" if nothing. -->
