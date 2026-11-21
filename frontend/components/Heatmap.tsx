"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TIER_COLOR, fmtDate, type CityView, type Tier } from "@/lib/api";

const tierOf = (s: number): Tier => (s >= 75 ? "Critical" : s >= 50 ? "High" : s >= 25 ? "Medium" : "Low");

export function Heatmap({ data }: { data: CityView["heatmap"] }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [hover, setHover] = useState<{ label: string; week: string; score: number } | null>(null);
  const rows = all ? data.rows : data.rows.slice(0, 15);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[3px] text-xs">
          <thead>
            <tr>
              <th className="w-36" />
              {data.weeks.map((w) => (
                <th key={w} className="font-normal text-muted">
                  <span className="hidden sm:inline">{fmtDate(w)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ward} onClick={() => router.push(`/ward/${r.ward}`)} className="cursor-pointer">
                <th scope="row" className="truncate pr-2 text-left font-medium whitespace-nowrap">
                  {r.label}
                </th>
                {r.scores.map((s, i) => (
                  <td
                    key={i}
                    className="h-6 min-w-5 rounded-md transition hover:scale-110 hover:ring-2 hover:ring-ink/40"
                    style={{ background: s == null ? "var(--line)" : TIER_COLOR[tierOf(s)], opacity: s == null ? 0.5 : 0.35 + (s % 25) / 40 }}
                    onMouseEnter={() => s != null && setHover({ label: r.label, week: data.weeks[i], score: s })}
                    onMouseLeave={() => setHover(null)}
                    title={s == null ? "No forecast" : `${r.label}, week of ${fmtDate(data.weeks[i])}: ${tierOf(s)} (${s}/100)`}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="min-h-5 text-muted" aria-live="polite">
          {hover ? `${hover.label}, week of ${fmtDate(hover.week)}: ${tierOf(hover.score)} risk (${hover.score}/100)` : "Hover a square for details."}
        </p>
        {data.rows.length > 15 && (
          <button onClick={() => setAll(!all)} className="font-medium text-accent hover:underline">
            {all ? "Show top 15" : `Show all ${data.rows.length} wards`}
          </button>
        )}
      </div>
    </div>
  );
}
