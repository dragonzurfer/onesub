import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "OneSub Studio",
  description: "Interactive subtitle authoring studio for OneSub"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased">
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
              <h1 className="text-xl font-semibold tracking-tight">OneSub Studio</h1>
              <span className="text-sm text-slate-400">Preview · Edit · Render</span>
            </div>
          </header>
          <main className="flex-1">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
