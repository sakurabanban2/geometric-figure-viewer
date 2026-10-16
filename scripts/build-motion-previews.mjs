// motions/ にあるモーション（.bvh / .vmd）の一覧 motions/index.json と、ワークショップ用のプレビュー画像を作り直す。
// 使い方: npm i --no-save playwright && npx playwright install chromium && node scripts/build-motion-previews.mjs
// 既定モデルにモーションを再生させ、エディターの公開ダイアログと同じ方法で 12 コマのスプライト（WebP）とサムネイルを撮る。
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const motionsDir = path.join(root, "motions");
const previewDir = path.join(motionsDir, "previews");
const MAX_BYTES = 300 * 1024;
// 新しく見つけたモーションの既定タグ（index.json に既にあればそちらを残す）
const DEFAULT_TAGS = {
  "all-fours-rocking": ["標準", "nsfw", "女性"],
  "bridge-hip-thrust-lying": ["標準", "nsfw", "男性"],
  "hip-thrust-standing": ["標準", "nsfw", "男性"],
  "riding-grind": ["標準", "nsfw", "女性"],
  "riding-up-down": ["標準", "nsfw", "女性"],
};
const DEFAULT_TITLES = {
  "all-fours-rocking": "四つん這いで揺れる",
  "bridge-hip-thrust-lying": "ブリッジで腰を突き上げる",
  "hip-thrust-standing": "立って腰を突き出す",
  "riding-grind": "騎乗位（前後にこする）",
  "riding-up-down": "騎乗位（上下）",
};

const playwrightPath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightPath);

const types = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".mjs": "text/javascript", ".bvh": "text/plain", ".vmd": "application/octet-stream", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const file = path.join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(root)) throw new Error("outside");
    const body = await fs.readFile(file);
    response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function findMotions(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== previewDir) found.push(...(await findMotions(full)));
    } else if (/\.(bvh|vmd)$/i.test(entry.name)) found.push(full);
  }
  return found.sort();
}

let previous = {};
try {
  const index = JSON.parse(await fs.readFile(path.join(motionsDir, "index.json"), "utf8"));
  for (const item of index.motions ?? []) previous[item.file] = item;
} catch { /* 初回 */ }

await fs.mkdir(previewDir, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const motions = [];
for (const file of await findMotions(motionsDir)) {
  const rel = path.relative(motionsDir, file).split(path.sep).join("/");
  const stem = path.basename(file).replace(/\.(bvh|vmd)$/i, "");
  const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const params = new URLSearchParams({ workshop: `${origin}/motions/${rel}`, kind: "motion" });
  await page.goto(`${origin}/index.html?${params}`);
  await page.waitForFunction(() => /モーション「/.test(document.getElementById("file-state")?.textContent ?? ""), null, { timeout: 300000 });
  await page.waitForTimeout(1500);
  await page.locator(".menu-button", { hasText: "ファイル" }).click();
  await page.click("#workshop-publish");
  await page.evaluate(() => {
    const radio = document.querySelector('input[name="publish-kind"][value="motion"]');
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
  });
  await page.waitForFunction(() => /コマ|作れません/.test(document.getElementById("publish-preview-note").textContent), null, { timeout: 300000 });
  const shot = await page.evaluate(async () => {
    const sprite = document.getElementById("publish-preview").style.backgroundImage.slice(5, -2);
    const image = new Image();
    image.src = document.getElementById("publish-thumb").src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return { sprite, thumb: canvas.toDataURL("image/webp", 0.8) };
  });
  await context.close();
  if (!shot.sprite.startsWith("data:image/webp")) throw new Error(`${rel}: プレビューを作れませんでした`);
  const previewName = `${stem}.webp`;
  const thumbName = `${stem}.thumb.webp`;
  const previewBytes = Buffer.from(shot.sprite.split(",")[1], "base64");
  const thumbBytes = Buffer.from(shot.thumb.split(",")[1], "base64");
  if (previewBytes.length > MAX_BYTES) console.warn(`警告: ${previewName} が ${Math.round(previewBytes.length / 1024)}KB あります`);
  await fs.writeFile(path.join(previewDir, previewName), previewBytes);
  await fs.writeFile(path.join(previewDir, thumbName), thumbBytes);
  const old = previous[rel] ?? {};
  motions.push({
    file: rel,
    title: old.title ?? DEFAULT_TITLES[stem] ?? stem,
    author: old.author ?? "標準",
    tags: old.tags ?? DEFAULT_TAGS[stem] ?? ["標準", "nsfw"],
    description: old.description ?? "",
    thumbnail: `previews/${thumbName}`,
    preview: { file: `previews/${previewName}`, frames: 12, fps: 8 },
  });
  console.log(`${rel}: preview ${Math.round(previewBytes.length / 1024)}KB, thumb ${Math.round(thumbBytes.length / 1024)}KB`);
}
await browser.close();
server.close();
await fs.writeFile(path.join(motionsDir, "index.json"), `${JSON.stringify({ version: 1, motions }, null, 2)}\n`);
console.log(`motions/index.json: ${motions.length} 件`);
