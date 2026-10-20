import {describe,expect,it} from 'vitest';
import {nativeSvgCaptureFacts,logicalSourceSvg} from './native-source-svg';

describe('logical native SVG source transport',()=>{
  it('retains source defs and root defaults under the core-provided transform',()=>{
    const svg='<svg width="360" height="208" viewBox="0 0 360 208" fill="none"><defs><clipPath id="a"><rect width="360" height="208"/></clipPath></defs><g clip-path="url(#a)"><path d="M0 0H30V30Z" fill="red"/></g></svg>';
    const source={width:315.8,height:189.5,absoluteTransform:[[1,.2,76300],[0,1,26335]],absoluteBoundingBox:{x:76300,y:26335,width:353.7,height:189.5}} as unknown as FrameNode;
    const facts=nativeSvgCaptureFacts(source,svg);
    expect(facts.pixelSize).toEqual({width:360,height:208});
    expect(facts.logicalSize).toEqual({width:315.8,height:189.5});
    const output=logicalSourceSvg(svg,[[1,-.2,0],[0,1,0]],facts.logicalSize);
    expect(output).toContain('viewBox="0 0 315.8 189.5"');
    expect(output).toContain('transform="matrix(1 0 -0.2 1 0 0)"');
    expect(output).toContain(svg);
  });
  it('refuses an unknown exporter window instead of treating guessed bounds as source facts',()=>{
    expect(()=>nativeSvgCaptureFacts({} as FrameNode,'<svg viewBox="1 0 360 208"></svg>')).toThrow(/window/);
    expect(()=>nativeSvgCaptureFacts({} as FrameNode,'<svg viewBox="0 0 360.5 208"></svg>')).toThrow(/window/);
  });
  it('describes visible source-view pixels in the scaled instance logical frame',()=>{
    const source={width:300,height:180,absoluteTransform:[[1,0,72000],[0,1,26000]],absoluteBoundingBox:{x:72000,y:26000,width:300,height:180}} as unknown as FrameNode;
    const facts=nativeSvgCaptureFacts(source,'<svg viewBox="0 0 300 180"></svg>',{width:450,height:270});
    expect(facts.logicalSize).toEqual({width:450,height:270});
    expect(facts.logicalToCaptureSpace).toEqual([[2/3,0,72000],[0,2/3,26000]]);
    expect(facts.pixelSize).toEqual({width:300,height:180});
  });
});
