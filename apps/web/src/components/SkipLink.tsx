// Copyright (c) 2026 Sub Rosa contributors
import type { MouseEvent } from "react";

export interface FocusableLandmark {
  focus(): void;
  scrollIntoView?(options?: ScrollIntoViewOptions): void;
}

export interface LandmarkDocument {
  getElementById(id: string): FocusableLandmark | null;
}

export function skipToMainContent(
  event: Pick<MouseEvent<HTMLAnchorElement>, "preventDefault">,
  doc: LandmarkDocument | undefined = typeof document !== "undefined" ? document : undefined,
): boolean {
  event.preventDefault();
  const main = doc?.getElementById("main-content") ?? null;
  if (!main) {
    return false;
  }
  main.focus();
  if (typeof main.scrollIntoView === "function") {
    main.scrollIntoView({ block: "start" });
  }
  return true;
}

export function SkipLink({
  targetId = "main-content",
  label = "Skip to main content",
}: {
  targetId?: string;
  label?: string;
}) {
  return (
    <a
      href={`#${targetId}`}
      className="skip-link"
      onClick={(event) => {
        skipToMainContent(event);
      }}
    >
      {label}
    </a>
  );
}
