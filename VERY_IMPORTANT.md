# VERY IMPORTANT: API Structure Rule

The structure of the API calls between the agent and the image generator are to be considered **unrelated and independent**.

For specific project reasons, their APIs are structured differently. This includes, but is not limited to, authentication methods, API construction, and payload formats.

**DO NOT** attempt to unify, refactor, or change the state of either API. They must remain in their current, distinct states.