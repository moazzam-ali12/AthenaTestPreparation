// Key pages for the accessibility and responsive specs, plus the checks they run.
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expect, api, open } from "./fixtures";
import { quizPath, subtopicsOf } from "./state";

export type KeyPage = { name: string; path: string };

/** dashboard, learning, quiz, TBS, progress, subscribe — resolved for the signed-in user. */
export async function keyPages(page: Page): Promise<KeyPage[]> {
  const sub = (await subtopicsOf("aud"))[0];
  const tasks = (await api(page, "GET", "/api/tbs?section=aud")).body.tasks as { id: string; isSample?: boolean; locked?: boolean }[];
  const tbs = tasks.find((t) => t.isSample) ?? tasks.find((t) => !t.locked) ?? tasks[0];
  return [
    { name: "dashboard", path: "/dashboard" },
    { name: "learning", path: "/learning" },
    { name: "quiz", path: quizPath(sub, 1) },
    { name: "tbs", path: `/learning/aud/tbs/${tbs.id}` },
    { name: "progress", path: "/progress" },
    { name: "subscribe", path: "/subscribe" },
  ];
}

/**
 * Opens a page and waits until it has rendered real content: the main landmark holds text and no
 * loading spinner is left. (Not "a heading": the full-screen quiz has none.)
 */
export async function openReady(page: Page, path: string) {
  await open(page, path);
  const main = page.getByRole("main").first();
  await expect
    .poll(async () => ((await main.innerText().catch(() => "")) ?? "").trim().length, { message: `${path} rendered`, timeout: 60_000 })
    .toBeGreaterThan(80);
  await expect(page.locator(".animate-spin")).toHaveCount(0, { timeout: 60_000 });
}

export type AxeIssue = { rule: string; impact: string; nodes: number; target: string };

/** Serious + critical axe violations (WCAG 2.1 A/AA) on the current page. */
export async function seriousAxeIssues(page: Page): Promise<AxeIssue[]> {
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return res.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ rule: v.id, impact: v.impact!, nodes: v.nodes.length, target: String(v.nodes[0]?.target ?? "") }));
}

/**
 * Layout problems at the current viewport: horizontal page scroll, and visible buttons/links whose
 * centre is covered by another element once scrolled into view. Returns readable strings.
 */
export async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sw = document.documentElement.scrollWidth;
    const label = (el: Element) =>
      (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".") : ""}`;
    if (sw > vw + 1) {
      // Name the outermost elements that stick out past the viewport (the likely cause).
      const wide = [...document.body.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > vw + 1 && r.width > 0 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1);
      });
      issues.push(`horizontal scroll: page ${sw}px wide at ${vw}px; overflowing: ${wide.slice(0, 3).map(describe).join(" | ")}`);
    }
    // A fixed full-viewport overlay (the full-screen quiz) intentionally covers the app shell:
    // only its own controls are checked then.
    const overlay = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        if (getComputedStyle(el).position !== "fixed") return false;
        const r = el.getBoundingClientRect();
        return r.width >= vw * 0.95 && r.height >= vh * 0.9;
      })
      .pop();
    const els = [...document.querySelectorAll<HTMLElement>("button, a[href], [role=button]")].filter(
      (el) =>
        el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        !el.closest("[aria-hidden=true], [inert]") &&
        (!overlay || overlay.contains(el))
    );
    const { scrollX, scrollY } = window;
    for (const el of els.slice(0, 80)) {
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cx > vw || cy < 0 || cy > window.innerHeight) continue; // clipped (off-canvas menu etc.)
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        issues.push(`covered: "${label(el)}" under "${label(hit)}"`);
      }
    }
    window.scrollTo(scrollX, scrollY);
    return [...new Set(issues)];
  });
}
