/**
 * slug 自动生成（[内容管线]）
 * 规则（PRD 3.2 / 4.1）：
 *  - 英文标题 → kebab-case
 *  - 中文标题 → post-YYYYMMDD-xxxx 兜底（正式写作台可升级为中文转拼音）
 *  - 同面去重：与已有 slug 冲突时追加 -2 / -3…
 *  - 一经发布即冻结（改名走重定向映射，不在此处理）
 */
export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return base;
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rnd = Math.random().toString(36).slice(2, 6);
  return `post-${d.getFullYear()}${mm}${dd}-${rnd}`;
}

export function dedupeSlug(base: string, existing: string[], keep?: string): string {
  const taken = existing.filter((s) => s !== keep);
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function autoSlug(title: string, existing: string[], keep?: string): string {
  return dedupeSlug(slugifyTitle(title), existing, keep);
}
