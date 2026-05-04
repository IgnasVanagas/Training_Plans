import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../src/i18n/I18nProvider";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({
  children,
  initialEntries = ["/"],
  client,
}: {
  children: React.ReactNode;
  initialEntries?: string[];
  client?: QueryClient;
}) {
  const qc = client ?? makeQueryClient();
  return (
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>
  );
}

export function renderApp(
  ui: React.ReactElement,
  opts: { initialEntries?: string[]; client?: QueryClient } & Omit<RenderOptions, "wrapper"> = {},
) {
  const { initialEntries, client, ...rest } = opts;
  return render(
    <AppProviders initialEntries={initialEntries} client={client}>
      {ui}
    </AppProviders>,
    rest,
  );
}
