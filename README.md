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

## Tech stack

- **Backend**: Rust + [`axum`](https://github.com/tokio-rs/axum), with [`yrs`](https://github.com/y-crdt/y-crdt) (Yjs-compatible CRDT) for real-time state
- **Frontend**: [SvelteKit](https://kit.svelte.dev/) + [Bun](https://bun.sh) + [Tailwind CSS](https://tailwindcss.com/)
- **Deploy**: single self-contained binary — the SvelteKit static build is embedded into the Rust binary via [`rust-embed`](https://github.com/pyrossh/rust-embed). No separate web server needed.

## Quickstart

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Bun](https://bun.sh)

### Build

```bash
./build.sh
```

This builds the frontend (`bun run build`) and then the release binary (`cargo build --release`). The frontend's static assets are embedded into the final binary at compile time.

### Run

```bash
RETRO_LEAD_TOKEN=your-secret-token ./target/release/fast-retro
```

Then open <http://localhost:5102>.

The "lead" controls (timer, phase changes, board reset) are gated by a secret URL: `/lead/<RETRO_LEAD_TOKEN>`. Share the public URL with participants; keep the lead URL to yourself.

### Environment variables

| Variable           | Default                                | Description                                                                 |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| `RETRO_LEAD_TOKEN` | random 16-char string printed at start | Secret token gating the lead/host controls. Set this in production.         |
| `PORT`             | `5102`                                 | HTTP port to bind.                                                          |
| `RUST_LOG`         | `fast_retro=info,tower_http=info`      | `tracing-subscriber` env filter.                                            |

If `RETRO_LEAD_TOKEN` is unset, the server generates a random token on each start and prints it to stdout — handy for local development, but you'll want a stable one for any persistent deployment.

### Dev mode (frontend hot reload)

For frontend iteration:

```bash
cd frontend && bun install && bun run dev
```

The Vite dev server proxies the websocket and API requests to a separately-running backend on port 5102.

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

The process is stateless apart from the in-memory Yjs document, so it restarts cleanly; if you need persistence across restarts, persist the Yjs update stream out of band.

## License

[MIT](./LICENSE) © 2026 Scott Schmidt
