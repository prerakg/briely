import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: `${process.env.BRIEFLY_TEST_PYTHON || (process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python")} -m backend.tests.e2e_server`,
      url: "http://127.0.0.1:8100/api/v1/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "npm run dev:frontend -- --port 3100 --strictPort",
      env: { BRIEFLY_API_PROXY_TARGET: "http://127.0.0.1:8100" },
      url: "http://localhost:3100",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
