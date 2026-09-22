type SupportedComposite = 'source-over' | 'lighter';

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export class SpineWebGlRenderer {
  private hostCanvas: HTMLCanvasElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private uvBuffer: WebGLBuffer | null = null;
  private aPosition = -1;
  private aTexCoord = -1;
  private uResolution: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private uTexture: WebGLUniformLocation | null = null;
  private textureCache = new WeakMap<HTMLCanvasElement, WebGLTexture>();
  private currentBlend: string | null = null;
  private dirty = false;

  get width() {
    return this.canvas?.width || 0;
  }

  get height() {
    return this.canvas?.height || 0;
  }

  setHostCanvas(canvas: HTMLCanvasElement | null) {
    if (this.hostCanvas === canvas) return;
    this.hostCanvas = canvas;
    if (this.canvas && this.canvas !== canvas && !this.hostCanvas) {
      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.positionBuffer = null;
      this.uvBuffer = null;
      this.aPosition = -1;
      this.aTexCoord = -1;
      this.uResolution = null;
      this.uAlpha = null;
      this.uColor = null;
      this.uTexture = null;
      this.textureCache = new WeakMap<HTMLCanvasElement, WebGLTexture>();
      this.currentBlend = null;
      this.dirty = false;
    }
    if (canvas) {
      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.positionBuffer = null;
      this.uvBuffer = null;
      this.aPosition = -1;
      this.aTexCoord = -1;
      this.uResolution = null;
      this.uAlpha = null;
      this.uColor = null;
      this.uTexture = null;
      this.textureCache = new WeakMap<HTMLCanvasElement, WebGLTexture>();
      this.currentBlend = null;
      this.dirty = false;
    }
  }

  usesHostCanvas() {
    return !!this.hostCanvas && this.canvas === this.hostCanvas;
  }

  supportsComposite(composite: GlobalCompositeOperation) {
    return composite === 'source-over' || composite === 'lighter';
  }

  begin(width: number, height: number) {
    const gl = this.ensureContext(width, height);
    if (!gl || !this.canvas) return false;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = Math.max(1, width | 0);
      this.canvas.height = Math.max(1, height | 0);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.currentBlend = null;
    this.dirty = false;
    return true;
  }

  drawQuad(
    textureSource: HTMLCanvasElement,
    quad: readonly number[],
    color: readonly number[],
    alpha: number,
    composite: GlobalCompositeOperation,
    premultipliedAlpha: boolean
  ) {
    if (!this.supportsComposite(composite) || quad.length < 8) return false;
    const positions = new Float32Array([
      quad[0], quad[1],
      quad[2], quad[3],
      quad[4], quad[5],
      quad[0], quad[1],
      quad[4], quad[5],
      quad[6], quad[7],
    ]);
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 0,
      1, 1,
      0, 1,
    ]);
    return this.drawTriangles(textureSource, positions, uvs, color, alpha, composite as SupportedComposite, premultipliedAlpha);
  }

  drawTriangles(
    textureSource: HTMLCanvasElement,
    positions: Float32Array,
    uvs: Float32Array,
    color: readonly number[],
    alpha: number,
    composite: SupportedComposite,
    premultipliedAlpha: boolean
  ) {
    const gl = this.gl;
    const canvas = this.canvas;
    const program = this.program;
    if (!gl || !canvas || !program) return false;
    if (!textureSource || textureSource.width <= 0 || textureSource.height <= 0) return false;
    if (positions.length === 0 || uvs.length === 0 || positions.length !== uvs.length) return false;

    const texture = this.getTexture(textureSource);
    if (!texture) return false;

    this.applyBlend(composite, premultipliedAlpha);
    gl.useProgram(program);
    gl.uniform2f(this.uResolution, canvas.width, canvas.height);
    gl.uniform1f(this.uAlpha, Math.max(0, Math.min(1, alpha || 0)));
    gl.uniform3f(
      this.uColor,
      Math.max(0, Math.min(1, Number(color?.[0] ?? 1))),
      Math.max(0, Math.min(1, Number(color?.[1] ?? 1))),
      Math.max(0, Math.min(1, Number(color?.[2] ?? 1))),
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uTexture, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aTexCoord);
    gl.vertexAttribPointer(this.aTexCoord, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 2);
    this.dirty = true;
    return true;
  }

  flushTo(ctx: CanvasRenderingContext2D) {
    if (!this.canvas || !this.gl || !this.dirty) return false;
    this.gl.flush();
    if (this.usesHostCanvas()) {
      this.currentBlend = null;
      this.dirty = false;
      return true;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.currentBlend = null;
    this.dirty = false;
    return true;
  }

  clear(width: number, height: number) {
    const gl = this.ensureContext(width, height);
    if (!gl || !this.canvas) return false;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = Math.max(1, width | 0);
      this.canvas.height = Math.max(1, height | 0);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.currentBlend = null;
    this.dirty = false;
    return true;
  }

  private ensureContext(width: number, height: number) {
    if (this.gl && this.canvas && this.program && this.positionBuffer && this.uvBuffer) {
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = Math.max(1, width | 0);
        this.canvas.height = Math.max(1, height | 0);
      }
      return this.gl;
    }

    if (typeof document === 'undefined') return null;
    const canvas = this.hostCanvas || document.createElement('canvas');
    canvas.width = Math.max(1, width | 0);
    canvas.height = Math.max(1, height | 0);
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;

    const program = createProgram(
      gl,
      `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      uniform vec2 u_resolution;
      varying vec2 v_texCoord;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
      `,
      `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_texture;
      uniform float u_alpha;
      uniform vec3 u_color;
      void main() {
        vec4 tex = texture2D(u_texture, v_texCoord);
        tex.rgb *= u_color;
        tex.a *= u_alpha;
        gl_FragColor = tex;
      }
      `
    );
    if (!program) return null;

    const positionBuffer = gl.createBuffer();
    const uvBuffer = gl.createBuffer();
    if (!positionBuffer || !uvBuffer) {
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (uvBuffer) gl.deleteBuffer(uvBuffer);
      gl.deleteProgram(program);
      return null;
    }

    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.positionBuffer = positionBuffer;
    this.uvBuffer = uvBuffer;
    this.aPosition = gl.getAttribLocation(program, 'a_position');
    this.aTexCoord = gl.getAttribLocation(program, 'a_texCoord');
    this.uResolution = gl.getUniformLocation(program, 'u_resolution');
    this.uAlpha = gl.getUniformLocation(program, 'u_alpha');
    this.uColor = gl.getUniformLocation(program, 'u_color');
    this.uTexture = gl.getUniformLocation(program, 'u_texture');
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    return gl;
  }

  private getTexture(source: HTMLCanvasElement) {
    const gl = this.gl;
    if (!gl) return null;
    const cached = this.textureCache.get(source);
    if (cached) return cached;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.textureCache.set(source, texture);
    return texture;
  }

  private applyBlend(composite: SupportedComposite, premultipliedAlpha: boolean) {
    const gl = this.gl;
    if (!gl) return;
    const blendKey = `${composite}::${premultipliedAlpha ? 'pma' : 'straight'}`;
    if (blendKey === this.currentBlend) return;
    this.currentBlend = blendKey;
    if (composite === 'lighter') {
      if (premultipliedAlpha) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      return;
    }
    if (premultipliedAlpha) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}
