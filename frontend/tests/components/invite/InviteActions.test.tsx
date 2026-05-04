import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";

import InviteActions from "../../../src/components/invite/InviteActions";

describe("InviteActions", () => {
  it("invokes accept and back-to-login handlers", async () => {
    const onAccept = vi.fn();
    const onBackToLogin = vi.fn();
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <InviteActions onAccept={onAccept} accepting={false} onBackToLogin={onBackToLogin} />
      </MantineProvider>
    );

    await user.click(screen.getByRole("button", { name: /accept invitation/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /back to login/i }));
    expect(onBackToLogin).toHaveBeenCalledTimes(1);
  });

  it("shows loading state while accepting", () => {
    render(
      <MantineProvider>
        <InviteActions onAccept={vi.fn()} accepting onBackToLogin={vi.fn()} />
      </MantineProvider>
    );
    const acceptBtn = screen.getByRole("button", { name: /accept invitation/i });
    // Mantine sets data-loading on Button when loading
    expect(acceptBtn).toHaveAttribute("data-loading", "true");
  });
});
