// Accessibility: axe (WCAG 2.1 A/AA) on the key pages; fails on serious/critical violations.
// Known app bugs are listed in KNOWN (page -> rule ids) and reported as annotations instead.
import { test, expect } from "../lib/fixtures";
import { closeDb } from "../lib/db";
import { resetLearner } from "../lib/state";
import { keyPages, openReady, seriousAxeIssues } from "../lib/pages";

const ROLE = "ui" as const;
const PAGES = ["dashboard", "learning", "quiz", "tbs", "progress", "subscribe"];

/** Reported app bugs, not yet fixed (see the report). Remove an entry once it's fixed. */
// color-contrast: inactive top-nav links use text-muted-foreground/60 (src/components/layout/top-nav.tsx)
//   on every page; dashboard also has text-athena-amber on the light card (daily-quest-card, quest-streak).
// scrollable-region-focusable: TBS scroll panel (.overflow-y-auto.flex-1.py-4) can't get keyboard focus.
// button-name (critical): quiz header icon-only buttons (show/hide timer, calculator, close) have no name.
const KNOWN: Record<string, string[]> = {
  dashboard: ["color-contrast"],
  learning: ["color-contrast"],
  quiz: ["button-name", "color-contrast"],
  tbs: ["color-contrast", "scrollable-region-focusable"],
  progress: ["color-contrast"],
  subscribe: ["color-contrast"],
};

test.beforeAll(() => resetLearner(ROLE));
test.afterAll(closeDb);

for (const name of PAGES) {
  test(`axe: ${name}`, { tag: name === "dashboard" ? "@smoke" : undefined }, async ({ as }) => {
    const page = await as(ROLE);
    const target = (await keyPages(page)).find((p) => p.name === name)!;
    await openReady(page, target.path);
    const issues = await seriousAxeIssues(page);
    const known = issues.filter((i) => KNOWN[name]?.includes(i.rule));
    for (const k of known) {
      test.info().annotations.push({ type: "known a11y bug", description: `${name}: ${k.rule} (${k.impact}, ${k.nodes} nodes)` });
    }
    expect(issues.filter((i) => !known.includes(i)), `serious/critical axe issues on ${target.path}`).toEqual([]);
  });
}
