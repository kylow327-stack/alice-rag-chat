import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-navy">
          <span className="font-serif text-xl">Alice</span>
          <span className="ml-2 text-sm text-ink-soft">grounded chat</span>
        </Link>
        <nav aria-label="Pages" className="flex gap-4 text-sm">
          <Link href="/" className="text-navy underline-offset-4 hover:underline">
            Chat
          </Link>
          <Link href="/architecture" className="text-navy underline-offset-4 hover:underline">
            Architecture
          </Link>
        </nav>
      </div>
    </header>
  );
}
