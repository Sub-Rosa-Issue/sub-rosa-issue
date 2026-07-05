import type { UseCaseId } from "./useCases";
import { USE_CASES } from "./useCases";

export type Page = "landing" | "demo" | "architecture" | "dashboard";

export interface RouteState {
  page: Page;
  useCase: UseCaseId;
}

export function routeFromHash(): RouteState {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash || hash === "landing") {
    return { page: "landing", useCase: "grants" };
  }

  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "architecture") {
    return { page: "architecture", useCase: "grants" };
  }
  if (parts[0] === "dashboard") {
    return { page: "dashboard", useCase: "grants" };
  }
  if (parts[0] === "demo" || parts[0] === "app") {
    const maybeCase = parts[1];
    const useCase = USE_CASES.some((item) => item.id === maybeCase)
      ? (maybeCase as UseCaseId)
      : "grants";
    return { page: "demo", useCase };
  }

  return { page: "landing", useCase: "grants" };
}

export function hashFor(page: Page, useCase: UseCaseId = "grants"): string {
  if (page === "landing") return "#/landing";
  if (page === "architecture") return "#/architecture";
  if (page === "dashboard") return "#/dashboard";
  return `#/demo/${useCase}`;
}
