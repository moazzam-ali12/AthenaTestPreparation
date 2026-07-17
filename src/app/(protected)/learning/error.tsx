"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function LearningError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Learning route crashed:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold">Something went wrong loading this lesson</h2>
      <p className="text-sm text-muted-foreground">
        This page hit an error. You can try again, or head back and pick it up from there.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" onClick={() => (window.location.href = "/learning")}>
          Back to Learning
        </Button>
      </div>
    </div>
  );
}
