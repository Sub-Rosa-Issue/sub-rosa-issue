// Copyright (c) 2026 Sub Rosa contributors
import { useEffect, useState } from "react";
import { getUseCase } from "./config/useCases";
import type { UseCaseId } from "./config/useCases";
import { hashFor, routeFromHash, type RouteState } from "./config/routing";
import { ArchitecturePage } from "./pages/ArchitecturePage";
import { ConfigBanner } from "./components/ConfigBanner";
import { SkipLink } from "./components/SkipLink";
import { gateDemoActions } from "./lib/config";
import { PUBLIC_ENV, SDK_CLIENT_IDENTITY } from "./lib/chain";
import { DashboardPage } from "./pages/DashboardPage";
import { DemoPage } from "./pages/DemoPage";
import { LandingPage } from "./pages/LandingPage";
import { ToastProvider } from "./ui/Toast";
import { TimeProvider } from "./lib/time";

export default function App() {
  const [route, setRoute] = useState<RouteState>(routeFromHash);

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#main-content") {
        return;
      }
      setRoute(routeFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(page: RouteState["page"], useCase: UseCaseId = route.useCase) {
    window.location.hash = hashFor(page, useCase);
    setRoute({ page, useCase });
  }

  const active = getUseCase(route.useCase);

  return (
    <TimeProvider>
      <ToastProvider>
      <SkipLink />
      {route.page === "landing" ? (
        <LandingPage
          onDemo={() => navigate("demo", "auction")}
          onCase={(id) => navigate("demo", id)}
        />
      ) : route.page === "dashboard" ? (
        <DashboardPage goHome={() => navigate("landing")} />
      ) : (
        <>
          <ConfigBanner gate={gateDemoActions(SDK_CLIENT_IDENTITY, PUBLIC_ENV)} />
          {route.page === "architecture" ? (
            <ArchitecturePage goHome={() => navigate("landing")} />
          ) : (
            <DemoPage
              active={active}
              setActive={(id) => navigate("demo", id)}
              goHome={() => navigate("landing")}
            />
          )}
        </>
      )}
      </ToastProvider>
    </TimeProvider>
  );
}
