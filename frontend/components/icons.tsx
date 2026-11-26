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
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Brand mark: a monitoring radar with one live signal. */
export function BrandMark() {
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/40 bg-accent-soft shadow-[0_0_22px_-6px_rgb(45_212_191/0.8)]" aria-hidden>
      <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none">
        <circle cx="16" cy="16" r="13" stroke="var(--accent)" strokeOpacity="0.35" />
        <circle cx="16" cy="16" r="7.5" stroke="var(--accent)" strokeOpacity="0.6" />
        <path d="M16 16 25.2 6.8" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="16" cy="16" r="2.2" fill="var(--accent)" />
        <circle cx="22" cy="20.5" r="2" fill="var(--high)" />
      </svg>
    </span>
  );
}
