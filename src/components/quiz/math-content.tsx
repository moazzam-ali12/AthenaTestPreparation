"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

export const MathContent = React.memo(function MathContent({
  content,
}: {
  content: string;
}) {
  if (!content) return null;

  // Skip markdown pipeline for plain text (no $ for math, no markdown markers,
  // no | for GFM tables)
  if (!content.includes("$") && !content.includes("#") && !content.includes("*") && !content.includes("`") && !content.includes("|")) {
    return <span className="text-sm leading-relaxed">{content}</span>;
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
