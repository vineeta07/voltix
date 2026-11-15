"use client";

import { useQuery } from "@tanstack/react-query";
import { Reveal } from "@/components/ui";

type Photo = { src: string; alt: string; caption?: string; credit?: string };

/** Real photos from the pilot. Renders nothing until public/photos/manifest.json lists some. */
export function PilotPhotos() {
  const q = useQuery({
    queryKey: ["photos"], staleTime: Infinity, retry: false,
    queryFn: async () => { const r = await fetch("/photos/manifest.json"); return r.ok ? ((await r.json()) as Photo[]) : []; },
  });
  const photos = (q.data ?? []).slice(0, 3);
  if (!photos.length) return null;
  return (
    <section className="mx-auto max-w-[1280px] px-4 pt-16 sm:px-6 lg:px-8 lg:pt-24" aria-label="From the pilot">
      <Reveal><p className="eyebrow">From the pilot at DTU</p></Reveal>
      <div className={`mt-5 grid gap-4 ${photos.length > 1 ? "md:grid-cols-3" : ""}`}>
        {photos.map((p, i) => (
          <Reveal key={p.src} delay={i * 0.08} className={i === 0 && photos.length === 3 ? "md:col-span-2 md:row-span-2" : ""}>
            <figure className="group h-full overflow-hidden rounded-xl border border-line bg-panel">
              <div className={`overflow-hidden ${i === 0 ? "aspect-[4/3] md:h-full md:min-h-[420px]" : "aspect-[4/3]"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.alt} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
              </div>
              {(p.caption || p.credit) && <figcaption className="flex justify-between gap-3 px-4 py-3 text-sm"><span>{p.caption}</span>{p.credit && <span className="text-xs text-muted">Photo: {p.credit}</span>}</figcaption>}
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
