// ============================================================
// 自带数据表格解析：支持 CSV / TSV / TXT 与 Excel（.xlsx/.xls）
// 解析结果只保留摘要与预览，完整数据不出本机浏览器
// ============================================================

import type { DataAttachment } from "./types";

const MAX_PREVIEW_ROWS = 5;
const MAX_COLS = 12;
const MAX_CELL = 40;

type Grid = string[][];

function clipCell(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length > MAX_CELL ? s.slice(0, MAX_CELL) + "…" : s;
}

function detectDelimiter(line: string): RegExp {
  const candidates: Array<[RegExp, number]> = [
    [/\t/, (line.match(/\t/g) ?? []).length],
    [/,/, (line.match(/,/g) ?? []).length],
    [/；|;/, (line.match(/[；;]/g) ?? []).length],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : /,/;
}

function gridFromText(text: string): Grid {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const delim = detectDelimiter(lines[0]);
  return lines.map((l) => l.split(delim).map(clipCell));
}

async function gridFromExcel(file: File): Promise<Grid> {
  // SheetJS 体积较大，动态导入单独分包
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("工作簿中没有工作表");
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  return raw
    .filter((row) => row.some((c) => String(c ?? "").trim() !== ""))
    .map((row) => row.map(clipCell));
}

function buildAttachment(name: string, grid: Grid): DataAttachment {
  if (grid.length < 2) throw new Error("表格内容为空或只有表头");
  const columns = grid[0].filter(Boolean).slice(0, MAX_COLS);
  if (columns.length === 0) throw new Error("未识别到表头字段");
  const dataRows = grid.slice(1);
  const previewGrid = [columns, ...dataRows.slice(0, MAX_PREVIEW_ROWS).map((r) => columns.map((_, i) => r[i] ?? ""))];
  const preview = previewGrid.map((r) => r.join(" | ")).join("\n");
  const summary =
    `数据文件「${name}」：共 ${dataRows.length} 行记录 × ${columns.length} 个字段。` +
    `字段：${columns.join("、")}。\n前 ${Math.min(MAX_PREVIEW_ROWS, dataRows.length)} 行数据预览：\n${preview}`;
  return { name, rows: dataRows.length, columns, preview, summary };
}

/** 解析用户上传的数据表格文件，失败时抛出带中文说明的错误 */
export async function parseDataFile(file: File): Promise<DataAttachment> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (file.size > 10 * 1024 * 1024) throw new Error("文件超过 10MB，请提供抽样后的数据表");

  if (ext === "xlsx" || ext === "xls") {
    return buildAttachment(file.name, await gridFromExcel(file));
  }
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const text = await file.text();
    return buildAttachment(file.name, gridFromText(text));
  }
  throw new Error("仅支持 .csv / .tsv / .txt / .xlsx / .xls 格式");
}
