type PaletteInput = {
    headerBorder: string;
    textDim: string;
    dayCellBorder: string;
    offRangeBg: string;
    offRangeText: string;
    todayBg: string;
    panelBg: string;
};

export const buildTrainingCalendarStyles = ({
    isDark,
    weekdayHeaderHeight,
    palette,
}: {
    isDark: boolean;
    weekdayHeaderHeight: number;
    palette: PaletteInput;
}) => `
                .rbc-calendar {
                    font-family: 'Inter', sans-serif;
                    height: 100% !important;
                }
                .rbc-month-view {
                    border: none !important;
                    background: transparent;
                    height: 100% !important;
                }
                .rbc-month-header {
                    min-height: ${weekdayHeaderHeight}px;
                }
                .rbc-header {
                    background: transparent !important;
                    border-bottom: 1px solid ${palette.headerBorder} !important;
                    color: ${palette.textDim};
                    text-transform: uppercase;
                    font-size: 0.68rem;
                    letter-spacing: 0.9px;
                    padding: 8px 0 !important;
                    font-weight: 700;
                }
                .rbc-month-row {
                    background: transparent !important;
                    border-top: 1px solid ${palette.dayCellBorder} !important;
                    overflow: hidden !important;
                    min-height: 96px !important;
                    flex: 1 1 0 !important;
                }
                .rbc-month-row:first-of-type {
                    border-top: none !important;
                }
                .rbc-day-bg {
                    background: transparent !important;
                    border-left: 1px solid ${palette.dayCellBorder} !important;
                }
                .rbc-day-bg:first-of-type {
                   border-left: none !important;
                }
                .rbc-date-cell {
                    padding: 4px 6px 2px !important;
                }
                .rbc-off-range-bg {
                    background: ${palette.offRangeBg} !important;
                }
                .rbc-off-range {
                    color: ${palette.offRangeText} !important;
                }
                .rbc-today {
                    background: ${palette.todayBg} !important;
                }
                .rbc-row-content {
                    z-index: 4;
                    padding-bottom: 1px;
                    min-height: 24px !important;
                }
                .rbc-row-segment {
                    padding: 1px 2px !important;
                }
                .calendar-grid-wrapper {
                    border: 1px solid ${palette.headerBorder};
                    border-radius: 12px;
                    overflow: hidden;
                    background: ${palette.panelBg};
                    backdrop-filter: blur(14px);
                    min-height: 0;
                    height: 100%;
                    box-shadow: ${isDark ? '0 28px 56px -40px rgba(15, 23, 42, 0.9)' : '0 28px 56px -44px rgba(15, 23, 42, 0.45)'};
                }
                .rbc-event {
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    border-radius: 0 !important;
                    opacity: 1 !important;
                }
                .rbc-event:hover,
                .rbc-event:focus,
                .rbc-event:focus-within,
                .rbc-event.rbc-selected,
                .rbc-row-segment:hover .rbc-event {
                    opacity: 1 !important;
                }
                .rbc-event-content {
                    margin: 0 !important;
                    line-height: 1.15;
                    opacity: 1 !important;
                }
                .rbc-show-more {
                    font-size: 10px !important;
                    font-weight: 700 !important;
                    color: ${palette.textDim} !important;
                }
            `;
