import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  useMap: vi.fn(),
  useMapEvents: vi.fn(),
}));

vi.mock("leaflet", () => ({
  default: {
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    latLngBounds: vi.fn(),
  },
}));

import {
  MAP_HOVER_SNAP_SQ,
  findNearestRoutePoint,
  getHeatColor,
  toDistanceLabel,
} from "./mapHelpers";

describe("activity detail map helpers", () => {
  const points = [
    { lat: 54.7, lon: 25.3, chartIndex: 10 },
    { lat: 54.71, lon: 25.31, chartIndex: 20 },
    { lat: 54.75, lon: 25.4, chartIndex: 30 },
  ];

  it("formats distance labels and hover snap threshold", () => {
    expect(toDistanceLabel(12.3456)).toBe("12.35 km");
    expect(toDistanceLabel(-1)).toBe("-");
    expect(toDistanceLabel("bad")).toBe("-");
    expect(MAP_HOVER_SNAP_SQ).toBeCloseTo(0.0036 * 0.0036);
  });

  it("finds the nearest route point", () => {
    expect(findNearestRoutePoint({ lat: 54.7001, lng: 25.3001 } as never, points as never)).toEqual(points[0]);
    expect(findNearestRoutePoint({ lat: 0, lng: 0 } as never, [])).toBeNull();
  });

  it("returns a stable heat palette across ranges", () => {
    expect(getHeatColor(Number.NaN, 0, 100)).toBe("#3b82f6");
    expect(getHeatColor(10, 0, 100)).toBe("#1d4ed8");
    expect(getHeatColor(30, 0, 100)).toBe("#0ea5e9");
    expect(getHeatColor(50, 0, 100)).toBe("#22c55e");
    expect(getHeatColor(70, 0, 100)).toBe("#f59e0b");
    expect(getHeatColor(95, 0, 100)).toBe("#dc2626");
  });
});