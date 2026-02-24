import asyncio
import os
from .database import AsyncSessionLocal
from .models import Activity
from .parsing import parse_activity_file
from sqlalchemy import select

async def reprocess_all():
    print("Starting reprocessing of activities...")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Activity))
        activities = result.scalars().all()
        
        print(f"Found {len(activities)} activities to process.")
        
        for activity in activities:
            print(f"Processing Activity ID {activity.id}: {activity.filename}")
            
            # Ensure we are checking the path relative to where the script runs (project root in container)
            # Database stores "uploads/filename.fit" typically.
            
            if not os.path.exists(activity.file_path):
                print(f"  - File not found at {activity.file_path}, skipping.")
                continue
                
            try:
                # Parsing
                parsed_data = parse_activity_file(activity.file_path, activity.file_type)
                
                if not parsed_data:
                    print("  - Parsing failed (returned None).")
                    continue
                    
                summary = parsed_data.get("summary", {})
                
                # Update Scalars (Overwrite old values with potentially better calculations)
                activity.distance = summary.get("distance")
                activity.duration = summary.get("duration")
                activity.avg_speed = summary.get("avg_speed")
                activity.average_hr = summary.get("average_hr")
                activity.average_watts = summary.get("average_watts")
                activity.sport = parsed_data.get("sport")
                
                # Update Streams/Complex Data
                # Key fixes: Structure now allows power_curve and hr_zones extraction
                composite_streams_data = {
                    "data": parsed_data.get("streams"),
                    "power_curve": parsed_data.get("power_curve"),
                    "hr_zones": parsed_data.get("hr_zones")
                }
                activity.streams = composite_streams_data
                
                print("  - Successfully re-parsed and updated in memory.")
                
            except Exception as e:
                print(f"  - Error processing: {e}")
                import traceback
                traceback.print_exc()

        await db.commit()
        print("Database commit successful. Reprocessing complete.")

if __name__ == "__main__":
    asyncio.run(reprocess_all())
