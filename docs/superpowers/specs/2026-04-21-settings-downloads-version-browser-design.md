# Settings, Downloads, and Version Browser UX Design

Date: 2026-04-21

## Goal

Improve the Electron app's usability in three areas without changing the overall product identity:

1. Make the Settings page easier to understand and complete.
2. Make the Downloads page clearer and more actionable while queue activity is in progress.
3. Fix By Version sorting and filter trust issues, especially the incorrect ordering behind `Most Popular`, and tighten the surrounding UX so users understand what they are seeing.

The work should preserve the existing visual language, navigation model, and Electron renderer architecture. This is a focused workflow redesign, not a full UI rewrite.

## Scope

In scope:

- `ElectronSpike/src/renderer/index.html`
- `ElectronSpike/src/renderer/renderer.js`
- `ElectronSpike/src/renderer/styles.css`
- `ElectronSpike/src/main/services/versionBrowser.ts`
- `ElectronSpike/src/main/services/workshopBrowser.ts`
- Small focused regression tests for sort mapping and any extracted pure UI/state helpers where practical

Out of scope:

- Replacing the sidebar or navigation structure
- Rebuilding the library page
- Introducing a new design system or dependency
- Backend changes unrelated to version ordering

## Current Problems

### Settings

- Information is present, but grouped by internal feature areas rather than common user tasks.
- Workshop runtime setup is unclear when Steamworks is unavailable and SteamCMD is required.
- Path inputs and validation actions are visually separated from their status, increasing ambiguity.
- Save and validation controls are easy to miss relative to the amount of form content.

### Downloads

- The queue page behaves like a raw operation log instead of an operational dashboard.
- Active work, blocked work, and history are mixed visually.
- Summary language is generic and sometimes mirrors internal queue state rather than user intent.
- Empty and low-activity states are not very helpful.

### By Version

- `Most Popular` is currently mapped to Steam `trend`, which is not the same ranking.
- Users do not get enough context about what ordering is active.
- Filter changes are wired, but the page does not reinforce ranking and filter state clearly enough.
- Trust drops when the ranking label shown in the UI does not match the order returned.

## Recommended Approach

Use a focused workflow redesign:

- Keep the current visual theme, navigation, and renderer architecture.
- Reorganize Settings and Downloads around user tasks and operational states.
- Fix version ranking correctness at the service layer, then improve the page so the active sort and filter state is obvious.

This approach gives a meaningful UX upgrade with lower regression risk than a full refactor.

## Proposed UX Changes

### Settings Page

Restructure Settings into clearer task-oriented panels while keeping the existing settings page entry point.

Target sections:

1. `Game Setup`
   - Game path
   - Mods path
   - Detected game version
   - Restart warning toggle
   - Inline detection and status chips next to the relevant controls

2. `Workshop Downloads`
   - Runtime selector
   - SteamCMD executable path
   - SteamCMD download path
   - Runtime recommendation and helper text based on current environment
   - Clear configured or missing status chip
   - Action cluster for detect or auto-configure placed beside the section title or controls

3. `Profile & Sharing`
   - Public profile username
   - Short helper copy explaining where it is used

4. `Updates & Diagnostics`
   - App update controls
   - Last-check metadata
   - Developer mode and diagnostics block, visually deprioritized unless enabled

Interaction changes:

- Make section headers more explicit and instructional.
- Add short helper text under complex fields instead of relying on status bar updates.
- Keep save and validate controls persistently obvious at the bottom of the page.
- Improve unsaved-state visibility with stronger chip placement and page-level messaging.
- Hide or soften advanced diagnostics when developer mode is off.

### Downloads Page

Reframe Downloads into three operational zones:

1. `Active Now`
   - Running items only
   - Strong emphasis on current operation, progress, and available action

2. `Queue Overview`
   - Counts, overall progress, queue health, and last updated timestamp
   - Clear idle, active, and blocked wording

3. `Recent History`
   - Completed, failed, and cancelled operations
   - Retry and dismiss actions where appropriate

Interaction changes:

- Separate active work from history visually.
- Promote the top summary to answer "what is happening right now?"
- Improve action button hierarchy so cancel, retry, and clear are more obvious.
- Rewrite queue microcopy in user language, for example "Removing installed files..." or "Waiting for another operation to finish."
- Provide more useful empty states for no queue activity and no history.

### By Version Page

Keep the current page structure but improve trust and scanning:

- Add a stronger results-summary area that reflects active version, sort, and search context.
- Improve the controls layout so sorting and search feel like one filter bar.
- Show ranking context in the status text and results header.
- Ensure any sort or filter change resets to page 1 and fully refreshes visible results.

Behavioral correction:

- `Most Subscribed` continues to map to subscriber-based ordering.
- `Most Popular` must map to a popularity-oriented browse mode, not `trend`.
- `Relevance` remains search-oriented.

If Steam browse capabilities do not expose a perfect "most popular" equivalent for every search scenario, the code should use the closest true popularity ordering available and the UI text should match that actual behavior.

## Technical Design

### Renderer Changes

Files:

- `ElectronSpike/src/renderer/index.html`
- `ElectronSpike/src/renderer/renderer.js`
- `ElectronSpike/src/renderer/styles.css`

Planned renderer work:

- Restructure the Settings page markup into clearer grouped cards and sections.
- Restructure Downloads markup to support active, overview, and history groupings.
- Add any new summary chips, helper blocks, and empty-state containers required by the redesign.
- Update renderer state and render functions so queue items can be split into active versus finished presentations cleanly.
- Improve version page status rendering to surface the active ordering and filter context.

### Version Sorting Changes

Files:

- `ElectronSpike/src/main/services/versionBrowser.ts`
- `ElectronSpike/src/main/services/workshopBrowser.ts`

Planned service work:

- Audit the mapping between `VersionSortMode` and `WorkshopSortMode`.
- Correct the `most-popular` translation so the backend and label are consistent.
- Add a focused regression test around the mapping function or equivalent pure helper.
- Preserve cache-key behavior so different ranking modes do not share stale results.

### Data Flow

1. User changes version page filters.
2. Renderer resets pagination and requests results with explicit sort and filter state.
3. Version-browser service maps the requested UI sort to the correct workshop sort.
4. Workshop browse service fetches IDs using the correct browse order.
5. Renderer shows results and a summary that matches the actual ordering used.

For downloads:

1. Queue snapshot arrives from the main process.
2. Renderer partitions items into active versus finished sets.
3. Page summary derives counts and current status from that partition.
4. UI presents operations in clearer groups with appropriate actions.

## Error Handling

- If queue data is unavailable, Downloads should show a clear degraded-state message instead of an empty panel.
- If version queries fail, the status area should describe the failure without leaving stale ranking context in place.
- If SteamCMD fields are missing while the selected runtime requires them, Settings should reflect that inline before the user hits save.

## Testing Strategy

1. Add a regression test for version sort mapping so `Most Popular` cannot silently map back to `trend`.
2. Run existing renderer-adjacent checks through the current build and test flow.
3. Manually verify:
   - Settings field grouping and save and validate affordances
   - SteamCMD guidance visibility
   - Downloads active and history separation
   - Queue empty and active states
   - By Version sorting and page reset behavior across:
     - Relevance
     - Most Subscribed
     - Most Popular
     - Search text changes
     - Version changes

## Risks and Mitigations

- Risk: UI churn causes minor regressions in event wiring.
  - Mitigation: keep IDs stable where possible and change markup incrementally.

- Risk: Steam's browse options do not perfectly match product wording.
  - Mitigation: align UI labels and helper copy with the actual ordering used, and cover the mapping with tests.

- Risk: Downloads page refactor accidentally weakens current queue controls.
  - Mitigation: preserve existing action handlers and refactor rendering around them rather than replacing queue behavior.

## Implementation Boundaries

The implementation should remain focused on:

- UX clarity
- Sort correctness
- Copy and state improvements
- Layout improvements within the existing renderer stack

It should not expand into unrelated feature work or wholesale redesign of unrelated pages.
