/** Figma may regenerate resource IDs after unrelated document activity.
 * Canonicalize only IDs and their XML attribute references. Geometry, text,
 * colors, embedded images and all other bytes remain part of the proof. */
export function stableExportSvg(svg:string):string {
  if(svg.length>8*1024*1024)throw Error("Native SVG source exceeds 8 MiB");
  const tags:{start:number;end:number;text:string}[]=[];
  for(let start=svg.indexOf("<");start!==-1;){
    if(svg.startsWith("<!--",start)||svg.startsWith("<![CDATA[",start)){
      const end=svg.indexOf(svg.startsWith("<!--",start)?"-->":"]]>",start);
      if(end<0)throw Error("Invalid exported SVG");start=svg.indexOf("<",end+3);continue;
    }
    let end=start+1,quote="";
    for(;end<svg.length;end++){
      const ch=svg[end]!;
      if(quote){if(ch===quote)quote="";}
      else if(ch==='"'||ch==="'")quote=ch;
      else if(ch===">")break;
    }
    if(end===svg.length)throw Error("Invalid exported SVG");
    const text=svg.slice(start,end+1);
    // Figma exports presentation attributes. A stylesheet has different ID
    // reference semantics and must not silently lose selector relationships.
    if(/^<\s*(?:style|script)\b/i.test(text))throw Error("Unsupported executable or stylesheet SVG export");
    if(/^<[A-Za-z_]/.test(text))tags.push({start,end:end+1,text});
    start=svg.indexOf("<",end+1);
  }
  const attributes=/([\t\n\r ])([A-Za-z_:][A-Za-z0-9_.:-]*)(\s*=\s*)("[^"]*"|'[^']*')/g;
  const ids=new Map<string,string>();
  for(const tag of tags)for(const match of tag.text.matchAll(attributes))if(match[2]==="id"){
    const id=match[4]!.slice(1,-1);if(ids.has(id))throw Error("Duplicate exported SVG resource ID");
    ids.set(id,`worldbend-resource-${ids.size}`);
  }
  let cursor=0,result="";
  for(const tag of tags){
    result+=svg.slice(cursor,tag.start)+tag.text.replace(attributes,(all,space:string,name:string,equals:string,quoted:string)=>{
      const value=quoted.slice(1,-1),quote=quoted[0];let next=value;
      if(name==="id")next=ids.get(value)!;
      else if((name==="href"||name==="xlink:href")&&value.startsWith("#"))next=ids.has(value.slice(1))?`#${ids.get(value.slice(1))}`:value;
      else next=value.replace(/url\(\s*#([^\s)]+)\s*\)/g,(url,id:string)=>ids.has(id)?`url(#${ids.get(id)})`:url);
      return next===value?all:`${space}${name}${equals}${quote}${next}${quote}`;
    });cursor=tag.end;
  }
  return result+svg.slice(cursor);
}
