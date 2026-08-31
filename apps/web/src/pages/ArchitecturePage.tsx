// Copyright (c) 2026 Sub Rosa contributors
import architectureMd from "../../../../ARCHITECTURE.md?raw";
import { LOGO_SRC } from "../lib/chain";

export function ArchitecturePage({ goHome }: { goHome: () => void }) {
  return (
    <main className="architecture-page">
      <nav className="architecture-nav">
        <button type="button" className="brand-link" onClick={goHome}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="architecture-nav-actions">
          <button type="button" className="secondary-action compact" onClick={goHome}>
            Back to demo
          </button>
        </div>
      </nav>

      <article className="architecture-doc" aria-label="Sub Rosa architecture">
        <pre>{architectureMd}</pre>
      </article>
    </main>
  );
}
