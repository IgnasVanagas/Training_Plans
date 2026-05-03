# Figma Wireframe Prompts

Use these prompts in Figma AI to generate low-fidelity interface sketches for the current system. These are intentionally written for wireframes, not polished final UI mockups.

## Global Prompt Prefix

Use this prefix before each screen-specific prompt:

Create a low-fidelity desktop web-app wireframe, not a polished final design. Use grayscale with only very small muted accent color if needed. Keep it clearly in sketch or wireframe style suitable for software specification documentation. No screenshots, no photos, no realistic product render, no marketing illustration except simple hero blocks on login and register. Use clear labeled sections, cards, tables, tabs, form rows, placeholder charts, placeholder map blocks, and consistent spacing. The product is Origami Plans, an endurance coaching platform for athletes and coaches. Match the existing application structure as closely as possible. Use a left sidebar and top header on authenticated screens. Desktop frame, around 1440 by 1024.

## Shared Authenticated Navigation

Use this navigation on authenticated athlete-facing screens unless the prompt says otherwise:

- Calendar
- Dual Calendar
- Organizations
- Races and records
- Training insights
- Comparison
- Training zones
- Activity trackers
- Athlete profile
- Macrocycle

Top header should contain:

- Origami Plans logo or title
- Support action
- Theme toggle
- User avatar menu

## 1. Login Page

Create a low-fidelity login screen for Origami Plans. Use a two-column desktop layout. Left side is a hero panel with product name, short platform description, and a simple list of core capabilities: track activities and compliance, plan training with drag and drop, multi-sport support, wearable integrations. Right side is a centered authentication card. At the top of the auth card place language toggles EN and LT and a Support button. Main content: title Welcome back, subtitle Sign in to continue to your dashboard, email field, password field, prominent Sign in button, secondary text links Create an account and Forgot password. At the bottom include a clearly separated optional alert area for Invite detected and Login error states. Keep it structured and block-based.

## 2. Register Page

Create a low-fidelity registration screen for Origami Plans using the same overall two-column structure as the login page. Left side hero panel matches login. Right side contains a registration card. Top row has EN, LT, and Support. Main content: title Create an account, subtitle Fill in your details to get started. Show role selector with Athlete and Coach, then fields for first name, last name, gender select, birth date input, email, password. Include a compact password requirements block: minimum 10 characters, uppercase and lowercase, number, symbol. Include checkboxes for Privacy Policy acceptance and coach access to training data when joining an organization. Main button: Create account. Secondary text at bottom: Already have an account.

## 3. Calendar Page

Create a low-fidelity desktop wireframe for the athlete Calendar page in Origami Plans. Use the standard authenticated layout with left sidebar and top header. Main header area should show page title Calendar and an athlete name context. Add a control row with Back, Today, previous and next navigation, a month picker, and a month or week view selector. Main body should be split into two areas: a large continuous training calendar grid on the left and a weekly summary or planning panel on the right. The calendar grid should show weekday headers, multiple weeks, planned workouts, rest days, race markers, and notes in day cells. The right side panel should contain planned load, completed load, zone distribution, upcoming races, day notes, and a workout library drag-and-drop area. Keep the calendar clearly dominant.

## 4. Activity View Page

Create a low-fidelity wireframe for the Activity detail overview page in Origami Plans. Use a top activity header with Back, activity title, date, sport metadata, and actions like Share to chat, Delete, and Reparse. Below it place horizontal tabs: Overview, Charts, HR Zones, Power Curve, Pace Zones or Power Zones, Laps, Hard Efforts, Best Efforts, Comparison. Show the Overview tab active. The content should be a two-column desktop layout. Left column contains a Detailed Stats card with rows for total time, moving time, average pace or speed, average heart rate, average power, elevation gain, calories, training load. Under that place a Top Efforts card and then a Comments panel. Right column contains a Session Feedback panel, a small map metric selector, a large route map placeholder, and a selected segment summary block.

## 5. Activity Chart View

Create a low-fidelity wireframe for the Activity detail Charts tab in Origami Plans. Reuse the same activity header and tabs as the activity overview screen, but show Charts active. Add a chart controls row with chips or toggles for Heart Rate, Pace, Speed, Power, Cadence, Altitude. Add a segmented control for raw power, 5 second average, and 30 second average. Add a Focus Mode switch and a dropdown for Pacing, Cardio, or Efficiency. Main content is a large interactive time-series chart area with a hover tooltip placeholder and selected range overlay. Under the chart place a Selected Segment Summary card with metrics like duration, average power, average HR, average pace, average speed, elevation gain. At the bottom add a labeled range slider for chart zoom.

## 6. Organizations Page

Create a low-fidelity wireframe for the Organizations page in Origami Plans. Use the authenticated layout. Main header: Organizations with a Create Organization button. First section shows My Organizations as selectable organization cards with organization name, description, coach names, admin badge, active badge, and settings action. Second section is Find Organizations with a search field and result cards containing organization avatar, name, member count, coach list, and Join or Pending button. The bottom half should be a messenger-style split layout: left pane is inbox or thread list with thread search and threads like Organization group, coach conversation, direct message, and unread state. Right pane is the active conversation view with thread header, scrolling message history, attachment preview area, activity share link, text input, attach button, and send button.

## 7. Races And Records Page

Create a low-fidelity wireframe for the Races and records page in Origami Plans. Use the authenticated layout. In the main content, first show a Races section with Upcoming and Past race cards. Each race card should include priority badge A, B, or C, race name, date, sport, distance, expected time, and location if present. Below that add a Personal Records section with a segmented toggle for Cycling and Running. Show a records table with columns like Distance or Window, Time, Pace or Power, Heart Rate, Date, Trophy. Include several example rows. Under or beside the table add a simple placeholder chart for a power curve or record trend.

## 8. Training Insights Page

Create a low-fidelity wireframe for the Training insights page in Origami Plans. Use the authenticated layout. Top section contains two rows of snapshot metric cards: FTP or LT2, Resting HR, HRV, then Fatigue, Fitness, and Form. Below that add a Performance Trend card with segmented range control for 30d, 90d, 180d, 365d, clickable series chips for Daily Training Load, Fitness, Fatigue, and Form, and a large trend chart placeholder. Under the chart add a Weekly Load Summary area with weekly bar chart, training status badge, and a short explanation panel. Structure it as a clean analytics dashboard, not a polished BI tool.

## 9. Comparison Page

Create a low-fidelity wireframe for the Comparison page in Origami Plans. Use the authenticated layout. Header should read Coach split-screen analysis or Training comparison, with visual Side A and Side B labels and a segmented control for Workouts, Weeks, and Months. Below that show two side-by-side selectors. In workouts mode each side should contain a mini calendar picker, selected activity summary card, and list of activities for the selected date. Below the selectors show a row of comparison metric cards like duration, distance, average HR, average power, training load, RPE. Then add a large charts and analysis area with tabs for Stream, Power Curve, Zones, Splits, and Insights. Include a split line chart placeholder, zone bars placeholder, split table placeholder, and workout insights list.

## 10. Training Zones Page

Create a low-fidelity wireframe for the Training zones page in Origami Plans. Use the authenticated layout. Top of the page should have title Training Zones and a short advisory text block explaining threshold values and personalization. Under that place sport tabs for Running, Cycling, and Swimming. Main content is a three-column layout. First column is Heart Rate zones with threshold input and zone cards. Second column is Pace or Power zones with threshold input and zone cards. Third column is RPE zones as a read-only effort scale. Each editable column should have small actions like Adjust zones, Save changes, and Discard. Keep the three columns clearly symmetrical and structured.

## 11. Activity Trackers Page

Create a low-fidelity wireframe for the Activity trackers page in Origami Plans. Use the authenticated layout. Header should contain page title and supporting text about connecting devices and apps to sync workouts automatically. Main body should be a grid of provider cards such as Strava, Garmin, Polar, Suunto, Coros, and Wahoo. Each card should show provider icon placeholder, provider name, connection status, last sync time, possible error note, and action buttons like Connect, Disconnect, Sync now, or Cancel sync. At least one provider card should show a sync progress bar. Include a Powered by Strava note on the Strava card.

## 12. Athlete Profile Page

Create a low-fidelity wireframe for the Athlete profile page in Origami Plans. Use the authenticated layout. Top area contains My Profile title and a profile picture card with avatar and change picture action. Main content is a two-column layout. Left column has Personal details, Contact details, and Account setup cards. Personal details should include full name, gender, date of birth, weight, max HR, country. Contact details should include contact email and contact number. Account setup should include unit system toggle and timezone select. Right column contains a Training card with sports checkboxes for Running, Cycling, Swimming, and Triathlon, and a Training days checklist for Monday through Sunday. Bottom right should have a strong Save Changes button.

## Recommended Figma Settings

- Keep all frames low fidelity.
- Prefer grayscale wireframes.
- Use one desktop frame per screen.
- Keep labels readable and explicit.
- Use consistent spacing and block hierarchy.
- Avoid making the result look like a finished product screenshot.

## Recommended Workflow

1. Create one base frame with the shared sidebar and top header.
2. Duplicate it for the authenticated screens.
3. Use the screen-specific prompts one by one in Figma AI.
4. Simplify anything that becomes too polished.
5. Export as PNG or PDF for the specification document.