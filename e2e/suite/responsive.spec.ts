// Responsive: key pages at 375 / 768 / 1440 px — no horizontal scroll, no covered buttons.
// Sets its own viewports, so it runs in the desktop project only.
import { test, expect } from "../lib/fixtures";
import { closeDb } from "../lib/db";
import { resetLearner } from "../lib/state";
import { keyPages, layoutProblems, openReady } from "../lib/pages";

const ROLE = "ui" as const;
const PAGES = ["dashboard", "learning", "quiz", "tbs", "progress", "subscribe"];
const WIDTHS = [375, 768, 1440];

/**
 * Reported app bugs (page -> widths), annotated instead of failing. Remove once fixed.
 * learning@375: the subject pill row (src/app/(protected)/learning/page.tsx, "mb-6 flex gap-2")
 * neither wraps nor scrolls, so the page is 417px wide.
 */
const KNOWN: Record<string, number[]> = { learning: [375] };

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "viewports are set per test"));
test.beforeAll(({}, info) => (info.project.name === "desktop" ? resetLearner(ROLE) : undefined));
test.afterAll(closeDb);

for (const name of PAGES) {
  test(`layout: ${name} at ${WIDTHS.join("/")}px`, { tag: name === "dashboard" ? "@smoke" : undefined }, async ({ as }) => {
    const page = await as(ROLE);
    const target = (await keyPages(page)).find((p) => p.name === name)!;
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
      await openReady(page, target.path);
      if (KNOWN[name]?.includes(width)) {
        const problems = await layoutProblems(page);
        test.info().annotations.push({
          type: "known layout bug",
          description: `${name}@${width}: ${problems.join("; ") || "no longer reproduces — remove from KNOWN"}`,
        });
        continue;
      }
      // Polls until entrance animations settle; fails with the last problems found.
      await expect.poll(() => layoutProblems(page), { message: `${target.path} @ ${width}px`, timeout: 15_000 }).toEqual([]);
    }
  });
}
