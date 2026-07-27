// ============================================================
// 真实文献检索：Europe PMC（覆盖 PubMed 全部索引，免费开放、支持 CORS）
// 返回的每一条文献都有真实 PMID / DOI，可在 https://pubmed.ncbi.nlm.nih.gov 核实
// ============================================================

import type { LiteratureItem } from "./types";

const ENDPOINT = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

interface EuropePmcResult {
  title?: string;
  authorString?: string;
  journalInfo?: { journal?: { title?: string } };
  pubYear?: string;
  pmid?: string;
  doi?: string;
  abstractText?: string;
  citedByCount?: number;
}

/** 从 abstractText 中剥离 HTML 标签并截断 */
function cleanAbstract(raw: string | undefined): string {
  if (!raw) return "";
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 420 ? text.slice(0, 420) + "…" : text;
}

/**
 * 用英文检索词在 Europe PMC 检索真实文献，按被引量降序。
 * 首次跨域连接可能较慢：45 秒超时 + 自动重试一次。
 * 网络失败或无结果时返回空数组，由调用方回退演示引擎。
 */
export async function searchRealLiterature(terms: string[], pageSize = 10): Promise<LiteratureItem[]> {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean).slice(0, 4);
  if (cleaned.length === 0) return [];
  const query = cleaned.map((t) => `"${t.replace(/"/g, "")}"`).join(" AND ");
  const url =
    `${ENDPOINT}?query=${encodeURIComponent(query)}` +
    `&format=json&pageSize=${pageSize}&resultType=core&sort=CITED%20desc`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) continue;
      const data = (await res.json()) as { resultList?: { result?: EuropePmcResult[] } };
      const rows = data.resultList?.result ?? [];
      return rows
        .filter((r) => r.title && r.pmid)
        .map((r) => ({
          title: String(r.title).replace(/\.$/, ""),
          authors: String(r.authorString ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5),
          journal: r.journalInfo?.journal?.title ?? "",
          year: Number(r.pubYear) || 0,
          pmid: String(r.pmid),
          citations: Number(r.citedByCount) || 0,
          abstract: cleanAbstract(r.abstractText),
          doi: r.doi ? String(r.doi) : undefined,
          source: "pubmed" as const,
        }));
    } catch {
      /* 超时或网络错误 → 重试一次 */
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

/**
 * 把真实文献列表格式化为 GB/T 7714 著录条目（期刊论文 [J]）。
 * 这是参考文献章节的「可信来源」——条目与 PubMed 记录一一对应。
 */
export function formatReferenceGB7714(item: LiteratureItem, index: number): string {
  // 知网导出条目保留原始著录（逐字保真），PubMed 条目按字段重组
  if (item.citation) return `[${index}] ${item.citation}`;
  const authors = item.authors.length > 0 ? item.authors.join(", ") : "佚名";
  const year = item.year || "n.d.";
  const doiPart = item.doi ? ` DOI: ${item.doi}.` : "";
  const pmidPart = item.pmid ? ` PMID: ${item.pmid}.` : "";
  return `[${index}] ${authors}. ${item.title}[J]. ${item.journal}, ${year}.${doiPart}${pmidPart}`;
}
