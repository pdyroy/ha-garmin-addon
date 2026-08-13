# CLAUDE.md — Project Context

Home Assistant add-on that packages an AI-assisted training coach built on
Garmin Connect data. s6-overlay for process management, embedded PostgreSQL
for storage, Next.js for the UI, and a pluggable AI backend for coaching.

## Repository layout

This repo is self-contained: the add-on packaging and the application source
live together, and the image is built entirely from local source.

```
.
├── pulsecoach/                  # add-on folder — this IS the Docker build context
│   ├── config.json              # manifest: options, schema, ingress
│   ├── build.json               # multi-arch build config
│   ├── Dockerfile               # stage 1 builds app/, stage 2 = HA base image
│   ├── apparmor.txt             # AppArmor profile (name must match the slug)
│   ├── translations/en.yaml     # labels for the options UI
│   ├── rootfs/                  # overlaid onto the container filesystem
│   │   ├── app/scripts/*.py     # Garmin/Strava sync, metrics, HA notify
│   │   ├── app/blueprints/      # HA automation blueprints
│   │   └── etc/s6-overlay/      # s6 service definitions
│   └── app/                     # the Next.js monorepo (pnpm + Turbo)
│       ├── apps/nextjs/         # web UI, served through HA ingress
│       ├── packages/api/        # tRPC routers + AI backends
│       ├── packages/engine/     # deterministic coaching maths
│       ├── packages/db/         # drizzle schema
│       ├── packages/ui/         # components + theme
│       └── tooling/tailwind/    # design tokens (oklch, light + dark)
├── scripts/                     # local build and token helpers
└── repository.json              # HA add-on repository manifest
```

**Why `app/` sits inside `pulsecoach/`:** Home Assistant builds a local add-on
with the add-on folder as the Docker build context. Source outside that folder
cannot be `COPY`ed, so the application lives one level down.

## Architecture notes

### Add-on structure
- The `pulsecoach/` directory name is the add-on slug — renaming it means HA
  treats it as a different add-on, with a fresh database and new entity IDs.
- `rootfs/` is overlaid onto the container filesystem at runtime.
- s6-overlay manages the service lifecycle. `s6-rc.d/pulsecoach/run` is the
  entry point: it boots PostgreSQL, pushes the schema, starts Next.js behind
  an ingress proxy, and supervises five background loops.
- `SUPERVISOR_TOKEN` is injected by HA because `homeassistant_api: true`.

### AI backends
Selected via the `ai_backend` option and resolved in
`app/packages/api/src/router/chat.ts`:

| Backend | Path |
|---|---|
| `openrouter` | `app/packages/api/src/lib/openrouter.ts` — direct chat-completions call |
| `ha_conversation` | `app/packages/api/src/lib/ha-conversation.ts` — via the HA Conversation API |
| `ollama` | `app/packages/api/src/lib/ollama.ts` — local model, also used for embeddings |
| `none` | rules-based output only, no LLM |

`ha_conversation` auto-discovers an agent by integration domain. It does not
recognise every conversation integration, and when discovery fails HA falls
back to the built-in Assist intent matcher, which cannot answer a long
coaching prompt. `openrouter` avoids that path entirely.

`app/packages/api/src/lib/ai-framing.ts` carries a second, older backend
chain that does not know about OpenRouter — it needs consolidating.

### Garmin sync
- `rootfs/app/scripts/garmin-sync.py` uses the `garminconnect` package, pinned
  to 0.2.40 with `garth` 0.6.3. The auth server uses the garth-based API that
  garminconnect 0.3.0 removed; do not unpin without rewriting it.
- Tokens live in `/data/garmin-tokens/`, persistent across restarts, and are
  deliberately never written to `/share/` (other add-ons can read it).
- The database is backed up to `/share/` so it survives an uninstall.

### Duplicated logic — be careful here
Readiness scoring and workout recommendation exist **twice**: in Python
(`rootfs/app/scripts/metrics-compute.py`, `ha-notify.py`) for the HA sensors,
and in TypeScript (`app/packages/engine/`) for the web UI. The engine unit
tests are what keep the two in agreement. Change one, check the other.

## Development

```bash
./scripts/build-local.sh          # build the image (requires Docker)
./scripts/build-local.sh --run    # build and run on port 3100
./scripts/build-local.sh --clean  # remove build artifacts
```

Engine tests: `pnpm --filter @acme/engine test` inside `pulsecoach/app/`.

To run this on HAOS, mirror the `pulsecoach/` folder to `/addons/<slug>/` —
HA expects `config.json` directly beneath the add-on folder — then build it
from the local add-on entry in the UI. `config.json` must have no `image`
key, otherwise HA pulls a registry image instead of building.

## Conventions

Conventional Commits: `type(scope): short imperative description`, lowercase,
body wrapped at 72 columns explaining what and why. Allowed types: `fix`,
`feat`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`, `ci`,
`build`. One logical change per commit.

Licensing: the codebase is Apache-2.0 with some MIT files, and carries
per-file SPDX headers plus a REUSE configuration. Keep both intact when
editing — they are the upstream authors' copyright notices.
