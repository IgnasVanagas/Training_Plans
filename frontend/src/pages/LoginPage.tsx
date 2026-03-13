import { useEffect, useState, FormEvent } from "react";
import {
  Anchor,
  Alert,
  Button,
  Center,
  Container,
  Group,
  SegmentedControl,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  rem,
  List
} from "@mantine/core";
import { DateInput } from '@mantine/dates';
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconAt, IconLock, IconUser, IconBuilding } from "@tabler/icons-react";
import api from "../api/client";
import { useI18n } from "../i18n/I18nProvider";
import { hasAuthSession, markAuthSessionActive } from "../utils/authSession";

const appLogo = "/favicon.svg";

type AuthResponse = {
  access_token: string;
};

const STRAVA_LOGIN_RECENT_SYNC_FLAG = "tp:strava-login-recent-sync";

const LoginPage = () => {
  const { language, setLanguage, t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteCode = searchParams.get("invite");
  const verifyToken = searchParams.get("verify");
  const resetToken = searchParams.get("reset");
  const [isRegister, setIsRegister] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState("athlete");
  const [organizationName, setOrganizationName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
    mutationFn: async () => {
      const response = await api.post<AuthResponse>("/auth/login", {
        email: email.trim().toLowerCase(),
        password
      });
      return response.data;
    },
    onSuccess: async () => {
      markAuthSessionActive();
      sessionStorage.setItem(STRAVA_LOGIN_RECENT_SYNC_FLAG, "1");
      if (inviteCode) {
        try {
          await api.put("/users/organization/join", { code: inviteCode });
        } catch (err) {
          setError(getErrorMessage(err));
          return;
        }
      }
      navigate("/dashboard", { replace: true });
    },
    onError: (err) => setError(getErrorMessage(err))
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<AuthResponse>("/auth/register", {
        email: email.trim().toLowerCase(),
        password,
        role: inviteCode ? "athlete" : role,
        organization_name: organizationName || undefined,
        organization_code: inviteCode || undefined,
        first_name: firstName,
        last_name: lastName,
        gender: gender,
        birth_date: birthDate ? birthDate.toISOString().split('T')[0] : undefined
      });
      return response.data;
    },
    onSuccess: () => {
      markAuthSessionActive();
      navigate("/dashboard", { replace: true });
    },
    onError: (err) => setError(getErrorMessage(err))
  });

  const verifyEmailMutation = useMutation({
    mutationFn: async (token: string) => {
      await api.post("/auth/verify-email", { token });
    },
    onSuccess: () => setInfo("Email verified successfully. You can now sign in."),
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

  useEffect(() => {
    if (!verifyToken) return;
    verifyEmailMutation.mutate(verifyToken);
  }, [verifyToken]);

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

    if (isRegister) {
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
      loginMutation.mutate();
    }
  };

  const isLoading = loginMutation.isPending || registerMutation.isPending || forgotPasswordMutation.isPending || resetPasswordMutation.isPending;

  return (
    <Center style={{ width: "100%", height: "100vh", backgroundColor: "var(--mantine-color-body)" }}>
      <Container size={640} w="100%">
        <Center mb="xl">
            <img src={appLogo} alt="Origami Plans" width={88} height={88} />
        </Center>
        <Group justify="center" mb="sm">
          <SegmentedControl
            size="xs"
            value={language}
            onChange={(value) => setLanguage(value as "en" | "lt")}
            data={[
              { value: "en", label: "EN" },
              { value: "lt", label: "LT" },
            ]}
          />
        </Group>
        <Title ta="center" order={1} mb="sm" style={{ fontFamily: "greycliff cf, sans-serif", fontSize: rem(28) }}>
          Origami Plans
        </Title>
        <Text c="dimmed" size="md" ta="center" mb="xl">
            Manage your athletes and training plans efficiently
        </Text>
        
        <Paper shadow="xl" p={40} radius="md" withBorder>
          <Text size="lg" fw={500} mb="lg" ta="center">
            {isRegister ? t("Create an account") : t("Welcome back")}
          </Text>

          <form onSubmit={handleSubmit}>
            <Stack>
                {error && (
                <Alert variant="light" color="red" title="Error">
                    {error}
                </Alert>
                )}

                {info && (
                  <Alert variant="light" color="blue" title="Info">
                    {info}
                  </Alert>
                )}

                {inviteCode && (
                  <Alert variant="light" color="blue" title="Team invite detected">
                    Sign in to join this coach&apos;s team, or create an athlete account to join directly.
                  </Alert>
                )}

                <TextInput
                label="Email"
                placeholder="you@example.com"
                leftSection={<IconAt style={{ width: rem(20), height: rem(20) }} />}
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                size="lg"
                />
                
                {!isForgotPassword && !resetToken && (
                <PasswordInput
                label="Password"
                placeholder="Your password"
                leftSection={<IconLock style={{ width: rem(20), height: rem(20) }} />}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
                size="lg"
                />
                )}

                {resetToken && (
                  <>
                    <PasswordInput
                      label="New password"
                      placeholder="New password"
                      leftSection={<IconLock style={{ width: rem(20), height: rem(20) }} />}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.currentTarget.value)}
                      required
                      size="lg"
                    />
                    <PasswordInput
                      label="Confirm new password"
                      placeholder="Confirm new password"
                      leftSection={<IconLock style={{ width: rem(20), height: rem(20) }} />}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                      required
                      size="lg"
                    />
                  </>
                )}

                {isRegister && !resetToken && !isForgotPassword && (
                <>
                    <List size="xs" spacing={2} mb={4}>
                      <List.Item><Text c={password.length >= 10 ? "teal" : "dimmed"}>At least 10 characters</Text></List.Item>
                      <List.Item><Text c={/[A-Z]/.test(password) ? "teal" : "dimmed"}>One uppercase letter</Text></List.Item>
                      <List.Item><Text c={/[a-z]/.test(password) ? "teal" : "dimmed"}>One lowercase letter</Text></List.Item>
                      <List.Item><Text c={/\d/.test(password) ? "teal" : "dimmed"}>One number</Text></List.Item>
                      <List.Item><Text c={/[^A-Za-z0-9]/.test(password) ? "teal" : "dimmed"}>One symbol</Text></List.Item>
                    </List>
                    <Group grow>
                        <TextInput 
                            label="First Name" 
                            placeholder="John" 
                            value={firstName} 
                            onChange={(e) => setFirstName(e.currentTarget.value)}
                            required 
                            size="md"
                        />
                        <TextInput 
                            label="Last Name" 
                            placeholder="Doe" 
                            value={lastName} 
                            onChange={(e) => setLastName(e.currentTarget.value)} 
                            required 
                            size="md"
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
                        leftSection={<IconUser style={{ width: rem(20), height: rem(20) }} />}
                        data={[
                            { value: "athlete", label: t("Athlete") || "Athlete" },
                            { value: "coach", label: t("Coach") || "Coach" }
                        ]}
                        onChange={(value) => setRole(value || "athlete")}
                        size="md"
                        disabled={!!inviteCode}
                    />
                    <TextInput
                    label="Organization Name"
                    placeholder="e.g. Iron Team"
                    description="Optional"
                    leftSection={<IconBuilding style={{ width: rem(20), height: rem(20) }} />}
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.currentTarget.value)}
                    size="lg"
                    />
                </>
                )}
            </Stack>

            <Button fullWidth mt="xl" size="lg" type="submit" loading={isLoading}>
                {resetToken ? "Reset password" : isForgotPassword ? "Send reset instructions" : isRegister ? "Register" : "Sign in"}
            </Button>
          </form>

          {!isRegister && !resetToken && (
            <Group justify="center" mt="md">
              <Anchor component="button" type="button" size="sm" fw={500} onClick={() => {
                setIsForgotPassword(!isForgotPassword);
                setError(null);
              }}>
                {isForgotPassword ? "Back to login" : "Forgot password?"}
              </Anchor>
            </Group>
          )}

          <Group justify="center" mt="md">
            <Text size="sm" c="dimmed">
              {isRegister ? t("Have an account?") : t("Don't have an account yet?")}
            </Text>
            <Anchor component="button" type="button" size="sm" fw={600} onClick={() => {
              setIsRegister(!isRegister);
              setIsForgotPassword(false);
              setError(null);
              setPassword("");
            }}>
              {isRegister ? t("Login") : t("Create account")}
            </Anchor>
          </Group>
        </Paper>
      </Container>
    </Center>
  );
};

export default LoginPage;
