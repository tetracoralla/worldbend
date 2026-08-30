export function isWorkspacePluginVersion(pluginVersion, workspaceVersion) {
  if (pluginVersion === workspaceVersion) return true;
  return new RegExp(
    `^${escapeRegExp(workspaceVersion)}\\+codex\\.\\d{14}$`,
  ).test(pluginVersion);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
