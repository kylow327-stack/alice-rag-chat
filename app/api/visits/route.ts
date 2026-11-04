import { Redis } from "@upstash/redis";

// Prevent Next.js from trying to prerender this route at build time.
// It needs runtime env vars that aren't available during static generation.
export const dynamic = "force-dynamic";

// Lazy-init so the route doesn't crash when env vars aren't set yet
// (e.g. during local dev or before the Upstash integration is linked).
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

export async function GET() {
  const db = getRedis();
  if (!db) {
    return Response.json({ count: null }, { status: 200 });
  }

  try {
    const count = await db.incr("alice:visits");
    return Response.json(
      { count },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    // If Upstash is temporarily unreachable, don't break the page.
    return Response.json({ count: null }, { status: 200 });
  }
}
