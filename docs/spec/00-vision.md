# 00. Vision

> **spec_version:** 0.1.0
> **status:** draft
> **last_updated:** 2026-07-30

## q1. What is the product?

A Telegram Mini App called **HabitsTracker** — a personal habit tracker that pings the user twice a day (morning + evening) and collects structured self-reports on health and well-being.

## q2. Who is it for?

Single user (the owner). Designed to be self-hostable, easy to back up, and privacy-respecting. Multi-tenant architecture is NOT in scope for v0.1.0, but the data model and API should not preclude adding it later.

## q3. Why?

Tracking habits manually in a notes app is friction. Telegram is already on the phone. A Mini App removes install friction, lives where the user already is, and lets the bot do the reminding.

## q4. Scope of MVP (v0.1.0)

**In scope:**
- Single user, single Telegram account
- Morning survey (sleep, mood on waking, intention)
- Evening survey (smoking, food/sugar, sport, mood, best memory of the day)
- Configurable reminder times (morning + evening)
- History view (last 7 / 30 / all days)
- Local time zone support
- SQLite-backed storage
- Deploy via Docker on the user's VPS
- HTTPS via Let's Encrypt
- Branch protection on `main`, CI-check that links code to spec sections

**Out of scope (v0.1.0):**
- Multi-user / multi-tenant
- Statistics, charts, correlations
- Export to CSV / JSON
- Notifications outside Telegram
- Payments, subscriptions
- iOS / Android native app
- Internationalisation (RU/EN only, RU default)

## q5. Non-goals

- Not a social product. No sharing, no leaderboards, no friends.
- Not a coach. No AI feedback, no recommendations, no insights engine.
- Not a journal replacement. Best-memory field is for one short sentence, not a diary.

## q6. Success criteria

The MVP is considered done when:
1. User can install the bot, open the Mini App, configure two reminder times, and receive both reminders on schedule.
2. User can fill out morning and evening surveys from the phone, see them saved, and revisit them in history.
3. All code is on `main` via PRs; `main` is protected; CI-check passes.
4. Service is deployed on the user's VPS via `git push` and runs under HTTPS.
5. Backup of `habits.db` can be done with a single `cp` command.

## q7. Privacy stance

- All data lives on the user's VPS. No third-party services, no analytics, no telemetry.
- The Telegram bot only knows the user's `telegram_id` — used to identify them in the database.
- No data is sent to any service other than the user's own backend.
- Source code is public on GitHub; data and secrets are not.

## q8. Tech stack (frozen for v0.1.0)

| Layer | Choice | Rationale |
|---|---|---|
| Mini App frontend | Vanilla JS + Vite + plain CSS | Smallest possible bundle, fewest moving parts |
| Backend | Node.js (>= 20) + Fastify | Single language, fast startup, good ecosystem |
| Database | SQLite (file-based) | Single-file backup, zero ops, fine for one user |
| Containers | Docker + docker-compose | Already present on VPS via Portainer |
| Reverse proxy | Caddy 2 + Let's Encrypt | One config file, ACME built-in, no certbot to babysit |
| Deploy | Bare git repo on VPS + post-receive hook | Simplest "git push = deploy" workflow |
| CI | GitHub Actions (spec-check + lint) | Free for public repos |
| Bot | Telegram Bot API via `node-telegram-bot-api` | Most popular, well-maintained |

Any deviation from this stack requires a new ADR in `docs/spec/adr/`.

## q9. Repository layout

```
habitstracker/
├── docs/spec/             # THIS DIRECTORY — single source of truth
│   ├── README.md
│   ├── CHANGELOG-spec.md
│   ├── 00-vision.md
│   ├── 01-personas.md
│   ├── 02-user-stories.md
│   ├── 03-features/
│   ├── 04-data-model.md
│   ├── 05-api.md
│   ├── 06-ui-states.md
│   ├── 07-non-functional.md
│   ├── 08-deploy.md
│   └── adr/
├── server/                # Fastify backend
├── web/                   # Vite + vanilla JS Mini App
├── scripts/               # spec-check, deploy helpers
├── .github/workflows/     # GitHub Actions
├── docker-compose.yml
├── Dockerfile
├── README.md
├── LICENSE
└── .gitignore
```

## q10. Versioning

- Spec uses semver: `MAJOR.MINOR.PATCH`.
- `MAJOR` — breaking change in user-visible behaviour or data model.
- `MINOR` — new feature or new section in spec.
- `PATCH` — clarification, typo, no behaviour change.
- Every spec change is a commit prefixed with `docs(spec)`.
- Every code change references at least one spec section via marker `spec:NN-filename#qN`.
- CI-check (`scripts/spec-check.js`) fails the build if code references a non-existent section.
