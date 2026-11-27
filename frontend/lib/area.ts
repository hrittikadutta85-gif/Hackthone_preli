"use client";
/* Area Intelligence data. Reading is public; the hospital directory is edited by administrators only. */
import useSWR from "swr";
import { getJson } from "./http";
import type { Tier } from "./api";

export type PlaceKind = "division" | "district" | "city_corporation" | "neighbourhood" | "ward" | "locality" | "osm";

export interface Place {
  id: string;
  kind: PlaceKind;
  name: string;
  name_bn: string | null;
  district?: string | null;
  district_bn?: string | null;
  division?: string | null;
  division_bn?: string | null;
  city_corporation?: string | null;
  dataset_city?: string | null;
  ward?: string;
  ward_number?: string;
  point: [number, number] | null;
  display?: string;
  source?: string;
  verified?: boolean;
}

export interface SearchResult {
  query: string;
  results: Place[];
  unmatched: string[];
  partial: boolean;
  online_available: boolean;
}

export type CoverageLevel = "ward" | "city" | "city_context" | "district_partial" | "none";

export interface Overview extends Place {
  city_corporation_name: string | null;
  city_corporation_name_bn: string | null;
  city_point: [number, number] | null;
  city_radius_km: number | null;
  coverage: { level: CoverageLevel; cities?: string[]; wards?: string[]; nearest?: { city_corporation: string; km: number } };
  population: number | null;
  hospital_count: number;
  hospital_scope: "area" | "nearby";
}

export interface DengueHorizon {
  h: number;
  target_date: string;
  predicted: number;
  lower: number;
  upper: number;
  tier: Tier;
  tier_counts: Record<Tier, number>;
}

export interface Dengue {
  available: boolean;
  level?: CoverageLevel;
  origin?: string;
  data_to?: string;
  wards_counted?: number;
  current?: { week: string; cases: number; last_4_weeks: number };
  horizons?: DengueHorizon[];
  trend?: { date: string; cases: number }[];
  interval_note?: "summed" | "model";
  risk_factors?: { text: string; effect_pct: number; weather: boolean }[];
  headline?: string;
  actions?: string[];
  top_wards?: { ward: string; label: string; predicted: number; tier: Tier }[];
  risk_tier?: Tier;
}

export interface Environment {
  available: boolean;
  level?: CoverageLevel;
  week?: string;
  wards_counted?: number;
  sanitation_score?: number;
  waterlogging_index?: number;
  vulnerability_index?: number;
  population_density?: number;
  rain_week_mm?: number;
  rain_4w_mm?: number;
  avg_temp_c?: number;
  humidity_pct?: number;
  recent_cases_4w?: number;
  dataset_range?: { sanitation: [number, number]; waterlogging: [number, number] };
  facility_counts: null;
}

export type AvailabilityStatus = "live" | "reported" | "stale" | "unavailable";

export interface Hospital {
  id: number;
  name: string;
  name_bn: string | null;
  type: "government" | "private" | "autonomous" | "ngo" | "military" | "other";
  address: string;
  city_corporation: string | null;
  district: string;
  division: string;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  emergency_phone: string | null;
  has_emergency: boolean | null;
  registered_beds: number | null;
  icu_beds: number | null;
  source: string | null;
  source_ref: string | null;
  verified: boolean;
  verified_at: string | null;
  updated_at: string;
  active: boolean;
  distance_km: number | null;
  directions?: string;
  availability: {
    status: AvailabilityStatus;
    available_beds?: number | null;
    occupied_beds?: number | null;
    icu_available?: number | null;
    reported_at?: string;
    method?: "manual" | "api";
    source_ref?: string;
    age_hours?: number;
  };
  history?: { available_beds: number | null; occupied_beds: number | null; icu_available: number | null; reported_at: string; method: string; source_ref: string; verified: boolean }[];
}

type Total = { value: number | null; reported_by: number; of: number };
export interface HospitalSummary {
  total: number;
  government: number;
  private: number;
  other: number;
  verified: number;
  with_emergency: number;
  registered_beds: Total;
  icu_beds: Total;
  availability: Record<"available_beds" | "occupied_beds" | "icu_available", Total>;
  live: boolean;
  latest_report: string | null;
  closest_with_beds: { id: number; name: string; distance_km: number | null; available_beds: number; reported_at: string } | null;
}

export type BedStatus = "enough" | "tight" | "short";

export interface BedOutlook {
  available: boolean;
  level?: CoverageLevel;
  wards_counted?: number;
  capacity?: number;
  week?: string;
  in_use?: number;
  left_now?: number;
  status_now?: BedStatus;
  latest?: boolean;
  choices?: string[];
  weeks?: { h: number; target_date: string; capacity: number; needed_expected: number; needed_worst: number; left_expected: number; left_worst: number; status: BedStatus; wards_short: number; beds_short: number }[];
  tightest?: { ward: string; label: string; capacity: number; in_use: number; left_now: number; min_left_expected: number; min_left_worst: number }[];
  city_spare_2w?: number | null;
  history?: { date: string; in_use: number }[];
}

export interface Dashboard {
  overview: Overview;
  dengue: Dengue;
  environment: Environment;
  beds: BedOutlook;
  hospitals: { scope: "area" | "nearby"; summary: HospitalSummary; items: Hospital[] };
}

export interface Sources {
  gazetteer: { source: string; retrieved: string; note: string };
  dengue: { source: string; data_to: string };
  hospitals: { name: string; kind: string; url: string | null; notes: string | null }[];
}

const opts = { revalidateOnFocus: false, keepPreviousData: true } as const;

export const useLocationSearch = (q: string) =>
  useSWR<SearchResult>(q.trim().length >= 2 ? `/api/locations/search?q=${encodeURIComponent(q.trim())}&limit=8` : null, getJson, opts);

export const useDashboard = (id: string | null) => useSWR<Dashboard>(id ? `/api/locations/${encodeURIComponent(id)}` : null, getJson, { revalidateOnFocus: false });

export const useBeds = (id: string | null, asOf: string | null) =>
  useSWR<{ estimate: BedOutlook; reported: HospitalSummary; hospitals: Hospital[] }>(
    id && asOf ? `/api/locations/${encodeURIComponent(id)}/beds?as_of=${asOf}` : null,
    getJson,
    { revalidateOnFocus: false, keepPreviousData: true },
  );

export const useSources = () => useSWR<Sources>("/api/locations/sources", getJson, opts);

export const useAdminHospitals = () =>
  useSWR<{ items: Hospital[]; sources: { id: number; name: string; kind: string }[]; localities: { id: number; name: string; district: string; division: string; lat: number; lon: number; city_corporation: string | null; verified: number }[] }>(
    "/api/admin/hospitals",
    getJson,
    { revalidateOnFocus: true },
  );
