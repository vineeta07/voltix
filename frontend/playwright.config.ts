import { defineConfig } from "@playwright/test";

// Every test runs at phone and desktop width, in light and dark.
const sizes = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
const local = process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {};

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // sessions share the demo site's plugs, so runs must not overlap
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "off", ...local },
  projects: (["mobile", "desktop"] as const).flatMap((size) =>
    (["light", "dark"] as const).map((scheme) => ({
      name: `${size}-${scheme}`,
      use: { viewport: sizes[size], colorScheme: scheme, isMobile: size === "mobile", hasTouch: size === "mobile" },
    })),
  ),
});
