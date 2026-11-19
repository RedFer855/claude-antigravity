// Rutas del plugin. Los datos (KPIs, permisos por proyecto, briefs) van en CLAUDE_PLUGIN_DATA
// cuando corre instalado, porque la carpeta del plugin se reemplaza en cada actualización.
// En desarrollo (sin esa variable) se usan fuera de la carpeta del plugin, para que no se
// copien al instalar.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = process.env.CLAUDE_PLUGIN_DATA || join(PLUGIN_ROOT, "..", ".agy-data");
