"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const navItems = [
  { href: "/dashboard", label: "ATHENA" },
  { href: "/learning", label: "LEARNING" },
  { href: "/progress", label: "PROGRESS" },
  { href: "/queue", label: "QUEUE" },
  { href: "/review", label: "REVIEW" },
  { href: "/practice-exam", label: "MOCK EXAM" },
  { href: "/mentor", label: "MENTOR" },
  { href: "/profile", label: "PROFILE" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
        {/* Scrollable nav — prevents overflow on small screens */}
        <nav className="flex flex-1 items-center gap-5 sm:gap-8 overflow-x-auto scrollbar-hide justify-start sm:justify-center">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative shrink-0 py-4 text-xs font-medium tracking-[0.2em] transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                )}
              >
                {item.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-4 shrink-0">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
