# Security Policy

## Supported Versions

fast-retro doesn't yet publish versioned releases — security fixes are applied to the `main` branch. If you're running a self-hosted deployment, track `main`.

## Reporting a Vulnerability

Please report security vulnerabilities privately using [GitHub's private vulnerability reporting](https://github.com/5cotts/fast-retro/security/advisories/new) (Security tab → Report a vulnerability) rather than filing a public issue.

Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof of concept
- Any suggested fix, if you have one

You should receive an initial response within a few days. There's no bug bounty program, but reports are taken seriously and credited in the fix unless you'd prefer otherwise.

## Scope

Areas of particular interest for security review:

- Session/cookie handling and Google ID-token verification (`src/auth.rs`)
- Lead-token authorization for host-only actions (`src/main.rs`)
- WebSocket message handling and Yjs document sync (`src/sync.rs`)
- SQLite query construction (`src/db.rs`)
