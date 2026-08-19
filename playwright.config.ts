import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./tests/e2e",
  fullyParallel:false,
  retries:0,
  reporter:"line",
  use:{baseURL:"http://127.0.0.1:3100",channel:"chrome",viewport:{width:1440,height:1000}},
  webServer:{command:"SIGNAL_DESK_DEMO_MODE=true NEXT_PUBLIC_SIGNAL_DESK_DEMO_MODE=true npm run dev -- --port 3100 --hostname 127.0.0.1",url:"http://127.0.0.1:3100/today",reuseExistingServer:false,timeout:120_000,stdout:"pipe",stderr:"pipe"},
});
