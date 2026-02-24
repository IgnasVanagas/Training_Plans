import { Button, Stack } from "@mantine/core";

type InviteActionsProps = {
  onBackToLogin: () => void;
};

const InviteActions = ({ onBackToLogin }: InviteActionsProps) => {
  return (
    <Stack>
      <Button fullWidth size="md">Accept Invitation</Button>
      <Button variant="subtle" fullWidth onClick={onBackToLogin}>Back to Login</Button>
    </Stack>
  );
};

export default InviteActions;
