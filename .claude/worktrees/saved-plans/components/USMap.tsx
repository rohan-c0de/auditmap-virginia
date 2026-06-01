import { feature } from "topojson-client";
import { geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import topology from "us-atlas/states-albers-10m.json";
import { getAllStates } from "@/lib/states/registry";

// us-atlas topology has states pre-projected to Albers USA in a ~975×610 frame.
// geoPath() with no projection treats coordinates as already-screen coords.
const path = geoPath();

type StateProps = { name: string };

export default function USMap() {
  const states = getAllStates();
  const byName = new Map(
    states.map((s) => [s.name, { slug: s.slug, count: s.collegeCount }]),
  );

  // topojson types are loose; cast to a typed FeatureCollection for our use.
  const fc = feature(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topology as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (topology as any).objects.states,
  ) as unknown as FeatureCollection<Geometry, StateProps>;

  return (
    <div className="relative w-full">
      <svg
        viewBox="0 0 975 610"
        className="w-full h-auto"
        role="img"
        aria-label={`Map of US states. ${states.length} active, click to browse a state.`}
      >
        <g>
          {fc.features.map((f, i) => {
            const d = path(f) || "";
            const name = f.properties?.name ?? "";
            const active = byName.get(name);
            const key = `${name}-${i}`;
            if (active) {
              return (
                <a
                  key={key}
                  href={`/${active.slug}`}
                  aria-label={`${name}: ${active.count} colleges. Click to browse.`}
                >
                  <path
                    d={d}
                    className="fill-teal-500 hover:fill-teal-600 stroke-white cursor-pointer transition-colors"
                    strokeWidth={1}
                  >
                    <title>{`${name} — ${active.count} colleges · click to browse`}</title>
                  </path>
                </a>
              );
            }
            return (
              <path
                key={key}
                d={d}
                className="fill-slate-300/60 dark:fill-slate-700/60 stroke-white dark:stroke-slate-900"
                strokeWidth={1}
              >
                <title>{`${name} — coming soon`}</title>
              </path>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
