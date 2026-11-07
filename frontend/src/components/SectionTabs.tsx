import { NavLink, useLocation } from "react-router";

import { sectionForPath } from "../nav";

function tabClass({ isActive }: { isActive: boolean }) {
  return [
    "flex min-h-11 shrink-0 items-center border-b-2 px-4 text-sm transition-colors",
    isActive ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
  ].join(" ");
}

export function SectionTabs() {
  const { pathname } = useLocation();
  const section = sectionForPath(pathname);
  if (!section) return null;
  return (
    <nav aria-label={`${section.label} pages`} className="-mx-4 mb-4 overflow-x-auto border-b border-border md:-mx-6">
      <div className="flex">
        {section.pages.map((page) => (
          <NavLink key={page.path} to={page.path} className={tabClass}>
            {page.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
