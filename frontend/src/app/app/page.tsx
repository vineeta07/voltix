"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/auth";

export default function AppHome() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.data) router.replace(me.data.role === "user" ? "/app/charge" : "/app/live");
  }, [me.data, router]);
  return null;
}
