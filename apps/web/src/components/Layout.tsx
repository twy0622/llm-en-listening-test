import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { formatSeason, seasonForDate } from "@listening/shared";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors ${
    isActive
      ? "border-accent text-ink"
      : "border-transparent text-muted hover:border-line hover:text-ink"
  }`;

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const inExam = location.pathname.startsWith("/exam");

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <div className="h-1 bg-accent" aria-hidden="true" />

      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/" className="group flex items-center gap-3" aria-label="All Ears home">
            <span className="flex h-10 w-9 flex-col items-center justify-center border border-accent bg-accent text-white">
              <span className="font-serif text-[13px] leading-none">AE</span>
              <span className="mt-1 h-px w-5 bg-white/60" />
            </span>
            <span className="leading-tight">
              <span className="block font-serif text-[21px] tracking-tight text-ink">All Ears</span>
              <span className="hidden text-[9px] font-semibold uppercase tracking-[0.22em] text-muted sm:block">
                English Listening Papers
              </span>
            </span>
          </Link>

          {!inExam && (
            <nav className="flex items-center gap-1" aria-label="Main">
              <NavLink to="/" className={navClass} end>
                Practice
              </NavLink>
              <NavLink to="/history" className={navClass}>
                History
              </NavLink>
              <span className="mx-2 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
              <span className="mr-2 hidden text-[10px] uppercase tracking-[0.14em] text-muted lg:block">
                {formatSeason(seasonForDate())}
              </span>
              <Link to="/exam" className="btn-primary hidden sm:inline-flex">
                Start a paper
              </Link>
            </nav>
          )}

          {inExam && (
            <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
              <span className="h-1.5 w-1.5 bg-accent" aria-hidden="true" />
              Examination in progress
            </span>
          )}
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t-2 border-accent bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="font-serif text-base text-ink">All Ears · English Listening Papers</p>
            <p className="mt-1">
              Independent practice material. Not affiliated with any examination board.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[10px] uppercase tracking-[0.14em]">
              {formatSeason(seasonForDate())} series
            </span>
            <Link to="/admin" className="hover:text-accent">
              Content admin
            </Link>
            <a href="/api/health" className="hover:text-accent">
              Status
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
