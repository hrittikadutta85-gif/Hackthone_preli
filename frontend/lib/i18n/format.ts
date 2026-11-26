/** Language-aware numbers, dates and coordinates. The values never change, only how they are written. */
export type Lang = "en" | "bn";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export const toBengaliDigits = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
/** Accepts Bengali digits in typed or uploaded text. */
export const toLatinDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

export function makeFormat(lang: Lang) {
  const digits = (s: string) => (lang === "bn" ? toBengaliDigits(s) : s);
  const locale = lang === "bn" ? "bn-BD" : "en-GB";
  return {
    lang,
    /** Rewrites the digits inside any text. */
    digits,
    /** A number as it is, or rounded to `places` decimals. Rounding is identical in both languages. */
    n: (value: number | string | null | undefined, places?: number) =>
      value == null ? "?" : digits(places == null || typeof value === "string" ? String(value) : value.toFixed(places)),
    /** A count with thousands separators. */
    int: (value: number) => digits(value.toLocaleString("en-US")),
    date: (d: string, long = false) =>
      new Date(`${d}T00:00:00`).toLocaleDateString(locale, long ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" }),
    latLon: (lat: number, lon: number, places = 3) =>
      lang === "bn"
        ? `${toBengaliDigits(lat.toFixed(places))}° উ ${toBengaliDigits(lon.toFixed(places))}° পূ`
        : `${lat.toFixed(places)}°N ${lon.toFixed(places)}°E`,
  };
}

export type Format = ReturnType<typeof makeFormat>;
