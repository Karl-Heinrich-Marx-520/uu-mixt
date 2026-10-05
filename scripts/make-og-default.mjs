/**
 * make-og-default.mjs —— 生成社交分享默认卡片图（1200×630）
 *
 * 用途：文章页若正文无图、或页面本身没有专属 OG 图时，套用这张默认图，
 *       避免分享到微信/QQ/Discord 时是「没有缩略图的光秃链接」。
 *
 * 用法：node scripts/make-og-default.mjs
 * 输入：public/assets/bg/bg-entry.jpg（站点入口页背景，已有素材复用）
 * 输出：public/og-default.jpg
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "public", "assets", "bg", "bg-entry.jpg");
const OUT = path.join(ROOT, "public", "og-default.jpg");

const W = 1200;
const H = 630;

/* strong mind：中文字体在容器里不一定有，这里显式指定 Windows 常见中文字体兜底链 */
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0a0f1c" opacity="0.62"/>
  <rect x="0" y="${H - 8}" width="${W}" height="8" fill="#5aa9e6"/>
  <text x="86" y="322" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif" font-size="104" font-weight="700" fill="#ffffff">UU&amp;Mixt</text>
  <text x="90" y="386" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif" font-size="34" fill="#b9c7de">双作者双面技术博客</text>
  <text x="90" y="442" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif" font-size="22" fill="#7f90ab">uuandmixt.com</text>
</svg>`;

const buf = await sharp(SRC)
  .resize(W, H, { fit: "cover", position: "centre" })
  .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
  .jpeg({ quality: 82, progressive: true, mozjpeg: true })
  .toBuffer();

const { writeFileSync } = await import("node:fs");
writeFileSync(OUT, buf);
console.log("og-default.jpg written:", (buf.length / 1024).toFixed(0) + "KB", W + "x" + H);
void readFileSync;
