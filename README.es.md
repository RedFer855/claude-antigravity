# claude-antigravity

**Claude planea y revisa. Antigravity ejecuta. Todo se mide.**

Un plugin de Claude Code que le pasa el trabajo pesado y bien especificado (cambios en varios archivos, refactors, documentos Word/PDF) al CLI de Antigravity (`agy`, modelos Gemini) y te devuelve **un solo JSON compacto** en vez de un muro de narración.

[![CI](https://github.com/RedFer855/claude-antigravity/actions/workflows/ci.yml/badge.svg)](https://github.com/RedFer855/claude-antigravity/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/RedFer855/claude-antigravity?include_prereleases)](https://github.com/RedFer855/claude-antigravity/releases)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-green.svg)](LICENSE)
![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-339933)
![Plugin de Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d97757)
![Cero dependencias](https://img.shields.io/badge/dependencias-0-blue)

> 🇬🇧 [English README](README.md)

---

## Por qué

Cada turno de Claude vuelve a leer toda la conversación, y eso es lo caro. Una tarea de 10 turnos de editar → correr → arreglar cuesta 10 contextos completos. Este plugin hace que Claude escriba **un brief corto**, que `agy` lea, edite e itere con su propia cuota, y que Claude revise **un solo resultado**.

Solo delega cuando de verdad ahorra turnos, y nunca a ciegas: cada delegación lleva punto de control, cerca de seguridad y verificación.

## Cómo funciona

```
        tú ──► Claude ──► brief (corto, en inglés, rutas y no contenido)
                              │
                              ▼
                  ┌────────────────────────┐
                  │  agy-run.mjs (runtime) │
                  │  1. revisa la cuota    │
                  │  2. punto de control   │
                  │  3. ejecuta agy        │
                  │  4. diff + guarda      │
                  │  5. verifica (tu cmd)  │
                  │  6. registra KPIs      │
                  └───────────┬────────────┘
                              ▼
        Claude lee UN JSON compacto ──► aprueba / continúa / deshace
```

## Qué incluye

- **Consciente de la cuota.** Lee el uso de `agy` antes de gastar nada y no arranca si el grupo del modelo está bajo 10% (ajustable con `--min-cuota`). `/agy:cuota` muestra todos los grupos sin gastar tokens.
- **Puntos de control seguros.** Antes y después de cada ejecución crea un snapshot de git como referencia oculta (`refs/agy/<id>-antes` y `-despues`) con un índice temporal, así que **tu árbol de trabajo, tu índice y tus cambios sin commitear nunca se tocan**. El diff se mide entre los dos snapshots.
- **Deshacer seguro con un comando.** `deshacer --id <id>` revierte solo los archivos que `agy` escribió con sus herramientas de archivo. Lo que tú o Claude editaron en paralelo se informa aparte (`cambios.otros`) y no se toca, y un archivo editado después de la corrida no se pisa salvo que pases `--forzar`.
- **Cerca de secretos.** El contenido de `.env*` (menos plantillas tipo `.env.example`) y de `settings.local.json` se guarda antes y se repone al terminar si el agente lo cambió, borró o creó. Se te informa qué rutas se revirtieron, y antes se guarda una copia de lo que la cerca reemplaza, así que una edición tuya hecha durante la corrida no se pierde.
- **Control de permisos.** Lista base conservadora (comandos de solo lectura y `git status/diff/log` permitidos; `rm -r`, `Remove-Item`, `git push`, `git reset --hard`, `git clean`… denegados) más reglas por proyecto con `/agy:permisos`. Las reglas de comando son de coincidencia exacta; lo que no coincide se rechaza en modo headless en vez de quedarse colgado. `--comando "npm test"` permite un comando solo durante una delegación y siempre lo quita al terminar, aunque falle o se corte.
- **Verificación integrada.** `--verificar "npm test"` corre tu comando al terminar `agy` y devuelve el final de la salida. Si falla, el estado es `verificacion_fallida`, listo para una corrección.
- **Modo preguntas.** `--preguntas` hace que `agy` lea el brief y responda con hasta 5 preguntas bloqueantes (o `READY`) **sin modificar nada**, para no rehacer tareas grandes o documentos por un malentendido.
- **Modo `/goal`** para tareas largas y autónomas, y `--conversation <id>` para continuar una sesión mandando solo el delta.
- **Salida compacta.** Una respuesta larga se recorta a ~3000 caracteres para el contexto de Claude conservando el principio y el final, y el JSON apunta a la respuesta completa en disco (`respuesta_completa`); el brief y la respuesta también se guardan ahí.
- **KPIs.** Una línea JSON por delegación (`tareas.jsonl`): modelo, modo, duración, turnos, tokens, acciones denegadas, archivos y líneas cambiadas, resultado de la verificación y si cambiaste la recomendación de Claude. Mide cuánto cuesta cada nivel antes de tocar los valores por defecto.
- **Trabajo en paralelo.** Divide la tarea para que Claude y `agy` toquen archivos distintos, lanza `agy` en segundo plano y sigue trabajando.
- **Aviso opcional** al terminar (Windows, con un script de PowerShell local si lo tienes; si no, no hace nada).

## Instalación

Requisitos: **Node.js ≥ 20**, **git** y el **CLI de Antigravity (`agy`)** instalado y con sesión iniciada. El runtime busca `agy` en el `PATH`, en `%LOCALAPPDATA%\agy\bin\agy.exe` o en la variable de entorno `AGY_BIN`.

En Claude Code:

```text
/plugin marketplace add RedFer855/claude-antigravity
/plugin install agy@claude-antigravity
```

No hace falta `npm install`: el plugin no tiene dependencias.

## Actualizar

```bash
claude plugin marketplace update claude-antigravity
claude plugin update agy@claude-antigravity
```

Reinicia Claude Code para aplicarlo. Lo que cambió en cada versión está en el [CHANGELOG](CHANGELOG.md) y en la página de [Releases](https://github.com/RedFer855/claude-antigravity/releases).

Tu registro de KPIs, los permisos por proyecto y los briefs guardados se escriben en el directorio de datos de plugins de Claude Code (`CLAUDE_PLUGIN_DATA`), fuera de la carpeta del plugin, así que actualizar no los borra. Las versiones siguen [SemVer](https://semver.org/lang/es/): `0.x.y` para arreglos, `0.x.0` para funciones nuevas y `1.0.0` cuando el contrato de comandos y archivos de datos sea estable. Todo cambio en el formato de los archivos de datos trae su migración.

## Uso

| Comando | Qué hace |
| :-- | :-- |
| `/agy:delegar <tarea>` | Fuerza una delegación. Claude escribe el brief, `agy` ejecuta, Claude revisa. Opciones: `--model <slug>`, `--goal`, `--preguntas`, `--continuar <id>` |
| `/agy:cuota` | Cuota restante por grupo de modelos (ventanas de 5 h y semanal) y cuándo se reinicia |
| `/agy:permisos` | Ver, agregar o quitar lo que `agy` puede escribir y correr en el proyecto actual. Siempre te pregunta antes de agregar una regla |

La skill `delegacion` también se activa sola: antes de una tarea que a Claude le llevaría más de ~6 turnos, cuando pides un documento Word/PDF o cuando dices "usa agy". Recomienda un modelo en una sola pregunta (Delegar con X / Otro modelo / Lo hago yo).

También puedes llamar al runtime directamente:

```bash
node agy-bridge/scripts/agy-run.mjs --cwd /ruta/al/proyecto \
  --model gemini-4-hydrogen-high \
  --verificar "npm test" --tipo feature <<'BRIEF'
Add input validation to src/api/users.ts. Done when `npm test` passes.
Only modify files under src/api/.
BRIEF
```

```bash
node agy-bridge/scripts/agy-run.mjs cuota                        # cuota, sin gastar tokens
node agy-bridge/scripts/agy-run.mjs deshacer --id d1234 --cwd .  # revertir una delegación
```

### Estados

`estado` es uno de `ok`, `parcial`, `verificacion_fallida`, `permiso_denegado` (con el comando exacto rechazado), `sin_cuota`, `vacio`, `error` o `timeout`. El código de salida es `0` solo con `ok`. La skill limita las correcciones a dos continuaciones; después Claude lo toma o te pregunta.

### ¿Qué modelo?

Por defecto `gemini-4-hydrogen-high`; `medium` para trabajo mecánico de un archivo, `xhigh` antes de cambiar de modelo, `gemini-4-neon-high` para revisiones de seguridad, y modelos de Claude *dentro de* `agy` (a cuenta de tu cuota de Google, aparte de la de Claude) para tareas difíciles pero bien especificadas. La tabla completa está en [`skills/delegacion/SKILL.md`](agy-bridge/skills/delegacion/SKILL.md).

## Estructura

```
.claude-plugin/marketplace.json     entrada del marketplace
agy-bridge/
  .claude-plugin/plugin.json        manifiesto del plugin (nombre: agy)
  commands/                         /agy:delegar  /agy:cuota  /agy:permisos
  skills/delegacion/                cuándo y cómo delegar, modelo, ciclo de revisión
  skills/gemini-prompting/          cómo escribir un brief para que agy haga el trabajo
  permisos/base.json                lista global de permitidos y denegados
  scripts/agy-run.mjs               el runtime
  scripts/lib/                      cuota, snapshots de git, lector de stream, guarda, KPIs…
  tests/                            pruebas con node:test
scripts/                            herramientas del repo: verificar.mjs, release.mjs (no se distribuyen)
.github/workflows/                  ci.yml, release.yml
CHANGELOG.md                        origen de las notas de cada release
```

## Desarrollo

```bash
npm test                        # scripts del repo + pruebas del plugin (lo que corre el CI)
npm run verificar               # versiones, CHANGELOG, manifiestos, frontmatter
npm run release -- minor        # sube versión + CHANGELOG en una rama release/vX
npm run etiquetar               # desde main actualizada: crea el tag; el CI publica el GitHub Release
```

Los datos del runtime (registro de KPIs, permisos por proyecto, briefs y respuestas guardados) van a `CLAUDE_PLUGIN_DATA` cuando está instalado, para que las actualizaciones del plugin no los borren.

## Notas

- Hecho y probado en **Windows 11**. El núcleo es Node y git, pero macOS y Linux no están probados; el aviso al terminar es solo de Windows.
- Las skills y los comandos están escritos en **español** (los briefs que se mandan a `agy` van en inglés para ahorrar tokens).
- Es un proyecto comunitario independiente. No está afiliado ni respaldado por Anthropic ni por Google.

## Contribuir

Los issues y pull requests son bienvenidos, sobre todo para soporte de macOS/Linux. Se mantiene la regla de cero dependencias, cada comportamiento nuevo del runtime lleva su prueba y el cambio se anota en `[Unreleased]` del CHANGELOG. Todo entra a `main` por PR con el check `CI completo` en verde; ver [AGENTS.md](AGENTS.md).

## Licencia

[MIT](LICENSE) © 2026 Fernando Barahona

---

Si te ahorró turnos (o cuota), una ⭐ ayuda a que otros lo encuentren.
