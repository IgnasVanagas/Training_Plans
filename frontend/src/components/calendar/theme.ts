import { ActivityBrandType } from './activityStyling';

export type OrigamiPalette = {
    background: string;
    panelBg: string;
    cardBg: string;
    cardBorder: string;
    textMain: string;
    textDim: string;
    dayCellBorder: string;
    todayBg: string;
    offRangeBg: string;
    offRangeText: string;
    headerBorder: string;
    weekCellBg: string;
};

export const ORIGAMI_THEME: Record<'dark' | 'light', OrigamiPalette> = {
    dark: {
        background: '#081226',
        panelBg: 'rgba(8, 18, 38, 0.78)',
        cardBg: 'rgba(22, 34, 58, 0.62)',
        cardBorder: 'rgba(148, 163, 184, 0.28)',
        textMain: '#F8FAFC',
        textDim: '#94A3B8',
        dayCellBorder: 'rgba(148, 163, 184, 0.16)',
        todayBg: 'rgba(37, 99, 235, 0.18)',
        offRangeBg: 'rgba(9, 18, 34, 0.54)',
        offRangeText: 'rgba(148, 163, 184, 0.70)',
        headerBorder: 'rgba(100, 116, 139, 0.28)',
        weekCellBg: 'rgba(22, 34, 58, 0.72)'
    },
    light: {
        background: '#F1F5F9',
        panelBg: 'rgba(255, 255, 255, 0.82)',
        cardBg: 'rgba(255, 255, 255, 0.80)',
        cardBorder: 'rgba(15, 23, 42, 0.14)',
        textMain: '#0B1426',
        textDim: '#475569',
        dayCellBorder: 'rgba(15, 23, 42, 0.10)',
        todayBg: 'rgba(37, 99, 235, 0.12)',
        offRangeBg: 'rgba(241, 245, 249, 0.75)',
        offRangeText: 'rgba(71, 85, 105, 0.80)',
        headerBorder: 'rgba(15, 23, 42, 0.14)',
        weekCellBg: 'rgba(255, 255, 255, 0.88)'
    }
};

export const ORIGAMI_ACTIVITY_COLORS: Record<'dark' | 'light', Record<ActivityBrandType, string>> = {
    dark: {
        run: '#38BDF8',
        cycling: '#2563EB',
        workout: '#8B5CF6',
        virtual: '#0EA5E9',
        default: '#3B82F6'
    },
    light: {
        run: '#0C4A6E',
        cycling: '#1D4ED8',
        workout: '#6D28D9',
        virtual: '#0369A1',
        default: '#1E40AF'
    }
};
