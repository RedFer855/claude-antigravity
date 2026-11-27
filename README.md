# claude-antigravity

**Claude plans and reviews. Antigravity executes. Everything is measured.**

A Claude Code plugin that hands the heavy, well-specified work (multi-file changes, refactors, Word/PDF documents) to the Antigravity CLI (`agy`, Gemini models) and gives you back one compact JSON verdict instead of a wall of narration.

[![CI](https://github.com/RedFer855/claude-antigravity/actions/workflows/ci.yml/badge.svg)](https://github.com/RedFer855/claude-antigravity/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/RedFer855/claude-antigravity?include_prereleases)](https://github.com/RedFer855/claude-antigravity/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-339933)
![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-blue)

> 🇪🇸 [Léeme en español](README.es.md)

---

## Why

Every turn Claude takes re-reads the whole conversation, and that is the expensive part. A task that needs 10 turns of edit → run → fix costs 10 full contexts. This plugin lets Claude write **one short brief**, lets `agy` do the reading, editing and iterating on a separate quota, and lets Claude look at **one result**.

It only delegates when it actually saves turns, and it never trusts blindly: every delegation is checkpointed, fenced and verified.

## How it works

```
        you ──► Claude ──► brief (short, English, paths not contents)
                              │
                              ▼
                  ┌────────────────────────┐
                  │  agy-run.mjs (runtime) │
                  │  1. check quota        │
                  │  2. git checkpoint     │
                  │  3. run agy            │
                  │  4. diff + guard       │
                  │  5. verify (your cmd)  │
                  │  6. log KPIs           │
                  └───────────┬────────────┘
                              ▼
        Claude reads ONE compact JSON ──► approve / continue / undo
```

## Features

- **Quota-aware.** Reads `agy`'s usage before spending anything; refuses to start if the model's quota group is under 10% (configurable with `--min-cuota`). `/agy:cuota` shows all groups, no tokens spent.
- **Safe checkpoints.** Before and after every run it takes a git snapshot as a hidden ref (`refs/agy/<id>-antes` / `-despues`) built with a temporary index, so **your working tree, index and uncommitted changes are never touched**. The diff is measured between the two snapshots.
- **Safe one-command undo.** `deshacer --id <id>` reverts only the files `agy` wrote with its file tools. Anything you or Claude edited in parallel is reported separately (`cambios.otros`) and left alone, and a file edited after the run is never overwritten unless you pass `--forzar`.
- **Secret fence.** Contents of `.env*` (except `.env.example`-style templates) and `settings.local.json` are saved before the run and restored afterwards if the agent touched, deleted or created them. You are told which paths were reverted, and a copy of whatever the fence replaces is kept first, so an edit of yours made during the run is never lost.
- **Permission control.** A conservative base allow/deny list (read-only commands and `git status/diff/log` allowed; `rm -r`, `Remove-Item`, `git push`, `git reset --hard`, `git clean`… denied) plus per-project rules managed with `/agy:permisos`. Command rules are exact-match; anything not matching is denied in headless mode instead of hanging. `--comando "npm test"` allows a command for one delegation only and always removes it afterwards, even if the run fails or is killed.
- **Verification built in.** `--verificar "npm test"` runs your command after `agy` finishes and returns the tail of the output. A failed check becomes `verificacion_fallida`, ready for a one-shot correction turn.
- **Questions mode.** `--preguntas` makes `agy` read the brief and reply with up to 5 blocking questions (or `READY`) **without modifying anything**, so big tasks and documents are not redone because of a misunderstanding.
- **`/goal` mode** for long autonomous tasks, plus `--conversation <id>` to continue a session by sending only the delta.
- **Compact output.** A long reply is cut to ~3000 chars for Claude's context keeping the start and the end, and the JSON points to the full reply on disk (`respuesta_completa`); brief and reply are saved there too.
- **KPIs.** One JSON line per delegation (`tareas.jsonl`): model, mode, duration, turns, tokens, denied actions, files/lines changed, verification result, and whether you overrode Claude's recommendation. Measure what each model level really costs before changing defaults.
- **Parallel work.** Split a task so Claude and `agy` touch different files, run `agy` in the background and keep going.
- **Optional notification** when a delegation finishes (Windows, via a local PowerShell script if you have one; silently does nothing otherwise).

## Install

Requirements: **Node.js ≥ 20**, **git**, and the **Antigravity CLI (`agy`)** installed and signed in. The runtime finds `agy` on your `PATH`, at `%LOCALAPPDATA%\agy\bin\agy.exe`, or via the `AGY_BIN` environment variable.

In Claude Code:

```text
/plugin marketplace add RedFer855/claude-antigravity
/plugin install agy@claude-antigravity
```

No `npm install` needed: the plugin has zero dependencies.

## Updating

```bash
claude plugin marketplace update claude-antigravity
claude plugin update agy@claude-antigravity
```

Restart Claude Code to apply it. What changed in each version is in the [CHANGELOG](CHANGELOG.md) and on the [Releases](https://github.com/RedFer855/claude-antigravity/releases) page.

Your KPI log, per-project permissions and saved briefs are written to Claude Code's plugin data directory (`CLAUDE_PLUGIN_DATA`), outside the plugin folder, so updating does not wipe them. Versions follow [SemVer](https://semver.org): `0.x.y` for fixes, `0.x.0` for new features, and `1.0.0` once the command and data-file contract is stable. Any change to the data file formats ships with a migration.

## Usage

| Command | What it does |
| :-- | :-- |
| `/agy:delegar <task>` | Force a delegation. Claude writes the brief, `agy` executes, Claude reviews. Flags: `--model <slug>`, `--goal`, `--preguntas`, `--continuar <id>` |
| `/agy:cuota` | Remaining quota per model group (5 h and weekly windows) and when it resets |
| `/agy:permisos` | See, add or remove what `agy` may write and run in the current project. Always asks you before adding a rule |

The `delegacion` skill also triggers on its own: before a task that would take Claude more than ~6 turns, when you ask for a Word/PDF document, or when you say "use agy". It recommends a model in a single question (Delegate with X / Another model / I'll do it).

You can also call the runtime directly:

```bash
node agy-bridge/scripts/agy-run.mjs --cwd /path/to/project \
  --model gemini-4-hydrogen-high \
  --verificar "npm test" --tipo feature <<'BRIEF'
Add input validation to src/api/users.ts. Done when `npm test` passes.
Only modify files under src/api/.
BRIEF
```

```bash
node agy-bridge/scripts/agy-run.mjs cuota                        # quota, no tokens spent
node agy-bridge/scripts/agy-run.mjs deshacer --id d1234 --cwd .  # revert one delegation
```

### Verdicts

`estado` is one of `ok`, `parcial`, `verificacion_fallida`, `permiso_denegado` (with the exact denied command), `sin_cuota`, `vacio`, `error` or `timeout`. Exit code is `0` only for `ok`. The skill caps corrections at two continuations, then Claude takes over or asks you.

### Which model?

Default is `gemini-4-hydrogen-high`; `medium` for mechanical single-file work, `xhigh` before switching models, `gemini-4-neon-high` for security-sensitive reviews, `gemini-4-carbon-high` for long, deep reasoning, Orchestrator (`gemini-pro-orchestrator` with Carbon, `gemini-pro-orchestrator-neon` with Neon) for large tasks that split into independent pieces, and Claude models *inside* `agy` (billed to your Google quota, separate from your Claude one) for hard, well-specified tasks. The full table lives in [`skills/delegacion/SKILL.md`](agy-bridge/skills/delegacion/SKILL.md).

## Project layout

```
.claude-plugin/marketplace.json     marketplace entry
agy-bridge/
  .claude-plugin/plugin.json        plugin manifest (name: agy)
  commands/                         /agy:delegar  /agy:cuota  /agy:permisos
  skills/delegacion/                when and how to delegate, model choice, review loop
  skills/gemini-prompting/          how to write a brief that makes agy do the work
  permisos/base.json                global allow/deny list
  scripts/agy-run.mjs               the runtime
  scripts/lib/                      quota, git snapshots, stream parser, guard, KPIs…
  tests/                            node:test suite
scripts/                            repo tooling: verificar.mjs, release.mjs (not shipped)
.github/workflows/                  ci.yml, release.yml
CHANGELOG.md                        release notes source
```

## Development

```bash
npm test                        # repo scripts + plugin tests (what CI runs)
npm run verificar               # versions, CHANGELOG, manifests, frontmatter
npm run release -- minor        # bump version + CHANGELOG on a release/vX branch
npm run etiquetar               # from an up-to-date main: tag it; CI publishes the GitHub Release
```

Runtime data (KPI log, per-project permissions, saved briefs and replies) goes to `CLAUDE_PLUGIN_DATA` when installed, so plugin updates never wipe it.

## Notes

- Built and tested on **Windows 11**. The core is plain Node + git, but macOS/Linux are untested; the finish notification is Windows-only.
- The skill and command prompts are written in **Spanish** (the briefs sent to `agy` are written in English to save tokens). PRs with translations are welcome.
- This is an independent community project. It is not affiliated with or endorsed by Anthropic or Google.

## Contributing

Issues and pull requests are welcome, especially for macOS/Linux support and translations. Keep the zero-dependency rule, add a test for new runtime behaviour and note the change under `[Unreleased]` in the CHANGELOG. Everything lands on `main` through a PR with the `CI completo` check green; see [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © 2026 Fernando Barahona

---

If this saved you some turns (or some quota), a ⭐ helps other people find it.
