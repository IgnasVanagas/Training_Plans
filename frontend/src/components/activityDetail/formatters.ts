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
