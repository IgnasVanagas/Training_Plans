import { useState, FormEvent } from "react";
import {
  Anchor,
  Button,
  Center,
  Container,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Alert,
  rem,
  List
} from "@mantine/core";
import { DateInput } from '@mantine/dates';
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { IconAt, IconLock, IconUser, IconBuilding } from "@tabler/icons-react";
import api from "../api/client";
import appLogo from "../../uploads/favicon_Origami-removebg-preview.png";

type AuthResponse = {
  access_token: string;
};

const LoginPage = () => {
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("athlete");
  const [organizationName, setOrganizationName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getErrorMessage = (error: any) => {
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
    onSuccess: (data) => {
      localStorage.setItem("access_token", data.access_token);
      navigate("/dashboard");
    },
    onError: (err) => setError(getErrorMessage(err))
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<AuthResponse>("/auth/register", {
        email: email.trim().toLowerCase(),
        password,
        role,
        organization_name: organizationName || undefined,
        first_name: firstName,
        last_name: lastName,
        gender: gender,
        birth_date: birthDate ? birthDate.toISOString().split('T')[0] : undefined
      });
      return response.data;
    },
    onSuccess: (data) => {
      localStorage.setItem("access_token", data.access_token);
      navigate("/dashboard");
    },
    onError: (err) => setError(getErrorMessage(err))
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
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

  const isLoading = loginMutation.isPending || registerMutation.isPending;

  return (
    <Center style={{ width: "100%", height: "100vh", backgroundColor: "var(--mantine-color-body)" }}>
      <Container size={640} w="100%">
        <Center mb="xl">
            <img src={appLogo} alt="Origami Plans" width={88} height={88} />
        </Center>
        <Title ta="center" order={1} mb="sm" style={{ fontFamily: "greycliff cf, sans-serif", fontSize: rem(28) }}>
          Origami Plans
        </Title>
        <Text c="dimmed" size="md" ta="center" mb="xl">
            Manage your athletes and training plans efficiently
        </Text>
        
        <Paper shadow="xl" p={40} radius="md" withBorder>
          <Text size="lg" fw={500} mb="lg" ta="center">
            {isRegister ? "Create an account" : "Welcome back"}
          </Text>

          <form onSubmit={handleSubmit}>
            <Stack>
                {error && (
                <Alert variant="light" color="red" title="Error">
                    {error}
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
                
                <PasswordInput
                label="Password"
                placeholder="Your password"
                leftSection={<IconLock style={{ width: rem(20), height: rem(20) }} />}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
                size="lg"
                />

                {isRegister && (
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
                    label="I am a"
                    value={role}
                    leftSection={<IconUser style={{ width: rem(20), height: rem(20) }} />}
                    data={[
                      { value: "athlete", label: "Athlete" },
                      { value: "coach", label: "Coach" }
                    ]}
                    onChange={(value) => setRole(value || "athlete")}
                    size="lg"
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
                {isRegister ? "Register" : "Sign in"}
            </Button>
          </form>

          <Group justify="center" mt="md">
            <Text size="sm" c="dimmed">
              {isRegister ? "Already have an account?" : "Don't have an account yet?"}
            </Text>
            <Anchor component="button" type="button" size="sm" fw={600} onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
              setPassword("");
            }}>
              {isRegister ? "Login" : "Create account"}
            </Anchor>
          </Group>
        </Paper>
      </Container>
    </Center>
  );
};

export default LoginPage;
