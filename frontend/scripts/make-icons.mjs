// Renders the favicon, PWA icons and Open Graph image from the brand mark.
// Run from frontend/:  node scripts/make-icons.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const mark = readFileSync("../assets/brand/voltix-mark.svg", "utf8");
const logo = readFileSync("../assets/brand/voltix-logo-dark.svg", "utf8");
const font = pathToFileURL(path.resolve("node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2")).href;
const svgUrl = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;

const browser = await chromium.launch();
async function shot(html, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<style>*{margin:0}html,body{height:100%}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
  console.log("wrote", out);
}
const plain = (size) => `<img src="${svgUrl(mark)}" width="${size}" height="${size}">`;
// maskable: the mark sits inside the 80% safe zone on a full-bleed ink square
const maskable = `<div style="width:512px;height:512px;background:#0F2A3A;display:grid;place-items:center"><img src="${svgUrl(mark)}" width="372" height="372"></div>`;
const og = `<style>@font-face{font-family:N;src:url(${font})}</style>
<div style="width:1200px;height:630px;background:#0F2A3A;color:#EEF3F2;padding:72px 80px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between">
  <img src="${svgUrl(logo)}" width="231" height="56">
  <div style="font:500 68px/1.08 N,Georgia,serif;letter-spacing:-.012em;max-width:960px">Tariffs tell every EV when power is cheap. Nobody tells them <i style="color:#6FD3C1">not all at once.</i></div>
  <div style="font:400 22px/1 ui-monospace,monospace;letter-spacing:.08em;opacity:.6">THE TRAFFIC SIGNAL FOR EV CHARGING</div>
</div>`;

await shot(plain(192), 192, 192, "public/icons/icon-192.png");
await shot(plain(512), 512, 512, "public/icons/icon-512.png");
await shot(maskable, 512, 512, "public/icons/maskable-512.png");
await shot(plain(180), 180, 180, "src/app/apple-icon.png");
await shot(og, 1200, 630, "public/og.png");
await browser.close();
