/**
 * format.ts —— 派生字段（[内容管线]）
 * 与 demo 的展示口径一致：字数按中文字符数统计，阅读时长按 ≈270 字/分钟。
 */
export function charCount(body: string): number {
  return body.replace(/\s+/g, "").length;
}

export function readMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / 270));
}

/** 3.2k / 1.5k 这种紧凑写法（与 demo 的种子数据展示口径一致） */
export function formatWords(chars: number): string {
  if (chars >= 1000) {
    const k = chars / 1000;
    return `${k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(chars);
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/* ---------- 侧栏「网站信息」辅助（自 demo.js 迁移，构建期与 home.js 共用同一口径） ---------- */

export function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}

export function humanUptime(days: number): string {
  if (days >= 365) return Math.floor(days / 365) + " 年 " + (days % 365) + " 天";
  if (days >= 30) return Math.floor(days / 30) + " 个月 " + (days % 30) + " 天";
  return days + " 天";
}

export function humanAgo(days: number): string {
  if (days <= 0) return "今天";
  if (days < 30) return days + " 天前";
  if (days < 365) return Math.floor(days / 30) + " 个月前";
  return Math.floor(days / 365) + " 年前";
}
