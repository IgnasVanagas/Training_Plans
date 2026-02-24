export const formatDuration = (seconds: number) => {
    const totalMinutes = Math.max(0, Math.round(seconds / 60));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${m}m`;
};

export const formatZoneDuration = (seconds: number) => {
    const totalMinutes = Math.max(0, Math.round((seconds || 0) / 60));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${m}m`;
};
