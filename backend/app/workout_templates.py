# Workout template data for seeding the structured workout library.
# Each entry matches StructuredWorkoutCreate schema.

RUN_WORKOUTS = [
    # ── Existing ──────────────────────────────────────────────────────────────
    {
        "title": "Classic 5x1km Intervals",
        "description": "5x1km repeats at threshold pace with 2 min recovery.",
        "sport_type": "Running",
        "tags": ["Intervals", "Threshold"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 3}},
            {
                "type": "repeat",
                "repeats": 5,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "distance", "value": 1000}, "target": {"type": "pace", "metric": "percent_threshold_pace", "value": 100}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 2}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "Long Run with Tempo Finish",
        "description": "90 min endurance run, picking up the pace for the last 20 mins.",
        "sport_type": "Running",
        "tags": ["Endurance", "Tempo"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "rpe", "value": 3}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 3000}, "target": {"type": "heart_rate_zone", "zone": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "heart_rate_zone", "zone": 3}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 300}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "Speed Pyramid",
        "description": "1-2-3-2-1 mins hard with equal recovery.",
        "sport_type": "Running",
        "tags": ["Speed", "Intervals"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 3}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 60}, "target": {"type": "rpe", "value": 9}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 60}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 8}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 180}, "target": {"type": "rpe", "value": 7}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 180}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 8}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 120}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 60}, "target": {"type": "rpe", "value": 9}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    # ── New ───────────────────────────────────────────────────────────────────
    {
        "title": "Easy Base Run",
        "description": "60-minute easy aerobic run to build endurance base. Keep effort conversational throughout.",
        "sport_type": "Running",
        "tags": ["Endurance", "Base", "Easy"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 2400}, "target": {"type": "heart_rate_zone", "zone": 2}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "10x400m Track Repeats",
        "description": "10 repetitions of 400m at 5K race pace with 90-second standing recovery. Develops speed and running economy.",
        "sport_type": "Running",
        "tags": ["Speed", "Intervals", "Track"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "rpe", "value": 3}},
            {
                "type": "repeat",
                "repeats": 10,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "distance", "value": 400}, "target": {"type": "pace", "metric": "percent_threshold_pace", "value": 108}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 90}, "target": {"type": "rpe", "value": 2}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "Tempo Run 30min",
        "description": "Sustained 30-minute threshold effort. 'Comfortably hard' — you can speak in short phrases.",
        "sport_type": "Running",
        "tags": ["Threshold", "Tempo"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "rpe", "value": 3}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1800}, "target": {"type": "heart_rate_zone", "zone": 4}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "3x10min Threshold Blocks",
        "description": "Three 10-minute blocks at lactate threshold pace with 3-minute jog recoveries. Raises anaerobic threshold.",
        "sport_type": "Running",
        "tags": ["Threshold", "Intervals"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "rpe", "value": 3}},
            {
                "type": "repeat",
                "repeats": 3,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 600}, "target": {"type": "pace", "metric": "percent_threshold_pace", "value": 100}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 180}, "target": {"type": "rpe", "value": 2}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "Progression Run",
        "description": "Start easy and progressively increase pace every 10 minutes, finishing at threshold effort.",
        "sport_type": "Running",
        "tags": ["Progression", "Tempo"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 600}, "target": {"type": "heart_rate_zone", "zone": 1}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 600}, "target": {"type": "heart_rate_zone", "zone": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 600}, "target": {"type": "heart_rate_zone", "zone": 3}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 600}, "target": {"type": "heart_rate_zone", "zone": 4}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 300}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "Hill Repeats 8x",
        "description": "8 hard uphill surges (~45 seconds) followed by easy jog-down recovery. Builds leg strength and running power.",
        "sport_type": "Running",
        "tags": ["Strength", "Hills", "Speed"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "rpe", "value": 3}},
            {
                "type": "repeat",
                "repeats": 8,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 45}, "target": {"type": "rpe", "value": 9}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 90}, "target": {"type": "rpe", "value": 2}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "Fartlek Run",
        "description": "Speed play: alternate 5 minutes easy / 1 minute hard across 40 minutes. Develops speed in a low-pressure format.",
        "sport_type": "Running",
        "tags": ["Speed", "Fartlek"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 3}},
            {
                "type": "repeat",
                "repeats": 5,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 300}, "target": {"type": "rpe", "value": 5}},
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 60}, "target": {"type": "rpe", "value": 8}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "rpe", "value": 2}},
        ],
    },
    {
        "title": "Easy Run + Strides",
        "description": "20 minutes easy followed by 4 short strides (25 sec at ~5K effort). Great for activation or shake-out days.",
        "sport_type": "Running",
        "tags": ["Easy", "Recovery", "Speed"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 300}, "target": {"type": "rpe", "value": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "heart_rate_zone", "zone": 2}},
            {
                "type": "repeat",
                "repeats": 4,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 25}, "target": {"type": "rpe", "value": 9}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 60}, "target": {"type": "rpe", "value": 2}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 300}, "target": {"type": "rpe", "value": 2}},
        ],
    },
]

CYCLE_WORKOUTS = [
    # ── Existing ──────────────────────────────────────────────────────────────
    {
        "title": "2x20 FTP Intervals",
        "description": "Classic threshold builder. 2x20mins at 95-100% FTP.",
        "sport_type": "Cycling",
        "tags": ["Threshold", "FTP"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "power", "metric": "percent_ftp", "value": 95}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 600}, "target": {"type": "power_zone", "zone": 1}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "power", "metric": "percent_ftp", "value": 95}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
    {
        "title": "VO2Max 4x4min",
        "description": "High intensity intervals to boost VO2Max.",
        "sport_type": "Cycling",
        "tags": ["VO2Max", "Intervals"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 2}},
            {
                "type": "repeat",
                "repeats": 4,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 240}, "target": {"type": "power", "metric": "percent_ftp", "value": 115}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 240}, "target": {"type": "power_zone", "zone": 1}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
    {
        "title": "Endurance Ride (Zone 2)",
        "description": "Steady state endurance ride to build base.",
        "sport_type": "Cycling",
        "tags": ["Endurance", "Base"],
        "structure": [
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 5400}, "target": {"type": "power_zone", "zone": 2}},
        ],
    },
    # ── New ───────────────────────────────────────────────────────────────────
    {
        "title": "Sweet Spot 3x15min",
        "description": "Three 15-minute efforts at 88-93% FTP. The 'sweet spot' maximises training adaptation per effort.",
        "sport_type": "Cycling",
        "tags": ["Sweet Spot", "Threshold", "FTP"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 2}},
            {
                "type": "repeat",
                "repeats": 3,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 900}, "target": {"type": "power", "metric": "percent_ftp", "value": 90}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 300}, "target": {"type": "power_zone", "zone": 1}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
    {
        "title": "Sprint Intervals 6x30sec",
        "description": "6 maximal 30-second sprints with 4.5 min easy recovery. Develops peak power and neuromuscular capacity.",
        "sport_type": "Cycling",
        "tags": ["Sprint", "Neuromuscular", "Speed"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 1200}, "target": {"type": "power_zone", "zone": 2}},
            {
                "type": "repeat",
                "repeats": 6,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 30}, "target": {"type": "power", "metric": "percent_ftp", "value": 160}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 270}, "target": {"type": "power_zone", "zone": 1}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
    {
        "title": "Recovery Spin",
        "description": "40 minutes of very easy spinning. Active recovery to flush fatigue without adding training stress.",
        "sport_type": "Cycling",
        "tags": ["Recovery", "Easy"],
        "structure": [
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 2400}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
    {
        "title": "Over-Unders 3x12min",
        "description": "12-minute blocks alternating 3min at 95% FTP (under) and 1min at 105% FTP (over). Raises lactate tolerance.",
        "sport_type": "Cycling",
        "tags": ["Threshold", "FTP", "Over-Unders"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 2}},
            {
                "type": "repeat",
                "repeats": 3,
                "steps": [
                    {
                        "type": "repeat",
                        "repeats": 3,
                        "steps": [
                            {"type": "block", "category": "work", "duration": {"type": "time", "value": 180}, "target": {"type": "power", "metric": "percent_ftp", "value": 95}},
                            {"type": "block", "category": "work", "duration": {"type": "time", "value": 60}, "target": {"type": "power", "metric": "percent_ftp", "value": 105}},
                        ],
                    },
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 300}, "target": {"type": "power_zone", "zone": 1}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
    {
        "title": "8x2min VO2Max Efforts",
        "description": "Eight 2-minute maximal efforts at 120% FTP with equal rest. Builds aerobic ceiling and mental toughness.",
        "sport_type": "Cycling",
        "tags": ["VO2Max", "Intervals", "High Intensity"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 2}},
            {
                "type": "repeat",
                "repeats": 8,
                "steps": [
                    {"type": "block", "category": "work", "duration": {"type": "time", "value": 120}, "target": {"type": "power", "metric": "percent_ftp", "value": 120}},
                    {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 120}, "target": {"type": "power_zone", "zone": 1}},
                ],
            },
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
    {
        "title": "Long Endurance Ride",
        "description": "2.5-hour steady endurance ride at zone 2 power. Core base training for any event distance.",
        "sport_type": "Cycling",
        "tags": ["Endurance", "Base", "Long"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 1}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 7200}, "target": {"type": "power_zone", "zone": 2}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 600}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
    {
        "title": "FTP Test (20min)",
        "description": "Standard 20-minute FTP test. Warm up well, go all-out for 20 min. Your FTP ≈ 95% of average power.",
        "sport_type": "Cycling",
        "tags": ["Test", "FTP"],
        "structure": [
            {"type": "block", "category": "warmup", "duration": {"type": "time", "value": 1200}, "target": {"type": "power_zone", "zone": 2}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 300}, "target": {"type": "power", "metric": "percent_ftp", "value": 115}},
            {"type": "block", "category": "recovery", "duration": {"type": "time", "value": 300}, "target": {"type": "power_zone", "zone": 1}},
            {"type": "block", "category": "work", "duration": {"type": "time", "value": 1200}, "target": {"type": "rpe", "value": 10}},
            {"type": "block", "category": "cooldown", "duration": {"type": "time", "value": 900}, "target": {"type": "power_zone", "zone": 1}},
        ],
    },
]

ALL_WORKOUTS = RUN_WORKOUTS + CYCLE_WORKOUTS
