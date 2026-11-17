import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 border-t border-border pt-5 first:border-0 first:pt-0">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function Outcome({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span role={ok ? "status" : "alert"} className={`text-sm ${ok ? "text-ok" : "text-err"}`}>
      {children}
    </span>
  );
}