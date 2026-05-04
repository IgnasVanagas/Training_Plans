export type ActivityDetail = {
  id: number;
  athlete_id: number;
  filename: string;
  created_at: string;
  sport: string;
  distance: number;
  duration: number;
  moving_time?: number | null;
  avg_speed: number;
  average_hr: number;
  average_watts: number;
    streams: any;
  power_curve: Record<string, number> | null;
  hr_zones: Record<string, number> | null;
  best_efforts: Array<{
    window?: string; seconds?: number; power?: number;
    distance?: string; meters?: number; time_seconds?: number;
    avg_hr?: number | null; elevation?: number;
  }> | null;
  personal_records: Record<string, number> | null;
  laps: any[] | null;
  splits_metric: any[] | null;
  max_hr?: number;
  max_speed?: number;
  max_watts?: number;
  max_cadence?: number;
  avg_cadence?: number;
  total_elevation_gain?: number;
  total_calories?: number;
    is_deleted?: boolean;
    aerobic_load?: number;
    anaerobic_load?: number;
    total_load_impact?: number;
    rpe?: number | null;
    lactate_mmol_l?: number | null;
    notes?: string | null;
    ftp_at_time?: number | null;
    weight_at_time?: number | null;
    strava_activity_url?: string | null;
    planned_comparison?: {
        workout_id: number;
        workout_title: string;
        sport_type?: string | null;
        planned?: {
            duration_min?: number | null;
            distance_km?: number | null;
            intensity?: string | null;
            description?: string | null;
            structure?: any[] | null;
        } | null;
        actual?: {
            activity_id?: number | null;
            duration_min?: number | null;
            distance_km?: number | null;
        } | null;
        summary?: {
            has_planned_distance?: boolean | null;
            duration_delta_min?: number | null;
            distance_delta_km?: number | null;
            duration_match_pct?: number | null;
            distance_match_pct?: number | null;
            intensity_match_pct?: number | null;
            intensity_status?: 'green' | 'yellow' | 'red' | string | null;
            execution_score_pct?: number | null;
            execution_status?: 'great' | 'good' | 'ok' | 'fair' | 'subpar' | 'poor' | 'incomplete' | string | null;
            execution_components?: Record<string, number> | null;
            execution_trace?: {
                model_version?: string | null;
                scoring_basis?: string | null;
                used_weight_pct?: number | null;
                weighted_total_points?: number | null;
                normalization_divisor?: number | null;
                components?: Array<{
                    key?: string | null;
                    label?: string | null;
                    available?: boolean | null;
                    weight_fraction?: number | null;
                    weight_pct?: number | null;
                    component_score_pct?: number | null;
                    weighted_points?: number | null;
                    normalized_contribution_pct?: number | null;
                    note?: string | null;
                }>;
                status_thresholds?: Array<{
                    status?: string | null;
                    min_score_pct?: number | null;
                }>;
            } | null;
            split_importance?: 'high' | 'low' | string | null;
            split_source?: string | null;
            split_note?: string | null;
        };
        intensity?: {
            note?: string | null;
        } | null;
        splits?: Array<{
            split: number;
            planned?: {
                planned_duration_s?: number | null;
                category?: string | null;
                target?: {
                    type?: string | null;
                    value?: number | null;
                    min?: number | null;
                    max?: number | null;
                    zone?: number | null;
                } | null;
            } | null;
            actual?: {
                actual_duration_s?: number | null;
                avg_hr?: number | null;
                avg_power?: number | null;
                avg_speed?: number | null;
            } | null;
            delta_duration_s?: number | null;
            delta_duration_pct?: number | null;
        }>;
    } | null;
};

export type EffortSegmentMeta = {
    startIndex: number;
    endIndex: number;
    centerIndex: number;
    seconds: number | null;
    meters: number | null;
    avgPower: number | null;
    avgHr: number | null;
    speedKmh: number | null;
};

export type HardEffort = {
    key: string;
    zone: number;           // 1–7
    isWarmup?: boolean;
    isSprint?: boolean;
    startIndex: number;
    endIndex: number;
    centerIndex: number;
    durationSeconds: number;
    avgPower: number | null;
    wap: number | null;
    maxPower: number | null;
    avgHr: number | null;
    maxHr: number | null;
    avgSpeedKmh: number | null;
    pctRef: number | null;
};
export type HardEffortRest = {
    durationSeconds: number;
    avgHr: number | null;
    maxHr: number | null;
    avgPower: number | null;
    wap: number | null;
    maxPower: number | null;
    pctRef: number | null;
    avgSpeedKmh: number | null;
    zone: number;           // 1–7
};

export type RouteInteractivePoint = {
    chartIndex: number;
    lat: number;
    lon: number;
};
