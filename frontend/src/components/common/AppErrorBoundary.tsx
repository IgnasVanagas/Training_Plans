import React from "react";
import { Alert, Button, Center, Stack, Text, Title } from "@mantine/core";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
};

export default class AppErrorBoundary extends React.Component<Props, State> {
  public constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(): void {}

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <Center h="100vh" p="md">
          <Stack align="center" maw={460}>
            <Title order={3} ta="center">Something went wrong</Title>
            <Alert color="red" variant="light" title="App error">
              <Text size="sm">The page crashed unexpectedly. Please reload.</Text>
            </Alert>
            <Button onClick={this.handleReload}>Reload app</Button>
          </Stack>
        </Center>
      );
    }

    return this.props.children;
  }
}
