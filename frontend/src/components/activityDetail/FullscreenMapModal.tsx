import { ActionIcon, Box, Button, Chip, Group, Modal, Paper, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { MapFitBounds, MapPanTo, MapRouteInteractionLayer } from "./mapHelpers";
import { RouteInteractivePoint } from "../../types/activityDetail";
import { SelectedSegmentSummary } from "./SelectedSegmentSummary";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
    accent: string;
};

type MapHeatMetric = 'none' | 'speed' | 'heart_rate' | 'power' | 'gradient';

type FsVisibleMetrics = {
    altitude: boolean;
    heart_rate: boolean;
    pace: boolean;
    power: boolean;
    cadence: boolean;
};

interface FullscreenMapModalProps {
    opened: boolean;
    onClose: () => void;
    routePositions: [number, number][];
    centerPos: [number, number];
    mapHeatSegments: Array<{ positions: [number, number][]; color: string }>;
    selectedEffortRoutePositions: [number, number][];
    selectedChartRoutePositions: [number, number][];
    interactiveMapRoutePoints: RouteInteractivePoint[];
    onMapHover: (chartIndex: number | null) => void;
    fullscreenMarkerPos: [number, number] | null;
    fullscreenMarkerPoint: any | null;
    chartSelectionStats: any | null;
    onClearSelection: () => void;
    mapHeatMetric: MapHeatMetric;
    setMapHeatMetric: (m: MapHeatMetric) => void;
    fsVisibleMetrics: FsVisibleMetrics;
    setFsVisibleMetrics: Dispatch<SetStateAction<FsVisibleMetrics>>;
    supportsPaceSeries: boolean;
    supportsSpeedSeries: boolean;
    chartRenderData: any[];
    chartSelection: { startIdx: number; endIdx: number } | null;
    setChartSelection: (sel: { startIdx: number; endIdx: number } | null) => void;
    onFsChartMove: (state: any) => void;
    onFsChartLeave: () => void;
    isFsDraggingRef: MutableRefObject<boolean>;
    fsDragStartIdxRef: MutableRefObject<number | null>;
    me: any;
    formatElapsedFromMinutes: (value: unknown) => string;
    isDark: boolean;
    ui: UiTokens;
    t: (key: string) => string;
}

export const FullscreenMapModal = ({
    opened,
    onClose,
    routePositions,
    centerPos,
    mapHeatSegments,
    selectedEffortRoutePositions,
    selectedChartRoutePositions,
    interactiveMapRoutePoints,
    onMapHover,
    fullscreenMarkerPos,
    fullscreenMarkerPoint,
    chartSelectionStats,
    onClearSelection,
    mapHeatMetric,
    setMapHeatMetric,
    fsVisibleMetrics,
    setFsVisibleMetrics,
    supportsPaceSeries,
    supportsSpeedSeries,
    chartRenderData,
    chartSelection,
    setChartSelection,
    onFsChartMove,
    onFsChartLeave,
    isFsDraggingRef,
    fsDragStartIdxRef,
    me,
    formatElapsedFromMinutes,
    isDark,
    ui,
    t,
}: FullscreenMapModalProps) => {
    return (
        <Modal
            opened={opened}
            onClose={onClose}
            size="100%"
            padding={0}
            withCloseButton={false}
            styles={{ body: { height: '100vh', padding: 0, display: 'flex', flexDirection: 'column' }, content: { height: '100vh', maxHeight: '100vh', borderRadius: 0 }, inner: { padding: 0 } }}
        >
            {routePositions.length > 0 && (
                <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    {/* Map */}
                    <Box style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                        <MapContainer center={centerPos} zoom={13} style={{ height: '100%', width: '100%' }}>
                            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                            {mapHeatSegments.length > 0 ? (
                                mapHeatSegments.map((segment, index) => (
                                    <Polyline key={`fs-heat-${index}`} positions={segment.positions} color={segment.color} weight={5} opacity={0.92} />
                                ))
                            ) : (
                                <Polyline positions={routePositions} color="blue" weight={4} opacity={0.6} />
                            )}
                            {selectedEffortRoutePositions.length > 1 && (
                                <Polyline positions={selectedEffortRoutePositions} color={ui.accent} weight={8} opacity={0.95} />
                            )}
                            {selectedChartRoutePositions.length > 1 && (
                                <Polyline positions={selectedChartRoutePositions} color={ui.accent} weight={8} opacity={0.95} />
                            )}
                            <MapRouteInteractionLayer
                                points={interactiveMapRoutePoints}
                                onHover={onMapHover}
                            />
                            <MapFitBounds positions={routePositions} />
                            {fullscreenMarkerPos && <MapPanTo position={fullscreenMarkerPos} />}
                            {fullscreenMarkerPos && (
                                <CircleMarker center={fullscreenMarkerPos} radius={8} pathOptions={{ color: '#fff', fillColor: '#E95A12', fillOpacity: 1, weight: 3 }}>
                                    {fullscreenMarkerPoint && (
                                        <LeafletTooltip permanent direction="top" offset={[0, -12]}>
                                            <Stack gap={2}>
                                                <Text size="xs" fw={600}>
                                                    {Math.floor(fullscreenMarkerPoint.timeMin)}:{Math.round((fullscreenMarkerPoint.timeMin % 1) * 60).toString().padStart(2, '0')} {t('elapsed')}
                                                </Text>
                                                {fullscreenMarkerPoint.heart_rate != null && (
                                                    <Text size="xs">HR: {fullscreenMarkerPoint.heart_rate} bpm</Text>
                                                )}
                                                {fullscreenMarkerPoint.paceDisplay != null && (
                                                    <Text size="xs">{t('Pace')}: {fullscreenMarkerPoint.paceDisplay}</Text>
                                                )}
                                                {fullscreenMarkerPoint.paceDisplay == null && fullscreenMarkerPoint.speedKmh != null && (
                                                    <Text size="xs">{t('Speed')}: {fullscreenMarkerPoint.speedKmh.toFixed(1)} km/h</Text>
                                                )}
                                                {fullscreenMarkerPoint.power != null && fullscreenMarkerPoint.power > 0 && (
                                                    <Text size="xs">{t('Power')}: {Math.round(fullscreenMarkerPoint.power)} W</Text>
                                                )}
                                                {fullscreenMarkerPoint.altitude != null && (
                                                    <Text size="xs">{t('Elevation')}: {Math.round(fullscreenMarkerPoint.altitude)} m</Text>
                                                )}
                                                {fullscreenMarkerPoint.gradient_pct != null && (
                                                    <Text size="xs">{t('Gradient')}: {Number(fullscreenMarkerPoint.gradient_pct).toFixed(1)}%</Text>
                                                )}
                                            </Stack>
                                        </LeafletTooltip>
                                    )}
                                </CircleMarker>
                            )}
                        </MapContainer>
                        {/* Floating close button */}
                        <ActionIcon
                            variant="white"
                            size="md"
                            radius="sm"
                            style={{ position: 'absolute', top: 10, right: 10, zIndex: 1001, boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
                            onClick={onClose}
                            aria-label={t('Close fullscreen')}
                        >
                            <IconX size={16} />
                        </ActionIcon>
                        {/* Segment stats overlay */}
                        {chartSelectionStats && (
                            <Box style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, pointerEvents: 'auto' }}>
                                <Box style={{ minWidth: 340, maxWidth: 520, boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                                    <SelectedSegmentSummary
                                        stats={chartSelectionStats}
                                        me={me}
                                        supportsPaceSeries={supportsPaceSeries}
                                        onClear={onClearSelection}
                                        formatElapsedFromMinutes={formatElapsedFromMinutes}
                                        ui={ui}
                                        t={t}
                                    />
                                </Box>
                            </Box>
                        )}
                    </Box>
                    {/* Bottom toolbar: map metric selector */}
                    <Box style={{ flexShrink: 0, background: isDark ? '#0E1A30' : '#F8FAFF', borderTop: `1px solid ${ui.border}` }} px="xs" py={4}>
                        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                            <SegmentedControl
                                size="xs"
                                value={mapHeatMetric}
                                onChange={(value) => setMapHeatMetric(value as MapHeatMetric)}
                                data={[
                                    { label: t('Map metric: None'), value: 'none' },
                                    { label: t('Speed'), value: 'speed' },
                                    { label: t('Heart Rate'), value: 'heart_rate' },
                                    { label: t('Power'), value: 'power' },
                                    { label: t('Gradient'), value: 'gradient' },
                                ]}
                            />
                            <Group gap={4} wrap="wrap">
                                <Text size="xs" c={ui.textDim} fw={600}>{t('Show')}:</Text>
                                <Chip size="xs" checked={fsVisibleMetrics.altitude} onChange={(checked) => setFsVisibleMetrics((prev) => ({ ...prev, altitude: checked }))} variant="light">{t('Elevation')}</Chip>
                                <Chip size="xs" checked={fsVisibleMetrics.heart_rate} onChange={(checked) => setFsVisibleMetrics((prev) => ({ ...prev, heart_rate: checked }))} variant="light">{t('Heart Rate')}</Chip>
                                {supportsPaceSeries && <Chip size="xs" checked={fsVisibleMetrics.pace} onChange={(checked) => setFsVisibleMetrics((prev) => ({ ...prev, pace: checked }))} variant="light">{t('Pace')}</Chip>}
                                {supportsSpeedSeries && <Chip size="xs" checked={fsVisibleMetrics.cadence} onChange={(checked) => setFsVisibleMetrics((prev) => ({ ...prev, cadence: checked }))} variant="light">{t('Cadence')}</Chip>}
                                <Chip size="xs" checked={fsVisibleMetrics.power} onChange={(checked) => setFsVisibleMetrics((prev) => ({ ...prev, power: checked }))} variant="light">{t('Power')}</Chip>
                            </Group>
                        </Group>
                    </Box>
                    {/* Multi-metric chart — drag to select segment */}
                    {chartRenderData.length > 0 && (
                        <Box style={{ flexShrink: 0, background: isDark ? '#0E1A30' : '#F8FAFF', borderTop: `1px solid ${ui.border}` }}>
                            <Box
                                style={{ cursor: 'crosshair', userSelect: 'none' }}
                                onMouseDown={(e: React.MouseEvent) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                                    const idx = Math.round(ratio * (chartRenderData.length - 1));
                                    isFsDraggingRef.current = true;
                                    fsDragStartIdxRef.current = idx;
                                    setChartSelection(null);
                                }}
                                onMouseMove={(e: React.MouseEvent) => {
                                    if (!isFsDraggingRef.current || fsDragStartIdxRef.current === null) return;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                                    const idx = Math.round(ratio * (chartRenderData.length - 1));
                                    const startIdx = Math.min(fsDragStartIdxRef.current, idx);
                                    const endIdx = Math.max(fsDragStartIdxRef.current, idx);
                                    if (endIdx - startIdx >= 3) {
                                        setChartSelection({ startIdx, endIdx });
                                    } else {
                                        setChartSelection(null);
                                    }
                                }}
                                onMouseUp={() => { isFsDraggingRef.current = false; fsDragStartIdxRef.current = null; }}
                                onMouseLeave={() => { isFsDraggingRef.current = false; fsDragStartIdxRef.current = null; onFsChartLeave(); }}
                            >
                                <ResponsiveContainer width="100%" height={120}>
                                    <LineChart
                                        data={chartRenderData}
                                        onMouseMove={onFsChartMove}
                                        onMouseLeave={onFsChartLeave}
                                        margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ui.border} />
                                        <XAxis dataKey="time_min" hide />
                                        <YAxis yAxisId="selection" hide domain={[0, 1]} />
                                        <YAxis yAxisId="alt" hide domain={['dataMin - 10', 'dataMax + 10']} />
                                        <YAxis yAxisId="hr" hide domain={['auto', 'auto']} />
                                        <YAxis yAxisId="power" hide domain={[0, 'auto']} />
                                        <YAxis yAxisId="pace" hide reversed domain={['auto', 'auto']} />
                                        <YAxis yAxisId="cad" hide domain={[0, 'auto']} />
                                        <Tooltip
                                            isAnimationActive={false}
                                            cursor={{ stroke: ui.accent, strokeWidth: 1 }}
                                            content={({ active, payload }: any) => {
                                                if (isFsDraggingRef.current || !active || !payload?.[0]) return null;
                                                const d = payload[0].payload;
                                                const distKm = d.distance ? (d.distance / 1000).toFixed(2) : null;
                                                return (
                                                    <Paper withBorder p={6} radius="sm" bg={ui.surfaceAlt} style={{ fontSize: 11 }}>
                                                        {distKm && <Text size="xs" fw={600} c={ui.textDim}>{t('Distance')}: {distKm} km</Text>}
                                                        {fsVisibleMetrics.altitude && d.altitude != null && <Text size="xs" c={ui.textMain}>Elev: {Math.round(d.altitude)} m</Text>}
                                                        {fsVisibleMetrics.heart_rate && d.heart_rate != null && <Text size="xs" c="#fa5252">HR: {Math.round(Number(d.heart_rate))} bpm</Text>}
                                                        {fsVisibleMetrics.power && d.power_raw != null && <Text size="xs" c="#fd7e14">Power: {Math.round(Number(d.power_raw))} W</Text>}
                                                        {fsVisibleMetrics.pace && d.pace != null && Number.isFinite(Number(d.pace)) && <Text size="xs" c="#228be6">Pace: {Math.floor(Number(d.pace))}:{Math.floor((Number(d.pace) % 1) * 60).toString().padStart(2, '0')}/km</Text>}
                                                        {fsVisibleMetrics.cadence && d.cadence != null && <Text size="xs" c="#40c057">Cad: {Math.round(Number(d.cadence))} rpm</Text>}
                                                    </Paper>
                                                );
                                            }}
                                        />
                                        {fsVisibleMetrics.altitude && <Line yAxisId="alt" type="monotone" dataKey="altitude" stroke={isDark ? '#60A5FA' : '#3B82F6'} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />}
                                        {fsVisibleMetrics.heart_rate && <Line yAxisId="hr" type="monotone" dataKey="heart_rate" stroke="#fa5252" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />}
                                        {fsVisibleMetrics.power && <Line yAxisId="power" type="monotone" dataKey="power_raw" stroke="#fd7e14" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />}
                                        {fsVisibleMetrics.pace && <Line yAxisId="pace" type="monotone" dataKey="pace" stroke="#228be6" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />}
                                        {fsVisibleMetrics.cadence && <Line yAxisId="cad" type="monotone" dataKey="cadence" stroke="#40c057" strokeWidth={1.2} dot={false} isAnimationActive={false} connectNulls />}
                                        {chartSelection && chartRenderData[chartSelection.startIdx] && chartRenderData[chartSelection.endIdx] && (
                                            <ReferenceArea
                                                yAxisId="selection"
                                                x1={chartRenderData[chartSelection.startIdx].time_min}
                                                x2={chartRenderData[chartSelection.endIdx].time_min}
                                                y1={0}
                                                y2={1}
                                                fill={ui.accent}
                                                fillOpacity={0.2}
                                                stroke={ui.accent}
                                                strokeOpacity={0.85}
                                                strokeWidth={1.2}
                                                ifOverflow="extendDomain"
                                            />
                                        )}
                                    </LineChart>
                                </ResponsiveContainer>
                            </Box>
                        </Box>
                    )}
                </Box>
            )}
        </Modal>
    );
};
