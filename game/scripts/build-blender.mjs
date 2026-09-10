import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const game = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supplied = process.argv.indexOf("--blender");
const blender = supplied >= 0 ? process.argv[supplied + 1] : process.env.BLENDER_BIN ??
  path.resolve(game, "../../3d_astra/.tools/blender-4.5.3-windows-x64/blender.exe");
if (!blender || !existsSync(blender)) throw new Error("Set BLENDER_BIN or pass --blender <executable> to use Blender 4.5+");
const run = spawnSync(blender, ["--background", "--factory-startup", "--python-exit-code", "1",
  "--python", path.join(game, "tools/blender/build_iron_march.py")], { cwd: game, stdio: "inherit", windowsHide: true });
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
