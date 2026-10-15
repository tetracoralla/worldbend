/**
 * Figma has no transient canvas overlay for plugins, so an in-context preview
 * must use a marked document node. Real-host verification established the
 * trade-off: direct marked-node cleanup is data-safe, but can leave one empty
 * Undo step and host Undo can temporarily resurrect the preview. That host
 * limitation does not outweigh the user's need to see the working result in
 * its real scene. Never use triggerUndo to hide the artifact: it can undo
 * artwork created after the preview boundary.
 */
export const LIVE_SCENE_DRAFT_ENABLED = true;
