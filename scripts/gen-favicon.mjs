/**
 * gen-favicon.mjs —— 从桌宠像素小鹿图生成站点图标与友链头像
 *   public/images/pet.png（黑底）→ 黑色转透明 →
 *   ① public/favicon.png（32×32，浏览器标签图标）
 *   ② public/avatar.png （200×200，友链申请头像，自持域名防盗链）
 * 用法：node scripts/gen-favicon.mjs
 */
import sharp from "sharp";

const SRC = "public/images/pet.png";

const img = sharp(SRC);
const meta = await img.metadata();
const { data, info } = await img
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

/* 黑底转透明：RGB 均低于阈值（原图纯黑背景，鹿的深棕轮廓 >40 不受影响） */
for (let i = 0; i < data.length; i += info.channels) {
  if (data[i] < 20 && data[i + 1] < 20 && data[i + 2] < 20) {
    data[i + 3] = 0;
  }
}

const cleaned = sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
});

await cleaned
  .clone()
  .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile("public/favicon.png");

await cleaned
  .clone()
  .resize(200, 200, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile("public/avatar.png");

console.log(`gen-favicon: ${info.width}x${info.height} → favicon.png(32) + avatar.png(200)`);
