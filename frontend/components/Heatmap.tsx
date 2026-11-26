"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TIERS, TIER_COLOR, type CityView, type Tier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const tierOf = (s: number): Tier => (s >= 75 ? "Critical" : s >= 50 ? "High" : s >= 25 ? "Medium" : "Low");

export function Heatmap({ data }: { data: CityView["heatmap"] }) {
  const { t, f, b } = useI18n();
  const router = useRouter();
  const [all, setAll] = useState(false);
  // stored as positions, so the line below re-words itself when the language changes
  const [picked, setPicked] = useState<{ ward: string; week: number } | null>(null);
  const rows = all ? data.rows : data.rows.slice(0, 15);
  const row = picked && data.rows.find((r) => r.ward === picked.ward);
  const score = row && picked ? row.scores[picked.week] : null;

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <table className="w-full min-w-[34rem] border-separate border-spacing-[3px] text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] w-36 bg-card" />
              {data.weeks.map((w) => (
                <th key={w} className="font-normal whitespace-nowrap text-muted">
                  <span className="max-lg:text-[10px]">{f.date(w)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ward} className="hover:[&>th]:text-accent">
                {/* the ward name stays put while the weeks scroll sideways */}
                <th scope="row" className="sticky left-0 z-[1] bg-card pr-2 text-left font-medium">
                  <Link href={`/ward/${r.ward}`} className="flex items-center tap max-sm:max-w-24 sm:whitespace-nowrap">
                    {b(r.label)}
                  </Link>
                </th>
                {r.scores.map((s, i) => (
                  <td
                    key={i}
                    className="h-6 min-w-7 cursor-pointer rounded-[5px] transition hover:scale-110 hover:ring-2 hover:ring-accent"
                    style={{ background: s == null ? "var(--line)" : TIER_COLOR[tierOf(s)], opacity: s == null ? 0.5 : 0.35 + (s % 25) / 40 }}
                    // a mouse opens the ward; a finger shows the details first
                    onClick={() => (window.matchMedia("(hover: none)").matches ? setPicked({ ward: r.ward, week: i }) : router.push(`/ward/${r.ward}`))}
                    onMouseEnter={() => s != null && setPicked({ ward: r.ward, week: i })}
                    onMouseLeave={() => !window.matchMedia("(hover: none)").matches && setPicked(null)}
                    title={s == null ? t.heatmap.noForecast : t.heatmap.cell(b(r.label), f.date(data.weeks[i]), tierOf(s), f.n(s))}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {TIERS.map((tier) => (
          <span key={tier} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: TIER_COLOR[tier] }} aria-hidden />
            {t.common.tier[tier]}
          </span>
        ))}
        <span>{t.heatmap.brighter}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="min-h-5 text-muted" aria-live="polite">
          {row && picked && score != null ? t.heatmap.hover(b(row.label), f.date(data.weeks[picked.week]), tierOf(score), f.n(score)) : t.heatmap.hint}
        </p>
        {data.rows.length > 15 && (
          <button onClick={() => setAll(!all)} className="cursor-pointer font-medium text-accent hover:underline tap">
            {all ? t.heatmap.showTop : t.heatmap.showAll(data.rows.length)}
          </button>
        )}
      </div>
    </div>
  );
}
