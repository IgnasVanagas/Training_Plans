import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import InviteHeader from "../../../src/components/invite/InviteHeader";

describe("InviteHeader", () => {
  it("renders the title and description", () => {
    render(
      <MantineProvider>
        <InviteHeader title="Welcome" description="Join your team" />
      </MantineProvider>
    );

    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Join your team")).toBeInTheDocument();
  });
});
