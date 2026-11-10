# UI Implementation Quality — MusicPleasure

## Objective
A user should find and play one song, access a saved playlist, or start radio without understanding technical internals. MusicPleasure remains Invidious-only and preserves all IndexedDB data.

## Interaction contracts
- Search alone **does not alter the queue**. Selecting a search result plays only that track; explicit "すべて再生" enqueues all.
- Home presents one prominent "曲を検索する" action and direct shortcuts to playlists, radio, and batch import; decorative hero art never competes with actions.
- The persistent player surfaces the current track, playback state, play/pause, next/previous, progress, and queue entry points.
- "Next up" on the playing screen addresses the existing queue by absolute index; it must not reconstruct the entire queue.
- Radio recommendation selection intentionally starts radio with the chosen track; playlist selections retain established sequential-play behavior.
- Technical connection lists start collapsed. Users see standard playback settings first.
- Internal Piped endpoints and code are not reintroduced.

## UI acceptance criteria
- Japanese action labels; no misleading claims about "AI" or guaranteed media access.
- Primary controls are at least 44 CSS pixels tall and retain visible keyboard focus.
- Search and current playback controls remain usable at 390px, tablet and desktop widths; no horizontal document overflow.
- Both dark and light color schemes retain readable foreground/background and selected states.
- No hover-only access to primary functions: track play and playlist navigation are visible at rest.
- Respect reduced-motion preferences.
- Keep existing queue, playback, IndexedDB and Invidious API contracts unchanged except explicitly called-out navigation behavior.

## Verification
- Vitest + production build.
- Playwright: desktop, Android phone, Android tablet; home actions, navigation, queue contract, responsive overflow and settings disclosure.
- Published GitHub Pages build, then optional real-device review. Mocked media tests do not establish real Invidious audio reliability.
