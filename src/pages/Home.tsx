import { Link } from "react-router";
import { ArrowRight, BookOpen, FlaskConical, PenLine, ShieldCheck, Sparkles, Microscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import { PIPELINE_STAGES, AGENTS } from "@/engine/types";

const LOOP_CARDS = [
  { icon: BookOpen, title: "文献证据", desc: "Europe PMC / PubMed 检索英文文献，知网导出导入中文文献，全部真实可核实。" },
  { icon: FlaskConical, title: "假设与骨架", desc: "基于研究空白生成 IMRaD 论文大纲，明确研究假设与章节要点。" },
  { icon: ShieldCheck, title: "评审与质量控制", desc: "七维度量化评审，未达准入标准不进入写作——质量先于产出。" },
  { icon: PenLine, title: "写作与润色", desc: "逐章生成正文，术语规范化、格式校验与查重检测后输出投稿清单。" },
];

export default function Home() {
  return (
    <div className="min-h-screen text-neutral-900 dark:text-neutral-100 antialiased dark:text-neutral-100">
      {/* ===== Nav ===== */}
      <header className="sticky top-0 z-40 border-b border-neutral-100 dark:border-white/10 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-[#0a0a12]/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white">
              <Microscope className="h-4 w-4" />
            </div>
            <span className="text-lg font-semibold tracking-tight">MedPaper</span>
            <span className="hidden text-sm text-neutral-400 dark:text-neutral-500 sm:inline">医学论文写作全流程自动化平台</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-neutral-600 dark:text-neutral-400 md:flex">
            <a href="#loop" className="transition hover:text-neutral-900">研究回路</a>
            <a href="#agents" className="transition hover:text-neutral-900">智能体</a>
            <a href="#pipeline" className="transition hover:text-neutral-900">全流程</a>
          </nav>
          <ThemeToggle />
          <Link to="/workspace">
            <Button className="rounded-full bg-neutral-900 px-5 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
              进入工作台
            </Button>
          </Link>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(0,0,0,0.05),transparent)] dark:hidden" />
        <div className="mx-auto max-w-6xl px-6 pb-24 pt-28 text-center">
          <div className="mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-4 py-1.5 dark:border-white/15 dark:bg-white/10 text-sm text-neutral-600 dark:text-neutral-400">
            <Sparkles className="h-3.5 w-3.5" />
            三智能体协同 · 逐步确认可控 · 真实文献支撑
          </div>
          <h1 className="mx-auto max-w-3xl text-5xl font-bold leading-[1.15] tracking-tight md:text-6xl">
            寻求将临床经验转化为
            <br />
            学术成果的最优解
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
            给一个研究主题，三个智能体协同跑完整个写作回路：
            文献检索、大纲评审、质量控制、拟定标题、章节写作、润色投稿。
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link to="/workspace">
              <Button size="lg" className="rounded-full bg-neutral-900 px-8 text-base text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
                开始写作
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
            <a href="#loop">
              <Button size="lg" variant="outline" className="rounded-full px-8 text-base">
                了解研究回路
              </Button>
            </a>
          </div>

          {/* Stats */}
          <div className="mx-auto mt-20 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-200 md:grid-cols-4 dark:border-white/10 dark:bg-white/10">
            {[
              ["3", "协作智能体"],
              ["7", "自动化阶段"],
              ["CSV/Excel", "自带数据接入"],
              ["7", "评审维度"],
            ].map(([num, label]) => (
              <div key={label} className="bg-white/90 px-6 py-8 backdrop-blur dark:bg-white/[0.05]">
                <div className="text-3xl font-bold tracking-tight">{num}</div>
                <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Research loop ===== */}
      <section id="loop" className="border-t border-neutral-100 dark:border-white/10 bg-neutral-50/60 dark:border-white/5 dark:bg-transparent py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 flex items-end justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">研究回路</h2>
              <p className="mt-3 max-w-lg text-neutral-500 dark:text-neutral-400">
                像一位严谨的合作者那样工作：先读证据，再立假设，评审过关之后才动笔。
              </p>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {LOOP_CARDS.map((c) => (
              <div
                key={c.title}
                className="group rounded-2xl border border-neutral-200 dark:border-white/10 bg-white/85 p-7 backdrop-blur dark:bg-white/[0.04] transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-neutral-900/5"
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 text-white transition group-hover:scale-110">
                  <c.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Pipeline ===== */}
      <section id="pipeline" className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">七个阶段，一条流水线</h2>
          <p className="mt-3 max-w-lg text-neutral-500 dark:text-neutral-400">
            每个阶段由专属智能体负责，输出结构化结果并驱动下一阶段。
          </p>
          <div className="mt-12 space-y-0">
            {PIPELINE_STAGES.map((s) => (
              <div
                key={s.key}
                className="group flex items-center gap-6 border-b border-neutral-100 dark:border-white/10 py-5 transition hover:bg-neutral-50/80 dark:hover:bg-white/5 md:gap-10"
              >
                <div className="w-10 shrink-0 text-center text-2xl font-bold text-neutral-200 dark:text-white/15 transition group-hover:text-neutral-900">
                  {String(s.index).padStart(2, "0")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold">{s.title}</div>
                  <div className="text-sm text-neutral-500 dark:text-neutral-400">{s.subtitle}</div>
                </div>
                <div
                  className="hidden rounded-full px-3 py-1 text-xs font-medium text-white sm:block"
                  style={{ backgroundColor: AGENTS[s.agent].color }}
                >
                  {AGENTS[s.agent].name}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Agents ===== */}
      <section id="agents" className="border-t border-neutral-100 dark:border-white/10 bg-neutral-50/60 dark:border-white/5 dark:bg-transparent py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">三位智能体，各司其职</h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {(Object.keys(AGENTS) as Array<keyof typeof AGENTS>)
              .filter((k) => k !== "system")
              .map((k) => {
                const a = AGENTS[k];
                return (
                  <div key={k} className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white/85 p-8 backdrop-blur dark:bg-white/[0.04]">
                    <div className="mb-5 h-1.5 w-10 rounded-full" style={{ backgroundColor: a.color }} />
                    <h3 className="text-xl font-semibold">{a.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{a.role}</p>
                  </div>
                );
              })}
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="py-28 text-center">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-bold tracking-tight md:text-5xl">为职称评审而生，现已可用</h2>
          <p className="mx-auto mt-4 max-w-md text-neutral-500 dark:text-neutral-400">
            输入一个研究主题，让研究回路替你跑完剩下的路。
          </p>
          <Link to="/workspace">
            <Button size="lg" className="mt-10 rounded-full bg-neutral-900 px-10 text-base text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
              进入工作台
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-neutral-100 dark:border-white/10 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-neutral-400 dark:text-neutral-500 md:flex-row">
          <div className="flex items-center gap-2">
            <Microscope className="h-4 w-4" />
            <span>MedPaper · 医学论文写作全流程自动化平台</span>
          </div>
          <div>作者：wangpengfei</div>
        </div>
      </footer>
    </div>
  );
}
