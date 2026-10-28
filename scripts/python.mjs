import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function resolvePython() {
  const local = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const candidates = process.env.BRIEFLY_PYTHON
    ? [process.env.BRIEFLY_PYTHON]
    : [local, "python3", "python"];
  for (const command of candidates) {
    const probe = spawnSync(
      command,
      ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"],
      { cwd: root, stdio: "ignore" },
    );
    if (probe.status === 0) {
      const dependencies = spawnSync(
        command,
        [
          "-c",
          "import uvicorn, fastapi, sqlalchemy, pydantic_settings, langgraph, httpx",
        ],
        { cwd: root, stdio: "ignore" },
      );
      if (dependencies.status === 0) return command;
      throw new Error(
        `Backend dependencies are missing. Run ${command} -m pip install -r backend/requirements.txt`,
      );
    }
  }
  throw new Error(
    "Python 3.11+ is required. Create .venv with Python 3.11+ and install backend/requirements.txt. See docs/backend-setup.md.",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const child = spawn(resolvePython(), process.argv.slice(2), {
      cwd: root,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => child.kill(signal));
    child.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
