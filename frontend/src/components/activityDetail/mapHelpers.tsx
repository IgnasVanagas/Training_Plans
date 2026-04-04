import { useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { RouteInteractivePoint } from "../../types/activityDetail";

export const MapFitBounds = ({ positions }: { positions: [number, number][] }) => {
    const map = useMap();
    useEffect(() => {
        if (positions.length > 1) {
            map.fitBounds(L.latLngBounds(positions.map(p => L.latLng(p[0], p[1]))), { padding: [30, 30] });
        }
    }, [map, positions]);
    return null;
};

export const MapPanTo = ({ position }: { position: [number, number] | null }) => {
    const map = useMap();
    const lastPan = useRef<string | null>(null);
    useEffect(() => {
        if (!position) return;
        const key = `${position[0].toFixed(5)},${position[1].toFixed(5)}`;
        if (lastPan.current !== key) {
            lastPan.current = key;
            // Don't pan on every hover — only if marker is outside visible bounds
            if (!map.getBounds().contains(L.latLng(position[0], position[1]))) {
                map.panTo(L.latLng(position[0], position[1]), { animate: true, duration: 0.3 });
            }
        }
    }, [map, position]);
    return null;
};

export const toDistanceLabel = (kmValue: unknown) => {
    const km = Number(kmValue);
    if (!Number.isFinite(km) || km < 0) return '-';
    return `${km.toFixed(2)} km`;
};

export const findNearestRoutePoint = (latlng: L.LatLng, points: RouteInteractivePoint[]) => {
    if (!points.length) return null;
    const targetLat = latlng.lat;
    const targetLon = latlng.lng;
    let nearest: RouteInteractivePoint | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const point of points) {
        const dLat = point.lat - targetLat;
        const dLon = point.lon - targetLon;
        const distSq = dLat * dLat + dLon * dLon;
        if (distSq < bestDist) {
            bestDist = distSq;
            nearest = point;
        }
    }
    return nearest;
};

export const getHeatColor = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return '#3b82f6';
    }
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    if (ratio < 0.2) return '#1d4ed8';
    if (ratio < 0.4) return '#0ea5e9';
    if (ratio < 0.6) return '#22c55e';
    if (ratio < 0.8) return '#f59e0b';
    return '#dc2626';
};

// Threshold in degrees² for snapping hover to nearest route point (~400m radius)
export const MAP_HOVER_SNAP_SQ = 0.0036 * 0.0036;

export const MapRouteInteractionLayer = ({
    points,
    onHover,
    onDragStart,
    onDrag,
    onDragEnd,
}: {
    points: RouteInteractivePoint[];
    onHover: (chartIndex: number | null) => void;
    onDragStart?: (chartIndex: number) => void;
    onDrag?: (chartIndex: number) => void;
    onDragEnd?: () => void;
}) => {
    const draggingRef = useRef(false);

    useMapEvents({
        mousemove: (e) => {
            const nearest = findNearestRoutePoint(e.latlng, points);
            if (!nearest) {
                if (!draggingRef.current) onHover(null);
                return;
            }
            const dLat = nearest.lat - e.latlng.lat;
            const dLon = nearest.lon - e.latlng.lng;
            if (dLat * dLat + dLon * dLon > MAP_HOVER_SNAP_SQ) {
                if (!draggingRef.current) onHover(null);
                return;
            }
            if (draggingRef.current && onDrag) {
                onDrag(nearest.chartIndex);
            } else {
                onHover(nearest.chartIndex);
            }
        },
        mouseout: () => {
            if (!draggingRef.current) onHover(null);
        },
        mousedown: (e) => {
            if (!onDragStart) return;
            const nearest = findNearestRoutePoint(e.latlng, points);
            if (!nearest) return;
            const dLat = nearest.lat - e.latlng.lat;
            const dLon = nearest.lon - e.latlng.lng;
            if (dLat * dLat + dLon * dLon > MAP_HOVER_SNAP_SQ) return;
            draggingRef.current = true;
            onDragStart(nearest.chartIndex);
        },
        mouseup: () => {
            if (!draggingRef.current) return;
            draggingRef.current = false;
            onDragEnd?.();
        },
    });

    if (points.length < 2) return null;
    return null;
};
