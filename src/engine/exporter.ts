// ============================================================
// 论文导出器 — 生成符合中文医学期刊规范的 .docx
// 标题：黑体三号居中；一级标题：黑体四号；正文：宋体小四，1.5 倍行距
// ============================================================

import {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph,
  TextRun,
} from "docx";
import type { PaperProject, PlagiarismResult, PolishEdit, WritingChapter } from "./types";

const SONG = "SimSun";   // 宋体
const HEI = "SimHei";    // 黑体

function bodyParagraph(text: string, opts?: { indent?: boolean }): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 360 }, // 1.5 倍行距
    indent: opts?.indent ? { firstLine: 480 } : undefined, // 首行缩进2字符
    children: [
      new TextRun({ text, font: SONG, size: 24 }), // 小四 = 12pt = 24 half-points
    ],
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120, line: 360 },
    children: [
      new TextRun({ text, font: HEI, size: 28, bold: true }), // 四号加粗
    ],
  });
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

export async function exportPaperDocx(
  project: PaperProject,
  chapters: WritingChapter[],
  meta?: { edits?: PolishEdit[]; plagiarism?: PlagiarismResult | null },
): Promise<void> {
  const children: Paragraph[] = [];

  // ---- 题目页 ----
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 480, after: 240 },
      children: [new TextRun({ text: project.finalTitle || project.topic, font: HEI, size: 32, bold: true })], // 三号加粗
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: "作者：wangpengfei    单位：____________________", font: SONG, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: `目标期刊：《${project.targetJournal || "待定"}》    研究类型：${project.studyType}`,
          font: SONG, size: 21, color: "666666",
        }),
      ],
    }),
  );

  // ---- 各章节 ----
  for (const ch of chapters) {
    children.push(heading(ch.title, HeadingLevel.HEADING_1));
    for (const para of splitParagraphs(ch.content)) {
      // 摘要内的【目的】【方法】等段首标记、参考文献条目不缩进
      const noIndent = para.startsWith("【") || /^\[\d+\]/.test(para);
      children.push(bodyParagraph(para, { indent: !noIndent }));
    }
  }

  // ---- 附：AI 润色与质检报告 ----
  if (meta?.plagiarism || (meta?.edits && meta.edits.length > 0)) {
    children.push(
      new Paragraph({
        spacing: { before: 480, after: 120 },
        children: [new TextRun({ text: "附：AI 质检报告", font: HEI, size: 28, bold: true })],
      }),
    );
    if (meta.plagiarism) {
      children.push(bodyParagraph(
        `查重检测：全文总相似率 ${meta.plagiarism.similarityRate}%。${meta.plagiarism.verdict}`,
      ));
    }
    if (meta.edits) {
      for (const [i, e] of meta.edits.entries()) {
        children.push(bodyParagraph(
          `润色建议 ${i + 1}（${e.category}）：「${e.before}」→「${e.after}」。${e.reason}`,
        ));
      }
    }
  }

  const doc = new Document({
    title: project.finalTitle || project.topic,
    creator: "MedPaper · 医学论文写作全流程自动化平台",
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(project.finalTitle || project.topic) || "paper"}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
