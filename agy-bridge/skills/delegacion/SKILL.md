---
name: delegacion
description: Decide si conviene delegar a Antigravity (agy) una tarea de implementación o un documento Word/PDF, recomienda el modelo y ejecuta la delegación con agy-bridge. Úsala antes de implementar algo que te llevaría más de ~6 pasos, al generar un documento, o cuando el usuario diga "usa anty", "usa agy" o "usa antigravity".
---

# Delegar a agy

Claude piensa, planea y revisa; agy ejecuta. Delegar solo vale si **ahorra turnos de Claude**: cada turno de Claude reprocesa todo el contexto, y eso es lo caro.

## 1. ¿Conviene?
**Recomienda delegar** cuando la especificación está clara y además:
- harías la tarea en más de ~6 turnos (varios archivos, ciclo prueba-error, refactor mecánico, una fase completa de un plan), o
- es un documento Word/PDF.

**No delegues**: diseño o decisiones, algo ambiguo (primero acláralo con el usuario), arreglos de 1–3 turnos, depuración cuya causa no está clara, o tareas con secretos o producción.

**Ajuste por cuotas**: si tienes `mcp__ccd_session_mgmt__get_usage`, consúltalo una vez por sesión antes de la primera recomendación. Si el uso de Claude va ≥70% en 5 h o ≥80% semanal, baja el umbral a ~4 turnos.

Si el usuario forzó la delegación ("usa anty", `/agy:delegar`), no discutas si conviene: ve al paso 2.

## 2. Modelo
| Situación | Modelo |
|---|---|
| Cambio acotado y claro, varios archivos, `/goal`, documentos (por defecto) | `gemini-4-hydrogen-high` |
| Mecánico y de un archivo (renombrar, dar formato, volcar datos) | `gemini-4-hydrogen-medium` |
| Refactor o arquitectura multiarchivo difícil, o `high` ya falló una vez | `gemini-4-hydrogen-xhigh` (escala aquí antes de cambiar de modelo) |
| Muy pequeño (rara vez vale delegarlo) | `gemini-4-hydrogen-low` |
| Realmente difícil: seguridad y ciberdefensa (auditar, vulnerabilidades, RLS, RPC con dinero o auth) o razonamiento a la par de Opus. Solo para esto: Hydrogen sigue por defecto | `gemini-4-neon-high` (`xhigh` solo si `high` falló) |
| Difícil pero bien especificado, tareas de terminal o de uso de ordenador, o `xhigh` ya falló | `claude-sonnet-5-5-medium` (dentro de agy: cuota de Google, aparte de la tuya) |
| Muy difícil | `claude-opus-5-5-medium` (dentro de agy) |
| Argon | Solo si la cuota `argon` está sobre 30%: en el plan Pro su bolsa es pequeña |

Hydrogen (`gemini-4-hydrogen`, 2026-11-12) reemplaza a `gemini-3.8-flash` como modelo por defecto. `high` es el nivel por defecto de Google y el que mide sus benchmarks; a mayor nivel gasta más tokens (model card), así que `xhigh` no va por defecto. Hydrogen es el modelo ejecutor: el razonamiento largo y profundo es de Argon y Carbon. Con los KPIs del plugin (`cuota` y registro de delegaciones) mide cuánto cuesta cada nivel antes de cambiar el valor por defecto.

Recomienda en **una sola pregunta** (AskUserQuestion), con la recomendación primero: "Delegar con <modelo>" / "Delegar con otro modelo" / "Lo hago yo". Si el usuario cambia el modelo, úsalo sin discutir. Guarda tu recomendación para pasarla como `--recomendado`.

## 3. Preparar
- `CWD` = raíz del proyecto (la del repo git si existe).
- La primera vez que delegas en un proyecto en esta sesión, revisa los permisos: `node "${CLAUDE_PLUGIN_ROOT}/scripts/permisos.mjs" ver --cwd "<CWD>"`. Si falta escritura, propónla, confirma y agrégala (`permisos.mjs agregar --escritura`). En documentos hace falta escritura.
- **Modo auto (preferido).** Si en agy `/config` → `Agent Mode` = `auto`, el modo `-p` lo toma: aprueba solo los comandos seguros (con cualquier argumento) y rechaza lo irreversible (probado: `git log --oneline -1` pasa, `Remove-Item` se rechaza). Con auto activo no hace falta la lista exacta de abajo; pide igual en el brief que no use scripts ni bucles. No uses el flag `--mode auto`: desde Claude responde "not available for this account" aunque la configuración guardada sí funciona.
- **Comandos permitidos (coincidencia exacta, si auto no está activo).** agy solo deja correr un comando si es idéntico, carácter por carácter, a una regla: `command(git log)` no permite `git log --oneline -1`, y no hay prefijos ni comodines (probado: `*`, `:*`, `**`). En headless lo que no coincide se rechaza sin preguntar. Por eso:
  1. Decide la lista cerrada de comandos exactos que agy necesita (incluido el de `--verificar` si quieres que agy también lo corra), con sus argumentos.
  2. Muéstrala al usuario y confirma. Pásala a `agy-run.mjs` con un `--comando "<cmd>"` por comando: el runtime los permite solo durante esa delegación y **los quita siempre al terminar**, aunque falle o se corte; si el proceso muere, la corrida siguiente los limpia. No necesitas registrarlos ni quitarlos tú. Si un comando es de uso permanente en el proyecto, regístralo con `permisos.mjs agregar --cwd "<CWD>" --comando "<cmd>"` (las reglas son globales, no por proyecto).
  3. Pon en el brief una sección `ALLOWED COMMANDS (run them verbatim; any other command will be denied):` con esa lista, y pide que no use scripts, bucles, variables, `cd` ni `-C`.
  - Si la tarea necesita muchos comandos distintos que no puedes prever (exploración, auditorías de muchas carpetas), no conviene delegar: hazla tú.
- Escribe el brief con la skill `gemini-prompting` (en inglés, rutas y no contenido, engram o archivo para el contexto largo).

## 4. Modo preguntas (tareas grandes y documentos)
Úsalo para documentos, para tareas de más de 3 archivos o con `/goal`, y cuando el brief tenga supuestos.
1. Ejecuta con `--preguntas`. Si responde `READY`, continúa con `--conversation <id>` y el delta "Proceed with the task now."
2. Si trae preguntas, respóndelas tú cuando sepas la respuesta. Pregúntale al usuario solo lo que es decisión suya. Luego continúa con `--conversation <id>` y las respuestas más "Proceed with the task now."

## 5. Ejecutar (una llamada)
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-run.mjs" --cwd "<CWD>" --model "<modelo>" [--goal] [--preguntas] [--conversation "<id>"] [--verificar "<comando>"] [--comando "<cmd permitido>"]... --tipo "<mecanico|feature|refactor|documento|...>" --recomendado "<tu recomendación>" <<'AGY_BRIEF_FIN'
<brief>
AGY_BRIEF_FIN
```
- Pasa `--verificar` con el comando que demuestra que está terminado (`npm test`, `pytest`...). El runtime lo corre y te trae el resultado: no lo corras tú.
- **Trabajo en paralelo (cuando el usuario lo pida: "en paralelo", "mientras tanto", "tú haz X y agy Y").** Divide la tarea en dos partes que **no toquen los mismos archivos**: una para agy y otra para ti. Dile al usuario en una línea qué hace cada uno. Lanza agy con Bash en segundo plano (`run_in_background: true`), sin importar lo que dure, y ponte de inmediato con tu parte. No consultes la salida mientras corre: el aviso de fin te despierta. Cuando llegue, revisa el JSON (paso 6) y junta las dos partes. Si la parte de agy toca un archivo que tú también necesitas, no lo edites hasta que termine. Si el usuario lo pidió una vez en la sesión, sigue trabajando así en las siguientes delegaciones de esa sesión.
- Sin pedido de paralelo: con `--goal`, o si esperas más de ~8 minutos, ejecuta en segundo plano. Si no, en primer plano con timeout de 600000 ms.
- No llames a agy de otra forma ni uses un subagente: la llamada directa es la más barata.

## 6. Revisar con el JSON (sin turnos extra si está bien)
- `ok` + verificación ok + `cambios.archivos` son los esperados → **aprobado** sin leer el diff. Lee el diff solo si toca auth, datos, dinero, seguridad o migraciones, o si aparecen archivos inesperados.
- `cambios.archivos` son los que agy escribió con sus herramientas de archivo. Si viene `cambios.otros`, esos archivos cambiaron en la carpeta durante la corrida pero no por una escritura de agy: pueden ser de un comando suyo (formateador, build) o de tu trabajo en paralelo. Ábrelos antes de aprobar y no se los atribuyas a agy. Las rutas prohibidas que la guarda revirtió (`rutas_prohibidas_revertidas`) traen `respaldo` con la copia de lo que había: si el cambio era del usuario, devuélvesela.
- Si `respuesta_truncada` es true, el recorte conserva el principio y el final; el resto está en `respuesta_completa` (ruta a un archivo que puedes leer con Read).
- `verificacion_fallida` → continúa con `--conversation` mandando como delta solo `verificacion.salida_final` y qué corregir.
- `permiso_denegado` → muestra `comando_denegado`. Si es razonable, propone registrarlo **tal cual** (la cadena completa, no un prefijo) y, tras confirmar, continúa con `--conversation`. Si agy inventó un comando fuera de la lista, continúa recordándole la lista `ALLOWED COMMANDS`.
- `sin_cuota` → propone un modelo de otro grupo (por ejemplo `claude-sonnet-5-5-medium` dentro de agy) o hazlo tú.
- `parcial` (agy reportó un error pero entregó algo, y no había `--verificar`) → revisa `cambios` y corre tú la verificación una vez.
- `vacio`, `error` o `timeout` → explica el `motivo` en una línea y propone el siguiente paso.
- **Máximo 2 continuaciones de corrección.** Si sigue mal, tómala tú o pregúntale al usuario. No entres en un ciclo.
- Si el resultado es malo y conviene revertir, propone `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-run.mjs" deshacer --id <delegacion_id> --cwd "<CWD>"`. Revierte solo lo que agy escribió con sus herramientas de archivo (`cambios.archivos`) y **no toca** lo editado después de la corrida: esos archivos salen en `conflictos`. Dile al usuario qué quedó sin revertir. `--forzar` revierte también los conflictos; `--todo` incluye además `cambios.otros`. Usa cualquiera de los dos solo si el usuario lo pide. Pide confirmación antes.
- En documentos: revisa `CIFRAS` contra las fuentes (datos críticos). Si la respuesta vino truncada, lee `CIFRAS` en `respuesta_completa`. El formato visual lo revisa el usuario abriendo el archivo.

## 7. Informar
Máximo ~6 líneas: modelo, estado, tiempo, archivos cambiados, tu veredicto (aprobado, ajuste o rehecho) y el siguiente paso. Si el problema vino del brief, di la lección en una línea.
