import type { ComponentPropsWithoutRef } from "react";

/**
 * Use document navigation until vinext's production RSC prefetch/client
 * navigation bundle is stable. This keeps every internal link functional
 * without loading the broken next/link runtime.
 */
export default function AppLink({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a {...props}>{children}</a>;
}
