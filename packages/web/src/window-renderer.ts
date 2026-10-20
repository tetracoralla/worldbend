import type { SurfaceWindowPlan } from "./generated/core-contract";
import { TransformError } from "./transform-error";

export type WindowSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
export function windowFailure(code: "E_RENDER" | "E_OUTPUT_LIMIT" | "E_UNSUPPORTED_MEDIA" | "E_SCHEMA", message: string): never {
  throw new TransformError({ code, message });
}

export function windowSourceSize(source: WindowSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    if(source.readyState<2)windowFailure("E_UNSUPPORTED_MEDIA","Video must have a decoded current frame");
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    if(!source.complete)windowFailure("E_UNSUPPORTED_MEDIA","Image decoding must finish before binding");
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if ((typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) ||
      (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) ||
      (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap)) {
    return { width: source.width, height: source.height };
  }
  return windowFailure("E_UNSUPPORTED_MEDIA", "Use a decoded image, video, canvas or ImageBitmap; arbitrary DOM is not a texture source");
}

const VERTEX = `#version 300 es
in vec2 position;
out vec2 windowUv;
void main() {
  gl_Position=vec4(position,0.0,1.0);
  windowUv=vec2(position.x*0.5+0.5,0.5-position.y*0.5);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D contentTexture;
uniform mat3 sampleH;
uniform vec2 windowSize;
uniform vec2 contentSize;
uniform vec3 depthPlane;
uniform vec3 frost;
in vec2 windowUv;
out vec4 color;
vec4 sampleContent(vec2 uv,float lod) {
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return vec4(0.0);
  return textureLod(contentTexture,uv,lod);
}
void main() {
  vec2 position=windowUv*windowSize;
  vec3 projected=sampleH*vec3(position,1.0);
  vec2 uv=projected.xy/projected.z;
  float radius=min(frost.z,frost.x+frost.y*abs(dot(depthPlane,vec3(position,1.0))));
  vec2 pixels=vec2(textureSize(contentTexture,0));
  float footprint=max(length(dFdx(uv)*pixels),length(dFdy(uv)*pixels));
  float lod=max(0.0,log2(max(footprint,1.0)));
  if(radius<0.001) { color=sampleContent(uv,lod); return; }
  // A bounded 5x5 Gaussian over premultiplied samples. Mip filtering keeps
  // large radii from becoming separated ghost copies of the source.
  lod=max(lod,log2(max(1.0,radius*max(pixels.x/contentSize.x,pixels.y/contentSize.y)*0.5)));
  float weights[5]=float[5](1.0,4.0,6.0,4.0,1.0);
  vec4 result=vec4(0.0);
  for(int y=0;y<5;y++) for(int x=0;x<5;x++) {
    vec2 offset=vec2(float(x-2),float(y-2))*radius*0.5/contentSize;
    result+=sampleContent(uv+offset,lod)*weights[x]*weights[y]/256.0;
  }
  color=result;
}`;

export class WindowRenderer {
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | undefined;
  private buffer: WebGLBuffer | undefined;
  private texture: WebGLTexture | undefined;
  private vao: WebGLVertexArrayObject | undefined;
  private uniforms: Record<string, WebGLUniformLocation> = {};
  private matrix = new Float32Array(9);
  private textureSizes = new WeakMap<WebGLTexture,{width:number;height:number}>();
  private source: WindowSource | undefined;
  private sourceDirty = false;
  private mediaCanvas: HTMLCanvasElement | undefined;
  private lost = false;
  private disposed = false;
  readonly maximumTextureSize: number;
  readonly maximumDrawingSize: number;
  draws = 0;
  uploads = 0;

  constructor(readonly canvas: HTMLCanvasElement, preserveDrawingBuffer = false) {
    const gl = canvas.getContext("webgl2", { alpha:true, antialias:false, premultipliedAlpha:true, preserveDrawingBuffer });
    if (!gl) windowFailure("E_RENDER", "WebGL2 is required for spatial windows");
    this.gl = gl;
    this.maximumTextureSize = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maximumDrawingSize=Math.min(4096,this.maximumTextureSize,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,viewport[0]!,viewport[1]!);
    this.initialize();
  }

  private initialize() {
    const gl=this.gl;
    const shaders: WebGLShader[]=[];
    try {
      for(const [kind,text] of [[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,FRAGMENT]] as const) {
        const shader=gl.createShader(kind) ?? windowFailure("E_RENDER","Cannot allocate shader");
        shaders.push(shader); gl.shaderSource(shader,text); gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) windowFailure("E_RENDER",gl.getShaderInfoLog(shader) ?? "Shader compilation failed");
      }
      this.program=gl.createProgram() ?? windowFailure("E_RENDER","Cannot allocate program");
      for(const shader of shaders) gl.attachShader(this.program,shader);
      gl.linkProgram(this.program);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) windowFailure("E_RENDER",gl.getProgramInfoLog(this.program) ?? "Shader linking failed");
      this.vao=gl.createVertexArray() ?? windowFailure("E_RENDER","Cannot allocate vertex array");
      this.buffer=gl.createBuffer() ?? windowFailure("E_RENDER","Cannot allocate geometry");
      gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(this.program,"position");
      gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      for(const name of ["contentTexture","sampleH","windowSize","contentSize","depthPlane","frost"]) {
        this.uniforms[name]=gl.getUniformLocation(this.program,name) ?? windowFailure("E_RENDER",`Missing ${name}`);
      }
    } catch(error) { this.release(); throw error; }
    finally { for(const shader of shaders)gl.deleteShader(shader); }
  }

  setSource(source: WindowSource) {
    const {width,height}=windowSourceSize(source);
    if(width<1||height<1) windowFailure("E_UNSUPPORTED_MEDIA","Source must have decoded pixels before binding");
    if(width>this.maximumTextureSize||height>this.maximumTextureSize||width*height>16_777_216) {
      windowFailure("E_OUTPUT_LIMIT","Source exceeds the device texture size or 16 megapixel budget");
    }
    if(source===this.canvas) windowFailure("E_UNSUPPORTED_MEDIA","A window cannot sample its own output canvas");
    if(this.lost) { this.source=source;this.sourceDirty=true;return; }
    // Replacement is transactional: tainted or unsupported media cannot
    // destroy the previously accepted texture or change the source identity.
    const gl=this.gl;
    const next=gl.createTexture() ?? windowFailure("E_RENDER","Cannot allocate source texture");
    try { this.upload(next,source); }
    catch(error) { gl.deleteTexture(next);throw error; }
    if(this.texture)gl.deleteTexture(this.texture);
    this.texture=next;this.source=source;this.sourceDirty=false;
  }

  refresh() { this.sourceDirty=true; }
  private upload(texture:WebGLTexture, source:WindowSource) {
    const gl=this.gl;
    const {width,height}=windowSourceSize(source);
    if(width<1||height<1||width>this.maximumTextureSize||height>this.maximumTextureSize||width*height>16_777_216) {
      windowFailure("E_OUTPUT_LIMIT","Changed source dimensions exceed texture limits or contain no pixels");
    }
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    // Allocate an explicit RGBA8 mip chain once. Repeated texImage2D(video)
    // can change the driver's backing format; sub-image uploads keep the
    // filterable storage stable and avoid reallocating it every video frame.
    if(!this.textureSizes.has(texture)) {
      gl.texStorage2D(gl.TEXTURE_2D,Math.floor(Math.log2(Math.max(width,height)))+1,gl.RGBA8,width,height);
      if(gl.getError()!==gl.NO_ERROR)windowFailure("E_RENDER","Cannot allocate source texture storage");
      this.textureSizes.set(texture,{width,height});
    }
    try {
      let pixels: WindowSource = source;
      if(typeof ImageBitmap!=="undefined" && source instanceof ImageBitmap) {
        // WebGL ignores UNPACK_PREMULTIPLY_ALPHA for ImageBitmap. Normalize
        // through a reusable canvas so caller bitmap options cannot corrupt alpha.
        this.mediaCanvas ??= document.createElement("canvas");
        if(this.mediaCanvas.width!==width)this.mediaCanvas.width=width;
        if(this.mediaCanvas.height!==height)this.mediaCanvas.height=height;
        const context=this.mediaCanvas.getContext("2d") ?? windowFailure("E_RENDER","Cannot prepare media pixels");
        context.clearRect(0,0,width,height);
        context.drawImage(source,0,0);pixels=this.mediaCanvas;
      }
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    }
    catch { windowFailure("E_UNSUPPORTED_MEDIA","Source cannot be sampled; check decoding and CORS before replacing content"); }
    if(gl.getError()!==gl.NO_ERROR)windowFailure("E_RENDER","Texture upload failed");
    gl.generateMipmap(gl.TEXTURE_2D);
    if(gl.getError()!==gl.NO_ERROR)windowFailure("E_RENDER","Texture filtering setup failed");
    this.uploads++;
  }

  draw(plan:SurfaceWindowPlan,width:number,height:number) {
    if(this.lost||this.disposed)return;
    const gl=this.gl;
    if(this.sourceDirty&&this.source&&this.texture) {
      const next=windowSourceSize(this.source),previous=this.textureSizes.get(this.texture);
      if(next.width!==previous?.width||next.height!==previous?.height)this.setSource(this.source);
      else this.upload(this.texture,this.source);
      this.sourceDirty=false;
    }
    if(!this.texture)windowFailure("E_RENDER","No accepted source texture");
    if(this.canvas.width!==width)this.canvas.width=width;
    if(this.canvas.height!==height)this.canvas.height=height;
    if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)windowFailure("E_RENDER","Browser could not allocate the requested drawing buffer");
    gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    if(!plan.mapping)return;
    gl.useProgram(this.program!);gl.bindVertexArray(this.vao!);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    const u=this.uniforms;
    const h=plan.mapping.sampleHomography;
    for(let row=0;row<3;row++)for(let col=0;col<3;col++)this.matrix[col*3+row]=h[row*3+col]!;
    gl.uniform1i(u.contentTexture!,0);gl.uniformMatrix3fv(u.sampleH!,false,this.matrix);
    gl.uniform2f(u.windowSize!,plan.spec.windowSize.width,plan.spec.windowSize.height);
    gl.uniform2f(u.contentSize!,plan.spec.contentSize.width,plan.spec.contentSize.height);
    gl.uniform3fv(u.depthPlane!,plan.mapping.depthPlane);
    const f=plan.spec.frost;gl.uniform3f(u.frost!,f.baseRadius,f.spread,f.maxRadius);
    gl.drawArrays(gl.TRIANGLES,0,3);
    if(gl.getError()!==gl.NO_ERROR)windowFailure("E_RENDER","Spatial window draw failed");
    this.draws++;
  }

  contextLost() { this.lost=true; }
  contextRestored() {
    this.lost=false;this.texture=undefined;this.program=undefined;this.buffer=undefined;this.vao=undefined;
    this.initialize();
    if(this.source)this.setSource(this.source);
  }
  private release() {
    const gl=this.gl;
    if(this.texture)gl.deleteTexture(this.texture);
    if(this.buffer)gl.deleteBuffer(this.buffer);
    if(this.vao)gl.deleteVertexArray(this.vao);
    if(this.program)gl.deleteProgram(this.program);
    this.texture=undefined;this.buffer=undefined;this.vao=undefined;this.program=undefined;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.release();this.source=undefined;
    if(this.mediaCanvas){this.mediaCanvas.width=1;this.mediaCanvas.height=1;this.mediaCanvas=undefined;}
  }
}
