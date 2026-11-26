/*
 * Translates the English sentences that the API writes (backend/narrative.py and backend/service.py) into Bangla.
 * The backend, the model and every number stay exactly as they are; only the wording changes in the browser.
 *
 * A sentence that matches nothing is returned unchanged. `tests/test_translations.py` runs every sentence the backend
 * can produce through this file, so new or reworded backend text is caught there.
 */
// The ".ts" extension lets the coverage test run this file directly with Node.
import { toBengaliDigits as d } from "./format.ts";

const CITIES: Record<string, string> = {
  Chattogram: "চট্টগ্রাম",
  "Dhaka North": "ঢাকা উত্তর",
  "Dhaka South": "ঢাকা দক্ষিণ",
  Gazipur: "গাজীপুর",
  Narayanganj: "নারায়ণগঞ্জ",
  "all five city corporations": "পাঁচটি সিটি কর্পোরেশন",
};

const TIERS: Record<string, string> = { Low: "কম", Medium: "মাঝারি", High: "উচ্চ", Critical: "সংকটজনক" };

const ACTIONS: Record<string, string> = {
  "Keep routine surveillance going. Nothing urgent this window.": "নিয়মিত নজরদারি চালিয়ে যান। এই সময়ে জরুরি কিছু নেই।",
  "Use the quiet time to check larvicide and fogging stock.": "এই শান্ত সময়ে লার্ভানাশক ও ফগিং সামগ্রীর মজুত যাচাই করুন।",
  "Inspect the usual breeding spots: clogged drains, open water tanks, discarded containers.":
    "মশার সাধারণ প্রজননস্থল পরিদর্শন করুন: বন্ধ ড্রেন, খোলা পানির ট্যাংক, ফেলে রাখা পাত্র।",
  "Send a short community message about emptying standing water weekly.":
    "প্রতি সপ্তাহে জমা পানি ফেলে দিতে এলাকাবাসীকে সংক্ষিপ্ত বার্তা পাঠান।",
  "Check that larvicide and test kits are stocked before the window opens.":
    "ঝুঁকির সময় শুরুর আগেই লার্ভানাশক ও টেস্ট কিটের মজুত নিশ্চিত করুন।",
  "Schedule larviciding and spraying in this ward before the window opens.":
    "ঝুঁকির সময় শুরুর আগেই এই ওয়ার্ডে লার্ভানাশক প্রয়োগ ও স্প্রের সূচি করুন।",
  "Tell nearby clinics and hospitals to expect more fever cases.": "আশপাশের ক্লিনিক ও হাসপাতালকে জ্বরের রোগী বাড়তে পারে বলে জানান।",
  "Run door-to-door container clearing in the most waterlogged lanes.":
    "সবচেয়ে জলাবদ্ধ গলিগুলোতে বাড়ি বাড়ি গিয়ে পানি জমার পাত্র পরিষ্কার করান।",
  "Send emergency vector-control teams now, not next week.": "আগামী সপ্তাহে নয়, এখনই জরুরি মশক নিয়ন্ত্রণ দল পাঠান।",
  "Prepare hospital beds, NS1 test kits and IV fluids for a surge.":
    "রোগী হঠাৎ বাড়ার জন্য হাসপাতালের শয্যা, NS1 টেস্ট কিট ও স্যালাইন (IV) প্রস্তুত রাখুন।",
  "Ask clinics for daily case counts so the plan can change quickly.":
    "পরিকল্পনা দ্রুত বদলাতে ক্লিনিকগুলোর কাছ থেকে প্রতিদিনের রোগীর সংখ্যা নিন।",
};

/** "That's …" at the end of the first story sentence, by risk level. */
const TIER_PLAIN: Record<string, string> = {
  "a quiet stretch": "এটি তুলনামূলক শান্ত সময়।",
  "something to keep an eye on": "বিষয়টি নজরে রাখা দরকার।",
  "a real outbreak risk": "প্রাদুর্ভাবের বাস্তব ঝুঁকি আছে।",
  "an emergency-level risk": "এটি জরুরি পর্যায়ের ঝুঁকি।",
};

const GROUPS: Record<string, string> = {
  "Rainfall (multi-week lags)": "বৃষ্টিপাত (কয়েক সপ্তাহ আগের)",
  Temperature: "তাপমাত্রা",
  Humidity: "আর্দ্রতা",
  "Recent cases (surveillance)": "সাম্প্রতিক রোগী (নজরদারি)",
  "Ward vulnerability": "ওয়ার্ডের ঝুঁকিপ্রবণতা",
  Seasonality: "ঋতুগত প্রভাব",
  // the same groups without their notes, as shown on the driver bars
  Rainfall: "বৃষ্টিপাত",
  "Recent cases": "সাম্প্রতিক রোগী",
  // GROUP_PLAIN
  rainfall: "বৃষ্টিপাত",
  temperature: "তাপমাত্রা",
  humidity: "আর্দ্রতা",
  "recent case counts": "সাম্প্রতিক রোগীর সংখ্যা",
  "the ward's own conditions (drainage, crowding, sanitation)": "ওয়ার্ডের নিজস্ব অবস্থা (নিষ্কাশন, ঘনবসতি, পরিচ্ছন্নতা)",
  "the time of year": "বছরের সময়",
};

const FEATURES: Record<string, string> = {
  "this week's rain": "এই সপ্তাহের বৃষ্টি",
  "total rain 2 to 4 weeks ago (breeding window)": "২ থেকে ৪ সপ্তাহ আগের মোট বৃষ্টি (প্রজনন সময়কাল)",
  "rain over the last 4 weeks": "গত ৪ সপ্তাহের বৃষ্টি",
  "rain over the last 8 weeks": "গত ৮ সপ্তাহের বৃষ্টি",
  "number of very heavy rain weeks lately": "সাম্প্রতিক অতিভারী বৃষ্টির সপ্তাহের সংখ্যা",
  "this week's temperature": "এই সপ্তাহের তাপমাত্রা",
  "day-night temperature swing": "দিন-রাতের তাপমাত্রার পার্থক্য",
  "average temperature over 4 weeks": "৪ সপ্তাহের গড় তাপমাত্রা",
  "weeks in mosquito-friendly warmth": "মশার অনুকূল উষ্ণতার সপ্তাহ",
  "this week's humidity": "এই সপ্তাহের আর্দ্রতা",
  "dew point": "শিশিরাঙ্ক",
  "average humidity over 4 weeks": "৪ সপ্তাহের গড় আর্দ্রতা",
  "very humid weeks lately": "সাম্প্রতিক অতি আর্দ্র সপ্তাহ",
  "cases this week": "এই সপ্তাহের রোগী",
  "average cases over 4 weeks": "৪ সপ্তাহের গড় রোগী",
  "how fast cases are rising": "রোগী বাড়ার গতি",
  "cases across the whole city": "পুরো শহরের রোগী",
  "cases at this time last year": "গত বছরের এই সময়ের রোগী",
  "how crowded the ward is": "ওয়ার্ডের জনঘনত্ব",
  "waterlogging risk": "জলাবদ্ধতার ঝুঁকি",
  sanitation: "পরিচ্ছন্নতা",
  "waterlogging combined with poor sanitation": "জলাবদ্ধতা ও দুর্বল পরিচ্ছন্নতার মিলিত প্রভাব",
  "time of year": "বছরের সময়",
};

const ERRORS: Record<string, string> = {
  "Weeks must be consecutive, one row per week with no gaps.": "সপ্তাহগুলো পরপর হতে হবে; কোনো ফাঁক ছাড়া প্রতি সপ্তাহে একটি সারি।",
  "Not enough history to compute the lag features.": "আগের সপ্তাহের ফিচার হিসাব করার মতো যথেষ্ট ইতিহাস নেই।",
  "Some values are out of range. Check rainfall (0–1000 mm), temperature (5–45 °C) and humidity (1–100%).":
    "কিছু মান সীমার বাইরে। বৃষ্টিপাত (০–১০০০ মিমি), তাপমাত্রা (৫–৪৫ °সে) ও আর্দ্রতা (১–১০০%) যাচাই করুন।",
  "The what-if run failed.": "“কী হলে” হিসাবটি করা যায়নি।",
  "Failed to fetch": "সার্ভারের সঙ্গে যোগাযোগ করা যায়নি।",
};

const EXACT: Record<string, string> = {
  ...CITIES,
  ...TIERS,
  ...ACTIONS,
  ...GROUPS,
  ...FEATURES,
  ...ERRORS,
  "Weather isn't moving the forecast much right now.": "এই মুহূর্তে আবহাওয়া পূর্বাভাসে তেমন প্রভাব ফেলছে না।",
  "Nothing changed yet. Move a slider to see how the weather could shift the picture.":
    "এখনও কিছু বদলানো হয়নি। আবহাওয়া কীভাবে পরিস্থিতি বদলাতে পারে দেখতে একটি স্লাইডার সরান।",
};

const exact = (s: string) => EXACT[s] ?? s;
const WEEKS = "(next week|in \\d+ weeks)";
const when = (s: string) => (s === "next week" ? "আগামী সপ্তাহে" : `${d(s.replace(/\D/g, ""))} সপ্তাহ পরে`);
const TIER = "(Low|Medium|High|Critical)";
const NUM = "([\\d.,]+|nan|n/a)";
const num = (s: string) => (s === "nan" || s === "n/a" ? "?" : d(s));
const monthDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" })
    : "?";

/** "Your edited rainfall, 80% more rain and 3°C warmer weather" */
function changes(list: string): string {
  const parts = list.split(/, | and /).map((p) => {
    let m;
    if (p === "Your edited rainfall") return "আপনার সম্পাদিত বৃষ্টিপাত";
    if ((m = p.match(/^(\d+)% (more|less) rain$/))) return `${d(m[1])}% ${m[2] === "more" ? "বেশি" : "কম"} বৃষ্টি`;
    if ((m = p.match(/^([\d.]+)°C (warmer|cooler) weather$/)))
      return `${d(m[1])}°সে ${m[2] === "warmer" ? "বেশি গরম" : "বেশি ঠান্ডা"} আবহাওয়া`;
    if ((m = p.match(/^([\d.]+) points (more|less) humidity$/)))
      return `${d(m[1])} পয়েন্ট ${m[2] === "more" ? "বেশি" : "কম"} আর্দ্রতা`;
    return p;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ও ${parts[parts.length - 1]}` : parts[0];
}

type Rule = [RegExp, (...groups: string[]) => string];
const rule = (pattern: string, to: Rule[1]): Rule => [new RegExp(`^${pattern}$`), to];

const RULES: Rule[] = [
  // labels and plain feature names
  rule("Ward (\\w+), (Chattogram|Dhaka North|Dhaka South|Gazipur|Narayanganj)", (w, city) => `ওয়ার্ড ${d(w)}, ${exact(city)}`),
  rule("Ward (\\w+)", (w) => `ওয়ার্ড ${d(w)}`),
  rule("rain (\\d+) weeks? ago", (k) => `${d(k)} সপ্তাহ আগের বৃষ্টি`),
  rule("temperature (\\d+) weeks? ago", (k) => `${d(k)} সপ্তাহ আগের তাপমাত্রা`),
  rule("humidity (\\d+) weeks? ago", (k) => `${d(k)} সপ্তাহ আগের আর্দ্রতা`),
  rule("cases (\\d+) weeks? ago", (k) => `${d(k)} সপ্তাহ আগের রোগী`),

  // risk level help text
  rule("under ([\\d.]+) cases a week", (a) => `সপ্তাহে ${d(a)} জনের কম রোগী`),
  rule("([\\d.]+) to ([\\d.]+) cases a week", (a, b) => `সপ্তাহে ${d(a)} থেকে ${d(b)} জন রোগী`),
  rule("([\\d.]+)\\+ cases a week", (a) => `সপ্তাহে ${d(a)} জন বা তার বেশি রোগী`),

  // ward headline and story
  rule(`(.+) looks calm ${WEEKS}\\.`, (label, w) => `${when(w)} ${translate(label)} শান্ত থাকবে বলে মনে হচ্ছে।`),
  rule(`(.+) is worth watching ${WEEKS}\\.`, (label, w) => `${when(w)} ${translate(label)} নজরে রাখার মতো।`),
  rule(`(.+) is heading toward ${TIER} risk ${WEEKS}\\.`, (label, tier, w) => `${when(w)} ${translate(label)} ${TIERS[tier]} ঝুঁকির দিকে যাচ্ছে।`),
  rule(
    "The model expects about (\\d+) cases? that week, most likely between (\\d+) and (\\d+)\\. That's (.+)\\.",
    (c, lo, hi, plain) =>
      `মডেলের হিসাবে ওই সপ্তাহে আনুমানিক ${d(c)} জন রোগী হতে পারে, সম্ভবত ${d(lo)} থেকে ${d(hi)} জনের মধ্যে। ${TIER_PLAIN[plain] ?? plain}`,
  ),
  rule(`This week there (?:were|was) ${NUM} reported, so cases are expected to (climb|fall)\\.`, (c, dir) =>
    `এই সপ্তাহে ${num(c)} জন রোগী রিপোর্ট হয়েছে, তাই রোগী ${dir === "climb" ? "বাড়বে" : "কমবে"} বলে ধারণা।`,
  ),
  rule(`That's close to this week's ${NUM} reported cases, so no big change is expected\\.`, (c) =>
    `এটি এই সপ্তাহে রিপোর্ট হওয়া ${num(c)} জন রোগীর কাছাকাছি, তাই বড় কোনো পরিবর্তন আশা করা হচ্ছে না।`,
  ),
  rule(
    "The biggest weather factor is (.+?), mainly (.+)\\. Compared with a typical week at this time of year, it (adds|removes) about ([\\d.]+) cases?\\.",
    (group, feature, verb, c) =>
      `আবহাওয়ার সবচেয়ে বড় প্রভাবক ${translate(group)}, প্রধানত ${translate(feature)}। বছরের এই সময়ের সাধারণ সপ্তাহের তুলনায় এটি প্রায় ${d(c)} জন রোগী ${verb === "adds" ? "বাড়াচ্ছে" : "কমাচ্ছে"}।`,
  ),
  rule(`Heads up: risk climbs to ${TIER} ${WEEKS}\\.`, (tier, w) => `খেয়াল করুন: ${when(w)} ঝুঁকি বেড়ে ${TIERS[tier]} হবে।`),

  // city view and outlook summaries
  rule(`No ward in (.+) is at High risk ${WEEKS}\\. That's a good week to prepare\\.`, (scope, w) =>
    `${when(w)} ${exact(scope)}-এর কোনো ওয়ার্ড উচ্চ ঝুঁকিতে নেই। প্রস্তুতি নেওয়ার জন্য ভালো সপ্তাহ।`,
  ),
  rule(`(\\d+) of (\\d+) wards in (.+) could reach High or Critical risk ${WEEKS}\\. (.+) needs attention first\\.`, (a, b, scope, w, top) =>
    `${when(w)} ${exact(scope)}-এর ${d(b)}টি ওয়ার্ডের ${d(a)}টি উচ্চ বা সংকটজনক ঝুঁকিতে পৌঁছাতে পারে। আগে নজর দিন: ${translate(top)}।`,
  ),
  rule(
    "Across all (\\d+) wards, about ([\\d,]+) cases are expected in 2 weeks, (about the same as|up from|down from) ([\\d,]+) reported this week\\.",
    (wards, expected, trend, now) => {
      const tail =
        trend === "about the same as"
          ? `এই সপ্তাহে রিপোর্ট হওয়া ${d(now)} জনের প্রায় সমান`
          : `এই সপ্তাহের ${d(now)} জন থেকে ${trend === "up from" ? "বেশি" : "কম"}`;
      return `সব ${d(wards)}টি ওয়ার্ড মিলিয়ে ২ সপ্তাহ পরে আনুমানিক ${d(expected)} জন রোগী হতে পারে, যা ${tail}।`;
    },
  ),

  // what-if sentences
  rule(`(.+) would barely move (.+?)'s forecast\\. It stays ${TIER} \\(about ([\\d.]+) cases ${WEEKS}\\)\\.`, (list, label, tier, c, w) =>
    `${changes(list)} ধরলে ${translate(label)}-এর পূর্বাভাস খুব একটা বদলাবে না। ঝুঁকি ${TIERS[tier]}-ই থাকবে (${when(w)} আনুমানিক ${d(c)} জন রোগী)।`,
  ),
  rule(
    `(.+) would (raise|lower) the forecast ${WEEKS} from ([\\d.]+) to ([\\d.]+) cases, (?:moving it from ${TIER} to ${TIER}|keeping it at ${TIER})\\.`,
    (list, dir, w, a, b, from, to, kept) => {
      const tail = kept ? `ঝুঁকি ${TIERS[kept]}-ই থাকবে` : `ঝুঁকি ${TIERS[from]} থেকে ${TIERS[to]} হবে`;
      return `${changes(list)} ধরলে ${when(w)} পূর্বাভাস ${d(a)} থেকে ${dir === "raise" ? "বেড়ে" : "কমে"} ${d(b)} জন রোগী হবে; ${tail}।`;
    },
  ),

  // prediction portal notes and errors
  rule(`No case count for (\\S+), so last week's ${NUM} was carried forward\\.`, (date, c) =>
    `${monthDate(date)}-এর রোগীর সংখ্যা নেই, তাই আগের সপ্তাহের ${num(c)} ধরা হয়েছে।`,
  ),
  rule("Your first week must follow the recorded data \\(last recorded week: (.+)\\) or overlap it\\.", (date) =>
    `প্রথম সপ্তাহটি সংরক্ষিত তথ্যের ঠিক পরে হতে হবে (সর্বশেষ সপ্তাহ: ${monthDate(date)}) অথবা তার সঙ্গে মিলতে হবে।`,
  ),
  rule("I couldn't find a ward called '(.*)'\\.", (w) => `“${w}” নামে কোনো ওয়ার্ড পাওয়া যায়নি।`),
  rule("No city corporation called '(.*)'\\.", (c) => `“${c}” নামে কোনো সিটি কর্পোরেশন পাওয়া যায়নি।`),
  rule("Request failed \\((\\d+)\\)", (code) => `অনুরোধটি সম্পন্ন করা যায়নি (ত্রুটি ${d(code)})।`),
];

/** The Bangla wording of a backend string, or the string itself when it is not recognised. */
export function translate(text: string): string {
  const known = EXACT[text];
  if (known !== undefined) return known;
  for (const [pattern, to] of RULES) {
    const m = pattern.exec(text);
    if (m) return to(...m.slice(1));
  }
  return text;
}

/** For error messages, which may come from the browser itself: never leave a Bangla reader with raw English. */
export function translateError(message: string): string {
  if (/[ঀ-৿]/.test(message)) return message; // already written in Bangla by the web app
  const out = translate(message);
  return out === message ? "অনুরোধটি সম্পন্ন করা যায়নি।" : out;
}
