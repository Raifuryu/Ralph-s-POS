"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      theme?: "auto" | "light" | "dark";
    }
  ) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Renders the Cloudflare Turnstile widget. The widget injects its own hidden
 * `cf-turnstile-response` input into the container, so it is picked up by the
 * surrounding form automatically — no token state needed on our side.
 *
 * `resetSignal` should be a value whose identity changes on every sign-in
 * attempt (the action state object works). Turnstile tokens are single-use, so
 * without a reset a retry would submit a spent token.
 */
export default function Turnstile({ resetSignal }: { resetSignal: unknown }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  function render() {
    if (!siteKey || !containerRef.current || widgetIdRef.current) return;
    if (!window.turnstile) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
    });
  }

  useEffect(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={render}
      />
      <div ref={containerRef} />
    </>
  );
}
