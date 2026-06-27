import { render, screen } from "@testing-library/react";
import { KeeperDashboard } from "./KeeperDashboard";

describe("KeeperDashboard", () => {
  it("shows loading state initially", () => {
    render(<KeeperDashboard />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });
});
