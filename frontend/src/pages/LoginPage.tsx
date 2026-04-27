import { useEffect, useRef, useState, FormEvent } from "react";
import {
  Anchor,
  Alert,
  Box,
  Button,
  Checkbox,
  Center,
  Group,
  SegmentedControl,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  rem,
  List,
  useComputedColorScheme,
  Transition,
} from "@mantine/core";
import { DateInput } from '@mantine/dates';
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { IconAt, IconLock, IconUser, IconRun, IconBike, IconSwimming, IconHeartRateMonitor } from "@tabler/icons-react";
import api from "../api/client";
import SupportContactButton from "../components/common/SupportContactButton";
import { useI18n } from "../i18n/I18nProvider";
import { clearAuthSession, hasAuthSession, markAuthSessionActive } from "../utils/authSession";

const appLogo = "/origami-logo.png";

type AuthResponse = {
  access_token: string;
};

type GenericMessageResponse = {
  message: string;
};

type EmailVerificationPayload = {
  email: string;
  code: string;
};

type LoginResult = AuthResponse & {
  requestedEmail: string;
};

const STRAVA_LOGIN_RECENT_SYNC_FLAG = "tp:strava-login-recent-sync";
const PRIVACY_POLICY_VERSION = "2026-04-27";
const ATHLETE_DATA_SHARING_CONSENT_VERSION = "2026-04-27";

const LoginPage = () => {
  const { language, setLanguage, t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const inviteCode = searchParams.get("invite");
  const resetToken = searchParams.get("reset");
  const [isRegister, setIsRegister] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState("athlete");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [privacyPolicyAccepted, setPrivacyPolicyAccepted] = useState(false);
  const [athleteSharingConsentAccepted, setAthleteSharingConsentAccepted] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const verificationInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (hasAuthSession()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const getErrorMessage = (error: any) => {
    if (error?.code === "ECONNABORTED") {
      return "Request timed out. Please check your connection and try again.";
    }
    if (error?.message === "Network Error") {
      return "Cannot reach server. Ensure phone and computer are on the same Wi-Fi and backend is running.";
    }
    if (error.response?.data?.detail) {
      const detail = error.response.data.detail;
      if (Array.isArray(detail)) {
          return detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ');
      }
      if (typeof detail === 'object') return JSON.stringify(detail);
      return String(detail);
    }
    return "An unexpected error occurred.";
  };

  const loginMutation = useMutation({
    mutationFn: async (): Promise<LoginResult> => {
      const requestedEmail = email.trim().toLowerCase();

      // Ensure old auth cookies are cleared before establishing a new account session.
      await api.post("/auth/logout").catch(() => {});

      const response = await api.post<AuthResponse>("/auth/login", {
        email: requestedEmail,
        password
      });
      return {
        ...response.data,
        requestedEmail,
      };
    },
    onSuccess: async (data) => {
      markAuthSessionActive(data.access_token);
      queryClient.clear();
      
      // Additional protection: clear any remaining localStorage snapshots from previous session
      const snapshotPrefixes = [
        "zone-summary:",
        "activity:",
        "activities:",
        "week-view:",
      ];
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && snapshotPrefixes.some(prefix => key.startsWith(prefix))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => window.localStorage.removeItem(key));

      // Wait briefly to ensure cookies are processed by browser
      await new Promise(res => setTimeout(res, 100));

      let verificationAttempts = 0;
      const maxAttempts = 2;
      let lastError: any = null;

      while (verificationAttempts < maxAttempts) {
        try {
          const meResponse = await api.get<{ email?: string | null }>("/users/me", {
            params: { _: Date.now() },
            headers: {
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          });
          const authenticatedEmail = String(meResponse.data?.email || "").trim().toLowerCase();
          
          if (authenticatedEmail && authenticatedEmail === data.requestedEmail) {
            // Success - correct account verified
            sessionStorage.setItem(STRAVA_LOGIN_RECENT_SYNC_FLAG, "1");
            if (inviteCode) {
              try {
                await api.put("/users/organization/join", {
                  code: inviteCode,
                  athlete_data_sharing_consent: athleteSharingConsentAccepted,
                  athlete_data_sharing_consent_version: ATHLETE_DATA_SHARING_CONSENT_VERSION,
                });
              } catch (err) {
                setError(getErrorMessage(err));
                return;
              }
            }
            navigate("/dashboard", { replace: true });
            return;
          }

          lastError = { email: authenticatedEmail, expected: data.requestedEmail };
          verificationAttempts++;

          if (verificationAttempts < maxAttempts) {
            await new Promise(res => setTimeout(res, 200));
          }
        } catch (err) {
          lastError = err;
          verificationAttempts++;

          if (verificationAttempts < maxAttempts) {
            await new Promise(res => setTimeout(res, 200));
          }
        }
      }

      // All verification attempts failed
      console.error("Login verification failed after retries:", lastError);
      await api.post("/auth/logout").catch(() => {});
      clearAuthSession();
      queryClient.clear();
      setError("Login failed for the selected account. Please try again.");
    },
    onError: (err) => setError(getErrorMessage(err))
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<GenericMessageResponse>("/auth/register", {
        email: email.trim().toLowerCase(),
        password,
        role: inviteCode ? "athlete" : role,
        organization_code: inviteCode || undefined,
        first_name: firstName,
        last_name: lastName,
        gender: gender,
        birth_date: birthDate ? birthDate.toISOString().split('T')[0] : undefined,
        privacy_policy_accepted: privacyPolicyAccepted,
        privacy_policy_version: PRIVACY_POLICY_VERSION,
        privacy_policy_url: `${window.location.origin}/privacy`,
        athlete_data_sharing_consent: inviteCode ? athleteSharingConsentAccepted : undefined,
        athlete_data_sharing_consent_version: inviteCode ? ATHLETE_DATA_SHARING_CONSENT_VERSION : undefined,
      });
      return response.data;
    },
    onSuccess: async (data) => {
      await api.post("/auth/logout").catch(() => {});
      clearAuthSession();
      queryClient.clear();
      setIsRegister(false);
      setPassword("");
      setPendingVerificationEmail(email.trim().toLowerCase());
      setVerificationCode("");
      setInfo(data.message || t("Account created. Enter the 6-digit verification code sent to your email."));
    },
    onError: (err) => setError(getErrorMessage(err))
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (emailValue: string) => {
      const response = await api.post<GenericMessageResponse>("/auth/resend-email-confirmation", { email: emailValue });
      return response.data;
    },
    onSuccess: (data) => setInfo(data.message),
    onError: (err) => setError(getErrorMessage(err)),
  });

  const verifyEmailMutation = useMutation({
    mutationFn: async (payload: EmailVerificationPayload) => {
      await api.post("/auth/verify-email", payload);
    },
    onSuccess: () => {
      setPendingVerificationEmail(null);
      setVerificationCode("");
      setInfo("Email verified successfully. You can now sign in.");
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (emailValue: string) => {
      const response = await api.post<{ message: string }>("/auth/forgot-password", { email: emailValue });
      return response.data;
    },
    onSuccess: (data) => {
      setInfo(data.message);
      setIsForgotPassword(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (payload: { token: string; new_password: string }) => {
      const response = await api.post<{ message: string }>("/auth/reset-password", payload);
      return response.data;
    },
    onSuccess: (data) => {
      setInfo(data.message);
      setNewPassword("");
      setConfirmPassword("");
      navigate("/login");
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
      return;
    }

    if (resetToken) {
      if (!newPassword || !confirmPassword) {
        setError("Both password fields are required.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      resetPasswordMutation.mutate({ token: resetToken, new_password: newPassword });
      return;
    }

    if (isForgotPassword) {
      forgotPasswordMutation.mutate(normalizedEmail);
      return;
    }

    if (pendingVerificationEmail) {
      const cleanedCode = verificationCode.trim();
      if (cleanedCode.length !== 6 || !/^\d{6}$/.test(cleanedCode)) {
        setError("Enter the 6-digit verification code.");
        return;
      }
      verifyEmailMutation.mutate({ email: pendingVerificationEmail, code: cleanedCode });
      return;
    }

    if (isRegister) {
      if (!privacyPolicyAccepted) {
        setError(t("You must accept the Privacy Policy to register."));
        return;
      }
      if (inviteCode && !athleteSharingConsentAccepted) {
        setError(t("You must confirm coach data sharing to join this organization."));
        return;
      }
      if (!firstName.trim() || !lastName.trim() || !birthDate) {
        setError("First Name, Last Name, and Date of Birth are required.");
        return;
      }
      const hasLower = /[a-z]/.test(password);
      const hasUpper = /[A-Z]/.test(password);
      const hasDigit = /\d/.test(password);
      const hasSymbol = /[^A-Za-z0-9]/.test(password);
      if (password.length < 10 || !hasLower || !hasUpper || !hasDigit || !hasSymbol) {
        setError("Password must be at least 10 characters and include upper, lower, number, and symbol.");
        return;
      }
      registerMutation.mutate();
    } else {
      if (inviteCode && !athleteSharingConsentAccepted) {
        setError(t("You must confirm coach data sharing to join this organization."));
        return;
      }
      loginMutation.mutate();
    }
  };

  const isLoading = loginMutation.isPending || registerMutation.isPending || forgotPasswordMutation.isPending || resetPasswordMutation.isPending || resendVerificationMutation.isPending || verifyEmailMutation.isPending;
  const isDark = useComputedColorScheme("light") === "dark";
  const isVerificationStep = Boolean(pendingVerificationEmail) && !resetToken && !isForgotPassword;
  const verificationDigits = Array.from({ length: 6 }, (_, index) => verificationCode[index] ?? "");

  const handleVerificationDigitChange = (index: number, rawValue: string) => {
    const digit = rawValue.replace(/\D/g, "").slice(-1);
    const nextDigits = [...verificationDigits];
    nextDigits[index] = digit;
    const nextCode = nextDigits.join("").slice(0, 6);
    setVerificationCode(nextCode);
    if (digit && index < verificationInputRefs.current.length - 1) {
      verificationInputRefs.current[index + 1]?.focus();
    }
  };

  const handleVerificationDigitKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !verificationDigits[index] && index > 0) {
      verificationInputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerificationPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    setVerificationCode(pasted);
    const focusIndex = Math.min(pasted.length, 5);
    verificationInputRefs.current[focusIndex]?.focus();
  };

  const featureItems = [
    { icon: IconRun, text: t("Track activities & compliance") },
    { icon: IconBike, text: t("Plan training with drag & drop") },
    { icon: IconSwimming, text: t("Multi-sport support") },
    { icon: IconHeartRateMonitor, text: t("Wearable integrations") },
  ];

  return (
    <Box
      style={{
        display: "flex",
        minHeight: "100vh",
        width: "100%",
        backgroundColor: "var(--mantine-color-body)",
      }}
    >
      {/* ── Hero / branding panel ── */}
      <Box
        visibleFrom="md"
        style={{
          flex: "0 0 44%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: rem(48),
          background: isDark
            ? "linear-gradient(160deg, var(--mantine-color-dark-8) 0%, var(--mantine-color-cyan-9) 100%)"
            : "linear-gradient(160deg, var(--mantine-color-cyan-6) 0%, var(--mantine-color-cyan-4) 50%, var(--mantine-color-teal-3) 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative circles */}
        <Box
          style={{
            position: "absolute",
            width: 340,
            height: 340,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.06)",
            top: -60,
            left: -80,
          }}
        />
        <Box
          style={{
            position: "absolute",
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.04)",
            bottom: 60,
            right: -40,
          }}
        />

        <img
          src={appLogo}
          alt="Origami Plans"
          width={96}
          height={96}
          style={{ marginBottom: rem(24), filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.2))" }}
        />
        <Title order={2} c="white" ta="center" mb="xs" style={{ fontSize: rem(32), letterSpacing: -0.5 }}>
          Origami Plans
        </Title>
        <Text c="rgba(255,255,255,0.85)" size="lg" ta="center" maw={340} mb="xl">
          {t("Endurance coaching platform for athletes and coaches")}
        </Text>

        <Stack gap="md" mt="md">
          {featureItems.map((item, i) => (
            <Group key={i} gap="sm" wrap="nowrap">
              <item.icon size={22} color="rgba(255,255,255,0.9)" stroke={1.5} />
              <Text c="rgba(255,255,255,0.9)" size="sm">{item.text}</Text>
            </Group>
          ))}
        </Stack>
      </Box>

      {/* ── Form panel ── */}
      <Box
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: `${rem(32)} ${rem(24)}`,
          overflowY: "auto",
        }}
      >
        {/* Top-right controls */}
        <Group
          justify="flex-end"
          gap="sm"
          mb="lg"
          style={{ width: "100%", maxWidth: 480 }}
        >
          <SegmentedControl
            size="xs"
            value={language}
            onChange={(value) => setLanguage(value as "en" | "lt")}
            data={[
              { value: "en", label: "EN" },
              { value: "lt", label: "LT" },
            ]}
          />
          <SupportContactButton
            size="xs"
            variant="light"
            email={email || null}
            name={`${firstName} ${lastName}`.trim() || null}
          />
        </Group>

        {/* Mobile-only compact branding */}
        <Center hiddenFrom="md" mb="lg">
          <Group gap="sm" align="center">
            <img src={appLogo} alt="Origami Plans" width={48} height={48} />
            <Title order={3} style={{ letterSpacing: -0.5 }}>Origami Plans</Title>
          </Group>
        </Center>

        <Box style={{ width: "100%", maxWidth: 480 }}>
          <Transition mounted transition="fade" duration={200}>
            {(styles) => (
              <div style={styles}>
                <Title order={2} mb={4} style={{ fontSize: rem(26) }}>
                  {isVerificationStep
                    ? (t("Email verification") || "Email verification")
                    : isRegister
                    ? t("Create an account")
                    : resetToken
                    ? t("Reset password")
                    : isForgotPassword
                    ? t("Forgot password?")
                    : t("Welcome back")}
                </Title>
                <Text c="dimmed" size="sm" mb="xl">
                  {isVerificationStep
                    ? (t("Enter the 6-digit verification code sent to your email.") || "Enter the 6-digit verification code sent to your email.")
                    : isRegister
                    ? t("Fill in your details to get started")
                    : resetToken
                    ? t("Choose a new password for your account")
                    : isForgotPassword
                    ? t("Enter your email to receive reset instructions")
                    : t("Sign in to continue to your dashboard")}
                </Text>
              </div>
            )}
          </Transition>

          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              {error && (
                <Alert variant="light" color="red" radius="md" title="Error">
                  <Stack gap="xs">
                    <Text size="sm">{error}</Text>
                    {!isRegister && error.includes("Email not verified") && (
                      <Group>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            const normalizedEmail = email.trim().toLowerCase();
                            if (!normalizedEmail) {
                              setError("Email is required.");
                              return;
                            }
                            setPendingVerificationEmail(normalizedEmail);
                            resendVerificationMutation.mutate(normalizedEmail);
                          }}
                          loading={resendVerificationMutation.isPending}
                        >
                          {t("Resend verification email") || "Resend verification email"}
                        </Button>
                      </Group>
                    )}
                    <SupportContactButton
                      size="xs"
                      buttonText={t("Contact support")}
                      email={email || null}
                      name={`${firstName} ${lastName}`.trim() || null}
                      pageLabel="Login"
                      errorMessage={error}
                    />
                  </Stack>
                </Alert>
              )}

              {info && (
                <Alert variant="light" color="blue" radius="md" title="Info">
                  {info}
                </Alert>
              )}

              {inviteCode && (
                <Alert variant="light" color="cyan" radius="md" title={t("Team invite detected")}>
                  {t("Sign in to join this coach's team, or create an athlete account to join directly.")}
                </Alert>
              )}

              {!isVerificationStep && (
                <TextInput
                  label="Email"
                  placeholder="you@example.com"
                  leftSection={<IconAt style={{ width: rem(18), height: rem(18) }} />}
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  required
                  size="md"
                  autoComplete="email"
                  radius="md"
                  disabled={Boolean(pendingVerificationEmail)}
                />
              )}

              {!isVerificationStep && !isForgotPassword && !resetToken && (
                <PasswordInput
                  label="Password"
                  placeholder="Your password"
                  leftSection={<IconLock style={{ width: rem(18), height: rem(18) }} />}
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  required
                  size="md"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  radius="md"
                  disabled={Boolean(pendingVerificationEmail)}
                />
              )}

              {isVerificationStep && (
                <Box
                  style={{
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(37, 99, 235, 0.16)"}`,
                    borderRadius: rem(16),
                    padding: rem(20),
                    background: isDark ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.98)",
                  }}
                >
                  <Stack gap="md">
                    <Text size="sm" fw={600} c="dimmed" ta="center">{pendingVerificationEmail}</Text>
                    <Group justify="center" wrap="nowrap" gap="sm">
                      {verificationDigits.map((digit, index) => (
                        <TextInput
                          key={index}
                          ref={(node) => {
                            verificationInputRefs.current[index] = node;
                          }}
                          value={digit}
                          onChange={(event) => handleVerificationDigitChange(index, event.currentTarget.value)}
                          onKeyDown={(event) => handleVerificationDigitKeyDown(index, event)}
                          onPaste={handleVerificationPaste}
                          inputMode="numeric"
                          autoComplete={index === 0 ? "one-time-code" : "off"}
                          maxLength={1}
                          required
                          size="lg"
                          radius="md"
                          styles={{
                            input: {
                              width: rem(50),
                              height: rem(56),
                              textAlign: "center",
                              fontSize: rem(26),
                              fontWeight: 600,
                              padding: 0,
                            },
                          }}
                        />
                      ))}
                    </Group>
                    <Group justify="space-between">
                      <Button
                        variant="subtle"
                        onClick={() => pendingVerificationEmail && resendVerificationMutation.mutate(pendingVerificationEmail)}
                        loading={resendVerificationMutation.isPending}
                      >
                        {t("Resend verification email") || "Resend verification email"}
                      </Button>
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        onClick={() => {
                          setPendingVerificationEmail(null);
                          setVerificationCode("");
                          setInfo(null);
                        }}
                      >
                        {t("Use different email") || "Use different email"}
                      </Anchor>
                    </Group>
                  </Stack>
                </Box>
              )}

              {resetToken && (
                <>
                  <PasswordInput
                    label="New password"
                    placeholder="New password"
                    leftSection={<IconLock style={{ width: rem(18), height: rem(18) }} />}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.currentTarget.value)}
                    required
                    size="md"
                    radius="md"
                  />
                  <PasswordInput
                    label="Confirm new password"
                    placeholder="Confirm new password"
                    leftSection={<IconLock style={{ width: rem(18), height: rem(18) }} />}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                    required
                    size="md"
                    radius="md"
                  />
                </>
              )}

              {isRegister && !isVerificationStep && !resetToken && !isForgotPassword && (
                <>
                  <List size="xs" spacing={2} mb={4}>
                    <List.Item><Text size="xs" c={password.length >= 10 ? "teal" : "dimmed"}>At least 10 characters</Text></List.Item>
                    <List.Item><Text size="xs" c={/[A-Z]/.test(password) ? "teal" : "dimmed"}>One uppercase letter</Text></List.Item>
                    <List.Item><Text size="xs" c={/[a-z]/.test(password) ? "teal" : "dimmed"}>One lowercase letter</Text></List.Item>
                    <List.Item><Text size="xs" c={/\d/.test(password) ? "teal" : "dimmed"}>One number</Text></List.Item>
                    <List.Item><Text size="xs" c={/[^A-Za-z0-9]/.test(password) ? "teal" : "dimmed"}>One symbol</Text></List.Item>
                  </List>
                  <Group grow>
                    <TextInput
                      label="First Name"
                      placeholder="John"
                      value={firstName}
                      onChange={(e) => setFirstName(e.currentTarget.value)}
                      required
                      size="md"
                      radius="md"
                    />
                    <TextInput
                      label="Last Name"
                      placeholder="Doe"
                      value={lastName}
                      onChange={(e) => setLastName(e.currentTarget.value)}
                      required
                      size="md"
                      radius="md"
                    />
                  </Group>
                  <Group grow>
                    <Select
                      label="Gender"
                      placeholder="Select"
                      data={['Male', 'Female']}
                      value={gender}
                      onChange={setGender}
                      required
                      size="md"
                      radius="md"
                    />
                    <DateInput
                      label="Birth Date"
                      placeholder="YYYY-MM-DD"
                      value={birthDate}
                      onChange={setBirthDate}
                      required
                      size="md"
                    />
                  </Group>
                  <Select
                    label={t("I am a")}
                    value={role}
                    leftSection={<IconUser style={{ width: rem(18), height: rem(18) }} />}
                    data={[
                      { value: "athlete", label: t("Athlete") || "Athlete" },
                      { value: "coach", label: t("Coach") || "Coach" }
                    ]}
                    onChange={(value) => setRole(value || "athlete")}
                    size="md"
                    radius="md"
                    disabled={!!inviteCode}
                  />
                  <Checkbox
                    checked={privacyPolicyAccepted}
                    onChange={(event) => setPrivacyPolicyAccepted(event.currentTarget.checked)}
                    label={
                      <Text size="sm">
                        {t("I have read and accept the")} {" "}
                        <Anchor component={RouterLink} to="/privacy" target="_blank" rel="noreferrer" size="sm">
                          {t("Privacy Policy")}
                        </Anchor>
                      </Text>
                    }
                  />
                  {inviteCode && (
                    <Checkbox
                      checked={athleteSharingConsentAccepted}
                      onChange={(event) => setAthleteSharingConsentAccepted(event.currentTarget.checked)}
                      label={
                        <Text size="sm">
                          {t("I confirm that coaches in this organization can access my Strava-derived training data.")}
                        </Text>
                      }
                    />
                  )}
                </>
              )}

              {inviteCode && !isRegister && !isVerificationStep && !resetToken && !isForgotPassword && !pendingVerificationEmail && (
                <Checkbox
                  checked={athleteSharingConsentAccepted}
                  onChange={(event) => setAthleteSharingConsentAccepted(event.currentTarget.checked)}
                  label={
                    <Text size="sm">
                      {t("I confirm that coaches in this organization can access my Strava-derived training data.")}
                    </Text>
                  }
                />
              )}
            </Stack>

            <Button
              fullWidth
              mt="xl"
              size="md"
              radius="md"
              type="submit"
              loading={isLoading}
              style={{ fontWeight: 600, letterSpacing: 0.3 }}
            >
              {resetToken
                ? t("Reset password")
                : isForgotPassword
                ? t("Send reset instructions")
                : pendingVerificationEmail
                ? (t("Verify email") || "Verify email")
                : isRegister
                ? t("Register")
                : t("Sign in")}
            </Button>
          </form>

          {!isRegister && !resetToken && !pendingVerificationEmail && (
            <Group justify="center" mt="md">
              <Anchor component="button" type="button" size="sm" fw={500} onClick={() => {
                setIsForgotPassword(!isForgotPassword);
                setError(null);
              }}>
                {isForgotPassword ? t("Back to login") : t("Forgot password?")}
              </Anchor>
            </Group>
          )}

          {!isVerificationStep && (
            <Group justify="center" mt="lg">
              <Text size="sm" c="dimmed">
                {isRegister ? t("Have an account?") : t("Don't have an account yet?")}
              </Text>
              <Anchor component="button" type="button" size="sm" fw={600} onClick={() => {
                setPendingVerificationEmail(null);
                setVerificationCode("");
                setIsRegister(!isRegister);
                setIsForgotPassword(false);
                setError(null);
                setPassword("");
              }}>
                {isRegister ? t("Login") : t("Create account")}
              </Anchor>
            </Group>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default LoginPage;
