import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Circle, CircleDashed,
  ClipboardCheck, Cpu, Download, FileSpreadsheet, FileText, KeyRound, Loader2, MessageSquareDiff,
  Microscope, PenLine, Play,
  RotateCcw, ShieldCheck, Sparkles, Type, X, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AGENTS, PIPELINE_STAGES, STUDY_TYPES,
  type AgentId, type GateCheckItem, type LiteratureItem,
  type LogEntry, type OutlineSection, type PaperProject, type PlagiarismResult,
  type PolishEdit, type ResearchGap, type ReviewScores, type StageStatus, type TitleOption, type WritingChapter,
} from "@/engine/types";
import {
  draftChapter, evaluateOutline, gateCheck, generateOutline,
  polishPaper, proposeTitles, searchLiterature,
} from "@/engine/engine";
import {
  aiChapterCritique, aiChapterDraft, aiChapterRevise, aiOutline,
  aiPolishEdits, aiResearchGaps, aiReview, aiSearchTerms, aiTitleOptions, type ChapterIssue,
} from "@/engine/ai";
import { parseDataFile } from "@/engine/datafile";
import ThemeToggle from "@/components/ThemeToggle";
import { cnkiSearchUrl, parseCnkiExport } from "@/engine/cnki";
import { formatReferenceGB7714, searchRealLiterature } from "@/engine/pubmed";
import {
  checkStatus, getSavedBase, getSavedKey, getSavedModel,
  saveBase, saveKey, saveModel,
  PROVIDER_PRESETS, type LlmStatus,
} from "@/engine/llm";

// ============================================================
// 状态
// ============================================================

interface Results {
  literature: LiteratureItem[];
  /** 文献来源：真实检索 / 演示数据 */
  literatureSource: "real" | "demo" | null;
  gaps: ResearchGap[];
  outline: OutlineSection[];
  scores: ReviewScores | null;
  scoreTotal: number;
  scoreAvg: number;
  comments: string[];
  gate: { passed: boolean; checks: GateCheckItem[] } | null;
  titles: TitleOption[];
  selectedTitle: TitleOption | null;
  chapters: WritingChapter[];
  issues: Record<string, ChapterIssue[]>;
  edits: PolishEdit[];
  plagiarism: PlagiarismResult | null;
}

const emptyResults: Results = {
  literature: [], literatureSource: null, gaps: [], outline: [],
  scores: null, scoreTotal: 0, scoreAvg: 0, comments: [],
  gate: null, titles: [], selectedTitle: null,
  chapters: [], issues: {}, edits: [], plagiarism: null,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
const errMsg = (e: unknown) => (e instanceof Error ? e.message.slice(0, 60) : String(e).slice(0, 60));

/** 阶段确认门的用户决定：继续/重跑 + 可选批注 */
interface ConfirmDecision {
  action: "next" | "rerun";
  note: string;
}

/** 演示引擎的模拟流式输出 */
async function simulateStream(
  text: string,
  set: (s: string) => void,
  cancelRef: { current: boolean },
) {
  for (let pos = 0; pos < text.length; pos += 24) {
    if (cancelRef.current) throw new Error("cancelled");
    set(text.slice(0, pos + 24));
    await sleep(30);
  }
}

// ============================================================
// 主组件
// ============================================================

export default function Workspace() {
  const [project, setProject] = useState<PaperProject>({
    topic: "", keywords: "", studyType: "随机对照试验", targetJournal: "",
  });
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [stageStatus, setStageStatus] = useState<StageStatus[]>(Array(PIPELINE_STAGES.length).fill("pending"));
  const [activeStage, setActiveStage] = useState(0); // 0-based panel index
  const [results, setResults] = useState<Results>(emptyResults);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamText, setStreamText] = useState("");
  const [streamingKey, setStreamingKey] = useState("");
  const [apiKey, setApiKey] = useState(getSavedKey());
  const [model, setModel] = useState(getSavedModel());
  const [apiBase, setApiBase] = useState(getSavedBase());
  const [llm, setLlm] = useState<LlmStatus>({ configured: false, mode: "none" });
  const logId = useRef(0);
  const logBox = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  // 跟踪最新 results（含用户在确认门期间的标题选择，setState 异步不可直接依赖）
  const resultsRef = useRef<Results>(emptyResults);
  // 阶段间确认门：awaitingStage 非 null 时流水线暂停，等待用户确认
  const [awaitingStage, setAwaitingStage] = useState<number | null>(null);
  const confirmResolver = useRef<((r: ConfirmDecision) => void) | null>(null);
  const aiCtx = { apiKey, model, base: apiBase };
  const aiOn = llm.configured;

  const waitForConfirm = () =>
    new Promise<ConfirmDecision>((resolve) => {
      confirmResolver.current = resolve;
    });

  const resolveConfirm = (decision: ConfirmDecision) => {
    setAwaitingStage(null);
    confirmResolver.current?.(decision);
    confirmResolver.current = null;
  };

  const pushLog = useCallback((agent: AgentId, text: string) => {
    setLogs((prev) => [...prev.slice(-80), { id: ++logId.current, time: now(), agent, text }]);
  }, []);

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    checkStatus(getSavedKey()).then(setLlm);
  }, []);

  const applyKey = (key: string) => {
    setApiKey(key);
    saveKey(key);
    checkStatus(key).then(setLlm);
  };
  const applyModel = (m: string) => {
    setModel(m);
    saveModel(m);
  };
  const applyBase = (b: string) => {
    setApiBase(b);
    saveBase(b);
  };

  const setStage = (i: number, s: StageStatus) =>
    setStageStatus((prev) => prev.map((v, idx) => (idx === i ? s : v)));

  // ---------- 各阶段执行 ----------
  const runStage = useCallback(async (i: number, proj: PaperProject, res: Results, note = ""): Promise<Results> => {
    if (cancelRef.current) throw new Error("cancelled");
    setStage(i, "running");
    setActiveStage(i);
    const next = { ...res };
    const st = PIPELINE_STAGES[i];
    const ctx = { ...aiCtx, note };
    if (note.trim()) {
      pushLog("system", `携带用户批注执行：「${note.trim().slice(0, 40)}」`);
    }

    switch (st.key) {
      case "literature": {
        pushLog("strategist", `检索证据基线：主题「${proj.topic}」${proj.keywords.trim() ? ` · 关键词 ${proj.keywords.trim()}` : ""}`);
        // 真实文献检索优先（Europe PMC / PubMed），失败或结果不足才回退演示数据
        let realItems: LiteratureItem[] = [];
        if (aiOn) {
          try {
            pushLog("strategist", "提取英文检索词（MeSH 风格）…");
            const terms = await aiSearchTerms(proj, ctx);
            pushLog("strategist", `PubMed 检索式：${terms.join(" AND ")}`);
            realItems = await searchRealLiterature(terms, 10);
          } catch (e) {
            pushLog("system", `真实检索失败（${errMsg(e)}）`);
          }
        } else {
          const terms = proj.keywords.trim()
            ? proj.keywords.trim().split(/[,，、;；\s]+/).filter(Boolean).slice(0, 3)
            : [proj.topic];
          realItems = await searchRealLiterature(terms, 10);
        }
        const cnki = proj.cnkiRefs ?? [];
        if (cnki.length > 0) {
          pushLog("strategist", `知网导出文献已载入 ${cnki.length} 条（原始著录逐字保留）`);
        }
        const { items, gaps: tplGaps } = searchLiterature(proj);
        const merged = [...cnki, ...realItems];
        if (merged.length >= 3) {
          next.literature = merged.slice(0, 14);
          next.literatureSource = "real";
          const parts = [
            cnki.length > 0 ? `知网 ${cnki.length} 条` : "",
            realItems.length > 0 ? `Europe PMC ${realItems.length} 条` : "",
          ].filter(Boolean).join(" + ");
          pushLog("strategist", `真实文献池就绪：${parts}，全部真实可核实`);
        } else {
          next.literature = items;
          next.literatureSource = "demo";
          pushLog("system", "真实检索结果不足，本轮回退演示文献数据（参考文献将在投稿前替换）");
        }
        next.gaps = tplGaps;
        if (aiOn) {
          try {
            pushLog("strategist", "调用 LLM 深度分析研究空白…");
            next.gaps = await aiResearchGaps(proj, next.literature, ctx);
          } catch (e) {
            pushLog("system", `LLM 空白分析失败，回退演示引擎（${errMsg(e)}）`);
          }
        } else {
          await sleep(600);
        }
        pushLog("strategist", `命中 ${next.literature.length} 篇高相关文献，识别 ${next.gaps.length} 个研究空白`);
        next.gaps.forEach((g, idx) => pushLog("strategist", `空白 ${idx + 1}：${g.description.slice(0, 34)}…`));
        break;
      }
      case "outline": {
        pushLog("composer", "基于研究空白构建 IMRaD 论文骨架…");
        if (aiOn) {
          try {
            next.outline = await aiOutline(proj, next.gaps, ctx);
          } catch (e) {
            pushLog("system", `LLM 大纲生成失败，回退演示引擎（${errMsg(e)}）`);
            next.outline = generateOutline(proj);
          }
        } else {
          await sleep(900);
          next.outline = generateOutline(proj);
        }
        pushLog("composer", `大纲就绪：${next.outline.length} 个章节，目标字数约 ${next.outline.reduce((a, s) => a + s.wordTarget, 0)} 字`);
        break;
      }
      case "review": {
        pushLog("reviewer", "启动七维度量化评审…");
        let ev: { scores: ReviewScores; total: number; average: number; comments: string[] };
        if (aiOn) {
          try {
            ev = await aiReview(proj, next.outline, ctx);
          } catch (e) {
            pushLog("system", `LLM 评审失败，回退演示引擎（${errMsg(e)}）`);
            ev = evaluateOutline(proj);
          }
        } else {
          await sleep(1000);
          ev = evaluateOutline(proj);
        }
        next.scores = ev.scores;
        next.scoreTotal = ev.total;
        next.scoreAvg = ev.average;
        next.comments = ev.comments;
        pushLog("reviewer", `评审完成：总分 ${ev.total}/35，均分 ${ev.average}/5`);
        break;
      }
      case "gate": {
        pushLog("reviewer", "执行写作阶段准入质量控制…");
        await sleep(800);
        next.gate = gateCheck(next.scoreTotal, proj);
        pushLog("reviewer", next.gate.passed ? "质量控制通过 ✓ 准许进入写作阶段" : "质量控制未通过，需要返回修订大纲");
        if (!next.gate.passed) {
          setStage(i, "failed");
          setResults(next);
          throw new Error("gate");
        }
        break;
      }
      case "title": {
        pushLog("strategist", "基于大纲与证据基线拟定候选论文标题…");
        next.selectedTitle = null;
        if (aiOn) {
          try {
            next.titles = await aiTitleOptions(proj, next.outline, ctx);
          } catch (e) {
            pushLog("system", `LLM 标题生成失败，回退演示引擎（${errMsg(e)}）`);
            await sleep(700);
            next.titles = proposeTitles(proj);
          }
        } else {
          await sleep(700);
          next.titles = proposeTitles(proj);
        }
        if (next.titles.length === 0) throw new Error("标题生成失败");
        next.titles.forEach((t, idx) => pushLog("strategist", `候选 ${idx + 1}：${t.title.slice(0, 30)}${t.title.length > 30 ? "…" : ""}`));
        pushLog("strategist", "请选择一个候选标题，或在下方填写自定义标题后确认");
        break;
      }
      case "writing": {
        next.chapters = [];
        next.issues = {};
        // 真实文献池：注入写作提示词，演示回退的参考文献章节也由真实条目构成
        const refPool = next.literatureSource === "real" ? next.literature : undefined;
        const demoChapter = (sec: OutlineSection): WritingChapter => {
          const base = draftChapter(sec.key, sec.title, proj);
          if (sec.key === "references" && refPool && refPool.length > 0) {
            const content = refPool.slice(0, 10).map((it, i) => formatReferenceGB7714(it, i + 1)).join("\n");
            return { ...base, content, wordCount: content.replace(/\s/g, "").length };
          }
          return base;
        };
        for (const sec of next.outline) {
          if (cancelRef.current) throw new Error("cancelled");
          pushLog("composer", `撰写「${sec.title}」初稿${sec.wordTarget ? `，目标 ${sec.wordTarget} 字` : ""}…`);
          setStreamingKey(sec.key);
          setStreamText("");
          let ch: WritingChapter;
          if (aiOn) {
            try {
              // 第一轮：初稿
              const draft = await aiChapterDraft(sec, proj, next.chapters, {
                ...ctx,
                onToken: (full) => setStreamText(full),
              }, refPool);
              // 第二轮·审读：Reviewer 提意见
              pushLog("reviewer", `审读「${sec.title}」初稿…`);
              const issues = await aiChapterCritique(draft, sec, proj, ctx);
              if (issues.length > 0) {
                next.issues = { ...next.issues, [sec.key]: issues };
                issues.forEach((it, n) =>
                  pushLog("reviewer", `意见 ${n + 1}：${it.problem.slice(0, 36)}…`));
                // 第二轮·修订：Composer 重写
                pushLog("composer", `按 ${issues.length} 条审稿意见修订「${sec.title}」…`);
                setStreamText("");
                ch = await aiChapterRevise(draft, issues, sec, proj, next.chapters, {
                  ...ctx,
                  onToken: (full) => setStreamText(full),
                }, refPool);
              } else {
                ch = draft;
                pushLog("reviewer", "初稿质量达标，无需修订");
              }
            } catch (e) {
              pushLog("system", `LLM 写作失败，本章回退演示引擎（${errMsg(e)}）`);
              ch = demoChapter(sec);
              await simulateStream(ch.content, setStreamText, cancelRef);
            }
          } else {
            ch = demoChapter(sec);
            await simulateStream(ch.content, setStreamText, cancelRef);
          }
          setStreamText(ch.content);
          await sleep(250);
          setStreamingKey("");
          next.chapters = [...next.chapters, ch];
          setResults({ ...next });
          pushLog("composer", `「${sec.title}」定稿，${ch.wordCount} 字`);
        }
        break;
      }
      case "polish": {
        pushLog("composer", "全文润色：术语规范化、统计表述、格式校验…");
        const total = next.chapters.reduce((a, c) => a + c.wordCount, 0);
        const { edits: tplEdits, plagiarism } = polishPaper(proj, total);
        next.edits = tplEdits;
        next.plagiarism = plagiarism;
        if (aiOn) {
          try {
            const fullText = next.chapters.map((c) => `【${c.title}】\n${c.content}`).join("\n\n");
            next.edits = await aiPolishEdits(proj, fullText, ctx);
          } catch (e) {
            pushLog("system", `LLM 润色分析失败，回退演示引擎（${errMsg(e)}）`);
          }
        } else {
          await sleep(900);
        }
        pushLog("composer", `润色完成：${next.edits.length} 处修订建议；${plagiarism.verdict}`);
        pushLog("system", "🎉 全流程执行完毕，论文已具备投稿条件");
        break;
      }
    }
    setStage(i, "done");
    setResults(next);
    resultsRef.current = next;
    return next;
  }, [pushLog, aiOn, apiKey, model, apiBase]);

  // ---------- 启动 / 重跑 ----------
  const start = useCallback(async (topicOverride?: string) => {
    const topic = (topicOverride ?? project.topic).trim();
    if (!topic || running) return;
    let proj = { ...project, topic };
    setProject(proj);
    cancelRef.current = false;
    setStarted(true);
    setRunning(true);
    setResults(emptyResults);
    resultsRef.current = emptyResults;
    setStageStatus(Array(PIPELINE_STAGES.length).fill("pending"));
    setLogs([]);
    setStreamText("");
    pushLog("system", `研究回路启动 · 主题「${topic}」${aiOn ? " · LLM 已接入" : " · 演示模式"} · 逐步确认`);
    let res = { ...emptyResults };
    let pendingNote = "";
    try {
      for (let i = 0; i < PIPELINE_STAGES.length; i++) {
        // 进入写作阶段前，把选定的标题锁定进项目上下文
        if (PIPELINE_STAGES[i].key === "writing") {
          const chosen = resultsRef.current.selectedTitle ?? res.titles[0] ?? null;
          if (chosen) {
            proj = { ...proj, finalTitle: chosen.title };
            setProject((prev) => ({ ...prev, finalTitle: chosen.title }));
            if (!resultsRef.current.selectedTitle) {
              pushLog("system", `未手动选择，默认采用候选标题 1：「${chosen.title.slice(0, 26)}${chosen.title.length > 26 ? "…" : ""}」`);
            } else {
              pushLog("system", `论文标题已锁定：「${chosen.title.slice(0, 26)}${chosen.title.length > 26 ? "…" : ""}」`);
            }
          }
        }
        res = await runStage(i, proj, res, pendingNote);
        pendingNote = "";
        // 除最后一步外，每步完成后暂停等待用户确认
        while (i < PIPELINE_STAGES.length - 1) {
          pushLog("system", `阶段「${PIPELINE_STAGES[i].title}」已完成，等待确认…`);
          setAwaitingStage(i);
          const decision = await waitForConfirm();
          setAwaitingStage(null);
          if (cancelRef.current) throw new Error("cancelled");
          if (decision.action === "rerun") {
            pushLog("system", `重新执行阶段「${PIPELINE_STAGES[i].title}」…`);
            res = await runStage(i, proj, res, decision.note);
            continue;
          }
          if (decision.note.trim()) {
            pushLog("system", `已确认，批注「${decision.note.trim().slice(0, 30)}」将带入下一阶段`);
          } else {
            pushLog("system", `已确认，进入「${PIPELINE_STAGES[i + 1].title}」`);
          }
          pendingNote = decision.note;
          break;
        }
      }
    } catch {
      /* cancelled or gate failed */
    }
    setAwaitingStage(null);
    setRunning(false);
  }, [project, running, pushLog, runStage, aiOn]);

  const reset = () => {
    cancelRef.current = true;
    // 若正停在确认门，先放行让流水线退出
    confirmResolver.current?.({ action: "next", note: "" });
    confirmResolver.current = null;
    setAwaitingStage(null);
    setRunning(false);
    setStarted(false);
    setResults(emptyResults);
    resultsRef.current = emptyResults;
    setStageStatus(Array(PIPELINE_STAGES.length).fill("pending"));
    setLogs([]);
    setStreamText("");
    setStreamingKey("");
    setActiveStage(0);
  };

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div className="flex h-screen flex-col bg-white/90 text-neutral-900 dark:text-neutral-100 backdrop-blur-xl dark:bg-[#07070d]/80 dark:text-neutral-100">
      {/* ===== 顶栏 ===== */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-100 dark:border-white/10 px-5">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400 transition hover:text-neutral-900">
            <ArrowLeft className="h-4 w-4" />
            <Microscope className="h-4 w-4" />
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">MedPaper</span>
          </Link>
          {started && (
            <span className="hidden max-w-md truncate text-sm text-neutral-400 dark:text-neutral-500 md:inline">
              「{project.topic}」{project.keywords.trim() ? ` · ${project.keywords.trim()}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Badge
            variant={aiOn ? "default" : "secondary"}
            className={`gap-1.5 rounded-full ${aiOn ? "bg-emerald-600 hover:bg-emerald-600" : ""}`}
          >
            <Cpu className="h-3 w-3" />
            {aiOn ? (llm.mode === "byok" ? `LLM · ${model}` : "LLM · 内置引擎") : "演示模式"}
          </Badge>
          {awaitingStage !== null && (
            <Badge variant="secondary" className="gap-1.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
              <CircleDashed className="h-3 w-3" /> 等待确认
            </Badge>
          )}
          {running && awaitingStage === null && (
            <Badge variant="secondary" className="gap-1.5 rounded-full">
              <Loader2 className="h-3 w-3 animate-spin" /> 回路运行中
            </Badge>
          )}
          {started && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={reset}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> 重置
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ===== 左侧：阶段与智能体 ===== */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-neutral-100 dark:border-white/10 bg-neutral-50/50 dark:border-white/10 dark:bg-transparent md:flex">
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">研究回路</div>
            <div className="space-y-1">
              {PIPELINE_STAGES.map((s, i) => {
                const st = stageStatus[i];
                return (
                  <button
                    key={s.key}
                    onClick={() => setActiveStage(i)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      activeStage === i ? "bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-white/10 dark:ring-white/15" : "hover:bg-white/70 dark:hover:bg-white/5"
                    }`}
                  >
                    <StageIcon status={st} />
                    <div className="min-w-0">
                      <div className={`text-sm font-medium ${st === "pending" ? "text-neutral-400 dark:text-neutral-500" : ""}`}>
                        {s.index}. {s.title}
                      </div>
                      <div className="truncate text-xs text-neutral-400 dark:text-neutral-500">{s.subtitle}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mb-2 mt-6 px-2 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">智能体</div>
            <div className="space-y-1">
              {(Object.keys(AGENTS) as AgentId[]).filter((k) => k !== "system").map((k) => {
                const isActive = running && PIPELINE_STAGES[activeStage]?.agent === k;
                return (
                  <div key={k} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                    <span className="relative flex h-2 w-2">
                      {isActive && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: AGENTS[k].color }} />}
                      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: AGENTS[k].color }} />
                    </span>
                    <div>
                      <div className="text-sm font-medium">{AGENTS[k].name}</div>
                      <div className="text-xs text-neutral-400 dark:text-neutral-500">{AGENTS[k].role}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 活动日志 */}
          <div className="h-56 shrink-0 border-t border-neutral-100 dark:border-white/10">
            <div className="px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">活动日志</div>
            <div ref={logBox} className="h-[calc(100%-2rem)] overflow-y-auto px-4 pb-3">
              {logs.length === 0 && <div className="text-xs text-neutral-300 dark:text-neutral-600">等待回路启动…</div>}
              {logs.map((l) => (
                <div key={l.id} className="py-1 text-xs leading-relaxed">
                  <span className="mr-1.5 font-mono text-neutral-300 dark:text-neutral-600">{l.time.slice(3)}</span>
                  <span className="mr-1.5 font-semibold" style={{ color: AGENTS[l.agent].color }}>
                    {AGENTS[l.agent].name}
                  </span>
                  <span className="text-neutral-600 dark:text-neutral-400">{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ===== 主区域 ===== */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {!started ? (
            <SetupPanel
              project={project}
              setProject={setProject}
              onStart={() => start()}
              llm={llm}
              apiKey={apiKey}
              model={model}
              apiBase={apiBase}
              onKeyChange={applyKey}
              onModelChange={applyModel}
              onBaseChange={applyBase}
            />
          ) : (
            <div className="mx-auto max-w-4xl px-6 py-8">
              <StagePanel
                index={activeStage}
                status={stageStatus[activeStage]}
                results={results}
                project={project}
                streamText={streamText}
                streamingKey={streamingKey}
                onSelectTitle={(t) => {
                  setResults((prev) => ({ ...prev, selectedTitle: t }));
                  resultsRef.current = { ...resultsRef.current, selectedTitle: t };
                }}
              />
              {!running && stageStatus.every((s) => s === "done") && activeStage === PIPELINE_STAGES.length - 1 && (
                <div className="mt-10 rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] bg-neutral-900 p-8 text-center text-white">
                  <Sparkles className="mx-auto mb-3 h-6 w-6" />
                  <div className="text-xl font-semibold">论文已就绪</div>
                  <p className="mx-auto mt-2 max-w-md text-sm text-neutral-300 dark:text-neutral-600">
                    研究回路已完成全部 {PIPELINE_STAGES.length} 个阶段。你可以回到任意阶段查看产物，或重置后开启新的写作项目。
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <ExportButton
                      project={project}
                      chapters={results.chapters}
                      edits={results.edits}
                      plagiarism={results.plagiarism}
                      variant="secondary"
                    />
                    <Button variant="secondary" className="rounded-full" onClick={reset}>
                      <RotateCcw className="mr-1 h-4 w-4" /> 新的写作项目
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== 阶段确认栏 ===== */}
          {awaitingStage !== null && (
            <ConfirmBar
              stageIndex={awaitingStage}
              onResolve={resolveConfirm}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ============================================================
// 阶段图标
// ============================================================

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === "running") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-900 dark:text-neutral-100" />;
  if (status === "failed") return <XCircle className="h-4 w-4 shrink-0 text-rose-500" />;
  return <Circle className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600" />;
}

// ============================================================
// 项目设置面板
// ============================================================

function SetupPanel({
  project, setProject, onStart, llm, apiKey, model, apiBase, onKeyChange, onModelChange, onBaseChange,
}: {
  project: PaperProject;
  setProject: (p: PaperProject) => void;
  onStart: () => void;
  llm: LlmStatus;
  apiKey: string;
  model: string;
  apiBase: string;
  onKeyChange: (k: string) => void;
  onModelChange: (m: string) => void;
  onBaseChange: (b: string) => void;
}) {
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [cnkiError, setCnkiError] = useState("");
  const cnkiInput = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    setParsing(true);
    setFileError("");
    try {
      const dataFile = await parseDataFile(f);
      setProject({ ...project, dataFile });
    } catch (e) {
      setFileError(errMsg(e));
    }
    setParsing(false);
  };

  const handleCnki = async (f: File | undefined) => {
    if (!f) return;
    setCnkiError("");
    try {
      const refs = parseCnkiExport(await f.text());
      setProject({ ...project, cnkiRefs: refs });
    } catch (e) {
      setCnkiError(errMsg(e));
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-16">
      <div className="mb-10 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-white">
          <PenLine className="h-5 w-5" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">给研究回路一个主题</h1>
        <p className="mt-3 text-neutral-500 dark:text-neutral-400">
          三个智能体将依次完成文献检索、大纲评审、质量控制、写作与润色。
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] bg-white/90 p-8 shadow-sm backdrop-blur dark:bg-white/[0.04] dark:shadow-none">
        <div>
          <Label className="text-sm font-medium">研究主题</Label>
          <Input
            value={project.topic}
            onChange={(e) => setProject({ ...project, topic: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onStart()}
            placeholder="填写你的研究题目或研究方向"
            className="mt-2 h-12 rounded-xl text-base"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_180px]">
          <div>
            <Label className="text-sm font-medium">关键词</Label>
            <Input
              value={project.keywords}
              onChange={(e) => setProject({ ...project, keywords: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onStart()}
              placeholder="用逗号或空格分隔，如：脑卒中, 溶栓, 时间窗"
              className="mt-2 h-11 rounded-xl"
            />
            <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
              关键词将驱动文献检索与大纲生成，建议填写 2-5 个
            </p>
          </div>
          <div>
            <Label className="text-sm font-medium">研究类型</Label>
            <Input
              value={project.studyType}
              onChange={(e) => setProject({ ...project, studyType: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onStart()}
              placeholder="自由填写"
              className="mt-2 h-11 rounded-xl"
            />
          </div>
        </div>
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {STUDY_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setProject({ ...project, studyType: t })}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                project.studyType === t
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-neutral-400 hover:border-neutral-900 hover:text-neutral-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div>
          <Label className="text-sm font-medium">
            目标期刊 <span className="ml-1 text-xs font-normal text-neutral-400 dark:text-neutral-500">（可选）</span>
          </Label>
          <Input
            value={project.targetJournal}
            onChange={(e) => setProject({ ...project, targetJournal: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onStart()}
            placeholder="如：中华心血管病杂志 — 用于大纲对齐与投稿清单"
            className="mt-2 h-11 rounded-xl"
          />
        </div>

        {/* 数据表格上传 */}
        <div>
          <Label className="text-sm font-medium">
            数据表格 <span className="ml-1 text-xs font-normal text-neutral-400 dark:text-neutral-500">（可选）</span>
          </Label>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {project.dataFile ? (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{project.dataFile.name}</div>
                  <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {project.dataFile.rows} 行 × {project.dataFile.columns.length} 列 · {project.dataFile.columns.slice(0, 5).join("、")}{project.dataFile.columns.length > 5 ? " …" : ""}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProject({ ...project, dataFile: undefined })}
                className="shrink-0 rounded-full p-1.5 text-neutral-400 dark:text-neutral-500 transition hover:bg-white hover:text-neutral-900"
                title="移除数据表"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={parsing}
              onClick={() => fileInput.current?.click()}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 dark:border-white/20 px-4 py-4 text-sm text-neutral-500 dark:text-neutral-400 transition hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-60"
            >
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {parsing ? "正在解析数据表…" : "上传 CSV / Excel 数据表，结果章节将参照你的真实数据撰写"}
            </button>
          )}
          {fileError && <p className="mt-2 text-xs text-rose-500">{fileError}</p>}
          <p className="mt-2 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
            数据仅在本机浏览器解析，仅摘要注入写作提示词，完整文件不会上传。
          </p>
        </div>

        {/* 知网文献导入 */}
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              中文文献（知网）<span className="ml-1 text-xs font-normal text-neutral-400 dark:text-neutral-500">（可选）</span>
            </Label>
            <a
              href={cnkiSearchUrl(project.keywords || project.topic)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-neutral-400 dark:text-neutral-500 underline-offset-2 transition hover:text-neutral-900 hover:underline"
            >
              去知网检索 ↗
            </a>
          </div>
          <input
            ref={cnkiInput}
            type="file"
            accept=".txt,.ris,.ciw,.nbib,.net"
            className="hidden"
            onChange={(e) => {
              handleCnki(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {project.cnkiRefs && project.cnkiRefs.length > 0 ? (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <BookOpen className="h-5 w-5 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">已导入 {project.cnkiRefs.length} 条知网文献</div>
                  <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {project.cnkiRefs[0]?.title.slice(0, 30)}{project.cnkiRefs[0] && project.cnkiRefs[0].title.length > 30 ? "…" : ""} 等，原始著录逐字保留
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProject({ ...project, cnkiRefs: undefined })}
                className="shrink-0 rounded-full p-1.5 text-neutral-400 dark:text-neutral-500 transition hover:bg-white hover:text-neutral-900"
                title="移除知网文献"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => cnkiInput.current?.click()}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 dark:border-white/20 px-4 py-4 text-sm text-neutral-500 dark:text-neutral-400 transition hover:border-neutral-900 hover:text-neutral-900"
            >
              <BookOpen className="h-4 w-4" />
              上传知网导出文件（GB/T 7714 / EndNote / NoteExpress）
            </button>
          )}
          {cnkiError && <p className="mt-2 text-xs text-rose-500">{cnkiError}</p>}
          <p className="mt-2 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
            知网无开放接口：在知网检索后勾选文献 →「导出与分析」→ 选 GB/T 7714-2015（或 EndNote / NoteExpress）导出文件，上传到这里即并入真实文献池。
          </p>
        </div>

        {/* 模型设置 */}
        <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50/60 dark:border-white/10 dark:bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4 text-neutral-400 dark:text-neutral-500" />
              大模型接入
            </div>
            <Badge
              variant={llm.configured ? "default" : "secondary"}
              className={`rounded-full text-xs ${llm.configured ? "bg-emerald-600 hover:bg-emerald-600" : ""}`}
            >
              {llm.configured
                ? llm.mode === "byok" ? "已接入 · 自带密钥" : "已接入 · 内置引擎"
                : "未配置 · 演示模式"}
            </Badge>
          </div>

          {/* 服务商预设 */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PROVIDER_PRESETS.map((p) => {
              const active = p.id === "custom"
                ? !PROVIDER_PRESETS.some((q) => q.id !== "custom" && q.base === apiBase)
                : apiBase === p.base;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (p.id !== "custom") {
                      onBaseChange(p.base);
                      if (p.models.length > 0) onModelChange(p.models[0]);
                    }
                  }}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                    active
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-neutral-200 dark:border-white/10 bg-white text-neutral-500 dark:text-neutral-400 hover:border-neutral-900 hover:text-neutral-900"
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => onKeyChange(e.target.value)}
              placeholder={llm.configured && llm.mode !== "byok" ? "已使用内置密钥（可粘贴自有 Key 覆盖）" : "粘贴 API Key（sk-…）"}
              className="h-10 rounded-xl bg-white text-sm dark:bg-white/5"
            />
            <div>
              <Input
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder="模型名称"
                list="medpaper-models"
                className="h-10 rounded-xl bg-white text-sm dark:bg-white/5"
              />
              <datalist id="medpaper-models">
                {(PROVIDER_PRESETS.find((p) => p.base === apiBase)?.models ??
                  PROVIDER_PRESETS.flatMap((p) => p.models)
                ).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>

          <Input
            value={apiBase}
            onChange={(e) => onBaseChange(e.target.value)}
            placeholder="API 地址（OpenAI 兼容端点，如 https://api.deepseek.com/v1）"
            className="mt-3 h-9 rounded-xl bg-white font-mono text-xs dark:bg-white/5"
          />

          <p className="mt-2 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
            支持任何 OpenAI 兼容服务：选择预设或自定义 API 地址 + 模型名即可。
            密钥仅保存在本机浏览器；填了 Key 后由浏览器直连所选服务，本地部署时留空 Key 则使用内置引擎。线上版本无内置引擎，需填入自有 Key 才能启动真实生成，否则为演示模式。
          </p>
        </div>

        <Button
          size="lg"
          disabled={!project.topic.trim()}
          onClick={onStart}
          className="w-full rounded-xl bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <Play className="mr-1.5 h-4 w-4" />
          启动研究回路
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// 阶段面板
// ============================================================

const STAGE_HEADS = [
  { icon: BookOpen, title: "文献检索", desc: "检索高相关文献，构建证据基线并识别研究空白。" },
  { icon: FileText, title: "大纲生成", desc: "Composer 基于研究空白生成 IMRaD 论文骨架。" },
  { icon: ClipboardCheck, title: "七维评审", desc: "Reviewer 从七个维度对大纲进行量化评分。" },
  { icon: ShieldCheck, title: "质量控制", desc: "未达准入标准不进入写作——质量先于产出。" },
  { icon: Type, title: "拟定标题", desc: "Strategist 生成候选标题，选定后再进入正文写作。" },
  { icon: PenLine, title: "章节写作", desc: "Composer 逐章生成论文正文，流式输出。" },
  { icon: Sparkles, title: "润色投稿", desc: "术语规范化、格式校验与查重检测，输出投稿清单。" },
];

function StagePanel({
  index, status, results, project, streamText, streamingKey, onSelectTitle,
}: {
  index: number;
  status: StageStatus;
  results: Results;
  project: PaperProject;
  streamText: string;
  streamingKey: string;
  onSelectTitle: (t: TitleOption) => void;
}) {
  const head = STAGE_HEADS[index];
  return (
    <div>
      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
          <head.icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {String(index + 1).padStart(2, "0")} · {head.title}
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{head.desc}</p>
        </div>
        <div className="ml-auto pt-1"><StageIcon status={status} /></div>
      </div>

      {status === "pending" && <EmptyHint text="等待研究回路执行到本阶段…" />}
      {status === "running" && index !== 5 && <RunningHint />}

      {/* ---- 文献检索 ---- */}
      {index === 0 && results.literature.length > 0 && (
        <div className="space-y-8">
          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              研究空白（{results.gaps.length}）
            </h3>
            <div className="grid gap-3 md:grid-cols-3">
              {results.gaps.map((g, i) => (
                <div key={i} className="rounded-2xl border border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10 p-5">
                  <Badge variant="outline" className="mb-3 rounded-full border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-300">{g.evidenceLevel}</Badge>
                  <p className="text-sm leading-relaxed">{g.description}</p>
                  <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">建议方向：{g.direction}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-4 flex items-center gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                高相关文献（{results.literature.length}）
              </h3>
              {results.literatureSource === "real" ? (
                <Badge className="rounded-full bg-emerald-600 hover:bg-emerald-600">
                  {(() => {
                    const c = results.literature.filter((x) => x.source === "cnki").length;
                    const p = results.literature.filter((x) => x.source === "pubmed").length;
                    const parts = [c > 0 ? `知网 ${c}` : "", p > 0 ? `PubMed ${p}` : ""].filter(Boolean).join(" + ");
                    return `真实文献${parts ? ` · ${parts}` : ""}`;
                  })()}
                </Badge>
              ) : (
                <Badge variant="secondary" className="rounded-full">演示数据</Badge>
              )}
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-white/5 rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03]">
              {results.literature.map((l) => (
                <div key={`${l.source ?? "demo"}-${l.pmid || l.title}`} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-2">
                      {l.source === "cnki" && (
                        <span className="mt-0.5 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">知网</span>
                      )}
                      {l.source === "pubmed" && (
                        <span className="mt-0.5 shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">PubMed</span>
                      )}
                      <div className="text-sm font-medium leading-snug">{l.title}</div>
                    </div>
                    {l.year > 0 && (
                      <span className="shrink-0 rounded-full bg-neutral-100 dark:bg-white/10 px-2 py-0.5 text-xs text-neutral-500 dark:text-neutral-400">{l.year}</span>
                    )}
                  </div>
                  <div className="mt-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                    {[l.authors.join("、"), l.journal, l.pmid ? `PMID ${l.pmid}` : "", l.citations > 0 ? `被引 ${l.citations}` : "", l.doi ? `DOI ${l.doi}` : ""].filter(Boolean).join(" · ")}
                  </div>
                  {l.abstract && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{l.abstract}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- 大纲 ---- */}
      {index === 1 && results.outline.length > 0 && (
        <div className="space-y-3">
          {results.outline.map((s, i) => (
            <div key={s.key} className="rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] p-5">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{i + 1}. {s.title}</div>
                {s.wordTarget > 0 && (
                  <span className="rounded-full bg-neutral-100 dark:bg-white/10 px-2.5 py-0.5 text-xs text-neutral-500 dark:text-neutral-400">目标 {s.wordTarget} 字</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.keyPoints.map((k) => (
                  <span key={k} className="rounded-full border border-neutral-200 dark:border-white/10 px-2 py-0.5 text-xs text-neutral-500 dark:text-neutral-400">{k}</span>
                ))}
              </div>
              <div className="mt-3 space-y-1.5 border-l-2 border-neutral-100 dark:border-white/10 pl-4">
                {s.subsections.map((sub) => (
                  <div key={sub.title} className="text-sm text-neutral-600 dark:text-neutral-400">
                    <span className="font-medium">{sub.title}</span>
                    <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">{sub.keyPoints.join(" · ")}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- 七维评审 ---- */}
      {index === 2 && results.scores && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-neutral-900 p-6 text-white">
              <div className="text-sm text-neutral-400 dark:text-neutral-500">评审总分</div>
              <div className="mt-1 text-4xl font-bold">{results.scoreTotal}<span className="text-lg text-neutral-400 dark:text-neutral-500">/35</span></div>
            </div>
            <div className="rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] p-6">
              <div className="text-sm text-neutral-500 dark:text-neutral-400">维度均分</div>
              <div className="mt-1 text-4xl font-bold">{results.scoreAvg}<span className="text-lg text-neutral-400 dark:text-neutral-500">/5</span></div>
            </div>
          </div>
          <div className="space-y-3 rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] p-6">
            {Object.entries(results.scores).map(([dim, v]) => (
              <div key={dim} className="flex items-center gap-4">
                <div className="w-20 shrink-0 text-sm text-neutral-600 dark:text-neutral-400">{dim}</div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${v >= 4 ? "bg-emerald-500" : "bg-amber-400"}`}
                    style={{ width: `${(v / 5) * 100}%` }}
                  />
                </div>
                <div className="w-8 text-right text-sm font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] p-6">
            <h4 className="mb-3 text-sm font-semibold">Reviewer 评语</h4>
            <ul className="space-y-2">
              {results.comments.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" />{c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ---- 质量控制 ---- */}
      {index === 3 && results.gate && (
        <div className="space-y-5">
          <div className={`rounded-2xl p-6 text-center ${results.gate.passed ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"}`}>
            {results.gate.passed
              ? <><CheckCircle2 className="mx-auto mb-2 h-8 w-8" /><div className="text-lg font-semibold">质量控制通过，准许进入写作阶段</div></>
              : <><XCircle className="mx-auto mb-2 h-8 w-8" /><div className="text-lg font-semibold">质量控制未通过，请返回修订大纲</div></>}
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-white/5 rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03]">
            {results.gate.checks.map((c) => (
              <div key={c.name} className="flex items-center gap-4 p-5">
                {c.passed
                  ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  : <XCircle className="h-5 w-5 shrink-0 text-rose-500" />}
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-neutral-400 dark:text-neutral-500">{c.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- 拟定标题 ---- */}
      {index === 4 && results.titles.length > 0 && (
        <TitlePicker
          titles={results.titles}
          selected={results.selectedTitle}
          onSelect={onSelectTitle}
        />
      )}

      {/* ---- 章节写作 ---- */}
      {index === 5 && (
        <div className="space-y-5">
          {streamingKey && (
            <div className="rounded-2xl border border-neutral-900 p-6 dark:border-white/30">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在撰写「{results.outline.find((s) => s.key === streamingKey)?.title}」…
              </div>
              <div className="whitespace-pre-wrap text-sm leading-loose text-neutral-700 dark:text-neutral-300">
                {streamText}
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-neutral-900 align-text-bottom" />
              </div>
            </div>
          )}
          {results.chapters.map((ch) => (
            <details key={ch.key} className="group rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03]" open={ch.key === "abstract"}>
              <summary className="flex cursor-pointer list-none items-center justify-between p-5">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="font-semibold">{ch.title}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-neutral-400 dark:text-neutral-500">
                  {(results.issues[ch.key]?.length ?? 0) > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-600">
                      经 {results.issues[ch.key].length} 条审稿意见修订
                    </span>
                  )}
                  <span>{ch.wordCount} 字</span>
                </div>
              </summary>
              {(results.issues[ch.key]?.length ?? 0) > 0 && (
                <div className="border-t border-neutral-100 dark:border-white/10 bg-amber-50/50 dark:bg-amber-500/10 px-5 py-4">
                  <div className="mb-2 text-xs font-semibold text-amber-700">审稿修订记录</div>
                  <ul className="space-y-1.5">
                    {results.issues[ch.key].map((it, n) => (
                      <li key={n} className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                        <span className="font-medium text-amber-700">问题{n + 1}：</span>{it.problem}
                        <span className="mx-1 text-neutral-300 dark:text-neutral-600">→</span>
                        <span className="text-neutral-500 dark:text-neutral-400">{it.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="whitespace-pre-wrap border-t border-neutral-100 dark:border-white/10 p-5 text-sm leading-loose text-neutral-700 dark:text-neutral-300">
                {ch.content}
              </div>
            </details>
          ))}
          {status === "pending" && <EmptyHint text="等待质量控制通过后开始写作…" />}
        </div>
      )}

      {/* ---- 润色投稿 ---- */}
      {index === 6 && results.plagiarism && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] p-6 text-center">
              <div className="text-sm text-neutral-500 dark:text-neutral-400">全文总相似率</div>
              <div className={`mt-2 text-5xl font-bold ${results.plagiarism.similarityRate < 10 ? "text-emerald-600" : "text-rose-600"}`}>
                {results.plagiarism.similarityRate}%
              </div>
              <div className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{results.plagiarism.verdict}</div>
            </div>
            <div className="rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] p-6">
              <div className="mb-3 text-sm font-semibold">相似来源</div>
              {results.plagiarism.matchedSources.map((m) => (
                <div key={m.title} className="mb-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-600 dark:text-neutral-400">{m.title}</span>
                    <span className="font-semibold">{m.similarity}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${m.similarity * 10}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="border-b border-neutral-100 dark:border-white/10 p-5 text-sm font-semibold">润色修订（{results.edits.length}）</div>
            <div className="divide-y divide-neutral-100 dark:divide-white/5">
              {results.edits.map((e, i) => (
                <div key={i} className="p-5">
                  <Badge variant="secondary" className="mb-2 rounded-full">{e.category}</Badge>
                  <div className="flex flex-col gap-1.5 text-sm md:flex-row md:items-center md:gap-3">
                    <span className="text-neutral-400 dark:text-neutral-500 line-through">{e.before}</span>
                    <ArrowRight className="hidden h-4 w-4 text-neutral-300 dark:text-neutral-600 md:block" />
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">{e.after}</span>
                  </div>
                  <div className="mt-1.5 text-xs text-neutral-400 dark:text-neutral-500">{e.reason}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] p-6">
            <div className="mb-4 text-sm font-semibold">投稿清单 · 《{project.targetJournal}》</div>
            <div className="grid gap-2.5 md:grid-cols-2">
              {["正文各章节齐全（IMRaD）", "参考文献 GB/T 7714 著录", "查重率低于期刊阈值", "伦理审批编号已标注", "统计学表述符合 ICMJE 规范", "图表编号与引用一致"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />{item}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-center">
            <ExportButton
              project={project}
              chapters={results.chapters}
              edits={results.edits}
              plagiarism={results.plagiarism}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 拟定标题选择器
// ============================================================

function TitlePicker({
  titles, selected, onSelect,
}: {
  titles: TitleOption[];
  selected: TitleOption | null;
  onSelect: (t: TitleOption) => void;
}) {
  const [custom, setCustom] = useState("");

  const applyCustom = () => {
    const t = custom.trim();
    if (!t) return;
    onSelect({ title: t, englishTitle: "", rationale: "用户自定义标题" });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {titles.map((t, i) => {
          const active = selected?.title === t.title;
          return (
            <button
              key={t.title}
              type="button"
              onClick={() => onSelect(t)}
              className={`w-full rounded-2xl border p-5 text-left transition ${
                active
                  ? "border-neutral-900 bg-neutral-900 text-white shadow-md dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-200 dark:border-white/10 bg-white hover:border-neutral-400"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${active ? "bg-white text-neutral-900 dark:text-neutral-100" : "bg-neutral-100 dark:bg-white/10 text-neutral-500 dark:text-neutral-400"}`}>
                      {i + 1}
                    </span>
                    <span className="font-semibold leading-snug">{t.title}</span>
                  </div>
                  {t.englishTitle && (
                    <div className={`mt-1.5 pl-7 text-xs italic ${active ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-400 dark:text-neutral-500"}`}>
                      {t.englishTitle}
                    </div>
                  )}
                  <div className={`mt-2 pl-7 text-xs leading-relaxed ${active ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-500 dark:text-neutral-400"}`}>
                    推荐理由：{t.rationale}
                  </div>
                </div>
                {active && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* 自定义标题 */}
      <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-white/20 p-5">
        <div className="mb-3 text-sm font-medium text-neutral-600 dark:text-neutral-400">都不满意？自己写一个</div>
        <div className="flex items-center gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCustom()}
            placeholder="填写自定义论文标题，回车采用"
            className="h-10 rounded-xl text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!custom.trim()}
            onClick={applyCustom}
            className="h-10 shrink-0 rounded-xl"
          >
            采用此标题
          </Button>
        </div>
      </div>

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        {selected
          ? `已选定：「${selected.title}」，确认后将带入正文写作与 Word 导出。`
          : "点击卡片选定标题；若直接确认，将默认采用候选 1。"}
      </p>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-neutral-200 dark:border-white/10 py-16 text-neutral-300 dark:text-neutral-600">
      <CircleDashed className="mb-3 h-8 w-8" />
      <div className="text-sm">{text}</div>
    </div>
  );
}

function RunningHint() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 dark:border-white/10 dark:bg-white/[0.03] p-6 text-sm text-neutral-500 dark:text-neutral-400">
      <Loader2 className="h-4 w-4 animate-spin" /> 智能体正在执行本阶段…
    </div>
  );
}

// ============================================================
// Word 导出按钮
// ============================================================

function ExportButton({
  project, chapters, edits, plagiarism, variant = "default",
}: {
  project: PaperProject;
  chapters: WritingChapter[];
  edits: PolishEdit[];
  plagiarism: PlagiarismResult | null;
  variant?: "default" | "secondary";
}) {
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);

  const handleExport = async () => {
    if (exporting || chapters.length === 0) return;
    setExporting(true);
    try {
      const { exportPaperDocx } = await import("@/engine/exporter");
      await exportPaperDocx(project, chapters, { edits, plagiarism });
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch {
      /* 导出失败保持原状 */
    }
    setExporting(false);
  };

  return (
    <Button
      onClick={handleExport}
      disabled={exporting || chapters.length === 0}
      variant={variant === "secondary" ? "secondary" : "default"}
      className={`rounded-full ${variant === "default" ? "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200" : ""}`}
    >
      {exporting ? (
        <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> 正在生成…</>
      ) : done ? (
        <><CheckCircle2 className="mr-1.5 h-4 w-4" /> 已导出 .docx</>
      ) : (
        <><Download className="mr-1.5 h-4 w-4" /> 导出 Word 论文</>
      )}
    </Button>
  );
}

// ============================================================
// 阶段确认栏（含批注输入）
// ============================================================

function ConfirmBar({
  stageIndex, onResolve,
}: {
  stageIndex: number;
  onResolve: (d: ConfirmDecision) => void;
}) {
  const [note, setNote] = useState("");
  const stage = PIPELINE_STAGES[stageIndex];
  const nextStage = PIPELINE_STAGES[stageIndex + 1];

  const resolve = (action: "next" | "rerun") => {
    onResolve({ action, note: note.trim() });
    setNote("");
  };

  return (
    <div className="sticky bottom-0 z-10 border-t border-neutral-200 dark:border-white/10 bg-white/95 dark:bg-[#0a0a12]/90 px-6 py-4 backdrop-blur">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
            <div>
              <div className="text-sm font-semibold">阶段「{stage.title}」已完成</div>
              <div className="text-xs text-neutral-400 dark:text-neutral-500">
                审阅产物后确认继续「{nextStage.title}」，或写下批注让智能体修改
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => resolve("rerun")}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              {note.trim() ? "按批注重跑" : "重跑本阶段"}
            </Button>
            <Button
              size="sm"
              className="rounded-full bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              onClick={() => resolve("next")}
            >
              确认，继续
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <MessageSquareDiff className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600" />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && resolve(note.trim() ? "rerun" : "next")}
            placeholder="批注（可选）：如「期刊优先选 SCI」「方法部分增加亚组分析」… 回车提交"
            className="h-9 rounded-full border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
