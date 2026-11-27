/* Minimal line icons (24px grid, drawn with the current text colour). */
const PATHS = {
  overview: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  plan: "M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.500 11M4 18l1.2 1.200L7.500 17",
  ward: "M12 21s-6.500-5.600-6.500-11a6.500 6.500 0 0 1 13 0c0 5.400-6.500 11-6.500 11zM12 12.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z",
  predict: "M3 17l5-5 4 3 8-9M15 6h5v5",
  shield: "M12 3l7 3v5c0 4.600-3 8.200-7 10-4-1.800-7-5.400-7-10V6l7-3zM9 12l2.200 2.200L15.500 10",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  download: "M12 4v11M7.500 11 12 15.500 16.500 11M5 20h14",
  upload: "M12 16V5M7.500 9.500 12 5l4.500 4.500M5 20h14",
  print: "M7 9V4h10v5M7 18H5a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z",
  edit: "M4 20h4L19 9a2.800 2.800 0 0 0-4-4L4 16v4zM13.500 6.500l4 4",
  rain: "M7 15a4.500 4.500 0 1 1 .8-8.930A5.500 5.500 0 0 1 18.500 8 3.500 3.500 0 0 1 17.500 15H7zM8 18l-1 2.500M12.500 18l-1 2.500M17 18l-1 2.500",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2.500M12 19.500V22M2 12h2.500M19.500 12H22M4.900 4.900l1.800 1.800M17.300 17.300l1.800 1.800M4.900 19.100l1.800-1.800M17.300 6.700l1.800-1.800",
  heat: "M10 13.500V5a2 2 0 0 1 4 0v8.500a4.500 4.500 0 1 1-4 0zM12 9v8",
  mist: "M4 8h12M8 12h12M4 16h10M18 16h2M19 8h1M4 12h1",
  data: "M12 8c4.400 0 7.500-1.100 7.500-2.500S16.400 3 12 3 4.500 4.100 4.500 5.500 7.600 8 12 8zM4.500 5.500v13C4.500 19.900 7.600 21 12 21s7.500-1.100 7.500-2.500v-13M4.500 12c0 1.400 3.100 2.500 7.500 2.500s7.500-1.100 7.500-2.500",
  filter: "M4 5h16l-6 7.500V19l-4 2v-8.500L4 5z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.500 2",
  activity: "M3 12h4l2.500-7 5 14 2.500-7h4",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.500 8.500l-2 5-5 2 2-5 5-2z",
  incubate: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7z",
  hospital: "M5 4h14v16H5zM12 8v8M8 12h8",
  alert: "M12 4 2.800 20h18.400L12 4zM12 10v4.500M12 17.400v.1",
  menu: "M4 7h16M4 12h16M4 17h16",
  play: "M8 5l11 7-11 7V5z",
  pause: "M8 5v14M16 5v14",
  close: "M6 6l12 12M18 6 6 18",
  radar: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.500a4.500 4.500 0 1 0 0-9 4.500 4.500 0 0 0 0 9zM12 12l6.400-6.400",
  ops: "M4 8h16v11H4zM9 8V5.500h6V8M4 13h16M11 13v2h2v-2",
  box: "M3 7.500 12 3l9 4.500v9L12 21l-9-4.500v-9zM3 7.500 12 12l9-4.500M12 12v9",
  bed: "M3 6v13M3 15h18v4M21 15v-2.500A2.500 2.500 0 0 0 18.500 10H11v5M7 12.500a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3z",
  spray: "M7 10h6v10H7zM9 10V7h2v3M8 7h4M15 6l4-1.500M15 8.500h4.500M15 11l4 1.500",
  message: "M4 5h16v11H9l-5 4V5zM8 9.500h8M8 12.500h5",
  wifiOff: "M3 3l18 18M8.800 15.800a4.500 4.500 0 0 1 6.400 0M5.300 12.300a9.500 9.500 0 0 1 3.900-2.200M18.700 12.300a9.500 9.500 0 0 0-2.700-1.700M2 8.800a14.500 14.500 0 0 1 4.200-2.700M22 8.800a14.500 14.500 0 0 0-11-3.700M12 19.500h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  check: "M5 12.500l4.500 4.500L19 7",
  arrow: "M5 12h14M13 6l6 6-6 6",
  bell: "M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15L6 16.500zM10 20.500a2 2 0 0 0 4 0",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/**
 * Brand mark: a protection shield holding a simple Aedes mosquito silhouette. `tone="light"` is for dark teal
 * backgrounds (white tile, teal drawing); the default is a teal tile with a white drawing.
 */
export function BrandMark({ className = "h-10 w-10", tone = "teal" }: { className?: string; tone?: "teal" | "light" }) {
  const tile = tone === "light" ? "#ffffff" : "var(--accent)";
  const ink = tone === "light" ? "var(--accent)" : "#ffffff";
  return (
    <span className={`relative grid shrink-0 place-items-center ${className}`} aria-hidden>
      <svg viewBox="0 0 40 40" className="h-full w-full" fill="none">
        <rect width="40" height="40" rx="11" fill={tile} />
        <path d="M20 6.5 30.5 10.6v7.9c0 7-4.4 12.2-10.5 14.9C13.9 30.7 9.5 25.5 9.5 18.5v-7.9z" fill={ink} fillOpacity="0.14" stroke={ink} strokeWidth="1.7" strokeLinejoin="round" />
        {/* wings */}
        <ellipse cx="16.6" cy="19.6" rx="2.1" ry="4.4" transform="rotate(-28 16.6 19.6)" fill={ink} fillOpacity="0.55" />
        <ellipse cx="23.4" cy="19.6" rx="2.1" ry="4.4" transform="rotate(28 23.4 19.6)" fill={ink} fillOpacity="0.55" />
        {/* legs */}
        <path d="M19 19.5 14.6 23.4M21 19.5l4.4 3.9M19.2 21.6l-3.4 5M20.8 21.6l3.4 5M19.2 18.2l-3.6-2.6M20.8 18.2l3.6-2.6" stroke={ink} strokeWidth="1" strokeLinecap="round" />
        {/* body, head and proboscis */}
        <path d="M20 16.4v10.4" stroke={ink} strokeWidth="2.3" strokeLinecap="round" />
        <circle cx="20" cy="14.6" r="1.7" fill={ink} />
        <path d="M20 12.9v-2.6" stroke={ink} strokeWidth="1" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/* Educational Aedes aegypti illustration (seen from above): banded legs, a lyre-shaped mark on the thorax and a
   striped abdomen, the features used to tell this dengue vector apart. Friendly line art, not a photograph. */
const LEGS = [
  "M110 92 84 76 58 48",
  "M130 92l26-16 26-28",
  "M108 102 74 104 42 124",
  "M132 102l34 2 32 20",
  "M110 112 86 146 66 204",
  "M130 112l24 34 20 58",
];

export function MosquitoArt({ className = "", tone = "default" }: { className?: string; tone?: "default" | "light" }) {
  const dark = tone === "light";
  const body = dark ? "#e8f5f1" : "#193b38";
  const band = dark ? "#287f75" : "#ffffff";
  const wing = dark ? "rgb(232 245 241 / 0.18)" : "rgb(117 184 165 / 0.28)";
  const wingLine = dark ? "rgb(232 245 241 / 0.55)" : "#75b8a5";
  return (
    <svg viewBox="0 0 240 240" className={className} fill="none" aria-hidden>
      {/* wings */}
      <ellipse cx="98" cy="138" rx="15" ry="50" transform="rotate(22 98 138)" fill={wing} stroke={wingLine} strokeWidth="1.5" />
      <ellipse cx="142" cy="138" rx="15" ry="50" transform="rotate(-22 142 138)" fill={wing} stroke={wingLine} strokeWidth="1.5" />
      <path d="M100 100 88 176M140 100l12 76" stroke={wingLine} strokeWidth="1" strokeOpacity="0.7" />
      {/* banded legs: a solid stroke with a dashed light stroke on top */}
      {LEGS.map((d) => (
        <g key={d} strokeLinecap="round" strokeLinejoin="round">
          <path d={d} stroke={body} strokeWidth="3.2" />
          <path d={d} stroke={band} strokeWidth="1.8" strokeDasharray="4 7" />
        </g>
      ))}
      {/* antennae and proboscis */}
      <path d="M116 64c-6-8-10-14-16-22M124 64c6-8 10-14 16-22" stroke={body} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M103 46l-5 1M106 51l-5 1M137 46l5 1M134 51l5 1" stroke={body} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M120 64V30" stroke={body} strokeWidth="2.2" strokeLinecap="round" />
      {/* head */}
      <circle cx="120" cy="71" r="9" fill={body} />
      <circle cx="115.5" cy="69.5" r="2.4" fill={band} fillOpacity="0.85" />
      <circle cx="124.5" cy="69.5" r="2.4" fill={band} fillOpacity="0.85" />
      {/* thorax with the lyre mark */}
      <ellipse cx="120" cy="96" rx="15" ry="18" fill={body} />
      <path d="M113 86c-4 6-3 14 2 20M127 86c4 6 3 14-2 20M118 88v14M122 88v14" stroke={band} strokeWidth="1.6" strokeLinecap="round" />
      {/* striped abdomen */}
      <ellipse cx="120" cy="150" rx="10.5" ry="38" fill={body} />
      {[124, 136, 148, 160, 172].map((y) => (
        <path key={y} d={`M${111 + (y > 165 ? 2 : 0)} ${y}h${18 - (y > 165 ? 4 : 0)}`} stroke={band} strokeWidth="2" strokeLinecap="round" />
      ))}
    </svg>
  );
}
