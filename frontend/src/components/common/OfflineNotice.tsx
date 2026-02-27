import { Alert } from "@mantine/core";
import { IconWifiOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";

const OfflineNotice = () => {
  const [offline, setOffline] = useState(!navigator.onLine);
  const { t } = useI18n();

  useEffect(() => {
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <Alert color="orange" variant="light" icon={<IconWifiOff size={16} />}>
      {t("You are offline. Last synced data is shown; new actions will continue when connection returns.")}
    </Alert>
  );
};

export default OfflineNotice;
