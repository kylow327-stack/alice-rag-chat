import { connection } from "next/server";

// Signal to Next.js (with cacheComponents) that this route must run at
// request time, not at build time.
export const GET = async () => {
  await connection();

  try {
    const res = await fetch("https://abacus.jasoncameron.dev/hit/alice-rag-chat/visits", {
      cache: "no-store",
    });
    const data = (await res.json()) as { value: number };
    return Response.json(
      { count: data.value },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    // If Abacus is temporarily unreachable, don't break the page.
    return Response.json({ count: null }, { status: 200 });
  }
};
