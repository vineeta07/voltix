"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Reveal } from "@/components/ui";

type Photo = { src: string; alt: string; caption?: string; credit?: string };
type Manifest = { heading?: string; note?: string; photos: Photo[] };

/** Photo band on the landing page, driven by public/photos/manifest.json.
 *  Renders nothing when the manifest lists no photos. */
export function PilotPhotos() {
  const q = useQuery({
    queryKey: ["photos"], staleTime: Infinity, retry: false,
    queryFn: async (): Promise<Manifest> => {
      const r = await fetch("/photos/manifest.json");
      if (!r.ok) return { photos: [] };
      const j = await r.json();
      return Array.isArray(j) ? { photos: j } : j;
    },
  });
  const photos = (q.data?.photos ?? []).slice(0, 5);
  if (!photos.length) return null;
  // first two share a tall row (wide + portrait); the rest sit three across
  const span = (i: number) => (photos.length < 5 ? "md:col-span-2" : i === 0 ? "md:col-span-4" : "md:col-span-2");
  const box = (i: number) => (photos.length === 5 && i < 2 ? "aspect-[4/3] md:aspect-auto md:h-[440px]" : "aspect-[4/3]");
  return (
    <section className="mx-auto max-w-[1280px] px-4 pt-16 sm:px-6 lg:px-8 lg:pt-24" aria-label={q.data?.heading ?? "Photos"}>
      <Reveal><p className="eyebrow">{q.data?.heading ?? "From the pilot at DTU"}</p></Reveal>
      <div className="mt-5 grid gap-3 sm:gap-4 md:grid-cols-6">
        {photos.map((p, i) => (
          <Reveal key={p.src} delay={(i % 3) * 0.07} className={span(i)}>
            <figure className="group relative overflow-hidden rounded-xl border border-line bg-sunk">
              <div className={clsx("overflow-hidden", box(i))}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.alt} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
              </div>
              {p.caption && (
                <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-[#0F2A3A]/80 px-4 py-2.5 text-sm text-[#EEF3F2]">
                  <span>{p.caption}</span>{p.credit && <span className="shrink-0 text-xs opacity-70">Photo: {p.credit}</span>}
                </figcaption>
              )}
            </figure>
          </Reveal>
        ))}
      </div>
      {q.data?.note && <p className="mt-3 text-xs text-muted">{q.data.note}</p>}
    </section>
  );
}
