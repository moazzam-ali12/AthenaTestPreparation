// Currency vs. LaTeX `$` disambiguation for markdown + remark-math content.
//
// Content convention (sampled from staging problems/TBS): currency is a bare
// `$` before a digit ("$15,000", "$(14,000)"), currency inside math is already
// escaped (`\$6,000`), and inline math opens with a letter or `\` ("$x^2$",
// "$\text{NI} = \$5$"). Rarely math opens with a digit ("$360M \approx 1.7\%$"),
// so a digit-led span is still math when it reaches a closing `$` on the same
// line and contains LaTeX markup.

const CURRENCY_START = /^ ?\(?-?\d/;
const LATEX_MARKUP = /\\[a-zA-Z]|[\^_{}]/;

/** Index of the next unescaped single `$` at or after `from`, or -1. */
function findCloser(src: string, from: number, sameLine: boolean): number {
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (sameLine && ch === "\n") return -1;
    if (ch === "$") return i;
  }
  return -1;
}

/**
 * Escapes currency dollar signs (`$15,000` -> `\$15,000`) so remark-math does
 * not treat them as inline-math delimiters. Real math (`$x^2$`, `$$...$$`),
 * already-escaped `\$` and code spans are left untouched.
 */
export function escapeCurrencyDollars(src: string): string {
  if (!src.includes("$")) return src;
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\") {
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(run, i + run.length);
      const stop = end === -1 ? i + run.length : end + run.length;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }

    // Display math: copy through the closing `$$`.
    if (src[i + 1] === "$") {
      const end = src.indexOf("$$", i + 2);
      const stop = end === -1 ? i + 2 : end + 2;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }

    const rest = src.slice(i + 1);
    if (CURRENCY_START.test(rest)) {
      const closer = findCloser(src, i + 1, true);
      const isMath =
        closer !== -1 && src[closer + 1] !== "$" && LATEX_MARKUP.test(src.slice(i + 1, closer));
      if (!isMath) {
        out += "\\$";
        i++;
        continue;
      }
    }

    // Inline math: copy through its closing `$` so a closer is never
    // mistaken for currency ("$x$ 5").
    const closer = findCloser(src, i + 1, false);
    const stop = closer === -1 ? i + 1 : closer + 1;
    out += src.slice(i, stop);
    i = stop;
  }
  return out;
}
