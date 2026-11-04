"use client";

import { useEffect, useState } from "react";

type VisitData = {
  count: number | null;
};

export function VisitCounter() {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let aborted = false;

    async function fetchCount() {
      try {
        const res = await fetch("/api/visits", { cache: "no-store" });
        const data = (await res.json()) as VisitData;
        if (!aborted) {
          setCount(data.count);
          setLoading(false);
        }
      } catch {
        if (!aborted) setLoading(false);
      }
    }

    void fetchCount();
    return () => {
      aborted = true;
    };
  }, []);

  if (loading) {
    return (
      <span className="text-xs text-ink-soft" aria-hidden="true">
        ·
      </span>
    );
  }

  if (count === null) {
    // Upstash not configured — render nothing so the footer stays clean.
    return null;
  }

  const label = count === 1 ? "1 visit" : `${count.toLocaleString()} visits`;

  return (
    <span className="text-xs text-ink-soft">
      · {label}
    </span>
  );
}
