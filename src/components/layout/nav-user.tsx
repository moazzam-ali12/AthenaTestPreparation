"use client";

import { UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";

export function NavUser() {
  return (
    <div className="flex items-center gap-3">
      <ThemeToggle />
      <UserButton />
    </div>
  );
}
