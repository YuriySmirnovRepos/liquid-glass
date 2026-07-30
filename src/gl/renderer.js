// src/gl/renderer.js
import fullscreenVert from "./shaders/fullscreen.vert";
import backgroundFrag from "./shaders/background.frag";
import blurFrag from "./shaders/blur.frag";
import liquidGlassFrag from "./shaders/liquidGlass.frag";

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed:\n${error}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program) throw new Error("Could not create program");

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program linking failed:\n${error}`);
  }
  return program;
}

function createRenderTarget(gl, width, height) {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer)
    throw new Error("Could not create render target");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }
  return { texture, framebuffer, width, height };
}

function destroyRenderTarget(gl, target) {
  if (!target) return;
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

function clearCurrentFramebuffer(gl) {
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

export class LiquidGlassRenderer {
  constructor(gl) {
    this.gl = gl;

    this.backgroundProgram = createProgram(gl, fullscreenVert, backgroundFrag);
    this.blurProgram = createProgram(gl, fullscreenVert, blurFrag);
    this.glassProgram = createProgram(gl, fullscreenVert, liquidGlassFrag);

    this.emptyVao = gl.createVertexArray();
    if (!this.emptyVao) throw new Error("Could not create empty VAO");

    this.uniforms = {
      background: {
        resolution: gl.getUniformLocation(
          this.backgroundProgram,
          "uResolution"
        ),
        time: gl.getUniformLocation(this.backgroundProgram, "uTime"),
      },
      blur: {
        texture: gl.getUniformLocation(this.blurProgram, "uTexture"),
        direction: gl.getUniformLocation(this.blurProgram, "uDirection"),
        outputResolution: gl.getUniformLocation(
          this.blurProgram,
          "uOutputResolution"
        ),
        strength: gl.getUniformLocation(this.blurProgram, "uStrength"),
      },
      glass: {
        background: gl.getUniformLocation(this.glassProgram, "uBackground"),
        blurredBackground: gl.getUniformLocation(
          this.glassProgram,
          "uBlurredBackground"
        ),
        resolution: gl.getUniformLocation(this.glassProgram, "uResolution"),
        pointer: gl.getUniformLocation(this.glassProgram, "uPointer"),
        pointerVelocity: gl.getUniformLocation(
          this.glassProgram,
          "uPointerVelocity"
        ),
        rect: gl.getUniformLocation(this.glassProgram, "uRect"),
        radius: gl.getUniformLocation(this.glassProgram, "uRadius"),
        refraction: gl.getUniformLocation(this.glassProgram, "uRefraction"),
        enabled: gl.getUniformLocation(this.glassProgram, "uGlassEnabled"),
      },
    };

    this.backgroundTarget = null;
    this.blurHorizontalTarget = null;
    this.blurVerticalTarget = null;
  }

  destroyTargets() {
    const { gl } = this;
    destroyRenderTarget(gl, this.backgroundTarget);
    destroyRenderTarget(gl, this.blurHorizontalTarget);
    destroyRenderTarget(gl, this.blurVerticalTarget);
    this.backgroundTarget = null;
    this.blurHorizontalTarget = null;
    this.blurVerticalTarget = null;
  }

  resize(width, height) {
    const { gl } = this;
    this.destroyTargets();

    this.backgroundTarget = createRenderTarget(gl, width, height);

    const blurWidth = Math.max(1, Math.floor(width * 0.5));
    const blurHeight = Math.max(1, Math.floor(height * 0.5));

    this.blurHorizontalTarget = createRenderTarget(gl, blurWidth, blurHeight);
    this.blurVerticalTarget = createRenderTarget(gl, blurWidth, blurHeight);
  }

  drawFullscreen() {
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  renderBackground(time) {
    const { gl } = this;
    const target = this.backgroundTarget;

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    clearCurrentFramebuffer(gl);

    gl.useProgram(this.backgroundProgram);
    gl.bindVertexArray(this.emptyVao);

    gl.uniform2f(
      this.uniforms.background.resolution,
      target.width,
      target.height
    );
    gl.uniform1f(this.uniforms.background.time, time);

    this.drawFullscreen();
  }

  renderBlurPass(inputTarget, outputTarget, dirX, dirY) {
    const { gl } = this;

    gl.bindFramebuffer(gl.FRAMEBUFFER, outputTarget.framebuffer);
    gl.viewport(0, 0, outputTarget.width, outputTarget.height);
    clearCurrentFramebuffer(gl);

    gl.useProgram(this.blurProgram);
    gl.bindVertexArray(this.emptyVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTarget.texture);

    gl.uniform1i(this.uniforms.blur.texture, 0);
    gl.uniform2f(
      this.uniforms.blur.outputResolution,
      outputTarget.width,
      outputTarget.height
    );
    gl.uniform2f(this.uniforms.blur.direction, dirX, dirY);

    // 9-tap Gaussian за 5 билинейных выборок валиден только при
    // канонических смещениях, поэтому множитель нейтральный.
    gl.uniform1f(this.uniforms.blur.strength, 1.0);

    this.drawFullscreen();
  }

  renderLiquidGlass({
    width,
    height,
    pointer,
    rect,
    radius,
    refraction,
    glassEnabled,
  }) {
    const { gl } = this;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    clearCurrentFramebuffer(gl);

    gl.useProgram(this.glassProgram);
    gl.bindVertexArray(this.emptyVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTarget.texture);
    gl.uniform1i(this.uniforms.glass.background, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.blurVerticalTarget.texture);
    gl.uniform1i(this.uniforms.glass.blurredBackground, 1);

    gl.uniform2f(this.uniforms.glass.resolution, width, height);
    gl.uniform2f(this.uniforms.glass.pointer, pointer.x, pointer.y);
    gl.uniform2f(
      this.uniforms.glass.pointerVelocity,
      pointer.velocityX,
      pointer.velocityY
    );
    gl.uniform4f(
      this.uniforms.glass.rect,
      rect.x,
      rect.y,
      rect.width,
      rect.height
    );
    gl.uniform1f(this.uniforms.glass.radius, radius);
    gl.uniform1f(this.uniforms.glass.refraction, refraction);
    gl.uniform1f(this.uniforms.glass.enabled, glassEnabled);

    this.drawFullscreen();

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  renderFrame(time, params) {
    this.renderBackground(time);
    this.renderBlurPass(
      this.backgroundTarget,
      this.blurHorizontalTarget,
      1.0,
      0.0
    );
    this.renderBlurPass(
      this.blurHorizontalTarget,
      this.blurVerticalTarget,
      0.0,
      1.0
    );
    this.renderLiquidGlass(params);
  }
}
