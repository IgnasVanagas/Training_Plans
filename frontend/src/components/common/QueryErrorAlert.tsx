import { Alert, Button, Group } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { extractApiErrorMessage } from "../../pages/dashboard/utils";

interface QueryErrorAlertProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function QueryErrorAlert({ error, onRetry, title = "Failed to load data" }: QueryErrorAlertProps) {
  return (
    <Alert
      icon={<IconAlertCircle size={16} />}
      color="red"
      variant="light"
      title={title}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <span>{extractApiErrorMessage(error)}</span>
        {onRetry && (
          <Button size="xs" variant="light" color="red" onClick={onRetry} flex="0 0 auto">
            Retry
          </Button>
        )}
      </Group>
    </Alert>
  );
}
