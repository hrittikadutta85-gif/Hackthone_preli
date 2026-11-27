/*
 * Decorative background only: the light page colour with two very soft washes of teal and green light, so large
 * screens do not look flat. No patterns, nothing animated, and no data.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 40% at 0% 0%, rgb(117 184 165 / 0.14), transparent 70%)," +
            "radial-gradient(ellipse 45% 40% at 100% 0%, rgb(40 127 117 / 0.07), transparent 70%)," +
            "var(--paper)",
        }}
      />
    </div>
  );
}
