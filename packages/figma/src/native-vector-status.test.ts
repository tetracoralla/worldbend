import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import { nativeVectorStatusMessage } from "./native-vector-status";

describe("native Vector completion status", () => {
  it("reports an exact projection without claiming that a stroke was outlined", () => {
    expect(nativeVectorStatusMessage({ class: "exact", reasons: [] })).toEqual({
      key: "nativeVectorStatusExact",
    });
  });

  it("reports and rounds the curve approximation bound", () => {
    expect(
      nativeVectorStatusMessage({
        class: "approximated",
        maxError: 0.246,
        reasons: ["curveSubdivision"],
      }),
    ).toEqual({ key: "nativeVectorStatusApproximated", values: { error: 0.25 } });
  });

  it("distinguishes exact and approximated stroke outlines", () => {
    expect(
      nativeVectorStatusMessage({ class: "outlined", reasons: ["strokeOutlined"] }),
    ).toEqual({ key: "nativeVectorStatusOutlined" });
    expect(
      nativeVectorStatusMessage({
        class: "outlined",
        maxError: 0.244,
        reasons: ["strokeOutlined", "strokeApproximated"],
      }),
    ).toEqual({ key: "nativeVectorStatusOutlinedApproximated", values: { error: 0.24 } });
  });

  it("renders the completion copy in both carrier languages", () => {
    expect(translate("en", nativeVectorStatusMessage({ class: "exact", reasons: [] }))).toBe(
      "Native Vector applied exactly.",
    );
    expect(translate("zh-CN", nativeVectorStatusMessage({ class: "exact", reasons: [] }))).toBe(
      "原生矢量已精确应用。",
    );
    expect(
      translate(
        "zh-CN",
        nativeVectorStatusMessage({
          class: "outlined",
          maxError: 0.246,
          reasons: ["strokeOutlined", "strokeApproximated"],
        }),
      ),
    ).toBe("原生矢量已应用，描边已转换为填充轮廓，近似误差不超过 0.25 像素。");
  });
});
