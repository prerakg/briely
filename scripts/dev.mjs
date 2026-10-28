import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { resolvePython, root } from "./python.mjs";

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGKILL");
  }, 4000);
  timer.unref();
}
function launch(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
  return child;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());

async function checkApiPort() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          "Port 8000 is already in use or unavailable. Stop the existing API, or use npm run dev:frontend with that API.",
        ),
      ),
    );
    probe.listen(8000, "127.0.0.1", () => probe.close(resolve));
  });
}

try {
  const python = resolvePython();
  await checkApiPort();
  const api = launch(python, [
    "-m",
    "uvicorn",
    "backend.app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ]);
  let ready = false;
  const deadline = Date.now() + 30000;
  while (!stopping && Date.now() < deadline) {
    await delay(250);
    if (api.exitCode !== null) break;
    try {
      const response = await fetch("http://127.0.0.1:8000/api/v1/health", {
        signal: AbortSignal.timeout(1000),
      });
      const data = await response.json();
      if (response.ok && data.status === "ok" && data.version === "2.0.0") {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the API to finish starting before opening Vite. */
    }
  }
  if (!ready && !stopping)
    throw new Error(
      "Backend did not become ready on port 8000. Check its startup error above.",
    );
  if (!stopping) {
    console.log(
      "Backend ready at http://127.0.0.1:8000. Starting the frontend…",
    );
    launch(process.execPath, [
      "node_modules/vite/bin/vite.js",
      "--strictPort",
      ...process.argv.slice(2),
    ]);
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
