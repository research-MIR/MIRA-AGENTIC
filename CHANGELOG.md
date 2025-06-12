# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2024-06-12

### Fixed
- **Onboarding Tour Reliability:** Overhauled the onboarding tour logic to ensure it starts correctly from any page in the application. The tour now correctly navigates the user to the appropriate page for each step.
- **Onboarding Tour Theming:** Applied the application's theme to the onboarding tour popovers, ensuring they are readable and styled correctly in both light and dark modes.
- **Realtime Subscription Stability:** Refactored the Supabase Realtime subscription management on the chat page to use a more robust `useEffect` cleanup pattern, preventing application crashes caused by multiple subscription attempts.

### Removed
- **Redundant "Refresh Chat" Button:** Removed a debugging button from the chat page that was no longer necessary.