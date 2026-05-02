import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
    calculateNormalizedPower,
    createPeriodZones,
    formatAvgHr,
    formatTotalMinutes,
    getZonePalette,
    hasAnyPeriodZoneValues,
    hasAnyZoneValues,
    renderStackedZoneBar,
    speedToPaceMinPerKm,
} from './TrainingCalendarZoneSummaryPanel';

describe('TrainingCalendarZoneSummaryPanel helpers', () => {
    const renderWithMantine = (node: React.ReactNode) => {
        return render(<MantineProvider>{node}</MantineProvider>);
    };

    it('formats total minutes with rounding and zero floor', () => {
        expect(formatTotalMinutes(61.4)).toBe('1h 1m');
        expect(formatTotalMinutes(61.6)).toBe('1h 2m');
        expect(formatTotalMinutes(-15)).toBe('0h 0m');
    });

    it('formats average heart rate or placeholder', () => {
        expect(formatAvgHr(149.6)).toBe('150 bpm');
        expect(formatAvgHr(0)).toBe('-');
        expect(formatAvgHr(null)).toBe('-');
        expect(formatAvgHr(Number.NaN)).toBe('-');
    });

    it('converts speed to pace in minutes per kilometer', () => {
        expect(speedToPaceMinPerKm(3.3333333333)).toBeCloseTo(5, 5);
        expect(speedToPaceMinPerKm(0)).toBeNull();
        expect(speedToPaceMinPerKm(undefined)).toBeNull();
        expect(speedToPaceMinPerKm(Number.NaN)).toBeNull();
    });

    it('calculates normalized power for empty, short, and rolling windows', () => {
        expect(calculateNormalizedPower([])).toBeNull();
        expect(calculateNormalizedPower([100, 200, 300])).toBe(200);

        const constantThirtySeconds = Array.from({ length: 30 }, () => 250);
        expect(calculateNormalizedPower(constantThirtySeconds)).toBeCloseTo(250, 5);

        const steppedSamples = Array.from({ length: 30 }, (_, index) => 100 + index * 10);
        const expected = (() => {
            const rolling = [steppedSamples.reduce((sum, value) => sum + value, 0) / steppedSamples.length];
            const meanFourth = rolling.reduce((sum, value) => sum + value ** 4, 0) / rolling.length;
            return meanFourth ** 0.25;
        })();
        expect(calculateNormalizedPower(steppedSamples)).toBeCloseTo(expected, 5);
    });

    it('returns the correct palettes for five and seven zone views', () => {
        expect(getZonePalette(5)).toEqual(['#22C55E', '#84CC16', '#EAB308', '#F97316', '#EF4444']);
        expect(getZonePalette(7)).toEqual(['#22C55E', '#84CC16', '#EAB308', '#EAB308', '#F59E0B', '#F97316', '#EF4444']);
    });

    it('renders an empty stacked zone bar when there is no zone data', () => {
        const { container } = renderWithMantine(renderStackedZoneBar([0, 0, 0], 3, 10, '#ccc'));

        expect(container.querySelectorAll('div')).toHaveLength(2);
        expect(container.innerHTML).toContain('border: 1px solid rgb(204, 204, 204)');
    });

    it('renders only non-zero zone segments with proportional widths', () => {
        const { container } = renderWithMantine(renderStackedZoneBar([30, 0, 90], 3, 8, '#222'));
        const divs = Array.from(container.querySelectorAll('div'));
        const segmentDivs = divs.filter((element) => {
            const style = element.getAttribute('style') || '';
            return style.includes('width:') && style.includes('background:');
        });

        expect(segmentDivs).toHaveLength(2);
        expect(segmentDivs[0]?.getAttribute('style')).toContain('width: 25%');
        expect(segmentDivs[0]?.getAttribute('style')).toContain('background: rgb(34, 197, 94)');
        expect(segmentDivs[1]?.getAttribute('style')).toContain('width: 75%');
        expect(segmentDivs[1]?.getAttribute('style')).toContain('background: rgb(234, 179, 8)');
    });

    it('creates zeroed period zones and detects whether any values are present', () => {
        const zones = createPeriodZones();

        expect(zones.running.zoneSecondsByMetric.hr).toEqual({ Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 });
        expect(zones.running.zoneSecondsByMetric.pace).toEqual({ Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0, Z6: 0, Z7: 0 });
        expect(zones.cycling.zoneSecondsByMetric.power).toEqual({ Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0, Z6: 0, Z7: 0 });
        expect(hasAnyZoneValues()).toBe(false);
        expect(hasAnyZoneValues({ Z1: 0, Z2: 3 })).toBe(true);
        expect(hasAnyPeriodZoneValues(zones)).toBe(false);

        zones.cycling.zoneSecondsByMetric.power.Z4 = 120;
        expect(hasAnyPeriodZoneValues(zones)).toBe(true);
    });
});