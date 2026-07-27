// ============================================================
// MedPaper 领域类型定义
// 移植自原项目 backend/models/schemas.py
// ============================================================

export interface JournalInfo {
  name: string;
  issn: string;
  impactFactor: number;
  reviewCycleDays: number;
  publicationFeeYuan: number;
  databaseTags: string[];
  suitableLevels: string[];
  departments: string[];
  keywords: string[];
}

export interface JournalRecommendation extends JournalInfo {
  matchScore: number;
  matchReasons: string[];
}

export interface LiteratureItem {
  title: string;
  authors: string[];
  journal: string;
  year: number;
  pmid: string;
  citations: number;
  abstract: string;
  /** 真实文献携带 DOI（来自 Europe PMC / PubMed） */
  doi?: string;
  /** 文献来源：PubMed 真实检索 / 知网导出 / 演示数据 */
  source?: "pubmed" | "cnki" | "demo";
  /** 知网导出时保留的原始 GB/T 7714 著录行（逐字保留，最保真） */
  citation?: string;
}

export interface ResearchGap {
  description: string;
  evidenceLevel: string;
  direction: string;
}

/** 拟定标题阶段的候选标题 */
export interface TitleOption {
  title: string;
  englishTitle: string;
  rationale: string;
}

/** 用户上传的自带数据表格附件（解析后的摘要形式） */
export interface DataAttachment {
  name: string;
  rows: number;
  columns: string[];
  /** 前若干行的纯文本预览 */
  preview: string;
  /** 注入提示词的摘要文本 */
  summary: string;
}

export interface OutlineSubSection {
  title: string;
  keyPoints: string[];
}

export interface OutlineSection {
  key: string;
  title: string;
  wordTarget: number;
  keyPoints: string[];
  subsections: OutlineSubSection[];
}

export interface ReviewScores {
  临床价值: number;
  科学性: number;
  创新性: number;
  文献覆盖: number;
  统计方法: number;
  伦理合规: number;
  写作规范: number;
}

export interface GateCheckItem {
  name: string;
  passed: boolean;
  description: string;
}

export interface WritingChapter {
  key: string;
  title: string;
  content: string;
  wordCount: number;
  termCheckPassed: boolean;
  formatCheckPassed: boolean;
}

export interface PolishEdit {
  category: string;
  before: string;
  after: string;
  reason: string;
}

export interface PlagiarismResult {
  similarityRate: number;
  matchedSources: { title: string; similarity: number }[];
  verdict: string;
}

export interface PaperProject {
  topic: string;
  keywords: string;
  studyType: string;
  targetJournal: string;
  /** 拟定标题阶段选定后的最终标题 */
  finalTitle?: string;
  /** 用户上传的自带数据表格（可选） */
  dataFile?: DataAttachment;
  /** 用户从知网导出并上传的中文文献（可选，GB/T 7714 / RIS / Refworks 格式） */
  cnkiRefs?: LiteratureItem[];
  /** 兼容旧数据的可选字段，新表单不再收集 */
  titleLevel?: string;
  department?: string;
}

export type StageStatus = "pending" | "running" | "done" | "failed";

export interface LogEntry {
  id: number;
  time: string;
  agent: AgentId;
  text: string;
}

export type AgentId = "strategist" | "reviewer" | "composer" | "system";

export const AGENTS: Record<AgentId, { name: string; role: string; color: string }> = {
  strategist: { name: "Strategist", role: "选题策略 · 文献分析 · 标题拟定", color: "#0F766E" },
  reviewer: { name: "Reviewer", role: "七维评审 · 质量控制 · 统计审查", color: "#B45309" },
  composer: { name: "Composer", role: "大纲生成 · 章节写作 · 润色投稿", color: "#1D4ED8" },
  system: { name: "System", role: "流程调度", color: "#525252" },
};

export interface PipelineStage {
  index: number;
  key: string;
  title: string;
  subtitle: string;
  agent: AgentId;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { index: 1, key: "literature", title: "文献检索", subtitle: "检索证据，识别研究空白", agent: "strategist" },
  { index: 2, key: "outline", title: "大纲生成", subtitle: "构建 IMRaD 论文骨架", agent: "composer" },
  { index: 3, key: "review", title: "七维评审", subtitle: "多维度量化评分", agent: "reviewer" },
  { index: 4, key: "gate", title: "质量控制", subtitle: "写作阶段准入检查", agent: "reviewer" },
  { index: 5, key: "title", title: "拟定标题", subtitle: "生成候选标题并选定", agent: "strategist" },
  { index: 6, key: "writing", title: "章节写作", subtitle: "逐章生成论文正文", agent: "composer" },
  { index: 7, key: "polish", title: "润色投稿", subtitle: "术语、格式、查重与清单", agent: "composer" },
];

export const TITLE_LEVELS = ["中级", "副高级", "正高级"];

export const DEPARTMENTS = [
  "内科", "外科", "心血管内科", "神经内科", "肿瘤科",
  "骨科", "妇产科", "儿科", "护理", "公共卫生", "影像科", "急诊科",
];

export const STUDY_TYPES = ["随机对照试验", "回顾性研究", "队列研究", "Meta分析", "综述", "病例对照研究"];
