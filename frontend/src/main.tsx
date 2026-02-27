import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import AppErrorBoundary from "./components/common/AppErrorBoundary";
import faviconOrigami from "../uploads/favicon_Origami.png";
import faviconOrigamiRemoveBg from "../uploads/favicon_Origami-removebg-preview.png";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});
const theme = createTheme({
  primaryColor: "cyan",
  fontFamily: "Inter, sans-serif",
  headings: {
    fontFamily: "Inter, sans-serif",
    fontWeight: "700"
  },
  colors: {
    cyan: [
      "#e3fbff",
      "#c4f3ff",
      "#94e8ff",
      "#5fdbff",
      "#2ed0ff",
      "#00c3f5",
      "#00a9d6",
      "#008ab0",
      "#006f8d",
      "#004f66"
    ],
    dark: [
      "#f5f7fa",
      "#d9dfeb",
      "#b7c2d5",
      "#9aa7bf",
      "#7f8ea8",
      "#61708b",
      "#46546f",
      "#2f3a50",
      "#1c2535",
      "#0b0f14"
    ]
  },
  components: {
    AppShell: {
      defaultProps: {
        bg: 'var(--mantine-color-body)'
      }
    },
    Paper: {
      defaultProps: {
        radius: "md"
      }
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="bottom-right" />
        <QueryClientProvider client={queryClient}>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </QueryClientProvider>
      </MantineProvider>
    </I18nProvider>
  </React.StrictMode>
);

const faviconLink = document.querySelector("link[rel='icon']") || document.createElement("link");
faviconLink.setAttribute("rel", "icon");
faviconLink.setAttribute("type", "image/png");
faviconLink.setAttribute("href", faviconOrigami);
if (!faviconLink.parentElement) {
  document.head.appendChild(faviconLink);
}

const shortcutIconLink =
  document.querySelector("link[rel='shortcut icon']") || document.createElement("link");
shortcutIconLink.setAttribute("rel", "shortcut icon");
shortcutIconLink.setAttribute("type", "image/png");
shortcutIconLink.setAttribute("href", faviconOrigamiRemoveBg);
if (!shortcutIconLink.parentElement) {
  document.head.appendChild(shortcutIconLink);
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
