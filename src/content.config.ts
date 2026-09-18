import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 内容集合定义（[内容管线]）
 * 字段与校验 = PRD 3.2/3.3 的唯一落地（docs/04-技术方案.md §3 字段表）。
 * 说明：
 *  - schema 级校验在此（Astro 构建期自动执行，报错自带文件路径）
 *  - 交叉级校验（分类已登记 / slug 同面去重 / 站内死链 / 相似标签警告）
 *    在 src/lib/content-layer.ts 的 validateContent() 中执行
 *  - slug 由写作台按标题自动生成（作者不填）；此处校验其形态
 */
const postSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(60, '标题不能超过 60 字符'),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug 必须是纯 kebab-case（小写字母/数字/连字符）'),
  // description：下限 1（决策 7.20 取消 60 字下限——AI 托管后由提示词约束 60-120，不再构建期强卡）
  description: z.string().min(1, 'description 不能为空').max(120, 'description 不能超过 120 字符'),
  date: z.coerce.date(),
  updated: z.coerce.date().optional(),
  author: z.enum(['uu', 'mixt']),
  authors: z.array(z.enum(['uu', 'mixt'])).max(2).optional(),
  category: z.string().min(1, 'category 必填'),
  tags: z.array(z.string().min(1, '标签不能为空串')).max(5, '标签数量不能超过 5 个').default([]),
  cover: z.string().optional(),
  draft: z.boolean().default(false),
  featured: z.boolean().default(false),
});

// 生成 entry id 时强制转字符串：
// 写作台生成的 frontmatter 可能出现不带引号的数字 slug（如 `slug: 2026`），
// YAML 会解析成 number，content-layer 拿它调 id.endsWith() 直接崩溃
// （withastro/astro#17624 同类根因，2026-09-18 实际事故）。
// 对已有合法字符串 slug，String() 是恒等变换，entry id 不变。
const postLoader = (base: string) =>
  glob({
    pattern: '*.md',
    base,
    generateId: ({ data, entry }) => String(data.slug ?? entry).replace(/\.md$/i, ''),
  });

const uu = defineCollection({
  loader: postLoader('./src/content/uu'),
  schema: postSchema,
});

const mixt = defineCollection({
  loader: postLoader('./src/content/mixt'),
  schema: postSchema,
});

export const collections = { uu, mixt };
