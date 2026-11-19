---
description: Ver o ajustar los permisos que agy tiene en este proyecto (escritura y comandos)
argument-hint: "[ver | agregar --escritura | agregar --comando \"npm test\" | quitar ... | sugerir]"
allowed-tools: Bash(node:*), AskUserQuestion
---

Gestiona los permisos de agy para el proyecto actual con:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/permisos.mjs" <acción> --cwd "<raíz del proyecto>" [opciones]
```

Petición del usuario: $ARGUMENTS

Reglas:
- Sin argumentos, ejecuta `ver` y `sugerir` y muestra en pocas líneas: reglas del proyecto, si tiene escritura y los comandos que agy intentó y le rechazaron (con cuántas veces).
- `--cwd` es la raíz del proyecto (la del repositorio git si existe), no una subcarpeta.
- Antes de **agregar** cualquier regla, confirma con el usuario la lista exacta (AskUserQuestion). Nunca agregues reglas por tu cuenta.
- No propongas comandos destructivos (borrar, `git push`, `reset --hard`, instaladores globales); la lista base ya los bloquea con deny.
- Las reglas de comando son de **coincidencia exacta**: `command(npm test)` permite solo `npm test`, no `npm test -- --watch`. No existen prefijos ni comodines. Registra cada comando completo, con sus argumentos, tal como agy lo va a escribir.
- Las reglas de comando quedan activas para todos los proyectos (agy no tiene permisos de comando por carpeta); dilo si el usuario agrega uno amplio.
- Después de cambiar algo, muestra las reglas resultantes del proyecto.
