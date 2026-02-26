import { Stack, Text } from '@mantine/core';
import loadingAnimationVideo from '../../../uploads/Origami_Heart_Loading_Animation-Picsart-BackgroundRemover.mp4';

type OrigamiLoadingAnimationProps = {
    label?: string;
    minHeight?: number;
};

export default function OrigamiLoadingAnimation({
    label = 'Loading...',
    minHeight = 240,
}: OrigamiLoadingAnimationProps) {
    return (
        <Stack align="center" justify="center" gap="xs" style={{ minHeight }}>
            <video
                src={loadingAnimationVideo}
                autoPlay
                loop
                muted
                playsInline
                width={128}
                height={128}
            />
            <Text size="sm" c="dimmed">{label}</Text>
        </Stack>
    );
}