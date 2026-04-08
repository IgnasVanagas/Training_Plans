import fitparse
import fitdecode
import gpxpy
import math
import pandas as pd
import numpy as np
from datetime import datetime

from .services.personal_records import CYCLING_EFFORT_WINDOWS, compute_activity_best_efforts

def safe_float(val):
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (ValueError, TypeError):
        return None


def _cycling_efforts_from_power_curve(power_curve):
    if not isinstance(power_curve, dict):
        return None

    efforts = []
    for window, seconds in CYCLING_EFFORT_WINDOWS.items():
        watts = safe_float(power_curve.get(window))
        if not watts or watts <= 0:
            continue
        efforts.append({
            "window": window,
            "seconds": seconds,
            "power": round(watts),
            "avg_hr": None,
            "elevation": 0,
        })

    return efforts or None


def _compute_best_efforts(streams, sport, power_curve=None):
    efforts = compute_activity_best_efforts(streams or [], sport or "")
    sport_name = (sport or "").lower()
    if not efforts and ("cycl" in sport_name or "bike" in sport_name or "ride" in sport_name):
        efforts = _cycling_efforts_from_power_curve(power_curve)
    return efforts

def parse_activity_file(file_path: str, file_type: str):
    if file_type == 'fit':
        return parse_fit(file_path)
    elif file_type == 'gpx':
        return parse_gpx(file_path)
    return None

def calculate_curve(df, column):
    if column not in df.columns or df[column].isnull().all():
        return None
        
    series = df[column].fillna(0)
    
    curve = {}
    # Every second from 1 to 59, then every minute from 1 to 120
    windows = {f'{s}s': s for s in range(1, 60)}
    windows.update({f'{m}min': m * 60 for m in range(1, 121)})
    
    for label, seconds in windows.items():
        if len(series) >= seconds:
            val = series.rolling(window=seconds).mean().max()
            # return float for better precision in speed, int for power
            curve[label] = float(val) if not pd.isna(val) else 0
        else:
            curve[label] = 0
            
    return curve

def calculate_power_curve(df):
    curve = calculate_curve(df, 'power')
    if curve:
        # Cast to int for watts
        return {k: int(v) for k, v in curve.items()}
    return None

def calculate_pace_curve(df):
    # Returns Max Average Speed (m/s) curve
    # Frontend handles conversion to Pace (min/km)
    return calculate_curve(df, 'speed')

def calculate_hr_zones(df, max_hr=None):
    if 'heart_rate' not in df.columns or df['heart_rate'].isnull().all():
        return None

    hr = df['heart_rate'].dropna()
    if not max_hr or max_hr <= 0:
        max_hr = float(hr.max()) if len(hr) > 0 else 190.0

    # Simple 5 zone model based on Max HR
    # Z1: <60%, Z2: 60-70%, Z3: 70-80%, Z4: 80-90%, Z5: >90%
    zones = {
        'Z1': len(hr[hr < max_hr * 0.6]),
        'Z2': len(hr[(hr >= max_hr * 0.6) & (hr < max_hr * 0.7)]),
        'Z3': len(hr[(hr >= max_hr * 0.7) & (hr < max_hr * 0.8)]),
        'Z4': len(hr[(hr >= max_hr * 0.8) & (hr < max_hr * 0.9)]),
        'Z5': len(hr[hr >= max_hr * 0.9])
    }
    
    # Convert seconds (assuming 1hz) to minutes calculation could be more complex with timestamps
    # but for 1hz recording, count = seconds.
    # Normalize to percentage or raw seconds
    return zones

def clean_streams(df):
    # Replace NaNs/Infs with None for JSON serialization
    # Convert to object type first to ensure None is preserved and not converted back to NaN
    df = df.astype(object)
    df = df.replace([np.inf, -np.inf, np.nan], None)
    return df.where(pd.notnull(df), None).to_dict(orient='records')


def _ensure_distance_column(df: pd.DataFrame) -> pd.DataFrame:
    """If the 'distance' column is absent or entirely null, derive cumulative
    distance from speed × Δt so that best-effort computation has data.
    Called while timestamps are still datetime objects (before astype(str))."""
    if 'distance' in df.columns and df['distance'].notna().any():
        return df
    if 'speed' not in df.columns or df['speed'].isnull().all():
        return df

    speed = df['speed'].fillna(0.0)
    if 'timestamp' in df.columns:
        try:
            ts = pd.to_datetime(df['timestamp'], utc=True, errors='coerce')
            dt = ts.diff().dt.total_seconds().fillna(1.0).clip(lower=0.1, upper=10.0)
        except Exception:
            dt = pd.Series([1.0] * len(df), index=df.index)
    else:
        dt = pd.Series([1.0] * len(df), index=df.index)

    df = df.copy()
    df['distance'] = (speed * dt).cumsum()
    return df

def infer_sport(df):
    # Heuristics to guess sport from stream data
    if 'vertical_oscillation' in df.columns and df['vertical_oscillation'].notna().sum() > 10:
        return 'running'
    if 'stance_time' in df.columns and df['stance_time'].notna().sum() > 10:
        return 'running'

    avg_speed_m_s = df['speed'].mean() if 'speed' in df.columns else 0
    avg_cadence = df['cadence'].mean() if 'cadence' in df.columns else 0

    if avg_cadence > 130 and avg_speed_m_s < 7:
        return 'running'
    if avg_speed_m_s > 8:  # > 29 km/h, likely cycling
        return 'cycling'

    return 'unknown'


# FIT sport enum values that map to our canonical sport names
_FIT_SPORT_MAP: dict[str, str] = {
    'running': 'running',
    'cycling': 'cycling',
    'swimming': 'swimming',
    'walking': 'walking',
    'hiking': 'hiking',
    'transition': 'triathlon',
    'multisport': 'triathlon',
    'triathlon': 'triathlon',
    'open_water': 'swimming',
    'cross_country_skiing': 'cross_country_skiing',
    'alpine_skiing': 'alpine_skiing',
    'snowboarding': 'snowboarding',
    'rowing': 'rowing',
    'mountaineering': 'hiking',
    'e_biking': 'cycling',
    'motorcycling': 'cycling',
    'boating': 'other',
    'driving': 'other',
    'golf': 'other',
    'hang_gliding': 'other',
    'horseback_riding': 'other',
    'hunting': 'other',
    'fishing': 'other',
    'inline_skating': 'other',
    'rock_climbing': 'other',
    'sailing': 'other',
    'ice_skating': 'other',
    'sky_diving': 'other',
    'snowshoeing': 'hiking',
    'snowmobiling': 'other',
    'stand_up_paddleboarding': 'other',
    'surfing': 'other',
    'wakeboarding': 'other',
    'water_skiing': 'other',
    'kayaking': 'other',
    'rafting': 'other',
    'windsurfing': 'other',
    'kitesurfing': 'other',
    'tactical': 'other',
    'jumpmaster': 'other',
    'boxing': 'strength_training',
    'floor_climbing': 'strength_training',
    'strength_training': 'strength_training',
    'fitness_equipment': 'strength_training',
}


def normalize_fit_sport(raw: str, df: pd.DataFrame | None = None) -> str:
    """Convert a raw FIT sport string to a canonical sport name.
    Falls back to stream-based inference when the value is generic/unknown."""
    lower = raw.strip().lower()
    # Direct lookup first
    if lower in _FIT_SPORT_MAP:
        return _FIT_SPORT_MAP[lower]
    # Partial match fallbacks
    if 'run' in lower:
        return 'running'
    if 'cycl' in lower or 'bike' in lower or 'ride' in lower or 'e_bik' in lower:
        return 'cycling'
    if 'swim' in lower:
        return 'swimming'
    if 'walk' in lower or 'hik' in lower:
        return 'walking'
    if 'strength' in lower or 'fitness' in lower or 'gym' in lower:
        return 'strength_training'
    # Generic / unknown → fall back to heuristic inference from streams
    if lower in ('generic', 'unknown', '') and df is not None:
        return infer_sport(df)
    return lower or 'unknown'


def _haversine_distance_m(lat1, lon1, lat2, lon2):
    if None in (lat1, lon1, lat2, lon2):
        return 0.0
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def _strip_xml_namespace(tag):
    if not tag:
        return ""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return str(tag)


def _extract_gpx_extension_metrics(point):
    aliases = {
        "heart_rate": {"hr", "heart_rate", "heartrate"},
        "cadence": {"cad", "cadence", "run_cadence"},
        "power": {"power", "watts"},
    }
    out = {"heart_rate": None, "cadence": None, "power": None}

    for extension in (point.extensions or []):
        for node in extension.iter():
            tag = _strip_xml_namespace(getattr(node, "tag", "")).lower()
            text = (getattr(node, "text", None) or "").strip()
            if not tag or not text:
                continue
            parsed = safe_float(text)
            if parsed is None:
                continue

            for key, key_aliases in aliases.items():
                if tag in key_aliases:
                    out[key] = parsed

    return out

def parse_fit(file_path):
    # Try using fitdecode first as it handles Coros files and errors better
    try:
        return parse_fit_decode(file_path)
    except Exception as e:
        print(f"Fitdecode failed: {e}. Falling back to fitparse.")
        pass

    # check_crc=False allows reading files with bad checksums
    try:
        fitfile = fitparse.FitFile(file_path, check_crc=False)
    except Exception as e:
        print(f"Error opening FIT file: {e}")
        return None
    
    data_points = []
    sport = "unknown"
    start_time = None
    
    try:
        # Iterate over all messages once to catch sport/session even if errors occur later
        messages = fitfile.get_messages()
        
        while True:
            try:
                msg = next(messages)
                
                if msg.name == 'session' or msg.name == 'sport':
                    if msg.get_value('sport'):
                        sport = str(msg.get_value('sport'))
                    if msg.name == 'session' and msg.get_value('start_time'):
                         start_time = msg.get_value('start_time')
                        
                elif msg.name == 'record':
                    r_data = {}
                    for data in msg:
                        if data.name == 'timestamp':
                            r_data['timestamp'] = data.value
                        elif data.name == 'position_lat':
                            r_data['lat'] = data.value * (180 / 2**31) if data.value else None
                        elif data.name == 'position_long':
                            r_data['lon'] = data.value * (180 / 2**31) if data.value else None
                        elif data.name == 'distance':
                            r_data['distance'] = data.value
                        elif data.name == 'enhanced_speed':
                            r_data['speed'] = data.value
                        elif data.name == 'speed':
                            # Only use plain speed if enhanced_speed hasn't been set
                            if 'speed' not in r_data:
                                r_data['speed'] = data.value
                        elif data.name == 'heart_rate':
                            r_data['heart_rate'] = data.value
                        elif data.name == 'power':
                            r_data['power'] = data.value
                        elif data.name == 'cadence':
                            r_data['cadence'] = data.value
                        elif data.name == 'enhanced_altitude':
                            r_data['altitude'] = data.value
                        elif data.name == 'altitude':
                            if 'altitude' not in r_data:
                                r_data['altitude'] = data.value
                        elif data.name == 'vertical_oscillation':
                             r_data['vertical_oscillation'] = data.value
                        elif data.name == 'stance_time':
                             r_data['stance_time'] = data.value # Ground Contact Time
                        elif data.name == 'step_length':
                             r_data['step_length'] = data.value
                        elif data.name == 'left_right_balance':
                             r_data['left_right_balance'] = data.value
                    
                    if 'timestamp' in r_data:
                        data_points.append(r_data)
                        
            except StopIteration:
                break
            except Exception as e:
                # If a message is malformed, we might lose the stream if generator closes.
                print(f"Error parsing message: {e}")
                # Try to continue if the generator is still alive. 
                # If next() failed, it's risky, but worth a try for partial recovery.
                continue

    except Exception as e:
        print(f"Error in main loop: {e}")

    if not data_points:
        return None

    df = pd.DataFrame(data_points)

    # Derive cumulative distance from speed if missing (needed for best efforts)
    df = _ensure_distance_column(df)

    # Normalize sport name (handles FIT enum strings like "generic", "e_biking", etc.)
    sport = normalize_fit_sport(sport, df)

    # Calculate Summaries
    # Prefer calculated summaries from full stream, or explicit session message if implemented

    # Calculate Elevation Gain for fallback parser
    total_ascent = 0
    if 'altitude' in df.columns:
        deltas = df['altitude'].diff()
        total_ascent = safe_float(deltas[deltas > 0].sum())

    summary = {
        "distance": safe_float(df['distance'].max()) if 'distance' in df else 0,
        "duration": safe_float((df['timestamp'].iloc[-1] - df['timestamp'].iloc[0]).total_seconds()) if len(df) > 1 else 0,
        "avg_speed": safe_float(df['speed'].mean()) if 'speed' in df else 0,
        "average_hr": safe_float(df['heart_rate'].mean()) if 'heart_rate' in df else 0,
        "average_watts": safe_float(df['power'].mean()) if 'power' in df else 0,
        "max_hr": safe_float(df['heart_rate'].max()) if 'heart_rate' in df else 0,
        "max_speed": safe_float(df['speed'].max()) if 'speed' in df else 0,
        "max_watts": safe_float(df['power'].max()) if 'power' in df else 0,
        "avg_cadence": safe_float(df['cadence'].mean()) if 'cadence' in df else 0,
        "max_cadence": safe_float(df['cadence'].max()) if 'cadence' in df else 0,
        "total_elevation_gain": total_ascent,
        "total_calories": 0 # Calc not easy without weight
    }
    
    # Advanced Stats
    # Power curve for running might be unwanted if it's junk data.
    # Check if power is mostly 0
    power_curve = calculate_power_curve(df)

    if sport == 'running' and 'power' in df.columns:
         p_mean = df['power'].fillna(0).mean()
         if p_mean < 10: # If avg power is very low, it's likely noise or missing
             power_curve = None

    hr_zones = calculate_hr_zones(df)
    pace_curve = calculate_pace_curve(df)
    splits_metric = calculate_metric_splits(df)

    # Capture start_time and convert timestamps to strings BEFORE clean_streams
    # so that no non-JSON-serializable Timestamp objects leak into the streams list.
    if not start_time and not df.empty and 'timestamp' in df.columns:
        start_time = df['timestamp'].iloc[0]

    if 'timestamp' in df.columns:
        df['timestamp'] = df['timestamp'].astype(str)

    streams = clean_streams(df)
    best_efforts = _compute_best_efforts(streams, sport, power_curve)

    return {
        "summary": summary,
        "streams": streams,
        "sport": sport,
        "start_time": start_time,
        "power_curve": power_curve,
        "hr_zones": hr_zones,
        "pace_curve": pace_curve,
        "best_efforts": best_efforts,
        "laps": [],
        "splits_metric": splits_metric,
    }

def compute_metric_splits_from_points(points: list, interval: int = 1000) -> list:
    """Compute per-km (or per-interval) splits from a list of stream point dicts.

    Each point must have at least ``distance`` (cumulative metres).
    Optional fields: ``heart_rate``, ``power``.
    Points are assumed to be ~1 Hz (one per second).
    """
    if not points or len(points) < 2:
        return []

    # Extract valid distance-sorted entries
    valid = []
    for i, p in enumerate(points):
        d = p.get("distance")
        if d is None:
            continue
        try:
            valid.append((i, float(d)))
        except (ValueError, TypeError):
            continue
    if len(valid) < 2:
        return []

    splits: list[dict] = []
    split_start_idx = 0
    split_num = 1

    for vi in range(1, len(valid)):
        cur_global, cur_dist = valid[vi]
        start_global, start_dist = valid[split_start_idx]
        seg_dist = cur_dist - start_dist

        if seg_dist >= interval or vi == len(valid) - 1:
            duration = float(cur_global - start_global)  # seconds (1-Hz assumption)
            if duration <= 0:
                split_start_idx = vi
                continue

            # Aggregate HR / power over the range
            hr_vals = [float(points[j].get("heart_rate")) for j in range(start_global, cur_global + 1) if points[j].get("heart_rate") is not None]
            pwr_vals = [float(points[j].get("power")) for j in range(start_global, cur_global + 1) if points[j].get("power") is not None]

            avg_speed = seg_dist / duration if duration > 0 else 0

            splits.append({
                "split": split_num,
                "dist_start": round(start_dist, 1),
                "distance": round(seg_dist, 1),
                "duration": round(duration, 1),
                "avg_speed": round(avg_speed, 3),
                "avg_hr": round(sum(hr_vals) / len(hr_vals), 1) if hr_vals else None,
                "max_hr": round(max(hr_vals), 1) if hr_vals else None,
                "avg_power": round(sum(pwr_vals) / len(pwr_vals), 1) if pwr_vals else None,
            })

            split_num += 1
            split_start_idx = vi

    return splits


def calculate_metric_splits(df, interval=1000):
    if df.empty or 'distance' not in df.columns:
        return []

    splits = []
    
    # Ensure distance is monotonic and handle restarts? 
    # Usually distance from FIT is cumulative.
    
    # Group by integer division of distance
    # Filter out points where distance is NaN
    valid_df = df.dropna(subset=['distance']).copy()
    if valid_df.empty:
        return []

    valid_df['split_idx'] = (valid_df['distance'] // interval).astype(int)
    
    grouped = valid_df.groupby('split_idx')
    
    for idx, group in grouped:
        if idx < 0: continue
        
        # Calculate split stats
        # Start time is first timestamp of group
        # End time is last timestamp of group
        # But wait, groups might be disjoint if recording stopped.
        # Simple approach: delta between min and max timestamp in group
        
        t_start = group['timestamp'].min()
        t_end = group['timestamp'].max()
        
        if pd.isnull(t_start) or pd.isnull(t_end):
             continue
             
        duration = (t_end - t_start).total_seconds()
        
        if duration <= 0:
            continue
            
        dist_start = group['distance'].min()
        dist_end = group['distance'].max()
        distance = dist_end - dist_start
        
        # If distance is too small (e.g. at end of run), maybe skip or include?
        # Usually splits are fixed distance.
        # But the last split might be partial.
        
        avg_hr = group['heart_rate'].mean() if 'heart_rate' in group else None
        max_hr = group['heart_rate'].max() if 'heart_rate' in group else None
        avg_pwr = group['power'].mean() if 'power' in group else None
        
        # Pace = time / distance (min/km)
        # speed = dist/time
        # pace_min_per_km = (duration / 60) / (distance / 1000)
        
        avg_speed = distance / duration if duration > 0 else 0
        
        splits.append({
            "split": int(idx) + 1,
            "dist_start": safe_float(dist_start),
            "distance": safe_float(distance),
            "duration": safe_float(duration),
            "avg_speed": safe_float(avg_speed),
            "avg_hr": safe_float(avg_hr),
            "max_hr": safe_float(max_hr),
            "avg_power": safe_float(avg_pwr)
        })
        
    return splits

def parse_fit_decode(file_path):
    data_points = []
    laps = []
    sport = "unknown"
    session_stats = {}
    start_time = None
    
    with fitdecode.FitReader(file_path) as fit:
        for frame in fit:
            if isinstance(frame, fitdecode.FitDataMessage):
                if frame.name == 'session':
                   if frame.has_field('sport'):
                       sport_val = frame.get_value('sport')
                       if sport_val:
                           sport = str(sport_val)  # normalize_fit_sport applied after df is built
                   
                   if frame.has_field('start_time'):
                       start_time = frame.get_value('start_time')

                   # Extract session stats
                   session_stats['total_ascent'] = frame.get_value('total_ascent', fallback=0)
                   session_stats['total_descent'] = frame.get_value('total_descent', fallback=0)
                   session_stats['total_calories'] = frame.get_value('total_calories', fallback=0)
                   session_stats['max_cadence'] = frame.get_value('max_cadence', fallback=0)
                   session_stats['avg_cadence'] = frame.get_value('avg_cadence', fallback=0)
                   session_stats['max_heart_rate'] = frame.get_value('max_heart_rate', fallback=0)
                   session_stats['max_speed'] = frame.get_value('max_speed', fallback=0)
                   session_stats['max_power'] = frame.get_value('max_power', fallback=0)
                   session_stats['avg_speed'] = frame.get_value('avg_speed', fallback=0)
                   session_stats['total_distance'] = frame.get_value('total_distance', fallback=0)
                   session_stats['total_elapsed_time'] = frame.get_value('total_elapsed_time', fallback=0)
                   session_stats['total_timer_time'] = frame.get_value('total_timer_time', fallback=0)
                   session_stats['avg_power'] = frame.get_value('avg_power', fallback=0)
                   session_stats['avg_heart_rate'] = frame.get_value('avg_heart_rate', fallback=0)
                           
                elif frame.name == 'lap':
                    lap_data = {}
                    # start_time, total_elapsed_time, total_distance, avg_speed
                    lap_data['start_time'] = frame.get_value('start_time', fallback=None)
                    lap_data['duration'] = frame.get_value('total_elapsed_time', fallback=None)
                    lap_data['distance'] = frame.get_value('total_distance', fallback=None)
                    lap_data['avg_speed'] = frame.get_value('avg_speed', fallback=None)
                    lap_data['avg_hr'] = frame.get_value('avg_heart_rate', fallback=None)
                    lap_data['max_hr'] = frame.get_value('max_heart_rate', fallback=None)
                    lap_data['avg_power'] = frame.get_value('avg_power', fallback=None)
                    lap_data['split'] = len(laps) + 1
                    
                    # Convert start_time to string if datetime
                    if isinstance(lap_data['start_time'], datetime):
                        lap_data['start_time'] = str(lap_data['start_time'])
                    
                    laps.append(lap_data)
                           
                elif frame.name == 'record':
                    r_data = {}
                    if frame.has_field('timestamp'):
                         r_data['timestamp'] = frame.get_value('timestamp')
                         
                    # For performance, could check has_field before get_value, 
                    # but get_value returns None if not present usually (or raises?)
                    # fitdecode get_value returns None? No, it takes name or index. 
                    # If field not in message, get_value raises KeyOrIndexError? No.
                    # frame.get_value(name, fallback=None)
                    
                    r_data['lat'] = frame.get_value('position_lat', fallback=None)
                    if r_data['lat']: r_data['lat'] *= (180 / 2**31)
                    
                    r_data['lon'] = frame.get_value('position_long', fallback=None)
                    if r_data['lon']: r_data['lon'] *= (180 / 2**31)
                    
                    r_data['distance'] = frame.get_value('distance', fallback=None)
                    # Prefer enhanced_speed (higher precision), fall back to speed
                    r_data['speed'] = frame.get_value('enhanced_speed', fallback=None) or frame.get_value('speed', fallback=None)
                    r_data['heart_rate'] = frame.get_value('heart_rate', fallback=None)
                    r_data['power'] = frame.get_value('power', fallback=None)
                    r_data['cadence'] = frame.get_value('cadence', fallback=None)
                    # Prefer enhanced_altitude (higher precision), fall back to altitude
                    r_data['altitude'] = frame.get_value('enhanced_altitude', fallback=None) or frame.get_value('altitude', fallback=None)
                    r_data['vertical_oscillation'] = frame.get_value('vertical_oscillation', fallback=None)
                    r_data['stance_time'] = frame.get_value('stance_time', fallback=None)
                    r_data['step_length'] = frame.get_value('step_length', fallback=None)
                    r_data['left_right_balance'] = frame.get_value('left_right_balance', fallback=None)
                    
                    if 'timestamp' in r_data:
                        data_points.append(r_data)

    if not data_points:
        return None

    df = pd.DataFrame(data_points)

    # Derive cumulative distance from speed if missing (needed for best efforts)
    df = _ensure_distance_column(df)

    # Normalize sport name (handles FIT enum strings like "generic", "e_biking", etc.)
    sport = normalize_fit_sport(sport, df)

    # Stats Calculation Helpers
    def get_max_stat(df, col, session_val):
        val = session_val
        if (not val or val == 0) and col in df.columns:
            val = df[col].max()
        return safe_float(val)
        
    def get_avg_stat(df, col, session_val):
        val = session_val
        if (not val or val == 0) and col in df.columns:
            val = df[col].mean()
        return safe_float(val)

    # Cadence logic: 
    # Just take raw values.
    avg_cadence = get_avg_stat(df, 'cadence', session_stats.get('avg_cadence'))
    max_cadence = get_max_stat(df, 'cadence', session_stats.get('max_cadence'))
    
    # Elevation Gain
    total_ascent = safe_float(session_stats.get('total_ascent', 0))
    if (total_ascent == 0 or total_ascent is None) and 'altitude' in df.columns:
        # Calculate from stream: sum of positive deltas
        deltas = df['altitude'].diff()
        total_ascent = safe_float(deltas[deltas > 0].sum())

    summary = {
        "distance": get_max_stat(df, 'distance', session_stats.get('total_distance')),
        "duration": get_max_stat(df, None, session_stats.get('total_elapsed_time')) if session_stats.get('total_elapsed_time') else safe_float((df['timestamp'].iloc[-1] - df['timestamp'].iloc[0]).total_seconds()) if len(df) > 1 else 0,
        "avg_speed": get_avg_stat(df, 'speed', session_stats.get('avg_speed')),
        "average_hr": get_avg_stat(df, 'heart_rate', session_stats.get('avg_heart_rate')),
        "average_watts": get_avg_stat(df, 'power', session_stats.get('avg_power')),
        "max_hr": get_max_stat(df, 'heart_rate', session_stats.get('max_heart_rate')),
        "max_speed": get_max_stat(df, 'speed', session_stats.get('max_speed')),
        "max_watts": get_max_stat(df, 'power', session_stats.get('max_power')),
        "avg_cadence": avg_cadence,
        "max_cadence": max_cadence,
        "total_elevation_gain": total_ascent,
        "total_calories": safe_float(session_stats.get('total_calories', 0)),
        "total_timer_time": safe_float(session_stats.get('total_timer_time')) or None,
    }

    power_curve = calculate_power_curve(df)
    if sport == 'running' and 'power' in df.columns:
         p_mean = df['power'].fillna(0).mean()
         if p_mean < 10:
             power_curve = None

    hr_zones = calculate_hr_zones(df)
    pace_curve = calculate_pace_curve(df)
    splits_metric = calculate_metric_splits(df)

    # Capture start_time and convert timestamps to strings BEFORE clean_streams
    # so that no non-JSON-serializable Timestamp objects leak into the streams list.
    if not start_time and not df.empty and 'timestamp' in df.columns:
        start_time = df['timestamp'].iloc[0]

    if 'timestamp' in df.columns:
        df['timestamp'] = df['timestamp'].astype(str)

    streams = clean_streams(df)
    best_efforts = _compute_best_efforts(streams, sport, power_curve)

    return {
        "summary": summary,
        "streams": streams,
        "sport": sport,
        "power_curve": power_curve,
        "hr_zones": hr_zones,
        "pace_curve": pace_curve,
        "best_efforts": best_efforts,
        "laps": laps,
        "splits_metric": splits_metric,
        "start_time": start_time
    }

def parse_gpx(file_path):
    with open(file_path, 'r', encoding='utf-8') as gpx_file:
        gpx = gpxpy.parse(gpx_file)

    start_time = None
    time_bounds = gpx.get_time_bounds()
    if time_bounds:
        start_time = time_bounds.start_time

    data_points = []
    cumulative_distance = 0.0
    total_ascent = 0.0

    for track in gpx.tracks:
        for segment in track.segments:
            prev_lat = None
            prev_lon = None
            prev_alt = None
            prev_time = None
            for point in segment.points:
                ext_metrics = _extract_gpx_extension_metrics(point)

                segment_distance = _haversine_distance_m(prev_lat, prev_lon, point.latitude, point.longitude)
                if segment_distance < 0:
                    segment_distance = 0.0
                cumulative_distance += segment_distance

                if prev_alt is not None and point.elevation is not None:
                    ascent_delta = point.elevation - prev_alt
                    if ascent_delta > 0:
                        total_ascent += ascent_delta

                speed = None
                if prev_time and point.time:
                    delta_s = (point.time - prev_time).total_seconds()
                    if delta_s and delta_s > 0:
                        speed = segment_distance / delta_s

                r_data = {
                    'timestamp': point.time,
                    'lat': point.latitude,
                    'lon': point.longitude,
                    'altitude': point.elevation,
                    'distance': cumulative_distance,
                    'speed': speed,
                    'heart_rate': ext_metrics['heart_rate'],
                    'cadence': ext_metrics['cadence'],
                    'power': ext_metrics['power'],
                }
                data_points.append(r_data)

                prev_lat = point.latitude
                prev_lon = point.longitude
                prev_alt = point.elevation
                prev_time = point.time

    if not data_points:
        return None

    df = pd.DataFrame(data_points)

    distance_total = safe_float(df['distance'].max()) if 'distance' in df.columns else None
    if not distance_total:
        distance_total = safe_float(gpx.length_2d())

    duration_total = safe_float(gpx.get_duration())
    if (duration_total is None or duration_total <= 0) and 'timestamp' in df.columns and len(df) > 1:
        try:
            duration_total = safe_float((df['timestamp'].iloc[-1] - df['timestamp'].iloc[0]).total_seconds())
        except Exception:
            duration_total = None

    avg_speed = None
    if duration_total and duration_total > 0 and distance_total:
        avg_speed = distance_total / duration_total
    elif 'speed' in df.columns:
        avg_speed = safe_float(df['speed'].mean())

    sport = infer_sport(df)

    summary = {
        "distance": distance_total,
        "duration": duration_total,
        "avg_speed": safe_float(avg_speed),
        "average_hr": safe_float(df['heart_rate'].mean()) if 'heart_rate' in df.columns else 0,
        "average_watts": safe_float(df['power'].mean()) if 'power' in df.columns else 0,
        "max_hr": safe_float(df['heart_rate'].max()) if 'heart_rate' in df.columns else 0,
        "max_speed": safe_float(df['speed'].max()) if 'speed' in df.columns else 0,
        "max_watts": safe_float(df['power'].max()) if 'power' in df.columns else 0,
        "avg_cadence": safe_float(df['cadence'].mean()) if 'cadence' in df.columns else 0,
        "max_cadence": safe_float(df['cadence'].max()) if 'cadence' in df.columns else 0,
        "total_elevation_gain": safe_float(total_ascent),
        "total_calories": 0,
        "total_timer_time": None,  # GPX has no timer; moving_time computed in endpoint from streams
    }

    power_curve = calculate_power_curve(df)
    if sport == 'running' and 'power' in df.columns:
        p_mean = df['power'].fillna(0).mean()
        if p_mean < 10:
            power_curve = None

    hr_zones = calculate_hr_zones(df)
    pace_curve = calculate_pace_curve(df)
    splits_metric = calculate_metric_splits(df)

    df['timestamp'] = df['timestamp'].astype(str)

    return {
        "summary": summary,
        "streams": clean_streams(df),
        "sport": sport,
        "power_curve": power_curve,
        "hr_zones": hr_zones,
        "pace_curve": pace_curve,
        "laps": [],
        "splits_metric": splits_metric,
        "start_time": start_time
    }

