import { useEffect, useState } from "react";
import { getUseCase } from "./config/useCases";
import type { UseCaseId } from "./config/useCases";
import { hashFor, routeFromHash, type RouteState } from "./config/routing";
import { ArchitecturePage } from "./pages/ArchitecturePage";
import { ConfigBanner } from "./components/ConfigBanner";
import { DashboardPage } from "./pages/DashboardPage";
import { DemoPage } from "./pages/DemoPage";
import { LandingPage } from "./pages/LandingPage";
import { ToastProvider } from "./ui/Toast";

export default function App() {
  const [route, setRoute] = useState<RouteState>(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(page: RouteState["page"], useCase: UseCaseId = route.useCase) {
    window.location.hash = hashFor(page, useCase);
    setRoute({ page, useCase });
  }

  const active = getUseCase(route.useCase);

  return (
    <ToastProvider>
      {route.page === "landing" ? (
        <LandingPage
          onDemo={() => navigate("demo", "grants")}
          onCase={(id) => navigate("demo", id)}
        />
      ) : route.page === "dashboard" ? (
        <DashboardPage goHome={() => navigate("landing")} />
      ) : (
        <>
          <ConfigBanner />
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
  );
}
