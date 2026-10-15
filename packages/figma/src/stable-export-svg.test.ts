import {describe,it,expect} from "vitest";
import {stableExportSvg} from "./stable-export-svg";
describe("native export resource identity",()=>{
  const svg=(id:string,fill="red")=>`<svg viewBox="0 0 20 10"><defs><clipPath id="${id}"><rect width="20" height="10"/></clipPath></defs><g clip-path="url(#${id})"><path fill="${fill}" d="M0 0H20V10Z"/><use href="#${id}"/><text>Literal ${id}</text></g></svg>`;
  it("ignores regenerated resource IDs while retaining visible content",()=>{
    const a=svg("clip0_120_1"),b=svg("clip0_999_2").replace("Literal clip0_999_2","Literal clip0_120_1");
    expect(stableExportSvg(a)).toBe(stableExportSvg(b));
    expect(stableExportSvg(a)).toContain('clip-path="url(#worldbend-resource-0)"');
    expect(stableExportSvg(a)).toContain('href="#worldbend-resource-0"');
    expect(stableExportSvg(a)).toContain('Literal clip0_120_1');
    expect(stableExportSvg(a)).not.toBe(stableExportSvg(svg("clip0_120_1","blue")));
  });
  it("preserves comments, quoted delimiters, data URLs and non-resource attributes",()=>{
    const value=`<svg><!-- id="x" --><g data-label="a > b" id='x' style='fill:url(#x)'/><image href="data:image/svg+xml;base64,aWQ9eA=="/><text>url(#x)</text></svg>`;
    const stable=stableExportSvg(value);
    expect(stable).toContain(`<!-- id="x" -->`);expect(stable).toContain(`data-label="a > b"`);
    expect(stable).toContain(`style='fill:url(#worldbend-resource-0)'`);
    expect(stable).toContain(`href="data:image/svg+xml;base64,aWQ9eA=="`);expect(stable).toContain(`<text>url(#x)</text>`);
  });
  it("refuses ambiguous references instead of rewriting their meaning",()=>{
    expect(()=>stableExportSvg(`<svg><g id="x"/><path id="x"/></svg>`)).toThrow(/Duplicate/);
    expect(()=>stableExportSvg(`<svg><style>#x{fill:red}</style><g id="x"/></svg>`)).toThrow(/stylesheet/);
  });
});
