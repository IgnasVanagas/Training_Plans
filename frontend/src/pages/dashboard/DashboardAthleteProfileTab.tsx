import { useState, useEffect } from "react";
import {
  ActionIcon,
  Avatar,
  Box,
  Button,
  Checkbox,
  Divider,
  FileInput,
  Group,
  NumberInput,
  Paper,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { DateInput } from "@mantine/dates";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconPhoto, IconUpload } from "@tabler/icons-react";
import { uploadProfilePicture, resolveUserPictureUrl } from "../../api/organizations";
import { useI18n } from "../../i18n/I18nProvider";
import type { Profile, User } from "./types";

const SPORTS_OPTIONS = [
  { value: "running", label: "Running", color: "#dcfce7" },
  { value: "cycling", label: "Cycling", color: "#fae8ff" },
  { value: "swimming", label: "Swimming", color: "#dbeafe" },
  { value: "triathlon", label: "Triathlon", color: "#f3f4f6" },
];

const DAYS_OF_WEEK = [
  { value: "monday", color: "#fef3c7" },
  { value: "tuesday", color: "#dcfce7" },
  { value: "wednesday", color: "#dbeafe" },
  { value: "thursday", color: "#e0e7ff" },
  { value: "friday", color: "#fce7f3" },
  { value: "saturday", color: "#fef9c3" },
  { value: "sunday", color: "#f3e8ff" },
];

const GENDER_OPTIONS = ["Male", "Female", "Other"];

const getSupportedTimeZones = (): string[] => {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  return intlWithSupportedValues.supportedValuesOf?.("timeZone") ?? [Intl.DateTimeFormat().resolvedOptions().timeZone];
};

type Props = {
  user: User;
  onSubmit: (data: Profile) => void;
  isSaving: boolean;
};

const DashboardAthleteProfileTab = ({ user, onSubmit, isSaving }: Props) => {
  const isDark = useComputedColorScheme("light") === "dark";
  const { t } = useI18n();

  const capitalize = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  const initialProfile: Profile = user.profile
    ? {
        ...user.profile,
        birth_date: user.profile.birth_date ? new Date(user.profile.birth_date as string) : null,
        sports: user.profile.sports
          ? user.profile.sports
              .map((s) => s?.toLowerCase())
              .filter((sport): sport is string => typeof sport === "string" && sport.length > 0)
          : [],
        gender: capitalize(user.profile.gender) || null,
        training_days: user.profile.training_days || [],
      }
    : ({} as Profile);

  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [pictureFile, setPictureFile] = useState<File | null>(null);

  const uploadPictureMutation = useMutation({
    mutationFn: (file: File) => uploadProfilePicture(file),
    onSuccess: () => {
      notifications.show({ color: "green", title: t("Picture updated"), message: "" });
      setPictureFile(null);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => {
      notifications.show({ color: "red", title: t("Upload failed"), message: "" });
    },
  });

  useEffect(() => {
    setProfile(initialProfile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const handleChange = (field: keyof Profile, value: unknown) => {
    setProfile((p) => ({ ...p, [field]: value }));
  };

  const toggleSport = (sport: string) => {
    const current = profile.sports || [];
    const next = current.includes(sport)
      ? current.filter((s) => s !== sport)
      : [...current, sport];
    handleChange("sports", next);
  };

  const toggleDay = (day: string) => {
    const current = profile.training_days || [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day];
    handleChange("training_days", next);
  };

  const handleSave = () => {
    const payload: Profile = { ...profile };
    if (payload.sports && Array.isArray(payload.sports)) {
      payload.sports = payload.sports.map((s) => (typeof s === "string" ? s.toLowerCase() : s));
      if (payload.sports.length === 0) payload.sports = null;
    }
    if (payload.gender && typeof payload.gender === "string") {
      payload.gender = payload.gender.toLowerCase();
    }
    if (payload.first_name !== undefined || payload.last_name !== undefined) {
      // keep combined full name logic
    }
    onSubmit(payload);
  };

  const isFemale = profile.gender?.toLowerCase() === "female";

  const sportCheckboxBg = (color: string) =>
    isDark ? `${color}22` : color;

  const dayCheckboxBg = (color: string) =>
    isDark ? `${color}22` : color;

  const panelBg = isDark ? "var(--mantine-color-dark-6)" : "white";
  const fullName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();

  return (
    <Box maw={900} mx="auto" py="md">
      {/* Profile picture */}
      <Paper p="md" radius="md" withBorder bg={panelBg} mb="lg">
        <Group gap="md" align="center">
          <Avatar
            radius="xl"
            size={72}
            src={resolveUserPictureUrl(user.profile?.picture) || undefined}
            color="indigo"
          >
            {(user.profile?.first_name || user.email || "?").slice(0, 1).toUpperCase()}
          </Avatar>
          <Stack gap={4} style={{ flex: 1 }}>
            <Text fw={700} size="sm">{t("Profile picture")}</Text>
            <Group gap="xs" align="flex-end">
              <FileInput
                placeholder={t("Choose image")}
                value={pictureFile}
                onChange={setPictureFile}
                accept="image/png,image/jpeg,image/webp,image/gif"
                leftSection={<IconPhoto size={14} />}
                size="xs"
                style={{ flex: 1 }}
                clearable
              />
              <ActionIcon
                variant="light"
                color="indigo"
                loading={uploadPictureMutation.isPending}
                disabled={!pictureFile}
                onClick={() => { if (pictureFile) uploadPictureMutation.mutate(pictureFile); }}
              >
                <IconUpload size={16} />
              </ActionIcon>
            </Group>
          </Stack>
        </Group>
      </Paper>

      <Title order={2} mb="lg">{t("My Profile")}</Title>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
        {/* Left column */}
        <Stack gap="lg">
          {/* Personal details */}
          <Paper p="md" radius="md" withBorder bg={panelBg}>
            <Text fw={700} mb="sm">{t("Personal details")}</Text>
            <Stack gap="sm">
              <TextInput
                label={t("Full name") + " *"}
                value={fullName}
                onChange={(e) => {
                  const parts = e.currentTarget.value.split(" ");
                  handleChange("first_name", parts[0] || "");
                  handleChange("last_name", parts.slice(1).join(" ") || "");
                }}
              />
              <Select
                label={t("Gender") + " *"}
                data={GENDER_OPTIONS.map((g) => ({ value: g, label: t(g) }))}
                value={profile.gender ? capitalize(profile.gender) : null}
                onChange={(val) => handleChange("gender", val)}
                placeholder={t("Select gender")}
              />
              {isFemale && (
                <Checkbox
                  label={t("Menstruation available to coach")}
                  checked={!!profile.menstruation_available_to_coach}
                  onChange={(e) => handleChange("menstruation_available_to_coach", e.currentTarget.checked)}
                />
              )}
              <DateInput
                label={t("Date of birth") + " *"}
                value={profile.birth_date as Date}
                onChange={(val) => handleChange("birth_date", val)}
                clearable
              />
              <NumberInput
                label={t("Weight")}
                value={profile.weight ?? ""}
                onChange={(val) => handleChange("weight", val)}
                suffix=" kg"
                min={0}
                max={300}
              />
              <NumberInput
                label={t("Max HR")}
                value={profile.max_hr ?? ""}
                onChange={(val) => handleChange("max_hr", val)}
                suffix=" bpm"
                min={100}
                max={230}
              />
              <Select
                label={t("Country")}
                placeholder={t("Select country")}
                data={COUNTRY_LIST}
                value={profile.country || null}
                onChange={(val) => handleChange("country", val)}
                searchable
                clearable
              />
            </Stack>
          </Paper>

          {/* Contact details */}
          <Paper p="md" radius="md" withBorder bg={panelBg}>
            <Text fw={700} mb="sm">{t("Your contact details")}</Text>
            <Stack gap="sm">
              <TextInput
                label={t("Contact email")}
                value={profile.contact_email || user.email || ""}
                onChange={(e) => handleChange("contact_email", e.currentTarget.value)}
                styles={{ label: { fontStyle: "italic" } }}
              />
              <TextInput
                label={t("Contact number")}
                value={profile.contact_number || ""}
                onChange={(e) => handleChange("contact_number", e.currentTarget.value)}
              />
            </Stack>
          </Paper>

          {/* Account setup */}
          <Paper p="md" radius="md" withBorder bg={panelBg}>
            <Text fw={700} mb="sm">{t("Your account setup")}</Text>
            <Stack gap="sm">
              <div>
                <Text size="sm" fw={500} mb={4}>{t("Units")} *</Text>
                <Radio.Group
                  value={profile.preferred_units || "metric"}
                  onChange={(val) => handleChange("preferred_units", val)}
                >
                  <Group gap="lg">
                    <Radio
                      value="imperial"
                      label={
                        <span>
                          <Text component="span" fw={600} size="sm">{t("Imperial system")}</Text>
                          <br />
                          <Text component="span" size="xs" c="dimmed">({t("miles, lbs")})</Text>
                        </span>
                      }
                    />
                    <Radio
                      value="metric"
                      label={
                        <span>
                          <Text component="span" fw={600} size="sm">{t("Metric system")}</Text>
                          <br />
                          <Text component="span" size="xs" c="dimmed">({t("km, kg")})</Text>
                        </span>
                      }
                    />
                  </Group>
                </Radio.Group>
              </div>
              <Select
                label={t("Timezone")}
                placeholder={t("Select timezone")}
                data={getSupportedTimeZones()}
                value={profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                onChange={(val) => handleChange("timezone", val)}
                searchable
              />
            </Stack>
          </Paper>
        </Stack>

        {/* Right column */}
        <Stack gap="lg">
          <Paper p="md" radius="md" withBorder bg={panelBg}>
            <Text fw={700} size="lg" mb="xs">{t("Training")}</Text>

            {/* Sports */}
            <Text fw={600} mb={4}>{t("Sports")}</Text>
            <Text size="sm" c="dimmed" mb="sm">
              {t("What sport(s) do you participate in?")}
            </Text>
            <Stack gap={6}>
              {SPORTS_OPTIONS.map((sport) => {
                const checked = (profile.sports || []).includes(sport.value);
                return (
                  <Box
                    key={sport.value}
                    px="sm"
                    py={6}
                    style={{
                      borderRadius: 8,
                      background: checked ? sportCheckboxBg(sport.color) : "transparent",
                      transition: "background 150ms ease",
                    }}
                  >
                    <Checkbox
                      label={
                        <Text fw={500} size="sm">
                          {t(sport.label)}
                        </Text>
                      }
                      checked={checked}
                      onChange={() => toggleSport(sport.value)}
                      color="dark"
                    />
                  </Box>
                );
              })}
            </Stack>

            <Divider my="md" />

            {/* Training days */}
            <Text fw={600} mb={4}>{t("Training days")}</Text>
            <Text size="sm" c="dimmed" mb="sm">
              {t("What days are you generally available to train?")}
            </Text>
            <Stack gap={6}>
              {DAYS_OF_WEEK.map((day) => {
                const checked = (profile.training_days || []).includes(day.value);
                return (
                  <Box
                    key={day.value}
                    px="sm"
                    py={6}
                    style={{
                      borderRadius: 8,
                      background: checked ? dayCheckboxBg(day.color) : "transparent",
                      transition: "background 150ms ease",
                    }}
                  >
                    <Checkbox
                      label={
                        <Text fw={500} size="sm">
                          {t(capitalize(day.value) || day.value)}
                        </Text>
                      }
                      checked={checked}
                      onChange={() => toggleDay(day.value)}
                      color="dark"
                    />
                  </Box>
                );
              })}
            </Stack>
          </Paper>
        </Stack>
      </SimpleGrid>

      <Group justify="flex-end" mt="lg">
        <Button onClick={handleSave} loading={isSaving} color="orange" size="md">
          {t("Save Changes")}
        </Button>
      </Group>
    </Box>
  );
};

export default DashboardAthleteProfileTab;

const COUNTRY_LIST = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
  "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
  "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
  "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada",
  "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
  "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt",
  "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia",
  "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana",
  "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti",
  "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland",
  "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati",
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya",
  "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia",
  "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico",
  "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
  "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua",
  "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan",
  "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines",
  "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis",
  "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
  "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
  "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia",
  "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan",
  "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania",
  "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia",
  "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City",
  "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];
