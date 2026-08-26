import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sanitizeHtml = (value = "") => String(value)
  .replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, " $1=\"#\"")
  .replace(/<img\b(?![^>]*\bloading=)([^>]*?)>/gi, '<img loading="lazy" decoding="async" $1>');

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  const query = Array.isArray(payload?.result) ? payload.result[0] : null;
  if (!payload?.success || !query?.success || !Array.isArray(query.results)) {
    const message = payload?.errors?.map((item) => item.message).filter(Boolean).join("；");
    throw new Error(message || "Cloudflare D1 查询结果格式不正确");
  }
  return query.results;
}

export async function loadD1Overrides({ required = false } = {}) {
  const file = process.env.HUSIR_D1_OVERRIDES_FILE;
  if (file) return normalizeRows(JSON.parse(readFileSync(resolve(file), "utf8")));

  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  if (!token || !accountId || !databaseId) {
    if (required) throw new Error("缺少 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID 或 CLOUDFLARE_D1_DATABASE_ID");
    return [];
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sql: "SELECT path, work_slug, title, description, body_html, status, updated_at FROM content_overrides ORDER BY updated_at, id",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Cloudflare D1 API 返回 HTTP ${response.status}`);
  return normalizeRows(payload);
}

function updateWorkIndex(target, row, remove = false) {
  const indexPath = join(target, row.work_slug, "index.html");
  if (!existsSync(indexPath)) {
    if (remove) return false;
    throw new Error(`找不到典籍目录页：/${row.work_slug}/`);
  }
  let html = readFileSync(indexPath, "utf8");
  const anchorPattern = new RegExp(`<a\\s+href=["']${escapeRegex(row.path)}["'][^>]*>[\\s\\S]*?<\\/a>`, "i");
  const anchor = `<a href="${escapeHtml(row.path)}" title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</a>`;
  if (remove) html = html.replace(anchorPattern, "");
  else if (anchorPattern.test(html)) html = html.replace(anchorPattern, anchor);
  else {
    const listPattern = /(<div class="chapter-list">)([\s\S]*?)(<\/div><\/section>)/i;
    if (!listPattern.test(html)) throw new Error(`典籍目录页缺少正文列表：/${row.work_slug}/`);
    html = html.replace(listPattern, `$1$2${anchor}$3`);
  }
  writeFileSync(indexPath, html);
  return true;
}

function patchReaderHtml(html, row) {
  const title = escapeHtml(row.title);
  const description = escapeHtml(row.description || `${row.title}在线阅读`);
  const body = sanitizeHtml(row.body_html || "");
  if (!body.trim()) throw new Error(`${row.path} 的正文为空`);

  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}｜虎思国学网</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*">/i, `<meta name="description" content="${description}">`)
    .replace(/<link\s+rel="canonical"\s+href="[^"]*">/i, `<link rel="canonical" href="https://husir.cn${escapeHtml(row.path)}">`)
    .replace(/data-title="[^"]*"/i, `data-title="${title}"`)
    .replace(/(<nav class="breadcrumbs">[\s\S]*?<strong>)[\s\S]*?(<\/strong><\/nav>)/i, `$1${title}$2`)
    .replace(/(<article class="reader-paper">\s*<h1>)[\s\S]*?(<\/h1>)/i, `$1${title}$2`)
    .replace(/<div class="reader-content">[\s\S]*?<\/div><\/article>/i, `<div class="reader-content">${body}</div></article>`);
  return html;
}

function createFromTemplate(target, row) {
  const workDir = join(target, row.work_slug);
  if (!existsSync(workDir)) throw new Error(`新增正文所属典籍不存在：/${row.work_slug}/`);
  const templateName = readdirSync(workDir).find((name) => name.endsWith(".html") && join("/", row.work_slug, name) !== row.path);
  if (!templateName) throw new Error(`找不到可复用的正文模板：/${row.work_slug}/`);
  let html = patchReaderHtml(readFileSync(join(workDir, templateName), "utf8"), row);
  html = html.replace(/<nav class="reader-nav">[\s\S]*?<\/nav>/i, `<nav class="reader-nav"><a href="/${escapeHtml(row.work_slug)}/">← 返回目录</a><span></span></nav>`);
  return html;
}

export function applyD1Overrides(targetDirectory, rows) {
  const target = resolve(targetDirectory);
  const summary = { total: rows.length, published: 0, hidden: 0, drafts: 0, created: 0, updated: 0, removed: 0 };
  for (const row of rows) {
    if (!/^\/[a-z0-9-]+\/[a-z0-9-]+\.html$/i.test(row.path || "") || !/^[a-z0-9-]+$/i.test(row.work_slug || "")) {
      throw new Error(`D1 中存在无效正文路径：${row.path || "(空)"}`);
    }
    const filePath = join(target, row.path.replace(/^\//, ""));
    if (row.status === "draft") {
      summary.drafts += 1;
      continue;
    }
    if (row.status === "hidden") {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        summary.removed += 1;
      }
      updateWorkIndex(target, row, true);
      summary.hidden += 1;
      continue;
    }
    if (row.status !== "published") throw new Error(`${row.path} 的状态无效：${row.status}`);

    const existed = existsSync(filePath);
    const html = existed
      ? patchReaderHtml(readFileSync(filePath, "utf8"), row)
      : createFromTemplate(target, row);
    writeFileSync(filePath, html);
    updateWorkIndex(target, row, false);
    summary.published += 1;
    if (existed) summary.updated += 1;
    else summary.created += 1;
  }
  return summary;
}
