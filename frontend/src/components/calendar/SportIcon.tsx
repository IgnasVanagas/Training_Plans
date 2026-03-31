import { IconActivity, IconBarbell, IconBike, IconMoon, IconRun } from '@tabler/icons-react';

type SportIconProps = {
    sport: string;
    size?: number;
};

const SportIcon = ({ sport, size = 16 }: SportIconProps) => {
    const s = sport.toLowerCase();
    if (s.includes('rest')) return <IconMoon size={size} />;
    if (s.includes('virtualride') || s.includes('virtual ride') || s.includes('virtual') || s.includes('zwift')) return <IconBike size={size} />;
    if (s.includes('cycl') || s.includes('bike') || s.includes('ride')) return <IconBike size={size} />;
    if (s.includes('run')) return <IconRun size={size} />;
    if (s.includes('strength') || s.includes('gym') || s.includes('weight') || s.includes('lift')) return <IconBarbell size={size} />;
    return <IconActivity size={size} />;
};

export default SportIcon;
