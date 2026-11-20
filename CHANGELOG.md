# Changelog

Todos los cambios importantes del plugin `agy` se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen
[SemVer](https://semver.org/lang/es/): `0.x.y` para arreglos, `0.x.0` para funciones nuevas
y `1.0.0` cuando el contrato de los comandos y de los archivos de datos sea estable.

Para publicar: `npm run release -- minor` (o `patch`, `major`, `x.y.z`). Lo que esté en
`[Unreleased]` pasa a la versión nueva.

## [Unreleased]

### Added
- CI en GitHub Actions: pruebas en Windows, Linux y macOS (Node 20 y 24), verificación de versiones y manifiestos, y búsqueda de secretos con gitleaks. El único check obligatorio es `CI completo`.
- Flujo de releases: `npm run release` sube la versión en todos los archivos y el CHANGELOG, `npm run etiquetar` crea el tag y el workflow `release` publica el GitHub Release con estas notas.
- Dependabot para las acciones de GitHub, CODEOWNERS y plantilla de PR.
- `AGENTS.md` con las reglas del repositorio.
- `--comando "<cmd>"` en `agy-run.mjs` (repetible): permite un comando solo durante esa delegación y lo quita siempre al terminar, aunque falle o se corte el proceso (señal). Si el proceso muere, la corrida siguiente limpia lo que quedó (`permisos.mjs limpiar` lo hace a mano). Con dos delegaciones a la vez, la regla sale cuando termina la última; una regla que el usuario ya tenía nunca se quita.
- `respuesta_completa` en el JSON: ruta al archivo con la respuesta íntegra de agy.
- Pruebas de punta a punta del runtime con un agy falso (`tests/helpers/agy-falso.mjs`), activado con las variables `AGY_BIN` y `AGY_BIN_ARGS`: sin el agy real ni gastar cuota.

### Changed
- `npm test` del plugin usa `node --test` sin glob, para funcionar igual en Windows, Linux y macOS con Node 20 o más.
- `cambios.archivos` lista solo lo que agy escribió con sus herramientas de archivo. Lo demás que cambió en la carpeta durante la corrida (comandos de agy, o trabajo en paralelo tuyo o de Claude) sale aparte en `cambios.otros`, con una nota. Los registros de KPIs suman el campo `cambios.otros` (solo se agrega, no cambia ninguno existente).
- `deshacer` revierte solo `cambios.archivos` y no pisa un archivo editado después de la corrida: lo informa en `conflictos`. `--forzar` revierte también esos; `--todo` incluye `cambios.otros`. La salida cambia de `archivos` a `revertidos`, `conflictos` y `no_de_agy_sin_tocar`. Sin el registro de atribución (delegaciones hechas con versiones anteriores) exige `--todo`.
- La respuesta larga se recorta conservando el principio (60%) y el final (40%), en vez de solo el principio: en las plantillas de respuesta lo último es PENDIENTE y VERIFICACIÓN.
- Los archivos `.env` y similares que la guarda restaura o elimina se copian antes a `guarda/<id>/` en el directorio de datos; la entrada en `rutas_prohibidas_revertidas` trae `respaldo`. Así no se pierde una edición del usuario hecha durante la corrida.
- El settings de agy se escribe de forma atómica (archivo temporal y renombrado) y, además de `.bak`, se conserva `.bak-AAAA-MM-DD` con el primer estado del día.

### Fixed
- `deshacer` y `cambios` atribuían a agy cualquier archivo que cambiara en la carpeta durante la corrida, y `deshacer` los revertía también: con trabajo en paralelo se perdían ediciones ajenas.
- Con `--cwd` en una subcarpeta del repo, el diff y `deshacer` usaban rutas relativas a la carpeta equivocada. Ahora usan la raíz del repo.
- La atribución compara rutas canónicas: si el proyecto está bajo un enlace simbólico (en macOS `/var` es un enlace a `/private/var`) o en Windows se usa un nombre corto (`RUNNER~1`), git y agy veían la misma carpeta con rutas distintas y ningún archivo se atribuía a agy.
- Los nombres de archivo con acentos o `ñ` salían escapados (`"\303\261..."`) en el diff y no se podían comparar ni revertir.

## [0.2.4] - 2026-11-19

### Added
- Primera publicación pública del plugin: comandos `/agy:delegar`, `/agy:cuota` y `/agy:permisos`, skills `delegacion` y `gemini-prompting`, y el runtime `agy-run.mjs` con revisión de cuota, puntos de control en git, guarda de secretos, permisos, verificación y registro de KPIs.
