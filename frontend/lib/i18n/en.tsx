/*
 * Every English string in the web app. `bn.tsx` must provide the same keys (TypeScript enforces it).
 * Sentences written by the backend are translated separately, in `backend.ts`.
 */
import type { ReactNode } from "react";
import type { Tier } from "../api";
import { makeFormat } from "./format";

const f = makeFormat("en");
const s = (n: number) => (n === 1 ? "" : "s");
const weekName = (h: number) => (h === 1 ? "Next week" : `In ${h} weeks`);
const inWeeks = (h: number) => (h === 1 ? "next week" : `in ${h} weeks`);

export const en = {
  common: {
    brand: "Dengue Watch",
    tier: { Low: "Low", Medium: "Medium", High: "High", Critical: "Critical" } as Record<Tier, string>,
    allCities: "All cities",
    cityGroup: "City corporation",
    nextWeek: "Next week",
    weekName,
    weekShort: (h: number) => (h === 1 ? "Next week" : `In ${h} wks`),
    weekOf: (date: string) => `Week of ${date}`,
    casesExpected: "cases expected",
    cases: (n: string) => `${n} cases`,
  },

  shell: {
    tagline: "Public-health command",
    navLabel: "Main",
    nav: {
      overview: "City overview",
      map: "Risk map",
      plan: "Action plan",
      ward: "Ward forecast",
      predict: "Prediction portal",
      accuracy: "Can I trust it?",
      how: "How it works",
    },
    notFoundTitle: "Page not found",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    language: "Language",
    weekLabel: "Looking at week of",
    weekAria: "Week to forecast from",
    warnMe: "Warn me",
    ahead: "ahead",
    windowAria: "Early-warning window",
    window: (h: number) => `${h} wk`,
    inSample:
      "Heads up: weeks up to 2024 were used to teach the model, so they flatter its accuracy. Slide into 2025 for a fair test.",
    footer:
      "Team CodeNova · Forecasts run entirely on this machine, with no paid APIs or AI services. Only the street-map background loads from OpenStreetMap.",
    dataTo: (date: string) => `Data on file to ${date}`,
  },

  errors: {
    title: "Something went wrong.",
    serviceHint: (command: ReactNode) => <>The forecasting service may not be running. Start it with {command}.</>,
  },

  overview: {
    eyebrow: "City overview",
    subtitle: (target: string, origin: string) =>
      `Forecasts are for the week of ${target}, made using weather and cases up to ${origin}. Tap a ward to see why.`,
    tierWards: (tier: Tier) => `${tier}-risk wards`,
    allWards: "Wards, most at risk first",
    shown: (n: number) => `${n} shown`,
    findPlaceholder: "Find a ward…",
    findLabel: "Find a ward",
    download: "Download CSV",
    noMatch: "No wards match. Try clearing the filter or search.",
    showingTop: (n: number) => `Showing the 24 highest of ${n}. Narrow the list with a city or search.`,
    heatTitle: "How risk has moved, week by week",
    heatDesc: (h: number) =>
      `Each row is a ward and each column is a week. The colour is the risk for ${h} week${s(h)} after that week. Click a row to open the ward.`,
    trend: { steady: "holding steady", rising: "rising", easing: "easing" },
    likelyNow: (low: string, high: string, now: string | null, trend: string) =>
      `likely ${low}–${high} · ${now != null ? `${now} now, ` : ""}${trend}`,
    riskScore: (score: string) => `Risk score ${score} out of 100`,
    forecastAhead: (h: number) => `Forecast ${h} week${s(h)} ahead`,
  },

  outlook: {
    title: "The next 4 weeks at a glance",
    legend: "expected cases · wards at High or Critical",
    thisWeek: "This week",
    wards: (n: number) => `${n} wards`,
    highPlus: (n: number) => `${n} high+`,
    noneHigh: "none high",
  },

  heatmap: {
    noForecast: "No forecast",
    cell: (ward: string, week: string, tier: Tier, score: string) => `${ward}, week of ${week}: ${tier} (${score}/100)`,
    hover: (ward: string, week: string, tier: Tier, score: string) => `${ward}, week of ${week}: ${tier} risk (${score}/100)`,
    hint: "Hover a square for details.",
    brighter: "Brighter = higher score within a level.",
    showTop: "Show top 15",
    showAll: (n: number) => `Show all ${n} wards`,
  },

  map: {
    eyebrow: "Risk map",
    title: "Where is dengue heading? Red wards need help first.",
    intro: (play: ReactNode) => (
      <>
        Every bubble is a ward on the real map of Dhaka, Gazipur, Narayanganj and Chattogram. Hover for numbers, click for
        details, or press {play} to watch the outbreak season build and fade.
      </>
    ),
    levelsLabel: "Show risk levels",
    onlyAlerts: "Only High & Critical",
    showAll: "Show all",
    styleLabel: "Map style",
    street: "Street map",
    offline: "Offline view",
    timelapse: "Time-lapse",
    prevWeek: "Previous week",
    nextWeek: "Next week",
    play: "Play weeks",
    pause: "Pause",
    watch: "Watch the season build and fade, one week at a time.",
    tilesFailed: "The street map background needs internet and isn't loading.",
    toOffline: "Switch to the offline view",
    forecastFor: "Forecast for week of",
    madeWith: (date: string, h: number) => `made with data up to ${date} · ${h} wk ahead`,
    radar: (n: number) => `Early-warning radar · ${n} wards`,
    critical: "critical",
    high: "high",
    streetNote:
      "Cities are at their real locations on an OpenStreetMap base map. The dataset has no ward boundaries or coordinates, so each ward's bubble is placed approximately inside its city (teal circle). Bigger bubble = more expected cases. Zoom out to see one summary per city. Lines between cities are for orientation only; they do not show how dengue spreads.",
    offlineNote:
      "Works without internet. Drag to move · double-click or + / − to zoom · click a city name to fly to it. Wards are drawn as a honeycomb around each city; cities are in their real direction from each other but not to scale. Lines between cities are for orientation only; they do not show how dengue spreads.",
    hotspots: "Hotspots this week",
    hotspotsDesc: (h: number) => `Highest expected cases ${inWeeks(h)}. Click one to find it on the map.`,
    noneInFilter: "No wards match the filter.",
    byCity: "By city",
    flyToSummary: (city: string, summary: string) => `Fly to ${city}: ${summary}`,
    summary: (critical: number, high: number) =>
      [critical && `${critical} critical`, high && `${high} high`].filter(Boolean).join(" · ") || "no high-risk wards",
    ward: (num: string) => `Ward ${num}`,
    close: "Close ward details",
    trendSame: "about the same as now",
    trendUp: (now: number) => `up from ${now} now`,
    trendDown: (now: number) => `down from ${now} now`,
    panelLine: (date: string, low: string, high: string, trend: string) => `Week of ${date} · likely ${low}–${high} · ${trend}`,
    actually: (n: number) => (
      <>
        What actually happened: <b>{n}</b> {n === 1 ? "case" : "cases"}
      </>
    ),
    lastWeeks: (n: number) => `Expected cases over the last ${n} weeks`,
    trendLabel: "Recent trend of expected cases",
    fullForecast: "Full forecast & actions →",
    flyTo: (city: string) => `Fly to ${city}`,
    aheadNote: (h: number) => `Forecast ${h} week${s(h)} ahead. Change it with “Warn me” at the top.`,
    /** The words before and after the number. */
    about: ["About ", " cases expected"],
    tipLikely: (low: string, high: string, now: string) => `likely ${low}–${high} · ${now} reported now`,
    details: "Click for details",
    dhakaArea: "Dhaka area",
    cursor: "Cursor",
    streetLabel: "Street map of wards coloured by dengue risk",
    contributors: "contributors",
    leafletTitle: "A JavaScript library for interactive maps",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    metre: "m",
    km: "km",
    honeycombLabel: "Map of wards coloured by dengue risk",
    north: "N",
    farNote: "≈220 km south-east of Dhaka",
    notToScale: "not to scale",
    hexNone: (ward: string) => `${ward}: no forecast`,
    hex: (ward: string, tier: Tier, n: string) => `${ward}: ${tier} risk, about ${n} cases`,
    showEverything: "Show everything",
  },

  ward: {
    allWards: "← All wards",
    enter: "Enter this week's numbers",
    print: "Print / save as PDF",
    switch: "Switch ward",
    casesTitle: "Cases so far and where they're heading",
    casesDesc:
      "Grey bars are reported cases. The blue line is the forecast with its likely range. Hollow rings show what really happened, where we know it.",
    behindTitle: (h: number) => `What's behind the ${h}-week forecast`,
    behindDesc: "Compared with a typical week at this time of year, how many cases each factor adds or removes.",
    weatherTitle: "Recent weather",
    weatherDesc:
      "Rain that fell 2 to 4 weeks ago (the shaded stretch) matters most. Mosquito eggs need that long to become adults, and the virus needs a bit longer to show up as fever.",
    printFooter: (date: string) =>
      `Dengue Watch · Team CodeNova · forecast made with data up to the week of ${date}. Expected cases are estimates with an 80% likely range, not guarantees.`,
    chips: {
      crowdedMore: "More crowded than most wards nearby",
      crowdedLess: "Less crowded than most wards nearby",
      crowdedTypical: "Typical crowding",
      waterProne: "Prone to waterlogging",
      waterGood: "Drains well",
      waterTypical: "Typical drainage",
      sanitationBetter: "Better sanitation than nearby wards",
      sanitationWeaker: "Weaker sanitation than nearby wards",
      sanitationTypical: "Typical sanitation",
    },
    pickWeek: "Pick a forecast week",
    casesLikely: (low: string, high: string) => `cases · likely ${low}–${high}`,
    actually: (n: string) => `actually ${n}`,
    actionsTitle: "What to do about it",
    actionsDesc: (tier: Tier) => `Suggested steps for a ${tier.toLowerCase()}-risk week. Tick them off as your team goes.`,
    allDone: "All done. Nice work.",
    progress: (done: number, total: number) => `${done} of ${total} done`,
  },

  charts: {
    reported: (n: number) => `Reported: ${n} cases`,
    forecast: (n: string) => `Forecast: ${n} cases`,
    likely: (low: string, high: string) => `(likely ${low}–${high})`,
    actually: (n: number) => `What actually happened: ${n}`,
    forecastLabel: (ward: string) => `Weekly dengue cases with a forecast for ${ward}`,
    now: "now",
    weatherLabel: "Recent weekly rainfall, temperature and humidity",
    rain: "Rain",
    temperature: "Temperature",
    humidity: "Humidity",
    mm: "mm",
    celsius: "°C",
    breeding: "breeding window",
    weather: "weather",
    aboutNormal: "about normal",
    effect: (sign: string, n: string) => `${sign}${n} cases`,
    mostly: (feature: string) => `Mostly ${feature}`,
  },

  whatif: {
    presets: { monsoon: "Monsoon surge", dry: "Dry spell", heat: "Heatwave", damp: "Cool and damp" },
    title: "What if the weather changes?",
    desc: (ward: string) =>
      `Change the last 8 weeks of weather and the model re-scores ${ward} straight away. It's a way to ask “how bad could this get?” before the rain arrives.`,
    reset: "Reset",
    scenarios: "Weather scenarios",
    rainfall: "Rainfall",
    temperature: "Temperature",
    humidity: "Humidity",
    points: (v: string) => `${v} pts`,
    asRecorded: "as recorded",
    manual: "Or set each week's rainfall yourself",
    millimetres: "millimetres",
    manualNote: "Millimetres of rain per week. The rainfall slider above scales these numbers.",
    chartLabel: "Expected cases with recorded weather versus the scenario",
    recorded: "Recorded weather",
    scenario: "Your scenario (risk colours)",
    change: (before: string, after: string) => `${before} → ${after} cases`,
  },

  plan: {
    eyebrow: (date: string) => `Action plan · week of ${date}`,
    intro:
      "Tell us how many field teams you have. We rank the wards by risk and expected cases, so spraying and inspection reach the right places before hospitals fill up.",
    teams: "Field teams available this week",
    teamsLabel: "Number of field teams",
    teamsNote: "One team covers one ward for the week.",
    area: "Area",
    allFive: "all five city corporations",
    headlineNone: (scope: string, h: number) => `No ward in ${scope} reaches High risk ${inWeeks(h)}. A good week for prevention work.`,
    headlineCovered: (teams: number, scope: string) => `${teams} team${s(teams)} can cover every high-risk ward in ${scope}.`,
    headlineShort: (urgent: number, teams: number, planned: number) =>
      `${urgent} wards need help, but you have ${teams} team${s(teams)}. Start with these ${planned}.`,
    statUrgent: "wards at High or Critical",
    statUrgentNote: (scope: string, h: number) => `${scope}, ${h} wk ahead`,
    statPlan: "wards in this plan",
    statPlanMedium: "includes Medium wards, since teams are free",
    statPlanUrgent: "most urgent first",
    statCovered: "of high-risk cases covered",
    statCoveredNote: (covered: string, total: string) => `≈${covered} of ${total} expected cases`,
    statUncovered: "high-risk wards not covered",
    statUncoveredSome: "borrow teams or plan for next week",
    statUncoveredNone: "nobody left out",
    where: "Where to send each team",
    print: "Print",
    allLow: "Every ward is Low risk. Keep routine surveillance going.",
    waiting: "Waiting list: high-risk wards without a team",
    changed: "What changed since last week",
    changedDesc: "Compared with the forecast made one week earlier.",
    newAlerts: "Newly High or Critical",
    noNewAlerts: "No new alerts this week.",
    improved: "Improved below High",
    noneYet: "None yet.",
    risers: "Rising fastest",
    risersDesc: "Biggest jump from this week's reported cases.",
    noRisers: (n: number) => `No ward is expected to jump by ${n}+ cases.`,
    footnote:
      "The plan ranks wards by risk level, then by expected cases. It is a starting point: local knowledge (blocked roads, recent spraying, events) should adjust it.",
    team: (n: number) => `Team ${n}`,
    waitingList: "Waiting list",
    yes: "yes",
    newThisWeek: "new this week",
    risingFast: "rising fast",
    expected: (n: ReactNode) => <>{n} expected</>,
    likelyNow: (low: string, high: string, now: string) => `likely ${low}–${high} · ${now} now`,
  },

  predict: {
    eyebrow: "Prediction portal",
    title: "Got this week's numbers? Find out where dengue is heading.",
    intro:
      "Pick a ward, enter the weather and case counts you've recorded, and get a forecast for the next four weeks. The table starts with the latest weeks on file. Edit them, add a new week, or upload a spreadsheet.",
    ward: "Ward",
    upload: "Upload CSV",
    reset: "Reset to recorded data",
    weekOf: "Week of",
    rainfall: "Rainfall",
    temperature: "Avg temp",
    humidity: "Humidity",
    cases: "Cases reported",
    mm: "mm",
    celsius: "°C",
    optional: "optional",
    cellLabel: (column: string, date: string) => `${column} for week of ${date}`,
    removeWeek: "Remove last week",
    addWeek: "+ Add the next week",
    working: "Working it out…",
    predict: "Predict",
    missing: "Fill in rainfall, temperature and humidity for every week to continue. Cases can be left blank.",
    unreadable: "I couldn't read that file. Use columns: date, rainfall, temperature, humidity, cases, one row per week.",
    from: (ward: string, date: string) => `${ward} · forecast from the week of ${date}`,
  },

  accuracy: {
    eyebrow: "Can I trust it?",
    title: "We tested it on a whole year it had never seen.",
    intro: (h: number) =>
      `The model learned from 2016 to 2023, was tuned on 2024, and was then scored once on 2025. Everything below is from that final exam, for forecasts made ${h === 1 ? "a week" : `${h} weeks`} ahead. Change the window at the top to see the others.`,
    maeTitle: "cases off, on average",
    maeNote: "per ward per week. Typical weeks have 2 to 13 cases.",
    betterTitle: "better than guessing 'no change'",
    betterNote: "That naive guess misses more because outbreaks move.",
    recallTitle: "of real High/Critical weeks caught",
    recallNote: (precision: string) => `${precision} of the alerts we raised were real.`,
    coverageTitle: "of the time reality fell in our range",
    coverageNote: "We aim for 80%, so the ranges are honest.",
    backtestTitle: "2025, forecast versus reality",
    wardToShow: "Ward to show",
    backtestDesc: (h: number, ward: string) => `Each point is a forecast made ${h === 1 ? "a week" : `${h} weeks`} earlier. ${ward}.`,
    backtestLabel: "Backtest of forecast versus actual cases in 2025",
    range: "Likely range",
    forecast: "Forecast",
    actual: "What happened",
    levelTitle: "Did it call the right risk level?",
    levelDesc: (exact: string, near: string) =>
      `Right on the money ${exact} of the time, and within one level ${near} of the time. Rows are what happened, columns are what we said.`,
    byWindowTitle: "Accuracy by how far ahead",
    byWindowDesc: "Average miss in cases. Lower is better. The grey bar is the “nothing will change” guess.",
    byWindowLabel: "Average error by forecast window, model versus naive guess",
    windowTick: (h: number) => (h === 1 ? "1 wk" : `${h} wks`),
    naive: "Assume no change",
    model: "Our model",
    featuresTitle: "What the model pays attention to",
    featuresDesc: (h: number) => `Overall, across every ward, for the ${h}-week forecast.`,
    knowTitle: "Good to know",
    know: [
      "The forecast is an expected number with a range, not a promise. Real weeks can land outside it about 1 time in 5.",
      "Longer windows are a little less accurate, because there is more time for things to change.",
      "The data is weekly and per ward, so it can't say which street or household is at risk.",
      "It never uses information from after the forecast week, so these scores are what you'd have seen live.",
    ],
  },

  how: {
    eyebrow: "How it works",
    title: "From last week's rain to next month's hospital beds.",
    intro:
      "Dengue does not come on the same day as the rain. It comes 2 to 4 weeks later. Dengue Watch uses that delay to warn health teams early, ward by ward.",
    delayTitle: "Why there is a 2–4 week delay",
    timeline: [
      { week: "Week 0", text: "Heavy rain. Water collects in drains, tyres and pots." },
      { week: "Week 1–2", text: "Mosquito eggs hatch and grow into adults (7 to 14 days)." },
      { week: "Week 2–3", text: "Mosquitoes bite. The virus grows inside people for a few days." },
      { week: "Week 3–4", text: "Fever cases rise and hospitals fill up." },
    ],
    delayNote: "So if we watch the rain now, we can see the cases coming before they arrive.",
    stepsTitle: "What happens behind the screen",
    steps: [
      { title: "Collect", text: "Every week, for every ward: rain, temperature, humidity and the dengue cases reported." },
      { title: "Clean", text: "Fix wrong dates and repeated rows, remove impossible values, fill small gaps in the weather." },
      { title: "Learn the delay", text: "Look back 1 to 8 weeks. Rain from 2 to 4 weeks ago matters most, because mosquitoes need time to grow." },
      { title: "Predict", text: "Two models work together to expect the cases for the next 1, 2, 3 and 4 weeks, with a likely range." },
      { title: "Explain & act", text: "Turn the numbers into a risk level, plain-language reasons and clear steps for the health team." },
    ],
    splitTitle: "How we trained and tested it",
    splitDesc:
      "Weekly data from 60 wards in 5 city corporations, 2016 to 2025. We never mixed the years: a real forecast can only learn from the past.",
    splitLabel: "2016 to 2023 training, 2024 tuning, 2025 testing",
    learn: "Learn · 2016 – 2023",
    tune: "Tune · 2024",
    test: "Test · 2025",
    splitNote: "2025 was kept hidden until the very end, so the results below are what you would have seen in real life.",
    modelTitle: "The prediction model",
    modelPoints: [
      <>
        <b>Two models blended together.</b> A <i>Poisson GLM</i> (simple and steady) and <i>LightGBM</i> (catches tricky
        weather patterns). Both are built for counting things, like cases.
      </>,
      <>
        <b>One model for each window</b>: 1, 2, 3 and 4 weeks ahead.
      </>,
      <>
        <b>A likely range</b> from two extra LightGBM models, so you see “about 7, likely 6 to 14”, not just one number.
      </>,
      <>
        <b>Clear reasons.</b> We re-run the forecast with each factor set to a normal week, to show how many cases rain, heat
        or humidity add.
      </>,
    ],
    resultsTitle: "How well it works (2025 test)",
    colWindow: "Window",
    colMiss: "Off by (avg)",
    colBetter: "Better than “no change”",
    colLevel: "Right risk level",
    weeks: (h: number) => (h === 1 ? "1 week" : `${h} weeks`),
    miss: (n: string) => `±${n} cases`,
    honest: "Honest note: it catches about 7 in 10 real outbreak weeks, so it supports decisions. It is not a promise.",
    fullTest: "See the full test →",
    systemTitle: "How the system is built",
    dataTitle: "Data",
    dataItems: ["Weekly ward CSV (2016–2025)", "Weather · cases · ward details", "Upload new weeks in the portal"],
    backendTitle: "Backend · FastAPI (Python)",
    backendItems: [
      "1. Clean the data",
      "2. Build lag features per ward",
      "3. Load trained models once at start",
      "4. Predict cases, range and risk level",
      "5. Write plain-language reasons",
    ],
    frontendTitle: "Frontend · Next.js",
    frontendItems: ["City overview & outlook", "Risk map", "Action plan for field teams", "Ward forecast & what-if", "Prediction portal", "Accuracy report"],
    systemNote: (api: ReactNode) => (
      <>
        The browser talks only to Next.js, which passes {api} requests to FastAPI. Training happens once, offline. Everything
        runs on one computer: no paid services and no AI calls when you use it. The only outside request is the street-map
        background from OpenStreetMap.
      </>
    ),
    stack: { frontend: "Frontend", backend: "Backend", ml: "Machine learning" },
    limitsTitle: "What it can't do",
    limits: [
      "It looks at most 4 weeks ahead, not months.",
      "It works per ward, not per street or household.",
      "Ward positions on the map are approximate: the data has no ward boundaries.",
      "It was tested on one year (2025). A very unusual season could behave differently.",
    ],
    builtBy:
      "Built by Team CodeNova. We used Claude Code, an AI coding assistant, to help write the code and documents. Our team reviewed and tested everything.",
  },

  notFound: {
    title: "This page isn't on the grid.",
    text: "The address may be wrong, or the ward doesn't exist.",
    home: "Go to the city overview",
    map: "Open the risk map",
  },
  number: f.n,
};

export type Dict = typeof en;
