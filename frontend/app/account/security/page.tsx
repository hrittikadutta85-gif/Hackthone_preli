"use client";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useMyLogins } from "@/lib/account";
import { LoginTable, PageHead } from "@/components/auth/parts";
import { Skeleton } from "@/components/ui";

type Filter = "all" | "failed" | "suspicious";

export default function LoginHistory() {
  const { t, f } = useI18n();
  const { data } = useMyLogins();
  const [filter, setFilter] = useState<Filter>("all");
  const [now] = useState(() => Date.now()); // "last 30 days" is counted from when the page opened
  const h = t.auth.history;
  const rows = useMemo(() => data?.logins ?? [], [data]);

  const stats = useMemo(() => {
    const since = now - 30 * 86400_000;
    const recent = rows.filter((r) => new Date(r.at).getTime() >= since);
    return [
      [h.failedCount, recent.filter((r) => !r.success).length],
      [h.newDeviceCount, recent.filter((r) => r.success && r.new_device).length],
      [h.suspiciousCount, recent.filter((r) => r.suspicious).length],
    ] as const;
  }, [rows, h, now]);

  const shown = rows.filter((r) => (filter === "failed" ? !r.success : filter === "suspicious" ? r.suspicious : true));
  return (
    <>
      <PageHead title={h.title} subtitle={h.subtitle} />
      {!data ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            {stats.map(([label, n], i) => (
              <div key={label} className="panel p-4">
                <p className="kicker">{label}</p>
                <p className={`font-display mt-1 text-3xl font-semibold ${i === 2 && n ? "text-high" : i === 0 && n ? "text-critical-ink" : ""}`}>{f.int(n)}</p>
              </div>
            ))}
          </div>
          <div role="group" aria-label={h.title} className="mb-4 flex flex-wrap gap-2">
            {(["all", "failed", "suspicious"] as Filter[]).map((k) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className="btn">
                {h.filters[k]}
              </button>
            ))}
          </div>
          <LoginTable rows={shown} />
        </>
      )}
    </>
  );
}
