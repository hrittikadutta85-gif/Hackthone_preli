"use client";
import { useMap } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { ErrorNote, Skeleton } from "@/components/ui";
import { MapExplorer } from "@/components/map/MapExplorer";

export default function MapPage() {
  const { t } = useI18n();
  const { meta, origin, setOrigin, horizon } = useControls();
  const { data, error } = useMap(horizon);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rise">
        <p className="eyebrow">{t.map.eyebrow}</p>
        <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{t.map.title}</h1>
        {/* smaller on phones, so the map starts sooner */}
        <p className="mt-3 max-w-2xl text-sm text-ink/80 sm:text-lg">{t.map.intro(<b>{t.map.play}</b>)}</p>
      </div>
      {error ? (
        <ErrorNote error={error} />
      ) : !data || !meta || !origin ? (
        <Skeleton className="map-canvas lg:w-2/3" />
      ) : (
        <MapExplorer data={data} origin={origin} setOrigin={setOrigin} horizon={horizon} tierHelp={meta.tier_help} />
      )}
    </div>
  );
}
