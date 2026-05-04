import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "../../../src/i18n/I18nProvider";
import AppErrorBoundary from "../../../src/components/common/AppErrorBoundary";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Providers = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <MantineProvider>
      <I18nProvider>{children}</I18nProvider>
    </MantineProvider>
  </QueryClientProvider>
);

const Boom = () => {
  throw new Error("kaboom");
};

describe("AppErrorBoundary", () => {
  const originalError = console.error;

  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalError;
  });

  it("renders children when there is no error", () => {
    render(
      <Providers>
        <AppErrorBoundary>
          <div>safe child</div>
        </AppErrorBoundary>
      </Providers>
    );

    expect(screen.getByText("safe child")).toBeInTheDocument();
  });

  it("shows the error fallback when a child throws", () => {
    render(
      <Providers>
        <AppErrorBoundary>
          <Boom />
        </AppErrorBoundary>
      </Providers>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload app/i })).toBeInTheDocument();
  });
});
