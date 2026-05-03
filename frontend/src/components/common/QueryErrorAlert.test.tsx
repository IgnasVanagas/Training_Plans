import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";

import { QueryErrorAlert } from "./QueryErrorAlert";

const renderAlert = (props: React.ComponentProps<typeof QueryErrorAlert>) =>
  render(
    <MantineProvider>
      <QueryErrorAlert {...props} />
    </MantineProvider>
  );

describe("QueryErrorAlert", () => {
  it("renders the default title and extracted error message", () => {
    renderAlert({ error: new Error("Boom!") });

    expect(screen.getByText("Failed to load data")).toBeInTheDocument();
    expect(screen.getByText("Boom!")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders a retry button and triggers the callback", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    renderAlert({ error: { response: { data: { detail: "Service down" } } }, onRetry, title: "Custom title" });

    expect(screen.getByText("Custom title")).toBeInTheDocument();
    expect(screen.getByText("Service down")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
