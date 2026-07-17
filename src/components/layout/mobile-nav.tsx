"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  BookOpen,
  GraduationCap,
  User,
  Brain,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/queue", label: "Queue", icon: BookOpen },
  { href: "/review", label: "Review", icon: GraduationCap },
  { href: "/mentor", label: "Mentor", icon: Brain },
  { href: "/profile", label: "Profile", icon: User },
];

export function MobileNav() {
  const pathname = usePathname();

  // Hide during onboarding and full-screen quiz flows
  if (
    pathname.startsWith("/onboarding") ||
    pathname.includes("/quiz/")
  ) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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
              "flex flex-1 flex-col items-center justify-center gap-1 py-3 text-[10px] font-medium tracking-wide transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground/60 hover:text-muted-foreground"
            )}
          >
            <item.icon
              className={cn(
                "h-5 w-5 transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground/60"
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
