"use client";

import { ReactNode, useEffect, useState } from "react";

/** Avoid SSR/client DOM mismatches from browser extensions (e.g. Dark Reader). */
export function ClientOnly({
  children,
  fallback = <div className="h-screen bg-black" />,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return fallback;
  return children;
}
