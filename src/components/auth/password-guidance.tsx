"use client";

import { Check, Circle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** The only hard rule. Everything else is advisory and must never block submit. */
export const PASSWORD_MIN_LENGTH = 8;

const RULES = [
  { label: `${PASSWORD_MIN_LENGTH}+ characters`, test: (p: string) => p.length >= PASSWORD_MIN_LENGTH },
  { label: "Uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number", test: (p: string) => /\d/.test(p) },
  { label: "Special character", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export type PasswordStrength = "Weak" | "Fair" | "Strong";

export function getPasswordStrength(password: string): PasswordStrength {
  const met = RULES.filter((r) => r.test(password)).length;
  if (met === RULES.length) return "Strong";
  if (met >= 3 && password.length >= PASSWORD_MIN_LENGTH) return "Fair";
  return "Weak";
}

export function meetsPasswordMinimum(password: string) {
  return password.length >= PASSWORD_MIN_LENGTH;
}

/**
 * Soft, non-blocking password guidance: live checklist + strength label.
 * Render below any "set password" field. Do not use it to disable submit.
 */
export function PasswordGuidance({ password, className }: { password: string; className?: string }) {
  if (!password) return null;
  const strength = getPasswordStrength(password);

  return (
    <div className={cn("mt-2 space-y-2 text-xs", className)} aria-live="polite">
      <p className="flex items-center gap-1.5 text-muted-foreground">
        Strength:
        <span
          className={cn(
            "font-semibold",
            strength === "Strong" ? "text-athena-success" : "text-athena-amber"
          )}
        >
          {strength}
        </span>
      </p>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {RULES.map((rule) => {
          const ok = rule.test(password);
          return (
            <li
              key={rule.label}
              className={cn("flex items-center gap-1.5", ok ? "text-athena-success" : "text-muted-foreground")}
            >
              {ok ? <Check size={12} aria-hidden /> : <Circle size={12} aria-hidden />}
              <span>{rule.label}</span>
              <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
            </li>
          );
        })}
      </ul>
      {strength !== "Strong" && (
        <p className="flex items-start gap-1.5 rounded-md bg-athena-amber/10 px-2 py-1.5 text-athena-amber">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          This password is weak. We recommend mixing uppercase, lowercase, numbers, and special
          characters, but you can continue.
        </p>
      )}
    </div>
  );
}
