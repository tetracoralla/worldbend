import { describe, expect, it } from "vitest";
import {
  formatPercent,
  parseStoredLocalePreference,
  resolveLocale,
  translate,
  userMessage,
} from "./i18n";

describe("Figma locale preferences", () => {
  it("uses Simplified Chinese for supported Chinese system locales", () => {
    expect(resolveLocale("system", ["zh-CN"])).toBe("zh-CN");
    expect(resolveLocale("system", ["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(resolveLocale("system", ["zh_SG"])).toBe("zh-CN");
  });

  it("falls back to English for unsupported or Traditional Chinese locales", () => {
    expect(resolveLocale("system", ["fr-FR"])).toBe("en");
    expect(resolveLocale("system", ["zh-TW"])).toBe("en");
    expect(resolveLocale("system", [])).toBe("en");
  });

  it("keeps an explicit preference ahead of the system locale", () => {
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveLocale("zh-CN", ["en-US"])).toBe("zh-CN");
  });

  it("accepts only the versioned stored preference shape", () => {
    expect(parseStoredLocalePreference({ version: 1, locale: "zh-CN" })).toBe("zh-CN");
    expect(parseStoredLocalePreference({ version: 1, locale: "system" })).toBe("system");
    expect(parseStoredLocalePreference({ version: 2, locale: "zh-CN" })).toBe("system");
    expect(parseStoredLocalePreference({ version: 1, locale: "de" })).toBe("system");
  });

  it("translates parameterized and accessible editor copy", () => {
    expect(translate("zh-CN", "selectResultWithSource")).toContain("同时选中原图");
    expect(
      translate("zh-CN", userMessage("outputLimitExceeded", { limit: 4096 })),
    ).toContain("4096");
    expect(formatPercent("en", 0.0684)).toBe("6.84%");
    expect(formatPercent("zh-CN", 0.0684)).toBe("6.84%");
    expect(translate("zh-CN", "modeWarp")).toBe("变形");
    expect(translate("zh-CN", "distortPerspective")).toBe("透视");
    expect(translate("zh-CN", "selectSourceAndResult")).toBe("选择源图和结果");
    expect(translate("en", "cornerLabelFree")).toContain("Hold Shift");
    expect(translate("zh-CN", "cornerLabelPerspective")).toContain("横向拖动只对称联动同一横边端点");
    expect(translate("zh-CN", "cornerLabelPerspective")).toContain("识别方向后会保持到松手");
    expect(translate("en", "warpTwist")).toBe("Twist");
  });
});
