// Aviso por Telegram al terminar una delegación. Reutiliza el script de avisos de Claude Code
// (~/.claude/telegram/aviso.ps1), que decide si avisa según su telegram.env. Corre aparte y sin
// esperar, para no retrasar la respuesta a Claude; si el script no existe, no hace nada.
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const SCRIPT = join(homedir(), ".claude", "telegram", "aviso.ps1");

export function avisar({ cwd, estado, respuesta, wallSeconds }) {
  if (process.platform !== "win32" || !existsSync(SCRIPT)) return;
  try {
    const archivo = join(tmpdir(), `agy-aviso-${Date.now()}.json`);
    const texto = estado === "ok" ? respuesta : `Estado: ${estado}\n\n${respuesta ?? ""}`;
    writeFileSync(archivo, JSON.stringify({ agente: "agy", proyecto: basename(cwd), texto, minutos: wallSeconds / 60 }), "utf8");
    spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "directo", archivo], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {
    // El aviso nunca debe romper la delegación.
  }
}
