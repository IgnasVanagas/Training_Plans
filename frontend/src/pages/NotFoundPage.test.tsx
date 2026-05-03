import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import NotFoundPage from "./NotFoundPage";

describe("NotFoundPage", () => {
  it("renders the 404 message and navigates to the dashboard on click", async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/missing"]}>
          <Routes>
            <Route path="/missing" element={<NotFoundPage />} />
            <Route path="/dashboard" element={<div>Dashboard route</div>} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    );

    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /go to dashboard/i }));
    expect(screen.getByText("Dashboard route")).toBeInTheDocument();
  });
});
