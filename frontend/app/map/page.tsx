"use client";
import { useMap } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { ErrorNote, Skeleton } from "@/components/ui";
import { MapExplorer } from "@/components/map/MapExplorer";

export default function MapPage() {
  const { meta, origin, setOrigin, horizon } = useControls();
  const { data, error } = useMap(horizon);

  return (
    <div className="space-y-6">
      <div className="rise">
        <p className="text-sm font-medium text-accent">Risk map</p>
        <h1 className="font-display mt-1 max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">
          Where is dengue heading? Red wards need help first.
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink/80">
          Every bubble is a ward on the real map of Dhaka, Gazipur, Narayanganj and Chattogram. Hover for numbers, click for
          details, or press <b>Play weeks</b> to watch the outbreak season build and fade.
        </p>
      </div>
      {error ? (
        <ErrorNote error={error} />
      ) : !data || !meta || !origin ? (
        <Skeleton className="h-[460px] w-full sm:h-[620px] lg:w-2/3" />
      ) : (
        <MapExplorer data={data} origin={origin} setOrigin={setOrigin} horizon={horizon} tierHelp={meta.tier_help} />
      )}
    </div>
  );
}
