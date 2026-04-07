import React from "react";
import { Alert, Button, Center, Stack, Text, Title } from "@mantine/core";

import { useI18n } from "../../i18n/I18nProvider";
import SupportContactButton from "./SupportContactButton";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
};

const ErrorFallback = ({ onReload }: { onReload: () => void }) => {
  const { t } = useI18n();

  return (
    <Center h="100vh" p="md">
      <Stack align="center" maw={460}>
        <Title order={3} ta="center">{t("Something went wrong")}</Title>
        <Alert color="red" variant="light" title={t("App error")}>
          <Text size="sm">{t("The page crashed unexpectedly. Please reload.")}</Text>
        </Alert>
        <SupportContactButton
          buttonText={t("Contact support")}
          pageLabel="App error boundary"
          errorMessage={t("The page crashed unexpectedly. Please reload.")}
        />
        <Button onClick={onReload}>{t("Reload app")}</Button>
      </Stack>
    </Center>
  );
};

export default class AppErrorBoundary extends React.Component<Props, State> {
  public constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return <ErrorFallback onReload={this.handleReload} />;
    }

    return this.props.children;
  }
}
