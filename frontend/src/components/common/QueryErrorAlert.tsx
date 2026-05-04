import { Alert, Button, Group, Text } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useI18n } from "../../i18n/I18nProvider";

interface QueryErrorAlertProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function QueryErrorAlert({ error, onRetry, title = "Failed to load data" }: QueryErrorAlertProps) {
  const { t } = useI18n();

  return (
    <Alert
      icon={<IconAlertCircle size={16} />}
      color="red"
      variant="light"
      title={title}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="sm">{t("The server may be temporarily unavailable. Please try again.")}</Text>
        {onRetry && (
          <Button size="xs" variant="light" color="red" onClick={onRetry} flex="0 0 auto">
            {t("Retry")}
          </Button>
        )}
      </Group>
    </Alert>
  );
}
