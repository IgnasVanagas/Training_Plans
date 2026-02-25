export type ActivityBrandType =
    | 'run'
    | 'cycling'
    | 'swim'
    | 'walk'
    | 'hike'
    | 'workout'
    | 'virtual'
    | 'default';

type ActivityStyleRow = {
    sport_type?: string;
    title?: string;
};

export const resolveActivityBrandType = (sportType?: string, title?: string): ActivityBrandType => {
    const token = `${sportType || ''} ${title || ''}`.toLowerCase();
    if (token.includes('virtualride') || token.includes('virtual ride') || token.includes('virtual') || token.includes('indoor') || token.includes('trainer') || token.includes('zwift')) return 'virtual';
    if (token.includes('gym') || token.includes('strength') || token.includes('workout')) return 'workout';
    if (token.includes('swim')) return 'swim';
    if (token.includes('hike') || token.includes('trek') || token.includes('trail walk')) return 'hike';
    if (token.includes('walk') || token.includes('walking')) return 'walk';
    if (token.includes('run')) return 'run';
    if (token.includes('cycl') || token.includes('bike') || token.includes('ride') || token.includes('gravel')) return 'cycling';
    return 'default';
};

export const resolveActivityAccentColor = (activityColors: Record<ActivityBrandType, string>, sportType?: string, title?: string) => {
    return activityColors[resolveActivityBrandType(sportType, title)];
};

export const resolveActivityPillLabel = (sportType?: string, title?: string) => {
    const kind = resolveActivityBrandType(sportType, title);
    if (kind === 'virtual') return 'Virtual Ride';
    if (kind === 'workout') return 'Workout';
    if (kind === 'swim') return 'Swim';
    if (kind === 'walk') return 'Walk';
    if (kind === 'hike') return 'Hike';
    if (kind === 'run') return 'Run';
    if (kind === 'cycling') return 'Ride';
    return 'Session';
};

export const resolveWeekAccentColor = (rows: ActivityStyleRow[], activityColors: Record<ActivityBrandType, string>) => {
    if (!rows.length) return activityColors.default;
    const counts: Record<ActivityBrandType, number> = {
        run: 0,
        cycling: 0,
        swim: 0,
        walk: 0,
        hike: 0,
        workout: 0,
        virtual: 0,
        default: 0
    };
    rows.forEach((row) => {
        const key = resolveActivityBrandType(row.sport_type, row.title);
        counts[key] += 1;
    });
    const dominant = (Object.keys(counts) as ActivityBrandType[]).sort((a, b) => counts[b] - counts[a])[0] || 'default';
    return activityColors[dominant];
};
