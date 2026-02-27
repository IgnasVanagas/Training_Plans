import { Button, Stack } from "@mantine/core";

type InviteActionsProps = {
  onAccept: () => void;
  accepting: boolean;
  onBackToLogin: () => void;
};

const InviteActions = ({ onAccept, accepting, onBackToLogin }: InviteActionsProps) => {
  return (
    <Stack>
      <Button fullWidth size="md" onClick={onAccept} loading={accepting}>Accept Invitation</Button>
      <Button variant="subtle" fullWidth onClick={onBackToLogin}>Back to Login</Button>
    </Stack>
  );
};

export default InviteActions;
