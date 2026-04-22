export type ActivityBrandType =
    | 'run'
    | 'cycling'
    | 'swim'
    | 'walk'
    | 'hike'
    | 'workout'
    | 'virtual'
    | 'rest'
    | 'default';

type ActivityStyleRow = {
    sport_type?: string;
    title?: string;
};

const hasToken = (value: string, token: string): boolean => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`);
    return pattern.test(value);
};

const classifyFromText = (value: string): ActivityBrandType => {
    if (!value) return 'default';
    if (value.includes('rest')) return 'rest';
    if (value.includes('virtualride') || value.includes('virtual ride') || value.includes('virtual') || value.includes('indoor') || value.includes('trainer') || value.includes('zwift')) return 'virtual';
    if (value.includes('gym') || value.includes('strength') || value.includes('workout')) return 'workout';
    if (value.includes('swim')) return 'swim';
    if (value.includes('hike') || value.includes('trek') || value.includes('trail walk')) return 'hike';
    if (hasToken(value, 'walk') || hasToken(value, 'walking')) return 'walk';
    if (hasToken(value, 'run') || hasToken(value, 'running')) return 'run';
    if (value.includes('cycl') || value.includes('bike') || hasToken(value, 'ride') || value.includes('gravel')) return 'cycling';
    return 'default';
};

export const resolveActivityBrandType = (sportType?: string, title?: string): ActivityBrandType => {
    const sportToken = (sportType || '').toLowerCase();
    const titleToken = (title || '').toLowerCase();

    // Prefer canonical sport metadata over title heuristics.
    const fromSport = classifyFromText(sportToken);
    if (fromSport !== 'default') return fromSport;

    return classifyFromText(titleToken);
};

export const resolveActivityAccentColor = (activityColors: Record<ActivityBrandType, string>, sportType?: string, title?: string) => {
    return activityColors[resolveActivityBrandType(sportType, title)];
};

export const resolveActivityPillLabel = (sportType?: string, title?: string) => {
    const kind = resolveActivityBrandType(sportType, title);
    if (kind === 'rest') return 'Rest Day';
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
        rest: 0,
        default: 0
    };
    rows.forEach((row) => {
        const key = resolveActivityBrandType(row.sport_type, row.title);
        counts[key] += 1;
    });
    const dominant = (Object.keys(counts) as ActivityBrandType[]).sort((a, b) => counts[b] - counts[a])[0] || 'default';
    return activityColors[dominant];
};
