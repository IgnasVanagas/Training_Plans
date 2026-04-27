import { Anchor, Box, Container, List, Paper, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";

const PrivacyPolicyPage = () => {
  const { t } = useI18n();

  return (
    <Box
      style={{
        minHeight: "100vh",
        width: "100%",
        backgroundColor: "var(--mantine-color-body)",
        padding: "2rem 0",
      }}
    >
      <Container size="md">
        <Paper withBorder radius="md" p="xl">
          <Stack gap="md">
            <Title order={2}>{t("Privacy Policy")}</Title>
            <Text size="sm" c="dimmed">
              {t("Effective date: April 27, 2026")}
            </Text>
            <Text>
              {t("Training Plans is a personal endurance coaching app for athletes and coaches. This policy explains how I collect, use, store, and delete personal data, including Strava data when you connect your account.")}
            </Text>

            <Title order={4}>{t("What I collect")}</Title>
            <List spacing="xs" size="sm">
              <List.Item>{t("Account information such as name, email, role, and profile details.")}</List.Item>
              <List.Item>{t("Training and activity data you upload or sync from connected providers such as Strava.")}</List.Item>
              <List.Item>{t("App usage and settings data needed to operate core features.")}</List.Item>
            </List>

            <Title order={4}>{t("How data is used")}</Title>
            <List spacing="xs" size="sm">
              <List.Item>{t("To show your own training calendar, analysis, and coaching insights.")}</List.Item>
              <List.Item>{t("To support coach-athlete workflows when you explicitly consent to sharing within an organization.")}</List.Item>
              <List.Item>{t("To operate security, reliability, and support functions for your account.")}</List.Item>
            </List>

            <Title order={4}>{t("Coach access and consent")}</Title>
            <Text>
              {t("Your Strava-derived and training data is private to you by default. When you join an organization as an athlete, you must explicitly confirm sharing with coaches in that organization before access is granted.")}
            </Text>

            <Title order={4}>{t("Data retention and deletion")}</Title>
            <Text>
              {t("You can revoke integrations, leave organizations, or request deletion of your data. On valid deletion or access revocation requests, related data is removed according to applicable requirements.")}
            </Text>

            <Title order={4}>{t("Security")}</Title>
            <Text>
              {t("I use encrypted transport (HTTPS) and appropriate access controls to protect personal data.")}
            </Text>

            <Title order={4}>{t("Contact")}</Title>
            <Text>
              {t("For privacy questions or deletion requests, contact me using the in-app support option.")}
            </Text>

            <Anchor component={Link} to="/login">
              {t("Back to login")}
            </Anchor>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
};

export default PrivacyPolicyPage;
