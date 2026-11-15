import type { Metadata } from "next";
import { Guide } from "@/components/Guide";
import { PublicFooter, PublicNav } from "@/components/PublicShell";

export const metadata: Metadata = { title: "User guide" };

export default function PublicGuide() {
  return (
    <>
      <PublicNav />
      <main className="mx-auto max-w-[1280px] px-4 pt-10 pb-16 sm:px-6 lg:px-8">
        <p className="eyebrow">User guide</p>
        <h1 className="font-display mt-2 max-w-3xl text-[40px] leading-[1.08] font-medium sm:text-[56px]">How to charge, run a site, and read every number.</h1>
        <div className="mt-12"><Guide /></div>
      </main>
      <PublicFooter />
    </>
  );
}
