import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SECTIONS = [
  { href: "/admin/questions", title: "Question bank", text: "Search, edit and approve MCQs and practice questions." },
  { href: "/admin/tbs", title: "Task-based simulations", text: "Review TBS drafts, answer keys and section samples." },
  { href: "/admin/balance", title: "Difficulty balance", text: "Content gaps per subtopic and questions that are too easy or too hard." },
  { href: "/admin/users", title: "Users", text: "Look up a user and run support actions." },
  { href: "/admin/beta", title: "Beta", text: "Invite codes, tester feedback triage and the activation funnel." },
];

export default function AdminHome() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {SECTIONS.map((s) => (
        <Link key={s.href} href={s.href}>
          <Card className="h-full transition-colors hover:bg-accent/40">
            <CardHeader>
              <CardTitle>{s.title}</CardTitle>
              <CardDescription>{s.text}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
