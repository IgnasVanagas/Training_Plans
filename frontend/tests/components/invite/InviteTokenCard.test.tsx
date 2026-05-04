import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import InviteTokenCard from "../../../src/components/invite/InviteTokenCard";

describe("InviteTokenCard", () => {
  it("renders the token value", () => {
    render(
      <MantineProvider>
        <InviteTokenCard token="ABC123" />
      </MantineProvider>
    );

    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.getByText(/token/i)).toBeInTheDocument();
  });

  it("renders without a token without crashing", () => {
    render(
      <MantineProvider>
        <InviteTokenCard />
      </MantineProvider>
    );
    expect(screen.getByText(/token/i)).toBeInTheDocument();
  });
});
