import { Text, Title } from "@mantine/core";

type InviteHeaderProps = {
  title: string;
  description: string;
};

const InviteHeader = ({ title, description }: InviteHeaderProps) => {
  return (
    <>
      <Title order={2} mb="md">{title}</Title>
      <Text c="dimmed" mb="lg">
        {description}
      </Text>
    </>
  );
};

export default InviteHeader;
