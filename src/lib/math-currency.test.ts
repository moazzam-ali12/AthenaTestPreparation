import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeCurrencyDollars as esc } from "./math-currency";

test("currency amounts are escaped", () => {
  assert.equal(esc("A gift of $15,000 and a $45 million loss."), "A gift of \\$15,000 and a \\$45 million loss.");
  assert.equal(esc("Net loss of $(14,000)."), "Net loss of \\$(14,000).");
  assert.equal(esc("Price $ 20 each"), "Price \\$ 20 each");
  assert.equal(esc("$13,610,000 - $1,190,000"), "\\$13,610,000 - \\$1,190,000");
});

test("real math is left alone", () => {
  assert.equal(esc("Solve $x^2$ now"), "Solve $x^2$ now");
  assert.equal(esc("$$\\frac{a}{b}$$"), "$$\\frac{a}{b}$$");
  assert.equal(esc("$R \\leq C$ and $(R + X) / C$"), "$R \\leq C$ and $(R + X) / C$");
  assert.equal(esc("$\\text{NI} = \\$5,000$"), "$\\text{NI} = \\$5,000$");
  assert.equal(esc("$360M \\approx 1.7\\%$"), "$360M \\approx 1.7\\%$");
});

test("mixed currency and math", () => {
  assert.equal(esc("Pay $500 when $x > 2$."), "Pay \\$500 when $x > 2$.");
  assert.equal(esc("$x$ 5 then $10"), "$x$ 5 then \\$10");
  assert.equal(esc("Costs $80,000.\nPaid $2,000 for $y$"), "Costs \\$80,000.\nPaid \\$2,000 for $y$");
});

test("escaped dollars and code spans are untouched", () => {
  assert.equal(esc("Already \\$15 here"), "Already \\$15 here");
  assert.equal(esc("Use `$5` literally"), "Use `$5` literally");
  assert.equal(esc("no dollars"), "no dollars");
});
