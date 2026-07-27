// ============================================================
// 知网文献导出文件解析
// 知网无开放 API 且有反爬验证，程序化直搜不可行（实测 302 验证页）。
// 标准做法：用户在知网检索 → 勾选文献 →「导出与分析」导出为
//   GB/T 7714-2015 文本 / EndNote(RIS) / NoteExpress(Refworks)
// 然后上传到本模块解析为结构化文献，原始著录行逐字保留。
// ============================================================

import type { LiteratureItem } from "./types";

function clip(s: string, n = 200): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n) : t;
}

/** GB/T 7714 文本导出：[1] 作者. 题名[J]. 刊名, 年, 卷(期): 页码. */
function parseGb7714(text: string): LiteratureItem[] {
  const items: LiteratureItem[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 知网导出的条目可能折行，先按 [n] 开头重新拼条
  const entries: string[] = [];
  for (const line of lines) {
    if (/^\[\d+\]/.test(line)) entries.push(line);
    else if (entries.length > 0) entries[entries.length - 1] += " " + line;
  }
  for (const entry of entries) {
    const m = entry.match(/^\[\d+\]\s*(.+?)\.\s*(.+?)\[J\]\.?\s*(.*)$/i);
    if (m) {
      // 刊名与年份从尾部拆分：刊名, 年, 卷(期): 页码.
      const rest = (m[3] ?? "").trim();
      const jm = rest.match(/^(.+?),\s*(\d{4})/);
      const authors = m[1].split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
      items.push({
        title: clip(m[2], 160),
        authors,
        journal: clip(jm ? jm[1] : rest.replace(/[.,\s]+$/, ""), 60),
        year: jm ? Number(jm[2]) : 0,
        pmid: "", citations: 0, abstract: "",
        source: "cnki",
        citation: entry.replace(/^\[\d+\]\s*/, ""),
      });
      continue;
    }
    // 无法结构化的条目也保留原文，题名取整行
    const raw = entry.replace(/^\[\d+\]\s*/, "");
    if (raw.length >= 8) {
      items.push({
        title: clip(raw, 120), authors: [], journal: "", year: 0,
        pmid: "", citations: 0, abstract: "", source: "cnki", citation: raw,
      });
    }
  }
  return items;
}

/** RIS（EndNote）：TY  - JOUR … ER  - 结尾 */
function parseRis(text: string): LiteratureItem[] {
  const items: LiteratureItem[] = [];
  const records = text.split(/\r?\n(?=TY  -)/i).map((r) => r.trim()).filter(Boolean);
  for (const rec of records) {
    const fields = new Map<string, string[]>();
    for (const line of rec.split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9])  - (.*)$/);
      if (!m) continue;
      const arr = fields.get(m[1]) ?? [];
      arr.push(m[2].trim());
      fields.set(m[1], arr);
    }
    const title = fields.get("TI")?.[0] ?? fields.get("T1")?.[0] ?? "";
    if (!title) continue;
    const authors = [...(fields.get("AU") ?? []), ...(fields.get("A1") ?? [])].slice(0, 6);
    const journal = fields.get("JO")?.[0] ?? fields.get("T2")?.[0] ?? fields.get("JF")?.[0] ?? "";
    const year = Number((fields.get("PY")?.[0] ?? fields.get("Y1")?.[0] ?? "").slice(0, 4)) || 0;
    const au = authors.length > 3 ? [...authors.slice(0, 3), "等"] : authors;
    const citation = `${au.join(", ")}. ${title}[J]. ${journal}${year ? `, ${year}` : ""}.`;
    items.push({
      title: clip(title, 160), authors, journal: clip(journal, 60), year,
      pmid: "", citations: 0, abstract: "", source: "cnki", citation,
    });
  }
  return items;
}

/** Refworks / NoteExpress 标记格式：RT Journal Article, A1/T1/JF/YR 每行一字段 */
function parseRefworks(text: string): LiteratureItem[] {
  const items: LiteratureItem[] = [];
  const records = text.split(/\r?\n\s*\r?\n/).map((r) => r.trim()).filter((r) => r.startsWith("RT "));
  for (const rec of records) {
    const fields = new Map<string, string[]>();
    for (const line of rec.split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9])\s+(.*)$/);
      if (!m) continue;
      const arr = fields.get(m[1]) ?? [];
      arr.push(m[2].trim());
      fields.set(m[1], arr);
    }
    const title = fields.get("T1")?.[0] ?? "";
    if (!title) continue;
    const authors = (fields.get("A1") ?? []).flatMap((s) => s.split(/[,，;；]/)).map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const journal = fields.get("JF")?.[0] ?? fields.get("JO")?.[0] ?? "";
    const year = Number((fields.get("YR")?.[0] ?? "").slice(0, 4)) || 0;
    const au = authors.length > 3 ? [...authors.slice(0, 3), "等"] : authors;
    const citation = `${au.join(", ")}. ${title}[J]. ${journal}${year ? `, ${year}` : ""}.`;
    items.push({
      title: clip(title, 160), authors, journal: clip(journal, 60), year,
      pmid: "", citations: 0, abstract: "", source: "cnki", citation,
    });
  }
  return items;
}

/**
 * 解析知网导出的文献文件内容，自动识别三种格式。
 * 解析不到任何条目时抛错（提示用户检查导出格式）。
 */
export function parseCnkiExport(text: string): LiteratureItem[] {
  const sample = text.slice(0, 4000);
  let items: LiteratureItem[] = [];
  if (/^TY  -/m.test(sample)) {
    items = parseRis(text);
  } else if (/^RT /m.test(sample)) {
    items = parseRefworks(text);
  } else {
    items = parseGb7714(text);
  }
  if (items.length === 0) {
    throw new Error("未识别到文献条目，请使用知网「导出与分析」的 GB/T 7714、EndNote 或 NoteExpress 格式");
  }
  return items.slice(0, 30);
}

/** 生成知网检索深链（在用户自己的浏览器中打开，使用其机构权限） */
export function cnkiSearchUrl(keywords: string): string {
  const kw = keywords.trim().split(/[,，、;；\s]+/).filter(Boolean).slice(0, 2).join(" ") || "医学";
  return `https://kns.cnki.net/kns8s/defaultresult/index?kw=${encodeURIComponent(kw)}`;
}
