// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { SkipLink, skipToMainContent } from "./components/SkipLink";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

function readWebSource(relPath: string): string {
  return readFileSync(resolve(SRC_DIR, relPath), "utf8");
}

test("SkipLink renders an anchor targeting #main-content with class skip-link", () => {
  const html = renderToStaticMarkup(<SkipLink />);

  assert.equal(html, '<a href="#main-content" class="skip-link">Skip to main content</a>');
});

test("skipToMainContent prevents default navigation and moves focus/scroll to #main-content", () => {
  let defaultPrevented = false;
  let focused = false;
  let scrollOptions: ScrollIntoViewOptions | undefined;

  const moved = skipToMainContent(
    {
      preventDefault() {
        defaultPrevented = true;
      },
    },
    {
      getElementById(id: string) {
        if (id !== "main-content") return null;
        return {
          focus() {
            focused = true;
          },
          scrollIntoView(options?: ScrollIntoViewOptions) {
            scrollOptions = options;
          },
        };
      },
    },
  );

  assert.equal(moved, true);
  assert.equal(defaultPrevented, true);
  assert.equal(focused, true);
  assert.deepEqual(scrollOptions, { block: "start" });
});

test("skipToMainContent returns false safely when #main-content is absent", () => {
  let defaultPrevented = false;
  const moved = skipToMainContent(
    {
      preventDefault() {
        defaultPrevented = true;
      },
    },
    {
      getElementById() {
        return null;
      },
    },
  );

  assert.equal(moved, false);
  assert.equal(defaultPrevented, true);
});

test("App shell renders SkipLink first inside the shell and guards hash routing", () => {
  const appSource = readWebSource("App.tsx");

  assert.match(appSource, /<ToastProvider>\s*<SkipLink\s*\/>/);
  assert.match(
    appSource,
    /window\.location\.hash === "#main-content"/,
    "App.tsx must ignore #main-content in the hash router listener",
  );
});

test("every page component exposes exactly one unambiguous main#main-content landmark after navigation", () => {
  const pages: Array<{ file: string; navPattern: RegExp; outerClass: string }> = [
    { file: "pages/LandingPage.tsx", navPattern: /<motion\.nav\b/, outerClass: "landing-page" },
    { file: "pages/DashboardPage.tsx", navPattern: /<motion\.nav\b/, outerClass: "dashboard-page" },
    { file: "pages/ArchitecturePage.tsx", navPattern: /<nav\b/, outerClass: "architecture-page" },
    { file: "pages/DemoPage.tsx", navPattern: /<aside\s+className="case-nav">/, outerClass: "app-page" },
  ];

  for (const { file, navPattern, outerClass } of pages) {
    const source = readWebSource(file);
    const openMains = source.match(/<main\b/g) ?? [];
    const closeMains = source.match(/<\/main>/g) ?? [];
    assert.equal(openMains.length, 1, `${file} must have exactly one opening <main> tag`);
    assert.equal(closeMains.length, 1, `${file} must have exactly one closing </main> tag`);
    assert.match(
      source,
      new RegExp(`<div className="${outerClass}">`),
      `${file} outer wrapper must be a <div> rather than a duplicate <main>`,
    );
    assert.match(
      source,
      /<main\s+id="main-content"[^>]*tabIndex=\{-1\}>/,
      `${file} must expose <main id="main-content" tabIndex={-1}>`,
    );

    const navMatch = navPattern.exec(source);
    const mainIndex = source.indexOf('<main id="main-content"');
    assert.ok(navMatch && mainIndex > navMatch.index, `${file} must place navigation before <main>`);
  }
});

test("base.css hides .skip-link until keyboard focus and reveals it on :focus/:focus-visible", () => {
  const css = readWebSource("styles/base.css");

  assert.match(css, /\.skip-link\s*\{[\s\S]*?transform:\s*translateY\(-200%\)/);
  assert.match(css, /\.skip-link:focus,\s*\.skip-link:focus-visible\s*\{[\s\S]*?transform:\s*translateY\(0\)/);
  assert.match(css, /\.skip-link:focus,\s*\.skip-link:focus-visible\s*\{[\s\S]*?opacity:\s*1/);
});
