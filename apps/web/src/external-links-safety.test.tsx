// Copyright (c) 2026 Sub Rosa contributors
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { ExternalLink, SAFE_EXTERNAL_REL } from "./components/ExternalLink";
import { MainnetProofCard } from "./components/MainnetProofCard";

function collectAnchors(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map((m) => m[1]);
}
function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}
function assertSafeBlankTargets(html: string, label: string) {
  const anchors = collectAnchors(html);
  const blanks = anchors.filter((a) => attr(a, "target") === "_blank");
  assert.ok(blanks.length > 0, `${label} should render at least one external target="_blank" link`);
  for (const a of blanks) {
    const rel = (attr(a, "rel") ?? "").split(/\s+/).filter(Boolean);
    assert.ok(rel.includes("noopener"), `${label} target="_blank" link missing noopener: ${a}`);
    assert.ok(rel.includes("noreferrer"), `${label} target="_blank" link missing noreferrer: ${a}`);
  }
}

test("ExternalLink centralizes safe target and rel", () => {
  const html = renderToStaticMarkup(<ExternalLink href="https://example.com">Example</ExternalLink>);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, />Example<\/a>/);
  assert.equal(SAFE_EXTERNAL_REL, "noopener noreferrer");
});

test("representative components render safe external explorer/evidence links", () => {
  const proof = renderToStaticMarkup(<MainnetProofCard />);
  assertSafeBlankTargets(proof, "MainnetProofCard");
  assert.match(
    proof,
    /href="https:\/\/stellar\.expert\/explorer\/public\/contract\/CA7KSDEYJEPGZEB2ZROTLUWKQQ6GIRIQNGG6Z745MZ34QHP4UJPWODEX"/,
  );
  assert.match(proof, />stellar\.expert contract<\/a>/);
});

test("representative pages/components use ExternalLink with no raw target=_blank", () => {
  const srcDir = dirname(fileURLToPath(import.meta.url));
  const files = [
    "components/MainnetProofCard.tsx",
    "components/PasskeyPanel.tsx",
    "pages/LandingPage.tsx",
  ];
  for (const rel of files) {
    const source = readFileSync(resolve(srcDir, rel), "utf8");
    assert.doesNotMatch(source, /target=["']_blank["']/, `${rel} should not contain raw target="_blank"`);
    assert.match(source, /ExternalLink/, `${rel} should use ExternalLink`);
  }
  const landing = readFileSync(resolve(srcDir, "pages/LandingPage.tsx"), "utf8");
  assert.match(landing, /href="https:\/\/github\.com\/Sub-Rosa-Issue\/sub-rosa-issue"/);
  assert.match(landing, />\s*GitHub\s*<\/ExternalLink>/);
  const passkey = readFileSync(resolve(srcDir, "components/PasskeyPanel.tsx"), "utf8");
  assert.match(passkey, /<ExternalLink href=\{l\.href\}>\{l\.label\}<\/ExternalLink>/);
});
