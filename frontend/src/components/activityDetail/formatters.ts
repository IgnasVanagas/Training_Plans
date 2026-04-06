export const toTimestampMs = (value: any): number => {
    if (!value) return NaN;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
        const hasTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(value);
        const normalized = hasTimezone ? value : `${value}Z`;
        const ms = Date.parse(normalized);
        return Number.isFinite(ms) ? ms : NaN;
    }
    return NaN;
};

export const calculateNormalizedPower = (powerSamples: number[]): number | null => {
    if (!powerSamples.length) return null;
    const windowSize = Math.min(30, powerSamples.length);
    let rollingSum = 0;
    const rollingAverages: number[] = [];
    powerSamples.forEach((sample, index) => {
        rollingSum += sample;
        if (index >= windowSize) rollingSum -= powerSamples[index - windowSize];
        if (index >= windowSize - 1) rollingAverages.push(rollingSum / windowSize);
    });
    const source = rollingAverages.length ? rollingAverages : powerSamples;
    const meanFourth = source.reduce((sum, value) => sum + Math.pow(value, 4), 0) / source.length;
    return Math.pow(meanFourth, 0.25);
};

export const formatDuration = (seconds: number, includeMs: boolean = false) => {
    const val = includeMs ? Math.max(0, seconds) : Math.max(0, Math.round(seconds));
    const h = Math.floor(val / 3600);
    const m = Math.floor((val % 3600) / 60);
    const s = val % 60;
    
    const sStr = includeMs ? s.toFixed(1) : Math.floor(s).toString();
    
    if (h > 0) return `${h}h ${m}m ${sStr}s`;
    return `${m}m ${sStr}s`;
};

export const formatZoneDuration = (seconds: number) => {
    const totalMinutes = Math.max(0, Math.round((seconds || 0) / 60));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${m}m`;
};
