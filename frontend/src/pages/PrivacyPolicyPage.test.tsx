import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";

import { I18nProvider } from "../i18n/I18nProvider";
import PrivacyPolicyPage from "./PrivacyPolicyPage";

describe("PrivacyPolicyPage", () => {
  it("renders the privacy policy with key sections and a back-to-login link", () => {
    render(
      <MantineProvider>
        <I18nProvider>
          <MemoryRouter>
            <PrivacyPolicyPage />
          </MemoryRouter>
        </I18nProvider>
      </MantineProvider>
    );

    expect(screen.getByText(/privacy policy/i)).toBeInTheDocument();
    expect(screen.getByText(/what i collect/i)).toBeInTheDocument();
    expect(screen.getByText(/data retention and deletion/i)).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /back to login/i });
    expect(backLink).toHaveAttribute("href", "/login");
  });
});
