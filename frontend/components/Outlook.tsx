"use client";
import { fmtDate, useOutlook, type OutlookBlock } from "@/lib/api";
import { Card, Skeleton } from "./ui";

/** Expected cases per city for this week and the next four, as small bar rows. Click a city to filter the page. */
export function Outlook({ origin, city, onPick }: { origin: string | null; city: string | null; onPick: (c: string | null) => void }) {
  const { data } = useOutlook(origin);
  if (!data) return <Skeleton className="h-72" />;
  const rows: { name: string | null; label: string; b: OutlookBlock }[] = [
    { name: null, label: "All cities", b: data.total },
    ...data.cities.map((c) => ({ name: c.city, label: c.city, b: c })),
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-semibold">The next 4 weeks at a glance</h2>
        <span className="text-xs text-muted">expected cases · wards at High or Critical</span>
      </div>
      <p className="mt-1 mb-5 max-w-2xl text-muted">{data.summary}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="text-left font-medium" />
              <th className="font-medium">This week</th>
              {data.total.horizons.map((h) => (
                <th key={h.h} className="font-medium">
                  {h.h === 1 ? "Next week" : `In ${h.h} wks`}
                  <div className="font-normal">{fmtDate(h.target_date)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ name, label, b }) => {
              const max = Math.max(b.cases_now ?? 0, ...b.horizons.map((h) => h.expected), 1);
              const active = city === name;
              return (
                <tr
                  key={label}
                  onClick={() => onPick(name)}
                  className={`cursor-pointer transition ${active ? "bg-accent-soft" : "hover:bg-paper"}`}
                  aria-selected={active}
                >
                  <th scope="row" className={`rounded-l-xl py-2 pl-3 text-left ${name ? "font-medium" : "font-semibold"}`}>
                    {label}
                    <div className="text-xs font-normal text-muted">{b.wards} wards</div>
                  </th>
                  <Cell value={b.cases_now ?? 0} max={max} muted />
                  {b.horizons.map((h, i) => (
                    <Cell key={h.h} value={h.expected} max={max} alerts={h.alert_wards} last={i === b.horizons.length - 1} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Cell({ value, max, alerts, muted, last }: { value: number; max: number; alerts?: number; muted?: boolean; last?: boolean }) {
  return (
    <td className={`px-2 py-2 text-center align-bottom ${last ? "rounded-r-xl" : ""}`}>
      <div className="mx-auto flex h-10 w-8 items-end">
        <div className="w-full rounded-t-md transition-all duration-500" style={{ height: `${Math.max((value / max) * 100, 4)}%`, background: muted ? "#c9d3cf" : "#0f6b5c" }} />
      </div>
      <div className="mt-1 font-semibold tabular-nums">{value.toLocaleString()}</div>
      {alerts != null && <div className={`text-[11px] ${alerts ? "font-medium text-high" : "text-muted"}`}>{alerts ? `${alerts} high+` : "none high"}</div>}
    </td>
  );
}
