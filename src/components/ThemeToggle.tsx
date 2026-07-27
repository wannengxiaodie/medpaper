import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** 明暗主题切换按钮 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "切换到浅色主题" : "切换到深色主题"}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white/70 text-neutral-500 backdrop-blur transition hover:text-neutral-900 dark:border-white/15 dark:bg-white/10 dark:text-neutral-300 dark:hover:text-white"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
