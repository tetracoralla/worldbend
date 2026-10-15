import type { MockupSurface } from "@worldbend/web/types";

export const READY_SCENE_IDS = ["studio-poster", "desktop-screen", "carton-label", "studio-can", "hanging-fabric"] as const;
export type ReadySceneId = typeof READY_SCENE_IDS[number];
export type SceneArtworkFit = "cover" | "contain";
type Point = { x: number; y: number };
export interface ReadySceneGradient {
  direction: "horizontal" | "vertical";
  stops: ReadonlyArray<{ at: number; color: string; opacity?: number }>;
}
export interface ReadySceneDetail {
  name: string;
  path: string;
  color: string;
  gradient?: ReadySceneGradient;
  foreground?: true;
  shadow?: false;
  blendMode?: "MULTIPLY" | "SCREEN";
  opacity?: number;
  windingRule?: "NONZERO" | "EVENODD";
  blur?: number;
}
export interface ReadyScene {
  id: ReadySceneId;
  name: string;
  width: number;
  height: number;
  surface: { width: number; height: number };
  background: string;
  body: string;
  quad: { tl: Point; tr: Point; br: Point; bl: Point };
  outer: string;
  bodyGradient?: ReadySceneGradient;
  backgroundGradient?: ReadySceneGradient;
  artworkSurface?: MockupSurface;
}

/** Original editable studio scenes. These coordinates author native objects;
 * the canonical Mockup transform still owns artwork projection. */
export const READY_SCENES: readonly ReadyScene[] = [
  { id: "studio-poster", name: "Studio poster", width: 1200, height: 900,
    surface: { width: 440, height: 620 }, background: "E9E4DA", body: "FBF8F1",
    quad: { tl: { x: 350, y: 122 }, tr: { x: 815, y: 166 }, br: { x: 761, y: 782 }, bl: { x: 285, y: 722 } },
    outer: "M 337 106 L 830 151 L 775 800 L 269 737 Z" },
  { id: "desktop-screen", name: "Desktop screen", width: 1200, height: 900,
    surface: { width: 700, height: 420 }, background: "D9E0D8", body: "202A29",
    quad: { tl: { x: 176, y: 200 }, tr: { x: 991, y: 144 }, br: { x: 1022, y: 623 }, bl: { x: 191, y: 679 } },
    outer: "M 153 177 L 1013 119 Q 1028 118 1029 134 L 1060 637 Q 1061 653 1045 654 L 170 713 Q 154 714 153 698 L 130 195 Q 129 179 153 177 Z" },
  { id: "carton-label", name: "Carton label", width: 1200, height: 900,
    surface: { width: 540, height: 320 }, background: "EEE5D7", body: "DACDB8",
    quad: { tl: { x: 294, y: 302 }, tr: { x: 750, y: 354 }, br: { x: 749, y: 610 }, bl: { x: 295, y: 553 } },
    outer: "M 228 188 L 812 259 L 813 719 L 229 640 Z" },
  { id: "studio-can", name: "Studio can", width: 1200, height: 900,
    surface: { width: 640, height: 720 }, background: "E6C894", body: "DDE0D7",
    backgroundGradient: { direction: "vertical", stops: [{ at: 0, color: "F1DEBE" }, { at: .62, color: "E6C894" }, { at: 1, color: "DAB57C" }] },
    quad: { tl: { x: 425, y: 237 }, tr: { x: 780, y: 237 }, br: { x: 775, y: 726 }, bl: { x: 430, y: 726 } },
    outer: "M 414 175 C 406 355 414 584 429 747 C 435 789 770 789 776 747 C 791 584 799 355 791 175 Q 603 236 414 175 Z",
    bodyGradient: { direction: "horizontal", stops: [{ at: 0, color: "69716E" }, { at: .10, color: "CED4CD" }, { at: .23, color: "F5F3E7" }, { at: .34, color: "E2E5DC" }, { at: .62, color: "BFC7BE" }, { at: .85, color: "A3ACA1" }, { at: 1, color: "59665D" }] },
    artworkSurface: { kind: "cylinder", curvature: .92, tilt: .08, light: { strength: .55, direction: -.6 } } },
  { id: "hanging-fabric", name: "Hanging fabric", width: 1200, height: 900,
    surface: { width: 600, height: 670 }, background: "D8D5CC", body: "EDE8D8",
    quad: { tl: { x: 331, y: 191 }, tr: { x: 885, y: 219 }, br: { x: 861, y: 765 }, bl: { x: 307, y: 724 } },
    outer: "M 316 172 L 899 201 L 875 785 Q 828 794 783 772 Q 735 750 687 770 Q 640 790 594 762 Q 546 735 500 756 Q 454 777 406 745 Q 359 715 291 744 Z",
    bodyGradient: { direction: "horizontal", stops: [{ at: 0, color: "C3BCAD" }, { at: .25, color: "F1EDDF" }, { at: .5, color: "C8C1B1" }, { at: .75, color: "F6F1E4" }, { at: 1, color: "C4BCAC" }] },
    artworkSurface: { kind: "fabric", folds: 3, depth: .42, phase: .08, light: { strength: .45, direction: -.55 } } },
];

export function readySceneDetails(scene: ReadyScene): ReadonlyArray<ReadySceneDetail> {
  if (scene.id === "studio-can") return [
    { name: "Can · floor contact", path: "M 407 783 C 407 773 795 773 795 783 C 795 794 407 794 407 783 Z", color: "44351E",
      opacity: .28, blur: 8, blendMode: "MULTIPLY", shadow: false },
    { name: "Can · surface shadow", path: scene.outer, color: "000000", foreground: true, shadow: false,
      blendMode: "MULTIPLY", gradient: { direction: "horizontal", stops: [
        { at: 0, color: "15231D", opacity: .28 }, { at: .18, color: "15231D", opacity: 0 },
        { at: .66, color: "15231D", opacity: 0 }, { at: 1, color: "15231D", opacity: .36 },
      ] } },
    { name: "Can · softbox reflection", path: scene.outer, color: "FFFFFF", foreground: true, shadow: false,
      blendMode: "SCREEN", gradient: { direction: "horizontal", stops: [
        { at: 0, color: "FFF8E9", opacity: 0 }, { at: .13, color: "FFF8E9", opacity: 0 },
        { at: .20, color: "FFF8E9", opacity: .05 }, { at: .25, color: "FFF8E9", opacity: .22 },
        { at: .31, color: "FFF8E9", opacity: .20 }, { at: .40, color: "FFF8E9", opacity: 0 },
        { at: .90, color: "DCE6DD", opacity: 0 }, { at: .96, color: "DCE6DD", opacity: .12 },
        { at: 1, color: "DCE6DD", opacity: 0 },
      ] } },
    { name: "Can · rolled bottom rim", path: "M 429 734 Q 600 782 776 734 L 775 752 Q 601 808 430 752 Z", color: "A4AD9E", foreground: true, shadow: false },
    { name: "Can · bottom glint", path: "M 440 753 Q 603 797 765 753 L 765 758 Q 603 802 440 758 Z", color: "ECEDDD", foreground: true, shadow: false },
    { name: "Can · top rim", path: "M 414 174 C 414 105 791 105 791 174 C 791 243 414 243 414 174 Z", color: "DFE3D6", foreground: true, shadow: false,
      gradient: { direction: "vertical", stops: [{ at: 0, color: "F8F6E8" }, { at: .48, color: "BEC8B8" }, { at: 1, color: "6C7A6B" }] } },
    { name: "Can · inset lid", path: "M 432 170 C 432 120 773 120 773 170 C 773 221 432 221 432 170 Z", color: "BCC8B7", foreground: true, shadow: false,
      gradient: { direction: "vertical", stops: [{ at: 0, color: "B5C1BB" }, { at: .16, color: "E4E6DA" }, { at: .30, color: "AFBAB2" }, { at: .58, color: "D4DBD1" }, { at: .86, color: "A4B3AB" }, { at: 1, color: "DCE5D9" }] } },
    { name: "Can · lid groove", path: "M 438 170 C 438 124 767 124 767 170 C 767 216 438 216 438 170 Z M 441 170 C 441 128 764 128 764 170 C 764 212 441 212 441 170 Z", color: "718073", foreground: true, shadow: false, opacity: .55, windingRule: "EVENODD" },
    { name: "Can · opening", path: "M 591 189 C 591 174 647 174 647 189 C 647 208 591 208 591 189 Z", color: "32443B", foreground: true, shadow: false,
      gradient: { direction: "vertical", stops: [{ at: 0, color: "1A2622" }, { at: .58, color: "3C4B42" }, { at: 1, color: "7E9082" }] } },
    { name: "Can · pull tab", path: "M 564 152 Q 580 138 617 143 Q 665 153 663 175 Q 649 195 612 193 Q 563 186 556 169 Z M 580 157 Q 574 168 589 175 Q 617 187 640 176 Q 651 166 630 156 Q 600 145 580 157 Z", color: "F0F2E2", foreground: true, shadow: false,
      gradient: { direction: "vertical", stops: [{ at: 0, color: "D6DAD0" }, { at: .24, color: "F5F4E8" }, { at: .39, color: "A6B1A6" }, { at: .62, color: "EDF0E2" }, { at: 1, color: "8B9A8E" }] } },
    { name: "Can · tab rivet", path: "M 602 183 C 602 176 624 176 624 183 C 624 190 602 190 602 183 Z", color: "BAC4B8", foreground: true, shadow: false,
      gradient: { direction: "vertical", stops: [{ at: 0, color: "F0F0E3" }, { at: .5, color: "B8C3B4" }, { at: 1, color: "718271" }] } },
  ];
  if (scene.id === "hanging-fabric") return [
    { name: "Fabric · wall contact", path: "M 270 772 C 270 748 930 748 930 772 C 930 802 270 802 270 772 Z", color: "3A3428",
      opacity: .26, blur: 10, blendMode: "MULTIPLY", shadow: false },
    { name: "Fabric · left hanging cord", path: "M 349 45 L 353 45 L 351 155 L 347 155 Z", color: "858473" },
    { name: "Fabric · right hanging cord", path: "M 885 45 L 889 45 L 887 182 L 883 182 Z", color: "858473" },
    { name: "Fabric · rail cast", path: "M 318 168 L 896 198 L 888 308 L 310 278 Z", color: "000000",
      foreground: true, shadow: false, blendMode: "MULTIPLY", gradient: { direction: "vertical", stops: [
        { at: 0, color: "14120E", opacity: .42 }, { at: .35, color: "14120E", opacity: .28 },
        { at: .72, color: "14120E", opacity: .08 }, { at: 1, color: "14120E", opacity: 0 },
      ] } },
    { name: "Fabric · hanging rail", path: "M 284 139 Q 274 139 274 151 Q 274 163 284 163 L 925 194 Q 936 194 936 182 Q 936 170 925 170 Z", color: "726C53", foreground: true,
      gradient: { direction: "vertical", stops: [{ at: 0, color: "ABA384" }, { at: .35, color: "81795D" }, { at: 1, color: "474B3B" }] } },
    { name: "Fabric · left loop", path: "M 319 143 L 340 144 L 338 182 L 317 181 Z", color: "E5DFCB", foreground: true, shadow: false },
    { name: "Fabric · right loop", path: "M 860 169 L 881 170 L 879 208 L 858 207 Z", color: "D5CDB8", foreground: true, shadow: false },
  ];
  if (scene.id === "desktop-screen") return [
    { name: "Screen · desk contact", path: "M 400 805 C 400 770 870 770 870 805 C 870 848 400 848 400 805 Z", color: "2A322E",
      opacity: .28, blur: 12, blendMode: "MULTIPLY", shadow: false },
    // Stand stays behind artwork so the neck sits under the opaque screen; it
    // still paints after desk contact and occludes the backdrop under the base.
    { name: "Stand", path: "M 567 671 L 699 662 L 719 776 L 794 805 L 480 827 L 558 787 Z", color: "6A7771" },
    { name: "Screen · bezel cast", path: "M 175 175 L 1005 120 L 1015 275 L 185 330 Z", color: "000000",
      foreground: true, shadow: false, blendMode: "MULTIPLY", gradient: { direction: "vertical", stops: [
        { at: 0, color: "0E1412", opacity: .40 }, { at: .38, color: "0E1412", opacity: .22 },
        { at: .75, color: "0E1412", opacity: .06 }, { at: 1, color: "0E1412", opacity: 0 },
      ] } },
  ];
  if (scene.id === "carton-label") return [
    { name: "Carton · floor contact", path: "M 200 695 C 200 668 970 648 970 680 C 970 718 200 738 200 695 Z", color: "3A2E1C",
      opacity: .24, blur: 10, blendMode: "MULTIPLY", shadow: false },
    { name: "Carton · shaded side", path: "M 812 259 L 947 164 L 947 610 L 813 719 Z", color: "B6A58B" },
    { name: "Carton · top", path: "M 228 188 L 365 98 L 947 164 L 812 259 Z", color: "E4D9C7" },
    { name: "Carton · top cast", path: "M 250 210 L 800 275 L 792 395 L 242 330 Z", color: "000000",
      foreground: true, shadow: false, blendMode: "MULTIPLY", gradient: { direction: "vertical", stops: [
        { at: 0, color: "1A140C", opacity: .34 }, { at: .40, color: "1A140C", opacity: .18 },
        { at: .78, color: "1A140C", opacity: .05 }, { at: 1, color: "1A140C", opacity: 0 },
      ] } },
  ];
  if (scene.id === "studio-poster") return [
    { name: "Poster · wall contact", path: "M 240 755 C 240 732 810 792 810 815 C 810 842 240 782 240 755 Z", color: "3A3428",
      opacity: .24, blur: 10, blendMode: "MULTIPLY", shadow: false },
    { name: "Poster · clip cast", path: "M 330 118 L 835 164 L 818 290 L 314 244 Z", color: "000000",
      foreground: true, shadow: false, blendMode: "MULTIPLY", gradient: { direction: "vertical", stops: [
        { at: 0, color: "14120E", opacity: .36 }, { at: .38, color: "14120E", opacity: .20 },
        { at: .75, color: "14120E", opacity: .06 }, { at: 1, color: "14120E", opacity: 0 },
      ] } },
    // Clip paints after its cast so Multiply shade darkens poster artwork, not the clip hardware.
    { name: "Hanging clip · native occlusion", path: "M 562 125 L 617 130 L 613 168 L 558 162 Z", color: "555F59", foreground: true },
  ];
  return [];
}
