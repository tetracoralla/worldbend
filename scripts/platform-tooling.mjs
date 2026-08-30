export function platformExecutableName(name, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name;
}
