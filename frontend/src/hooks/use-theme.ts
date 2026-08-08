import { useState, useCallback } from "react";

export type Theme = "light" | "dark";

/** 读取当前生效的主题（基于 <html> 的 dark class） */
function read_theme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** 主题切换：更新 <html>.dark + localStorage，由 index.html 内联脚本初始化 */
export function use_theme(): { theme: Theme; toggle: () => void } {
  const [theme, set_theme] = useState<Theme>(read_theme);

  const toggle = useCallback(() => {
    set_theme(prev => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("granodiorite-theme", next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
