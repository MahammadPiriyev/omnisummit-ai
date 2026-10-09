import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "./theme-toggle";
const NAV = [
  { to: "/", label: "Yoxla" },
  { to: "/history", label: "Tarixçə" },
  { to: "/settings", label: "Ayarlar" },
] as const;
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="mr-auto flex items-center gap-2 text-base font-semibold">
          <img
            src="/t800-logo.png"
            alt=""
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-lg"
          />
          T800
        </Link>
        <nav aria-label="Əsas menyu" className="flex gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
              activeProps={{ className: "bg-secondary font-semibold text-foreground" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
