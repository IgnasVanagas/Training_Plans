import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { I18nProvider, useI18n } from "./I18nProvider";

const Consumer = () => {
  const { language, setLanguage, syncLanguagePreference } = useI18n();
  const [showExtraNode, setShowExtraNode] = useState(false);

  return (
    <div>
      <div data-testid="language-value">{language}</div>
      <p>Welcome back</p>
      <input aria-label="Sign in" placeholder="you@example.com" title="Sign in" />
      <button type="button" onClick={() => setLanguage("lt")}>set-lt</button>
      <button type="button" onClick={() => setLanguage("en")}>set-en</button>
      <button type="button" onClick={() => syncLanguagePreference("lt")}>sync-lt</button>
      <button type="button" onClick={() => syncLanguagePreference("de")}>sync-invalid</button>
      <button type="button" onClick={() => setShowExtraNode(true)}>show-extra</button>
      {showExtraNode ? <span>Dashboard</span> : null}
    </div>
  );
};

describe("I18nProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("translates existing DOM content and attributes when the language changes", async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: "set-lt" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("lang", "lt");
    });
    expect(screen.getByText("Sveiki sugrįžę")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("jusu@pavyzdys.lt")).toBeInTheDocument();
    expect(screen.getByLabelText("Prisijungti")).toBeInTheDocument();
    expect(window.localStorage.getItem("platform_language")).toBe("lt");

    await user.click(screen.getByRole("button", { name: "show-extra" }));

    await waitFor(() => {
      expect(screen.getByText("Skydelis")).toBeInTheDocument();
    });
  });

  it("applies supported language preferences and ignores invalid ones", async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>
    );

    await user.click(screen.getByRole("button", { name: "sync-invalid" }));
    expect(screen.getByTestId("language-value")).toHaveTextContent("en");
    expect(window.localStorage.getItem("platform_language")).toBeNull();

    await user.click(screen.getByRole("button", { name: "sync-lt" }));

    await waitFor(() => {
      expect(screen.getByTestId("language-value")).toHaveTextContent("lt");
    });
    expect(window.localStorage.getItem("platform_language")).toBe("lt");

    await user.click(screen.getByRole("button", { name: "set-en" }));

    await waitFor(() => {
      expect(screen.getByTestId("language-value")).toHaveTextContent("en");
    });
    expect(window.localStorage.getItem("platform_language")).toBe("en");
  });
});