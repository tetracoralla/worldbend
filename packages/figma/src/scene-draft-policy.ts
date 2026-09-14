/**
 * Figma document nodes participate in document history even when a plugin
 * creates and removes them within one editing session. Real-host verification
 * showed both an empty Undo step and draft resurrection around interleaved
 * artwork edits. Keep the carrier off until Figma exposes a transient canvas
 * surface or a history-neutral transaction can be demonstrated end to end.
 */
export const LIVE_SCENE_DRAFT_ENABLED = false;
