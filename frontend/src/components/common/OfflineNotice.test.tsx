import { act, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import { I18nProvider } from "../../i18n/I18nProvider";
import OfflineNotice from "./OfflineNotice";

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
};

const renderNotice = () =>
  render(
    <MantineProvider>
      <I18nProvider>
        <OfflineNotice />
      </I18nProvider>
    </MantineProvider>
  );

describe("OfflineNotice", () => {
  afterEach(() => {
    setOnline(true);
  });

  it("renders nothing while online", () => {
    setOnline(true);
    renderNotice();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it("shows the offline alert when navigator goes offline", () => {
    setOnline(true);
    renderNotice();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByText(/offline/i)).toBeInTheDocument();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it("renders immediately when navigator starts offline", () => {
    setOnline(false);
    renderNotice();
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });
});
