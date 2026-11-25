import { createContext, useContext, type ReactNode } from "react";
import {
  systemTime,
  type PartialTimeContext,
  type TimeContext as TimeContextValue,
  resolveTimeContext,
} from "@sub-rosa/time";

export { systemTime };

const TimeReactContext = createContext<TimeContextValue>(systemTime);

export function TimeProvider({
  value,
  children,
}: {
  value?: PartialTimeContext;
  children: ReactNode;
}) {
  const resolved = value ? resolveTimeContext(systemTime, value) : systemTime;
  return (
    <TimeReactContext.Provider value={resolved}>{children}</TimeReactContext.Provider>
  );
}

export function useTime(): TimeContextValue {
  return useContext(TimeReactContext);
}
