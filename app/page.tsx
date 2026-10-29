import { ChatPanel } from "@/components/chat-panel";

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-navy">
        Project Gutenberg #11
      </p>
      <h1 className="mt-2 font-serif text-4xl text-navy sm:text-5xl">Ask the book.</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        Questions are answered from the public-domain text of{" "}
        <cite>Alice’s Adventures in Wonderland</cite>. An answer cites the
        passage it came from. If the book does not say, the demo says so
        instead of guessing.
      </p>
      <ChatPanel />
      <noscript>
        <p className="mt-4 text-ink">Chat needs JavaScript. The architecture page still works.</p>
      </noscript>
    </div>
  );
}
