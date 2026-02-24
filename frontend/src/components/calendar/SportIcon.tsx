import { Activity, Bike, Footprints } from 'lucide-react';

type SportIconProps = {
    sport: string;
    size?: number;
};

const SportIcon = ({ sport, size = 16 }: SportIconProps) => {
    const s = sport.toLowerCase();
    if (s.includes('cycl') || s.includes('bike') || s.includes('ride')) return <Bike size={size} />;
    if (s.includes('run')) return <Footprints size={size} />;
    return <Activity size={size} />;
};

export default SportIcon;
