import { connection } from "next/server";
import { Redis } from "@upstash/redis";

// Signal to Next.js (with cacheComponents) that this route must run at
// request time, not at build time. Without this, the prerender step
// executes the handler with no env vars and crashes on Redis init.
export const GET = async () => {
  await connection();

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    return Response.json({ count: null }, { status: 200 });
  }

  try {
    const redis = new Redis({ url, token });
    const count = await redis.incr("alice:visits");
    return Response.json(
      { count },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    // If Upstash is temporarily unreachable or misconfigured, don't break the page.
    return Response.json({ count: null }, { status: 200 });
  }
};
