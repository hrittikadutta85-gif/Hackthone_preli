"use client";
import { useOutlook, type OutlookBlock } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Card, Skeleton } from "./ui";

/** Expected cases per city for this week and the next four, as small bar rows. Click a city to filter the page. */
export function Outlook({ origin, city, onPick }: { origin: string | null; city: string | null; onPick: (c: string | null) => void }) {
  const { t, f, b } = useI18n();
  const { data } = useOutlook(origin);
  if (!data) return <Skeleton className="h-72" />;
  const rows: { name: string | null; label: string; block: OutlookBlock }[] = [
    { name: null, label: t.common.allCities, block: data.total },
    ...data.cities.map((c) => ({ name: c.city, label: b(c.city), block: c })),
  ];
  const peak = (block: OutlookBlock) => Math.max(block.cases_now ?? 0, ...block.horizons.map((h) => h.expected), 1);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-semibold">{t.outlook.title}</h2>
        <span className="text-xs text-muted">{t.outlook.legend}</span>
      </div>
      <p className="mt-1 mb-5 max-w-2xl text-muted">{b(data.summary)}</p>

      {/* tablets and up: one table */}
      <div className="overflow-x-auto max-sm:hidden">
        <table className="w-full min-w-[34rem] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="text-left font-medium" />
              <th className="font-medium">{t.outlook.thisWeek}</th>
              {data.total.horizons.map((h) => (
                <th key={h.h} className="font-medium">
                  {t.common.weekShort(h.h)}
                  <div className="font-normal">{f.date(h.target_date)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ name, label, block }) => {
              const max = peak(block);
              const active = city === name;
              return (
                <tr
                  key={name ?? "all"}
                  onClick={() => onPick(name)}
                  className={`cursor-pointer transition ${active ? "bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-raise"}`}
                  aria-selected={active}
                >
                  <th scope="row" className={`rounded-l-xl py-2 pl-3 text-left ${name ? "font-medium" : "font-semibold"}`}>
                    <button type="button" className="tap cursor-pointer text-left">
                      {label}
                    </button>
                    <div className="text-xs font-normal text-muted">{t.outlook.wards(block.wards)}</div>
                  </th>
                  <td className="px-2 py-2 text-center align-bottom">
                    <Bar value={block.cases_now ?? 0} max={max} muted />
                  </td>
                  {block.horizons.map((h, i) => (
                    <td key={h.h} className={`px-2 py-2 text-center align-bottom ${i === block.horizons.length - 1 ? "rounded-r-xl" : ""}`}>
                      <Bar value={h.expected} max={max} alerts={h.alert_wards} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* phones: one card per city, with the same five weeks */}
      <ul className="space-y-3 sm:hidden">
        {rows.map(({ name, label, block }) => {
          const max = peak(block);
          const active = city === name;
          return (
            <li key={name ?? "all"}>
              <button
                type="button"
                onClick={() => onPick(name)}
                aria-pressed={active}
                className={`w-full cursor-pointer rounded-xl border p-3 text-left ${active ? "border-accent/60 bg-accent-soft" : "border-line bg-raise"}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{label}</span>
                  <span className="text-xs text-muted">{t.outlook.wards(block.wards)}</span>
                </span>
                <span className="mt-2 grid grid-cols-5 gap-1 text-center">
                  {[null, ...block.horizons].map((h) => (
                    <span key={h?.h ?? 0} className="flex min-w-0 flex-col justify-end">
                      <span className="mb-1 flex min-h-8 flex-col justify-end text-[10px] leading-tight text-muted">
                        {h ? f.date(h.target_date) : t.outlook.thisWeek}
                      </span>
                      <Bar value={h ? h.expected : (block.cases_now ?? 0)} max={max} muted={!h} alerts={h?.alert_wards} />
                    </span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Bar({ value, max, alerts, muted }: { value: number; max: number; alerts?: number; muted?: boolean }) {
  const { t, f } = useI18n();
  return (
    <span className="block">
      <span className="mx-auto flex h-10 w-8 max-w-full items-end">
        <span className="block w-full rounded-t-[4px] transition-all duration-700" style={{ height: `${Math.max((value / max) * 100, 4)}%`, background: muted ? "var(--series-quiet)" : "linear-gradient(180deg, var(--accent), rgb(45 212 191 / 0.28))" }} />
      </span>
      <span className="mt-1 block font-mono text-sm font-medium tabular-nums">{f.int(value)}</span>
      {alerts != null && (
        <span className={`block text-[10px] leading-tight sm:text-[11px] ${alerts ? "font-medium text-high" : "text-muted"}`}>
          {alerts ? t.outlook.highPlus(alerts) : t.outlook.noneHigh}
        </span>
      )}
    </span>
  );
}
