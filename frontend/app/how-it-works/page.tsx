"use client";
import Link from "next/link";
import { TIER_COLOR, TIERS, usePerformance } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { Card } from "@/components/ui";

const STEPS = [
  { icon: "📥", title: "Collect", text: "Every week, for every ward: rain, temperature, humidity and the dengue cases reported." },
  { icon: "🧹", title: "Clean", text: "Fix wrong dates and repeated rows, remove impossible values, fill small gaps in the weather." },
  { icon: "⏳", title: "Learn the delay", text: "Look back 1 to 8 weeks. Rain from 2 to 4 weeks ago matters most, because mosquitoes need time to grow." },
  { icon: "🔮", title: "Predict", text: "Two models work together to expect the cases for the next 1, 2, 3 and 4 weeks, with a likely range." },
  { icon: "🧭", title: "Explain & act", text: "Turn the numbers into a risk level, plain-language reasons and clear steps for the health team." },
];

const TIMELINE = [
  { week: "Week 0", icon: "🌧️", text: "Heavy rain. Water collects in drains, tyres and pots." },
  { week: "Week 1–2", icon: "🥚", text: "Mosquito eggs hatch and grow into adults (7 to 14 days)." },
  { week: "Week 2–3", icon: "🦟", text: "Mosquitoes bite. The virus grows inside people for a few days." },
  { week: "Week 3–4", icon: "🏥", text: "Fever cases rise and hospitals fill up." },
];

const STACK = {
  Frontend: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS", "Recharts", "Leaflet + OpenStreetMap"],
  Backend: ["FastAPI", "Uvicorn", "Pydantic", "pandas", "NumPy"],
  "Machine learning": ["LightGBM", "scikit-learn (Poisson GLM)", "joblib"],
};

export default function HowItWorks() {
  const { meta, horizon } = useControls();
  const { data: perf } = usePerformance("DSCC_Ward_05", horizon);

  return (
    <div className="space-y-10">
      <div className="rise">
        <p className="text-sm font-medium text-accent">How it works</p>
        <h1 className="font-display mt-1 max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">
          From last week&apos;s rain to next month&apos;s hospital beds.
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink/80">
          Dengue does not come on the same day as the rain. It comes 2 to 4 weeks later. Dengue Watch uses that delay to
          warn health teams early, ward by ward.
        </p>
      </div>

      {/* why the delay */}
      <Card>
        <h2 className="font-display text-2xl font-semibold">Why there is a 2–4 week delay</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-4">
          {TIMELINE.map((t, i) => (
            <li key={t.week} className="relative rounded-xl bg-paper p-4">
              <div className="text-3xl" aria-hidden>
                {t.icon}
              </div>
              <div className="mt-2 text-xs font-semibold tracking-wide text-accent uppercase">{t.week}</div>
              <p className="mt-1 text-sm">{t.text}</p>
              {i < TIMELINE.length - 1 && (
                <span className="absolute top-1/2 -right-3 hidden -translate-y-1/2 text-xl text-muted sm:block" aria-hidden>
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted">So if we watch the rain now, we can see the cases coming before they arrive.</p>
      </Card>

      {/* the five steps */}
      <section>
        <h2 className="font-display text-2xl font-semibold">What happens behind the screen</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rise rounded-2xl border border-line bg-card p-4 shadow-sm" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-bold text-white">{i + 1}</span>
                <span className="text-xl" aria-hidden>
                  {s.icon}
                </span>
              </div>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* data split */}
      <Card>
        <h2 className="font-display text-2xl font-semibold">How we trained and tested it</h2>
        <p className="mt-1 max-w-2xl text-muted">
          Weekly data from 60 wards in 5 city corporations, 2016 to 2025. We never mixed the years: a real forecast can only
          learn from the past.
        </p>
        <div className="mt-5 flex h-14 overflow-hidden rounded-xl text-sm font-semibold text-white" role="img" aria-label="2016 to 2023 training, 2024 tuning, 2025 testing">
          <div className="flex flex-[8] items-center justify-center bg-accent">Learn · 2016 – 2023</div>
          <div className="flex flex-1 items-center justify-center bg-medium text-ink">Tune · 2024</div>
          <div className="flex flex-1 items-center justify-center bg-high">Test · 2025</div>
        </div>
        <p className="mt-3 text-sm text-muted">
          2025 was kept hidden until the very end, so the results below are what you would have seen in real life.
        </p>
      </Card>

      {/* model + results */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-2xl font-semibold">The prediction model</h2>
          <ul className="mt-3 space-y-3 text-ink/85">
            <li>
              <b>Two models blended together.</b> A <i>Poisson GLM</i> (simple and steady) and <i>LightGBM</i> (catches
              tricky weather patterns). Both are built for counting things, like cases.
            </li>
            <li>
              <b>One model for each window</b>: 1, 2, 3 and 4 weeks ahead.
            </li>
            <li>
              <b>A likely range</b> from two extra LightGBM models, so you see “about 7, likely 6 to 14”, not just one number.
            </li>
            <li>
              <b>Clear reasons.</b> We re-run the forecast with each factor set to a normal week, to show how many cases rain,
              heat or humidity add.
            </li>
          </ul>
          {meta && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIERS.map((t) => (
                <div key={t} className="rounded-xl p-3 text-white" style={{ background: TIER_COLOR[t] }}>
                  <div className="text-sm font-semibold">{t}</div>
                  <div className="text-xs opacity-90">{meta.tier_help[t]}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <h2 className="font-display text-2xl font-semibold">How well it works (2025 test)</h2>
          {perf ? (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Window</th>
                  <th className="pb-2 font-medium">Off by (avg)</th>
                  <th className="pb-2 font-medium">Better than “no change”</th>
                  <th className="pb-2 font-medium">Right risk level</th>
                </tr>
              </thead>
              <tbody>
                {perf.summary.map((r) => (
                  <tr key={r.h} className={`border-t border-line ${r.h === horizon ? "font-semibold" : ""}`}>
                    <td className="py-2">{r.h === 1 ? "1 week" : `${r.h} weeks`}</td>
                    <td className="py-2 tabular-nums">±{r.mae.toFixed(1)} cases</td>
                    <td className="py-2 tabular-nums">{r.improvement_pct.toFixed(0)}%</td>
                    <td className="py-2 tabular-nums">{Math.round(r.tier_accuracy * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mt-3 h-40 animate-pulse rounded-xl bg-line/60" />
          )}
          <p className="mt-3 text-sm text-muted">
            Honest note: it catches about 7 in 10 real outbreak weeks, so it supports decisions. It is not a promise.{" "}
            <Link href="/accuracy" className="font-medium text-accent hover:underline">
              See the full test →
            </Link>
          </p>
        </Card>
      </div>

      {/* architecture */}
      <Card>
        <h2 className="font-display text-2xl font-semibold">How the system is built</h2>
        <div className="mt-5 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1.4fr_auto_1.2fr]">
          <Block title="Data" tone="bg-paper" items={["Weekly ward CSV (2016–2025)", "Weather · cases · ward details", "Upload new weeks in the portal"]} />
          <Arrow />
          <Block
            title="Backend · FastAPI (Python)"
            tone="bg-accent-soft"
            items={[
              "1. Clean the data",
              "2. Build lag features per ward",
              "3. Load trained models once at start",
              "4. Predict cases, range and risk level",
              "5. Write plain-language reasons",
            ]}
          />
          <Arrow />
          <Block
            title="Frontend · Next.js"
            tone="bg-paper"
            items={["City overview & outlook", "Risk map", "Action plan for field teams", "Ward forecast & what-if", "Prediction portal", "Accuracy report"]}
          />
        </div>
        <p className="mt-4 text-sm text-muted">
          The browser talks only to Next.js, which passes <code className="rounded bg-line px-1">/api</code> requests to FastAPI.
          Training happens once, offline. Everything runs on one computer: no paid services and no AI calls when you use it.
          The only outside request is the street-map background from OpenStreetMap.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {Object.entries(STACK).map(([k, v]) => (
            <div key={k}>
              <h3 className="text-sm font-semibold">{k}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {v.map((x) => (
                  <span key={x} className="rounded-full border border-line bg-card px-2.5 py-1 text-xs">
                    {x}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-2xl font-semibold">What it can&apos;t do</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink/85">
          <li>It looks at most 4 weeks ahead, not months.</li>
          <li>It works per ward, not per street or household.</li>
          <li>Ward positions on the map are approximate: the data has no ward boundaries.</li>
          <li>It was tested on one year (2025). A very unusual season could behave differently.</li>
        </ul>
        <p className="mt-4 text-sm text-muted">
          Built by Team CodeNova. We used Claude Code, an AI coding assistant, to help write the code and documents. Our team
          reviewed and tested everything.
        </p>
      </Card>
    </div>
  );
}

function Block({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div className={`rounded-2xl border border-line p-4 ${tone}`}>
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-ink/80">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function Arrow() {
  return (
    <div className="grid place-items-center text-2xl text-muted" aria-hidden>
      <span className="hidden lg:block">→</span>
      <span className="lg:hidden">↓</span>
    </div>
  );
}
