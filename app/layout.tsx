import type { Metadata } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Alice — grounded chat",
    template: "%s · Alice",
  },
  description:
    "A public demo that answers questions from the text of Alice's Adventures in Wonderland, with citations, and says when the book does not.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <footer className="border-t border-line px-4 py-6 text-center text-sm text-ink-soft">
          Text from Project Gutenberg eBook #11,{" "}
          <cite>Alice’s Adventures in Wonderland</cite> by Lewis Carroll. The
          narrative is public domain.
        </footer>
      </body>
    </html>
  );
}
