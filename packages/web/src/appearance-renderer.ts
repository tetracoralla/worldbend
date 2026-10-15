import type { EffectFrameAppearance } from "./generated/core-contract";
import { TransformError } from "./transform-error";
import { windowSourceSize } from "./window-renderer";
import type { WindowSource } from "./window-renderer";

const VERTEX = `#version 300 es
in vec2 position;
out vec2 sourceUv;
void main() {
  gl_Position=vec4(position,0.0,1.0);
  sourceUv=vec2(position.x*0.5+0.5,0.5-position.y*0.5);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D contentTexture;
uniform sampler2D depthTexture;
uniform vec2 logicalSize;
uniform vec4 depthConfig;
uniform vec3 depthMapConfig;
uniform vec2 motionVector;
in vec2 sourceUv;
out vec4 color;

vec4 sampleContent(vec2 uv,float lod) {
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return vec4(0.0);
  return textureLod(contentTexture,uv,lod);
}

void main() {
  float distance=depthConfig.w;
  if(depthMapConfig.x>0.5) {
    float depth=texture(depthTexture,sourceUv).r;
    distance=mix(depthMapConfig.y,depthMapConfig.z,depth);
  }
  float outsideFocus=abs(distance-depthConfig.x)-depthConfig.y*0.5;
  float depthRadius=depthConfig.z*clamp(outsideFocus/max(depthConfig.y,0.0001),0.0,1.0);
  float motionRadius=length(motionVector);
  if(depthRadius<0.001&&motionRadius<0.001) { color=sampleContent(sourceUv,0.0); return; }

  const vec2 disk[16]=vec2[16](
    vec2(0.000,0.000),vec2(0.527,0.086),vec2(-0.414,0.305),vec2(0.137,-0.517),
    vec2(0.747,0.462),vec2(-0.716,0.518),vec2(-0.231,-0.842),vec2(0.465,-0.732),
    vec2(0.982,-0.132),vec2(-0.967,-0.198),vec2(0.246,0.935),vec2(-0.541,0.822),
    vec2(0.690,-0.996),vec2(-0.826,-0.746),vec2(0.928,0.781),vec2(-0.096,-1.000)
  );
  float lod=max(0.0,log2(max(1.0,max(depthRadius,motionRadius)*0.35)));
  vec4 result=vec4(0.0);
  for(int i=0;i<16;i++) {
    float exposure=(float(i)+0.5)/16.0;
    vec2 offset=(disk[i]*depthRadius+motionVector*exposure)/logicalSize;
    result+=sampleContent(sourceUv+offset,lod);
  }
  color=result/16.0;
}`;

function failure(code:"E_RENDER"|"E_OUTPUT_LIMIT"|"E_UNSUPPORTED_MEDIA"|"E_SCHEMA",message:string):never {
  throw new TransformError({code,message});
}

export class AppearanceRenderer {
  private readonly gl:WebGL2RenderingContext;
  private program:WebGLProgram|undefined;
  private buffer:WebGLBuffer|undefined;
  private vao:WebGLVertexArrayObject|undefined;
  private contentTexture:WebGLTexture|undefined;
  private depthTexture:WebGLTexture|undefined;
  private uniforms:Record<string,WebGLUniformLocation>={};
  private source:WindowSource|undefined;
  private depthMap:WindowSource|undefined;
  private contentSize:{width:number;height:number}|undefined;
  private depthSize:{width:number;height:number}|undefined;
  private sourceDirty=false;
  private depthDirty=false;
  private mediaCanvas:HTMLCanvasElement|undefined;
  private lost=false;
  private disposed=false;
  readonly maximumTextureSize:number;
  readonly maximumDrawingSize:number;
  draws=0;
  uploads=0;

  constructor(readonly canvas:HTMLCanvasElement,preserveDrawingBuffer=false) {
    const gl=canvas.getContext("webgl2",{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer});
    if(!gl)failure("E_RENDER","WebGL2 is required for spatial appearance");
    this.gl=gl;
    this.maximumTextureSize=Math.min(8192,gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maximumDrawingSize=Math.min(4096,this.maximumTextureSize,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,viewport[0]!,viewport[1]!);
    this.initialize();
  }

  private initialize() {
    const gl=this.gl,shaders:WebGLShader[]=[];
    try {
      for(const [kind,text]of [[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,FRAGMENT]] as const){
        const shader=gl.createShader(kind)??failure("E_RENDER","Cannot allocate spatial-appearance shader");
        shaders.push(shader);gl.shaderSource(shader,text);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))failure("E_RENDER",gl.getShaderInfoLog(shader)??"Spatial-appearance shader compilation failed");
      }
      this.program=gl.createProgram()??failure("E_RENDER","Cannot allocate spatial-appearance program");
      for(const shader of shaders)gl.attachShader(this.program,shader);
      gl.linkProgram(this.program);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))failure("E_RENDER",gl.getProgramInfoLog(this.program)??"Spatial-appearance shader linking failed");
      this.vao=gl.createVertexArray()??failure("E_RENDER","Cannot allocate spatial-appearance vertex array");
      this.buffer=gl.createBuffer()??failure("E_RENDER","Cannot allocate spatial-appearance geometry");
      gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(this.program,"position");
      gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      for(const name of ["contentTexture","depthTexture","logicalSize","depthConfig","depthMapConfig","motionVector"]){
        this.uniforms[name]=gl.getUniformLocation(this.program,name)??failure("E_RENDER",`Missing ${name}`);
      }
    } catch(error){this.release();throw error;}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }

  private normalizeBitmap(source:WindowSource,width:number,height:number):WindowSource {
    if(typeof ImageBitmap==="undefined"||!(source instanceof ImageBitmap))return source;
    this.mediaCanvas??=document.createElement("canvas");
    if(this.mediaCanvas.width!==width)this.mediaCanvas.width=width;
    if(this.mediaCanvas.height!==height)this.mediaCanvas.height=height;
    const context=this.mediaCanvas.getContext("2d")??failure("E_RENDER","Cannot prepare spatial-appearance pixels");
    context.clearRect(0,0,width,height);context.drawImage(source,0,0);
    return this.mediaCanvas;
  }

  private validateSource(source:WindowSource):{width:number;height:number} {
    const size=windowSourceSize(source);
    if(size.width<1||size.height<1)failure("E_UNSUPPORTED_MEDIA","Spatial-appearance source must have decoded pixels");
    if(size.width>this.maximumTextureSize||size.height>this.maximumTextureSize||size.width*size.height>16_777_216)failure("E_OUTPUT_LIMIT","Spatial-appearance source exceeds texture or 16 megapixel limits");
    if(source===this.canvas)failure("E_UNSUPPORTED_MEDIA","A spatial-appearance canvas cannot sample itself");
    return size;
  }

  private upload(source:WindowSource,mipmaps:boolean,premultiply:boolean):{texture:WebGLTexture;size:{width:number;height:number}} {
    const gl=this.gl,{width,height}=this.validateSource(source);
    const texture=gl.createTexture()??failure("E_RENDER","Cannot allocate spatial-appearance texture");
    try {
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mipmaps?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.normalizeBitmap(source,width,height));
      if(gl.getError()!==gl.NO_ERROR)failure("E_RENDER","Spatial-appearance texture upload failed");
      if(mipmaps)gl.generateMipmap(gl.TEXTURE_2D);
      if(gl.getError()!==gl.NO_ERROR)failure("E_RENDER","Spatial-appearance texture filtering failed");
      this.uploads++;
      return{texture,size:{width,height}};
    } catch(error){gl.deleteTexture(texture);throw error;}
  }

  setSource(source:WindowSource) {
    const sourceSize=this.validateSource(source);
    if(this.depthSize&&(this.depthSize.width!==sourceSize.width||this.depthSize.height!==sourceSize.height))failure("E_SCHEMA","Depth map dimensions must match the content source");
    if(this.lost){this.source=source;this.contentSize=sourceSize;this.sourceDirty=true;return;}
    const next=this.upload(source,true,true);
    if(this.contentTexture)this.gl.deleteTexture(this.contentTexture);
    this.contentTexture=next.texture;this.contentSize=next.size;this.source=source;this.sourceDirty=false;
  }

  setDepthMap(source:WindowSource|undefined) {
    if(source===undefined){if(this.depthTexture)this.gl.deleteTexture(this.depthTexture);this.depthTexture=undefined;this.depthSize=undefined;this.depthMap=undefined;this.depthDirty=false;return;}
    const expected=this.contentSize??windowSourceSize(this.source!);
    const actual=this.validateSource(source);
    if(actual.width!==expected.width||actual.height!==expected.height)failure("E_SCHEMA","Depth map dimensions must match the content source");
    if(this.lost){this.depthMap=source;this.depthSize=actual;this.depthDirty=true;return;}
    const next=this.upload(source,false,false);
    if(this.depthTexture)this.gl.deleteTexture(this.depthTexture);
    this.depthTexture=next.texture;this.depthSize=next.size;this.depthMap=source;this.depthDirty=false;
  }

  refresh(){this.sourceDirty=true;if(this.depthMap)this.depthDirty=true;}

  private refreshTextures(){
    if(this.sourceDirty&&this.source)this.setSource(this.source);
    if(this.depthDirty&&this.depthMap)this.setDepthMap(this.depthMap);
  }

  draw(appearance:EffectFrameAppearance,width:number,height:number,logicalWidth:number,logicalHeight:number){
    if(this.lost||this.disposed)return;
    this.refreshTextures();
    if(!this.contentTexture)failure("E_RENDER","No accepted spatial-appearance source");
    const depth=appearance.depthOfField;
    if(depth?.depthMap&&!this.depthTexture)failure("E_SCHEMA","This spatial-appearance plan requires a bound depth map");
    if(!depth?.depthMap&&this.depthTexture)failure("E_SCHEMA","A depth map was bound but the recipe does not declare one");
    const gl=this.gl;
    if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
    if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)failure("E_RENDER","Browser could not allocate the spatial-appearance drawing buffer");
    gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program!);gl.bindVertexArray(this.vao!);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.contentTexture);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.depthTexture??this.contentTexture);
    const u=this.uniforms,motion=appearance.motionBlur?.sourceBlurVector??{x:0,y:0};
    gl.uniform1i(u.contentTexture!,0);gl.uniform1i(u.depthTexture!,1);gl.uniform2f(u.logicalSize!,logicalWidth,logicalHeight);
    gl.uniform4f(u.depthConfig!,depth?.focusDistance??1,depth?.focusRange??1,depth?.maxBlurRadius??0,depth?.planeDistance??1);
    gl.uniform3f(u.depthMapConfig!,depth?.depthMap?1:0,depth?.depthMap?.nearDistance??1,depth?.depthMap?.farDistance??1);
    gl.uniform2f(u.motionVector!,motion.x,motion.y);gl.drawArrays(gl.TRIANGLES,0,3);
    if(gl.getError()!==gl.NO_ERROR)failure("E_RENDER","Spatial-appearance draw failed");
    this.draws++;
  }

  contextLost(){this.lost=true;}
  contextRestored(){
    this.lost=false;this.program=undefined;this.buffer=undefined;this.vao=undefined;this.contentTexture=undefined;this.depthTexture=undefined;
    this.initialize();if(this.source)this.setSource(this.source);if(this.depthMap)this.setDepthMap(this.depthMap);
  }
  private release(){
    const gl=this.gl;if(this.contentTexture)gl.deleteTexture(this.contentTexture);if(this.depthTexture)gl.deleteTexture(this.depthTexture);
    if(this.buffer)gl.deleteBuffer(this.buffer);if(this.vao)gl.deleteVertexArray(this.vao);if(this.program)gl.deleteProgram(this.program);
    this.contentTexture=undefined;this.depthTexture=undefined;this.buffer=undefined;this.vao=undefined;this.program=undefined;
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.release();this.source=undefined;this.depthMap=undefined;
    if(this.mediaCanvas){this.mediaCanvas.width=1;this.mediaCanvas.height=1;this.mediaCanvas=undefined;}
  }
}
