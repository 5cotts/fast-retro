# Fast Retro

A multiplayer, real-time retrospective board — a self-hostable alternative to easyretro.io.

## Features

- **Cards** organized by column, with rich text and authorship
- **Votes** to surface what matters most
- **Emoji reactions** on cards
- **Threaded comments** on cards
- **Drag-to-reorder** within and between columns
- **Lead-controlled timer** for time-boxed phases
- **CSV export** of the whole board
- **Typing indicators** so you can see when someone is composing
- **Presence** — see who's currently on the board
- **Light / dark / auto theme**
- **Named users** with persistent identity per browser
- **Google Sign-In** (optional) — ties board ownership to your Google account, so you can recover host access from any browser
- **SQLite persistence** — boards and archives survive restarts

## Tech stack

- **Backend**: Rust + [`axum`](https://github.com/tokio-rs/axum), with [`yrs`](https://github.com/y-crdt/y-crdt) (Yjs-compatible CRDT) for real-time state
- **Frontend**: [SvelteKit](https://kit.svelte.dev/) + [Bun](https://bun.sh) + [Tailwind CSS](https://tailwindcss.com/)
- **Deploy**: single self-contained binary — the SvelteKit static build is embedded into the Rust binary via [`rust-embed`](https://github.com/pyrossh/rust-embed). No separate web server needed.

## Local development

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) — stable toolchain (a `rust-toolchain.toml` is checked in, so `rustup` will pick the right channel automatically)
- [Bun](https://bun.sh) ≥ 1.1

No Docker needed — both runtimes install cleanly on macOS and Linux. If you'd rather not install them on your host, see [Dev container](#dev-container-vs-code--cursor--codespaces) below.

### Get the code

```bash
git clone https://github.com/5cotts/fast-retro.git
cd fast-retro
( cd frontend && bun install )
```

### Run it — two-terminal dev loop (recommended)

This gives you Rust auto-rebuilds on backend changes and Vite HMR on the frontend.

```bash
# Terminal 1 — backend (port 5102)
RETRO_LEAD_TOKEN=dev-token cargo run

# Terminal 2 — frontend dev server (port 5173)
cd frontend && bun run dev
```

Then open <http://localhost:5173>. Vite proxies `/api/*` and the `/ws` websocket to the backend on `5102` (see `frontend/vite.config.ts`). Point at a different backend with `VITE_BACKEND_URL=http://host:port bun run dev`.

The "lead" controls (timer, phase changes, board reset) are gated by a secret URL: `/lead/dev-token`. Share the public URL with participants; keep the lead URL to yourself.

### Run it — single binary (production-like)

```bash
./build.sh
RETRO_LEAD_TOKEN=dev-token ./target/release/fast-retro
```

### Dev container (VS Code / Cursor / Codespaces)

A `.devcontainer/` is checked in so you can develop without installing Rust or Bun on your host. You'll need [Docker](https://www.docker.com/) and the Dev Containers extension for your editor (or just open the repo in GitHub Codespaces).

1. Open the repo in VS Code or Cursor.
2. Run **Dev Containers: Reopen in Container** from the command palette.
3. The container builds, `bun install` runs automatically, and `rust-analyzer` / Svelte / Tailwind / Playwright extensions are pre-installed.
4. In the container terminal, run the two-terminal dev loop above. Ports `5102` and `5173` are forwarded to your host, and `RETRO_LEAD_TOKEN=dev-token` is already set.

Playwright browsers aren't bundled in the image — run `cd frontend && bunx playwright install --with-deps chromium` once if you want to run e2e tests inside the container.

Then open <http://localhost:5102>. `build.sh` runs `bun run build` then `cargo build --release`; the SvelteKit static output is embedded into the binary via `rust-embed`.

### Tests

```bash
# Rust unit tests
cargo test

# Frontend type-check
( cd frontend && bun run check )

# Playwright end-to-end (first run only: install browsers)
bunx playwright install
bun run test:e2e
```

The e2e suite hits the live deployment by default; see `playwright.config.ts` to point it at `http://localhost:5173` or `http://localhost:5102`.

### Environment variables

| Variable           | Default                                | Description                                                                 |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| `RETRO_LEAD_TOKEN` | random 16-char string printed at start | Secret token gating the lead/host controls. Set this in production.         |
| `PORT`             | `5102`                                 | HTTP port to bind.                                                          |
| `FASTRETRO_DB`     | `data/fastretro.db`                    | Path to the SQLite database file. Created automatically on first run.       |
| `GOOGLE_CLIENT_ID` | unset (Google Sign-In disabled)        | Google OAuth client ID. Set to enable Google Sign-In; see [Google Sign-In](#google-sign-in) below. |
| `COOKIE_SECURE`    | `true`                                 | Whether session cookies are marked `Secure`. Set to `0`/`false` for local HTTP testing. |
| `RUST_LOG`         | `fast_retro=info,tower_http=info`      | `tracing-subscriber` env filter.                                            |
| `VITE_BACKEND_URL` | `http://localhost:5102`                | (dev only) Backend the Vite dev server proxies `/api` and `/ws` to.         |

If `RETRO_LEAD_TOKEN` is unset, the server generates a random token on each start and prints it to stdout — handy for local development, but you'll want a stable one for any persistent deployment.

A `.env.example` listing all of these is checked in — copy it to `.env` and adjust for local use (`.env` itself is gitignored).

### Google Sign-In

Signing in with Google ties board ownership to your account instead of a `localStorage` key, so you can recover host access from a new browser or device. It's entirely optional — you can also use fast-retro anonymously, with host access tied to a device-bound key instead.

To enable it:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create an OAuth consent screen (External, publish to Production) and an OAuth Client ID of type "Web application."
2. Add your deployment's origin(s) (e.g. `https://retro.example.com`) under **Authorized JavaScript origins**. No redirect URI is needed — this app uses Google Identity Services' ID-token flow, not the OAuth redirect flow, so there's no client secret involved either.
3. Set `GOOGLE_CLIENT_ID` to the resulting client ID and restart the server.

This app only requests the non-sensitive `openid`/`email`/`profile` scopes, so there's no Google verification process or user cap to worry about regardless of how many people sign in.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Rust binary (axum)                              │
│  ┌─────────────────────────┐  ┌───────────────┐  │
│  │ /ws  (websocket)        │  │ /api/...      │  │
│  │   yrs CRDT sync         │  │  health,      │  │
│  │   + awareness/presence  │  │  lead-token   │  │
│  └─────────────────────────┘  └───────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ static (rust-embed): SvelteKit build/      │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                       ▲
                       │ wss + https
                       │
                  ┌────┴─────┐
                  │ Browsers │  (SvelteKit SPA, yjs client)
                  └──────────┘
```

- The backend serves **both** the API/websocket endpoints and the embedded static frontend from a single port.
- Board state is a Yjs document. Clients exchange Yjs update messages over the websocket; the server maintains the authoritative document in memory and broadcasts updates to all peers.
- Awareness (cursors, typing indicators, presence) flows through the same websocket using the standard `y-protocols` awareness channel.

## Deploying

Because the binary embeds the frontend, deployment is just:

1. `./build.sh` on a build host (or in CI).
2. Copy `target/release/fast-retro` to the server.
3. Run behind a reverse proxy that terminates TLS and forwards both HTTP and websocket traffic to the port.

Example reverse-proxy target URL (replace with your own host): `https://retro.example.com → http://127.0.0.1:5102`.

Board state, archives, and (if Google Sign-In is enabled) user accounts all persist to the SQLite database at `FASTRETRO_DB` (default `data/fastretro.db`), so the process restarts cleanly without losing data. Back up that file if you want durability beyond the server's disk.

## License

[MIT](./LICENSE) © 2026 Scott Schmidt
