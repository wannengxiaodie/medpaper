// ============================================================
// LLM 驱动的研究回路环节（Kimi API）
// 每个函数在失败时抛错，由调用方回退到内置演示引擎
// ============================================================

import type {
  LiteratureItem, OutlineSection, PaperProject, PolishEdit,
  ResearchGap, ReviewScores, TitleOption, WritingChapter,
} from "./types";
import { chat, chatJson, chatStream, type ChatMessage } from "./llm";
import { formatReferenceGB7714 } from "./pubmed";

interface Ctx {
  apiKey: string;
  model: string;
  /** 自定义 OpenAI 兼容端点（可选，默认 Moonshot） */
  base?: string;
  /** 用户在阶段确认时给出的批注，注入提示词影响本轮执行 */
  note?: string;
}

const SYS = "你是一位资深的医学科研写作专家，长期协助临床医生撰写中文医学期刊论文与职称评审论文。你的表达严谨、规范，严格遵循 ICMJE 与 GB/T 7714 规范。所有输出使用简体中文。";

function projDesc(p: PaperProject): string {
  const parts = [
    p.finalTitle ? `论文标题：「${p.finalTitle}」` : "",
    `研究主题：「${p.topic}」`,
    p.keywords.trim() ? `关键词：${p.keywords.trim()}` : "",
    p.department ? `科室：${p.department}` : "",
    p.titleLevel ? `职称级别：${p.titleLevel}` : "",
    `研究类型：${p.studyType}`,
    `目标期刊：《${p.targetJournal || "未定"}》`,
    p.dataFile ? `作者自带数据：${p.dataFile.summary}` : "",
  ].filter(Boolean);
  return parts.join("；");
}

function userNote(ctx: Ctx): string {
  return ctx.note?.trim()
    ? `\n\n【用户批注】${ctx.note.trim()}。请在本次输出中优先落实这条批注。`
    : "";
}

// ---------- 研究空白识别 ----------
export async function aiResearchGaps(p: PaperProject, lit: LiteratureItem[], ctx: Ctx): Promise<ResearchGap[]> {
  const litSummary = lit.slice(0, 6).map((l) => `- ${l.title}（${l.journal}, ${l.year}）`).join("\n");
  const msgs: ChatMessage[] = [
    { role: "system", content: SYS },
    {
      role: "user",
      content: `${projDesc(p)}。\n\n已检索到的代表性文献：\n${litSummary}\n\n请基于该领域现状，识别 3 个真实、具体、可切入的研究空白。` +
        `严格输出 JSON 数组，不要输出任何其他文字，格式：\n[{"description":"空白描述（40字内）","evidenceLevel":"证据等级（如 中等证据）","direction":"建议研究方向（40字内）"}]` +
        userNote(ctx),
    },
  ];
  const arr = await chatJson<ResearchGap[]>(msgs, { ...ctx, maxTokens: 4096 });
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("空白识别结果为空");
  return arr.slice(0, 3).map((g) => ({
    description: String(g.description ?? ""),
    evidenceLevel: String(g.evidenceLevel ?? "中等证据"),
    direction: String(g.direction ?? ""),
  }));
}

// ---------- 英文检索词提取（用于真实文献检索） ----------
export async function aiSearchTerms(p: PaperProject, ctx: Ctx): Promise<string[]> {
  const msgs: ChatMessage[] = [
    { role: "system", content: "你是医学文献检索专家，擅长把中文研究课题转化为 PubMed 检索式。" },
    {
      role: "user",
      content: `${projDesc(p)}。\n\n请给出 2-4 个用于 PubMed/Europe PMC 检索的英文关键词或词组（尽量使用 MeSH 主题词风格，如 "SGLT2 inhibitor"、"type 2 diabetes mellitus"、"metformin"）。` +
        `严格输出 JSON 字符串数组，不要输出任何其他文字，格式：\n["term1","term2","term3"]`,
    },
  ];
  const arr = await chatJson<string[]>(msgs, { ...ctx, maxTokens: 2048 });
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("检索词提取失败");
  return arr.map(String).filter((s) => s.trim()).slice(0, 4);
}

// ---------- 大纲生成 ----------
interface AiOutlineSection {
  key: string;
  title: string;
  wordTarget: number;
  keyPoints: string[];
  subsections: { title: string; keyPoints: string[] }[];
}

export async function aiOutline(p: PaperProject, gaps: ResearchGap[], ctx: Ctx): Promise<OutlineSection[]> {
  const gapText = gaps.map((g, i) => `${i + 1}. ${g.description}`).join("\n");
  const msgs: ChatMessage[] = [
    { role: "system", content: SYS },
    {
      role: "user",
      content: `${projDesc(p)}。\n\n已识别的研究空白：\n${gapText}\n\n请生成符合 IMRaD 结构的论文大纲（摘要、引言、资料与方法、结果、讨论、结论、参考文献，共7章）。` +
        `严格输出 JSON 数组，不要输出任何其他文字，格式：\n[{"key":"abstract|introduction|methods|results|discussion|conclusion|references","title":"章节名","wordTarget":数字,"keyPoints":["要点1","要点2"],"subsections":[{"title":"小节名","keyPoints":["要点"]}]}]` +
        userNote(ctx),
    },
  ];
  const arr = await chatJson<AiOutlineSection[]>(msgs, { ...ctx, maxTokens: 8192 });
  if (!Array.isArray(arr) || arr.length < 5) throw new Error("大纲结构不完整");
  return arr.map((s) => ({
    key: String(s.key ?? s.title),
    title: String(s.title),
    wordTarget: Number(s.wordTarget) || 0,
    keyPoints: (s.keyPoints ?? []).map(String).slice(0, 5),
    subsections: (s.subsections ?? []).slice(0, 5).map((sub) => ({
      title: String(sub.title),
      keyPoints: (sub.keyPoints ?? []).map(String).slice(0, 4),
    })),
  }));
}

// ---------- 七维评审 ----------
interface AiReview {
  scores: ReviewScores;
  comments: string[];
}

export async function aiReview(p: PaperProject, outline: OutlineSection[], ctx: Ctx) {
  const outlineText = outline.map((s) => `- ${s.title}（${s.wordTarget}字）：${s.keyPoints.join("、")}`).join("\n");
  const msgs: ChatMessage[] = [
    { role: "system", content: SYS },
    {
      role: "user",
      content: `${projDesc(p)}。\n\n论文大纲：\n${outlineText}\n\n请以挑剔的期刊审稿人视角，从七个维度（临床价值、科学性、创新性、文献覆盖、统计方法、伦理合规、写作规范）各打 1-5 分，并给出 3 条具体评语。` +
        `严格输出 JSON，不要输出任何其他文字，格式：\n{"scores":{"临床价值":4,"科学性":4,"创新性":3,"文献覆盖":4,"统计方法":4,"伦理合规":5,"写作规范":4},"comments":["评语1","评语2","评语3"]}` +
        userNote(ctx),
    },
  ];
  const data = await chatJson<AiReview>(msgs, { ...ctx, maxTokens: 4096 });
  const clamp = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 3)));
  const scores: ReviewScores = {
    临床价值: clamp(data.scores?.临床价值),
    科学性: clamp(data.scores?.科学性),
    创新性: clamp(data.scores?.创新性),
    文献覆盖: clamp(data.scores?.文献覆盖),
    统计方法: clamp(data.scores?.统计方法),
    伦理合规: clamp(data.scores?.伦理合规),
    写作规范: clamp(data.scores?.写作规范),
  };
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return {
    scores,
    total,
    average: Math.round((total / 7) * 100) / 100,
    comments: (data.comments ?? []).map(String).slice(0, 4),
  };
}

// ---------- 拟定标题 ----------
export async function aiTitleOptions(p: PaperProject, outline: OutlineSection[], ctx: Ctx): Promise<TitleOption[]> {
  const outlineText = outline.map((s) => `- ${s.title}：${s.keyPoints.join("、")}`).join("\n");
  const msgs: ChatMessage[] = [
    { role: "system", content: SYS },
    {
      role: "user",
      content: `${projDesc(p)}。\n\n论文大纲：\n${outlineText}\n\n请为这篇论文拟定 3 个候选中文标题，风格各异（一个突出研究设计与结局，一个突出临床问题与价值，一个突出创新切入点）。` +
        `标题须符合中文医学期刊命名规范：具体、无夸大、不超过 30 字，避免「初探」「浅谈」这类弱表述；每个标题附一句英文翻译与一句 40 字内的推荐理由。` +
        `严格输出 JSON 数组，不要输出任何其他文字，格式：\n[{"title":"中文标题","englishTitle":"English Title","rationale":"推荐理由（40字内）"}]` +
        userNote(ctx),
    },
  ];
  const arr = await chatJson<TitleOption[]>(msgs, { ...ctx, maxTokens: 4096 });
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("标题生成结果为空");
  return arr.slice(0, 3).map((t) => ({
    title: String(t.title ?? ""),
    englishTitle: String(t.englishTitle ?? ""),
    rationale: String(t.rationale ?? ""),
  })).filter((t) => t.title.length > 0);
}

// ---------- 章节写作（初稿 → 评审 → 修订，双轮打磨） ----------

const SYS_COMPOSER = "你是一位在中华系列期刊发表过数十篇论文的资深医学作家，同时担任多本核心期刊的统计学审稿顾问。你的写作信条：每一个论断都有数据支撑，每一个数据都标注效应量与置信区间，方法部分的每一个细节都可被同行复现。你鄙视空话套话，绝不写「具有重要意义」「值得进一步研究」这类没有信息量的句子而不给出具体所指。所有输出使用简体中文。";

const SYS_REVIEWER = "你是一位以严苛著称的中文医学期刊审稿人，曾任职于中华医学会杂志社。你审读稿件时逐句核对：数据是否前后自洽、统计方法与研究设计是否匹配、论断是否有证据支撑、大纲要点是否全部落实。你的意见永远具体——指出第几段的哪个数字、哪句话，以及应该怎么改。所有输出使用简体中文。";

const CHAPTER_GUIDE: Record<string, string> = {
  abstract:
    "按【目的】【方法】【结果】【结论】四段式撰写。【方法】必须写明设计类型、样本量、分组方式；【结果】必须给出主要结局的具体数字：事件率或均数差、95%置信区间、精确P值（如 P=0.032），次要结局至少1个；【结论】一句话回答研究问题并说明适用条件。全文300-400字，末尾附【关键词】3-5个。",
  introduction:
    "写4个自然段，不少于900字。第1段：疾病的流行病学负担，给出具体的患病率/发病率/经济负担数据（可合理虚构但须符合真实数量级）；第2段：当前主流诊疗路径及其局限，指出至少2个尚存争议的临床问题；第3段：系统梳理文献空白，逐条列出「已有研究做了什么—还缺什么」；第4段：明确提出本研究假设与拟解决的具体科学问题。禁止泛泛而谈，每个空白必须对应可验证的研究缺口。",
  methods:
    "不少于1300字，按小标题组织：1 研究设计与伦理（设计类型、伦理批件号、知情同意、注册号）；2 研究对象（纳入标准至少4条、排除标准至少4条）；3 样本量估算（写出完整参数：主要结局预期事件率或效应量、α=0.05双侧、检验效能、脱落率、最终样本量，并给出计算逻辑）；4 干预/观察方案（具体剂量/频次/随访时点，写到同行可复现的程度）；5 观察指标（主要结局的精确定义与测量时点、次要结局、安全性指标）；6 统计学分析（统计软件版本、每类变量对应的检验方法、缺失值处理、亚组分析计划、检验水准）。",
  results:
    "不少于1100字，所有数字必须与方法部分严格自洽。第1段：入组流程（筛选例数→排除例数及主要原因→纳入例数→完成随访例数与随访率）；第2段：基线特征（列出年龄、性别、病程等至少5个变量在两组的具体数值与P值，说明可比性）；第3段：主要结局（两组事件率或均数、效应量RR/MD及其95%CI、精确P值，并解释临床意义）；第4段：次要结局与亚组分析（至少2个亚组，报告交互作用P值）、敏感性分析；第5段：安全性（不良事件分类与发生率比较）。",
  discussion:
    "不少于1100字，写5个自然段。第1段：用3-4句话概括主要发现，直接呼应研究假设；第2段：与既往研究比较——引用至少3项具体研究（作者/年份/期刊可合理虚构），逐项指出结果一致或不一致之处及可能原因；第3段：机制探讨，从病理生理或行为学角度解释观察到的效应，提出至少2条可检验的机制假设；第4段：局限性，列出至少3条具体局限（不得写「样本量小」一笔带过，要说明对结论的具体影响方向和程度）；第5段：对临床实践与未来研究的具体建议。",
  conclusion:
    "一个自然段，200-300字。直接回答研究假设是否成立，说明结论适用的患者人群与临床场景，给出可操作的临床建议，指出结论的边界条件。禁止重复结果数据，禁止空喊口号。",
  references:
    "从下方【已核实文献池】中选取 6-10 条与本研究最相关的文献，按 GB/T 7714 期刊论文格式著录（作者. 题名[J]. 刊名, 年.），保留池中所给的 DOI 与 PMID 标注。严禁新增文献池之外的任何条目，严禁修改任何字段，严禁凭记忆补全卷期页码。相关性不足的条目宁缺毋滥。",
};

function chapterContext(
  section: OutlineSection,
  p: PaperProject,
  previousChapters: WritingChapter[],
  ctx?: Ctx,
  pool?: LiteratureItem[],
): string {
  const prev = previousChapters
    .map((c) => `【${c.title}】\n${c.content.slice(0, 500)}`)
    .join("\n\n");
  // 真实文献池：参考文献章节只能从中著录，引言/讨论只能引用其中的真实文献
  let poolText = "";
  if (pool && pool.length > 0) {
    if (section.key === "references") {
      poolText =
        `【已核实文献池】以下文献均为真实文献（PubMed / Europe PMC 检索结果，以及作者从知网导出的中文文献），可凭 PMID 或知网记录逐条核实。参考文献章节只能从中选取著录：\n` +
        pool.map((it, i) => formatReferenceGB7714(it, i + 1)).join("\n") +
        "\n\n";
    } else if (section.key === "introduction" || section.key === "discussion") {
      poolText =
        `【可引用的真实文献】如需引用既往研究，只能引用以下真实文献（标注第一作者与年份），严禁虚构文献或杜撰引文：\n` +
        pool.slice(0, 8).map((it) => `- ${it.authors[0] ?? "佚名"} 等（${it.year}，${it.journal}）：${it.title}`).join("\n") +
        "\n\n";
    }
  }
  return (
    `${projDesc(p)}。\n\n` +
    `本章节要点：${section.keyPoints.join("、")}。\n` +
    poolText +
    (p.dataFile && (section.key === "methods" || section.key === "results" || section.key === "abstract")
      ? `【重要】作者上传了真实数据表（见上方自带数据）。本章涉及的样本量、分组、基线特征、效应量等数字必须与该数据表吻合，不得虚构与之矛盾的数值；可在其基础上做合理的统计呈现。\n`
      : "") +
    (prev ? `为保证前后数据与论述自洽，以下是已完成章节的节选，请与之严格衔接（尤其是样本量、分组、效应量等数字）：\n${prev}\n\n` : "") +
    (ctx ? userNote(ctx) + "\n" : "")
  );
}

function toChapter(section: OutlineSection, content: string): WritingChapter {
  return {
    key: section.key,
    title: section.title,
    content: content.trim(),
    wordCount: content.replace(/\s/g, "").length,
    termCheckPassed: true,
    formatCheckPassed: true,
  };
}

/** 第一轮：初稿 */
export async function aiChapterDraft(
  section: OutlineSection,
  p: PaperProject,
  previousChapters: WritingChapter[],
  ctx: Ctx & { onToken: (full: string) => void },
  pool?: LiteratureItem[],
): Promise<WritingChapter> {
  const guide = CHAPTER_GUIDE[section.key] ?? `围绕本节要点深入撰写，约${section.wordTarget}字，论证必须有具体数据支撑。`;
  const msgs: ChatMessage[] = [
    { role: "system", content: SYS_COMPOSER },
    {
      role: "user",
      content: chapterContext(section, p, previousChapters, ctx, pool) +
        `撰写「${section.title}」章节。写作规格：${guide}\n` +
        `直接输出章节正文，不要输出任何说明性文字。`,
    },
  ];
  const content = await chatStream(msgs, { ...ctx, maxTokens: 12288 });
  return toChapter(section, content);
}

export interface ChapterIssue {
  problem: string;
  suggestion: string;
}

/** 第二轮·审读：Reviewer 提出具体修改意见 */
export async function aiChapterCritique(
  draft: WritingChapter,
  section: OutlineSection,
  p: PaperProject,
  ctx: Ctx,
): Promise<ChapterIssue[]> {
  if (section.key === "references") return [];
  const msgs: ChatMessage[] = [
    { role: "system", content: SYS_REVIEWER },
    {
      role: "user",
      content: `${projDesc(p)}。\n\n本章节要点：${section.keyPoints.join("、")}。\n\n以下是「${section.title}」初稿：\n${draft.content}\n\n` +
        `请逐句审读，从以下角度找出 2-4 个最需要修改的问题：数据自洽性、统计表述规范性、论证深度与信息量、大纲要点覆盖度。\n` +
        `严格输出 JSON 数组，不要输出任何其他文字，格式：\n[{"problem":"具体问题（指明位置与内容，40字内）","suggestion":"具体修改方案（40字内）"}]` +
        userNote(ctx),
    },
  ];
  const arr = await chatJson<ChapterIssue[]>(msgs, { ...ctx, maxTokens: 4096 });
  if (!Array.isArray(arr)) throw new Error("评审意见格式异常");
  return arr.slice(0, 4).map((i) => ({
    problem: String(i.problem ?? ""),
    suggestion: String(i.suggestion ?? ""),
  }));
}

/** 第二轮·修订：Composer 按意见重写 */
export async function aiChapterRevise(
  draft: WritingChapter,
  issues: ChapterIssue[],
  section: OutlineSection,
  p: PaperProject,
  previousChapters: WritingChapter[],
  ctx: Ctx & { onToken: (full: string) => void },
  pool?: LiteratureItem[],
): Promise<WritingChapter> {
  const issueText = issues.map((i, n) => `${n + 1}. 问题：${i.problem} → 修改方案：${i.suggestion}`).join("\n");
  const guide = CHAPTER_GUIDE[section.key] ?? `围绕本节要点深入撰写，约${section.wordTarget}字。`;
  const msgs: ChatMessage[] = [
    { role: "system", content: SYS_COMPOSER },
    {
      role: "user",
      content: chapterContext(section, p, previousChapters, ctx, pool) +
        `以下是「${section.title}」的初稿：\n${draft.content}\n\n` +
        `审稿人提出了以下修改意见：\n${issueText}\n\n` +
        `请逐条落实修改意见，同时对照写作规格全面重写本章：${guide}\n` +
        `直接输出修订后的完整章节正文，保留初稿中正确的数据（除非审稿人指出其自相矛盾），不要输出任何说明性文字。`,
    },
  ];
  const content = await chatStream(msgs, { ...ctx, maxTokens: 12288 });
  return toChapter(section, content);
}

/** 兼容旧接口：单轮写作 */
export async function aiChapter(
  section: OutlineSection,
  p: PaperProject,
  previousSummaries: string,
  ctx: Ctx & { onToken: (full: string) => void; signal?: AbortSignal },
): Promise<WritingChapter> {
  void previousSummaries;
  return aiChapterDraft(section, p, [], ctx);
}

// ---------- 润色修订 ----------
export async function aiPolishEdits(p: PaperProject, paperText: string, ctx: Ctx): Promise<PolishEdit[]> {
  const excerpt = paperText.slice(0, 6000);
  const msgs: ChatMessage[] = [
    { role: "system", content: SYS_COMPOSER },
    {
      role: "user",
      content: `${projDesc(p)}。\n\n以下是论文全文节选：\n${excerpt}\n\n请以期刊编辑视角找出 5-7 处必须修订的问题（术语规范、语言润色、统计表述、格式规范），每处须引用真实原文片段。` +
        `严格输出 JSON 数组，不要输出任何其他文字，格式：\n[{"category":"类别","before":"原文片段（25字内）","after":"修改后","reason":"修改理由（40字内）"}]` +
        userNote(ctx),
    },
  ];
  const arr = await chatJson<PolishEdit[]>(msgs, { ...ctx, maxTokens: 4096 });
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("润色建议为空");
  return arr.slice(0, 7).map((e) => ({
    category: String(e.category ?? "语言润色"),
    before: String(e.before ?? ""),
    after: String(e.after ?? ""),
    reason: String(e.reason ?? ""),
  }));
}

// ---------- 参考文献（流式可选，用非流式即可） ----------
export async function aiChat(messages: ChatMessage[], ctx: Ctx): Promise<string> {
  return chat(messages, ctx);
}
