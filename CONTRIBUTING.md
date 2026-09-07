# Contributing

Thanks for considering contributing to Pacer.

This file covers the essentials for working on the repository. For a full
walkthrough of the layout and the architecture, see
[CLAUDE.md](CLAUDE.md) — the add-on packaging lives in `pacer/` and the
Next.js / tRPC / Drizzle application it serves lives in `pacer/app/`, both
built from local source by the Dockerfile.

## Development setup

The repository is self-contained; the only hard prerequisite is Docker.

### Build locally

```bash
# Build the addon Docker image
./scripts/build-local.sh

# Build and run (accessible at http://localhost:3100)
./scripts/build-local.sh --run

# Remove built images
./scripts/build-local.sh --clean
```

The multi-stage Dockerfile builds the Next.js application inside `pacer/app/`
and then assembles the Home Assistant add-on from `pacer/rootfs/`.

### Run the tests

```bash
# Engine unit tests (TypeScript / vitest)
pnpm --dir pacer/app --filter @acme/engine test

# Python sync test
python scripts/test_garmin_sync.py
```

Readiness scoring and the workout recommendation are deliberately
implemented twice — in Python (`rootfs/app/scripts/metrics-compute.py`,
`ha-notify.py`) for the HA sensors, and in TypeScript (`pacer/app/packages/
engine/`) for the web UI. The engine unit tests are what keep the two in
agreement; if you change one side, check the other.

## AI backends

Pacer ships several AI backends, chosen with the `ai_backend` option and
resolved in `pacer/app/packages/api/src/router/chat.ts`:

| Backend            | Implementation                                                   |
| ------------------ | ---------------------------------------------------------------- |
| `openrouter`       | `lib/openrouter.ts` — direct chat-completions call               |
| `ha_conversation`  | `lib/ha-conversation.ts` — via the HA Conversation API           |
| `ollama`           | `lib/ollama.ts` — local model, also used for embeddings          |
| `none`             | rules-based output only, no LLM                                  |

`ha_conversation` auto-discovers an agent by integration domain. When
discovery fails, HA falls back to the built-in Assist intent matcher, which
cannot answer a long coaching prompt — prefer `openrouter` where possible.

## Conventional commits

Commits follow the
[Conventional Commits][conventional-commits] format:
`type(scope): short imperative description, lowercase`. The body is wrapped
at 72 columns and explains **what** changed and **why**. Allowed types:
`fix`, `feat`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`,
`revert`, `ci`, `build`. Keep each commit to one logical change.

[conventional-commits]: https://www.conventionalcommits.org/en/v1.0.0/

## Licensing

This project is released under the [Apache License 2.0](LICENSE), with
portions under the MIT License as marked by their SPDX headers. Every file
carries an SPDX header, and the aggregate declarations live in
[REUSE.toml](REUSE.toml). Keep both intact when editing — they record the
upstream authors' copyright, which Apache-2.0 requires us to preserve.

The project is a fork of
[ha-garmin-fitness-coach-addon][ha-garmin-fitness-coach-addon] by Anil Belur
(Apache-2.0 / MIT), which in turn builds on
[create-t3-turbo][create-t3-turbo] (MIT). Accreditation and the statement of
changes required by Apache-2.0 section 4(b) live in [NOTICE](NOTICE).

[ha-garmin-fitness-coach-addon]: https://github.com/askb/ha-garmin-fitness-coach-addon
[create-t3-turbo]: https://github.com/t3-oss/create-t3-turbo
