/**
 * @author miibond
 * Generate a texture that represents the luminosity of the current scene, adapted over time
 * to simulate the optic nerve responding to the amount of light it is receiving.
 * Based on a GDC2007 presentation by Wolfgang Engel titled "Post-Processing Pipeline"
 *
 * Full-screen tone-mapping shader based on http://www.graphics.cornell.edu/~jaf/publications/sig02_paper.pdf
 */

THREE.AdaptiveToneMappingPass = function ( adaptive, resolution ) {

	this.resolution = ( resolution !== undefined ) ? resolution : 256;
	this.needsInit = true;
	this.adaptive = adaptive !== undefined ? !!adaptive : true;

	this.luminanceRT = null;
	this.previousLuminanceRT = null;
	this.currentLuminanceRT = null;

	if ( THREE.CopyShader === undefined )
		console.error( "THREE.AdaptiveToneMappingPass relies on THREE.CopyShader" );

	var copyShader = THREE.CopyShader;

	this.copyUniforms = THREE.UniformsUtils.clone( copyShader.uniforms );

	this.composite = new THREE.ShaderMaterial( {

		uniforms: this.copyUniforms,
		vertexShader: copyShader.vertexShader,
		fragmentShader: copyShader.fragmentShader,
		blending: THREE.NoBlending,
		depthTest: false

	} );

	if ( THREE.LuminosityShader === undefined )
		console.error( "THREE.AdaptiveToneMappingPass relies on THREE.LuminosityShader" );

	this.materialLuminance = new THREE.ShaderMaterial( {

		uniforms: THREE.LuminosityShader.uniforms,
		vertexShader: THREE.LuminosityShader.vertexShader,
		fragmentShader: THREE.LuminosityShader.fragmentShader,
		blending: THREE.NoBlending,
	} );

	this.adaptLuminanceShader = {
		defines: {
			"MIP_LEVEL_1X1" : Math.log2( this.resolution ).toFixed(1),
		},
		uniforms: {
			"lastLum": { type: "t", value: null },
			"currentLum": { type: "t", value: null },
			"delta": { type: 'f', value: 0.016 },
			"tau": { type: 'f', value: 1.0 }
		},
		vertexShader: [
			"varying vec2 vUv;",

			"void main() {",

				"vUv = uv;",
				"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

			"}"
		].join('\n'),
		fragmentShader: [
			"varying vec2 vUv;",

			"uniform sampler2D lastLum;",
			"uniform sampler2D currentLum;",
			"uniform float delta;",
			"uniform float tau;",

			"void main() {",

				"vec4 lastLum = texture2D( lastLum, vUv, MIP_LEVEL_1X1 );",
				"vec4 currentLum = texture2D( currentLum, vUv, MIP_LEVEL_1X1 );",

				"float fLastLum = lastLum.r;",
				"float fCurrentLum = currentLum.r;",

				//The adaption seems to work better in extreme lighting differences
				//if the input luminance is squared.
				"fCurrentLum *= fCurrentLum;",

				// Adapt the luminance using Pattanaik's technique
				"float fAdaptedLum = fLastLum + (fCurrentLum - fLastLum) * (1.0 - exp(-delta * tau));",
				// "fAdaptedLum = sqrt(fAdaptedLum);",
				"gl_FragColor = vec4( vec3( fAdaptedLum ), 1.0 );",
			"}",
		].join('\n')
	};

	this.materialAdaptiveLum = new THREE.ShaderMaterial( {

		uniforms: this.adaptLuminanceShader.uniforms,
		vertexShader: this.adaptLuminanceShader.vertexShader,
		fragmentShader: this.adaptLuminanceShader.fragmentShader,
		defines: this.adaptLuminanceShader.defines,
		blending: THREE.NoBlending
	} );

	if ( THREE.ToneMapShader === undefined )
		console.error( "THREE.AdaptiveToneMappingPass relies on THREE.ToneMapShader" );

	this.materialToneMap = new THREE.ShaderMaterial( {

		uniforms: THREE.ToneMapShader.uniforms,
		vertexShader: THREE.ToneMapShader.vertexShader,
		fragmentShader: THREE.ToneMapShader.fragmentShader,
		blending: THREE.NoBlending
	} );

	this.enabled = true;
	this.needsSwap = true;
	this.clear = false;

	this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	this.scene  = new THREE.Scene();

	this.quad = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), null );
	this.scene.add( this.quad );

};

THREE.AdaptiveToneMappingPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta, maskActive ) {

		if ( this.needsInit ) {
			this.reset( renderer );
			this.luminanceRT.type = readBuffer.type;
			this.previousLuminanceRT.type = readBuffer.type;
			this.currentLuminanceRT.type = readBuffer.type;
			this.needsInit = false;
		}

		if ( this.adaptive ) {
			//Render the luminance of the current scene into a render target with mipmapping enabled
			this.quad.material = this.materialLuminance;
			this.materialLuminance.uniforms.tDiffuse.value = readBuffer;
			renderer.render( this.scene, this.camera, this.currentLuminanceRT );

			//Use the new luminance values, the previous luminance and the frame delta to
			//adapt the luminance over time.
			this.quad.material = this.materialAdaptiveLum;
			this.materialAdaptiveLum.uniforms.delta.value = delta;
			this.materialAdaptiveLum.uniforms.lastLum.value = this.previousLuminanceRT;
			this.materialAdaptiveLum.uniforms.currentLum.value = this.currentLuminanceRT;
			renderer.render( this.scene, this.camera, this.luminanceRT );

			//Copy the new adapted luminance value so that it can be used by the next frame.
			this.quad.material = this.composite;
			this.copyUniforms.tDiffuse.value = this.luminanceRT;
			renderer.render( this.scene, this.camera, this.previousLuminanceRT );
		}

		this.quad.material = this.materialToneMap;
		this.materialToneMap.uniforms.tDiffuse.value = readBuffer;
		renderer.render( this.scene, this.camera, writeBuffer, this.clear );

	},

	reset: function( renderer ) {
		// render targets
		if ( this.luminanceRT ) {
			this.luminanceRT.dispose();
		}
		if ( this.currentLuminanceRT ) {
			this.currentLuminanceRT.dispose();
		}
		if ( this.previousLuminanceRT ) {
			this.previousLuminanceRT.dispose();
		}
		var pars = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBFormat };

		this.luminanceRT = new THREE.WebGLRenderTarget( this.resolution, this.resolution, pars );
		this.luminanceRT.generateMipmaps = false;
		this.previousLuminanceRT = new THREE.WebGLRenderTarget( this.resolution, this.resolution, pars );
		this.previousLuminanceRT.generateMipmaps = false;

		//We only need mipmapping for the current luminosity because we want a down-sampled version to sample in our adaptive shader
		pars.minFilter = THREE.LinearMipMapLinearFilter;
		this.currentLuminanceRT = new THREE.WebGLRenderTarget( this.resolution, this.resolution, pars );

		if ( this.adaptive ) {
			this.materialToneMap.defines["ADAPTED_LUMINANCE"] = "";
			this.materialToneMap.uniforms.luminanceMap.value = this.luminanceRT;
		}
		//Put something in the adaptive luminance texture so that the scene can render initially
		this.quad.material = new THREE.MeshBasicMaterial( { color: 0x777777 });
		this.materialLuminance.needsUpdate = true;
		this.materialAdaptiveLum.needsUpdate = true;
		this.materialToneMap.needsUpdate = true;
		// renderer.render( this.scene, this.camera, this.luminanceRT );
		// renderer.render( this.scene, this.camera, this.previousLuminanceRT );
		// renderer.render( this.scene, this.camera, this.currentLuminanceRT );
	},

	setAdaptive: function( adaptive ) {
		if ( adaptive ) {
			this.adaptive = true;
			this.materialToneMap.defines["ADAPTED_LUMINANCE"] = "";
			this.materialToneMap.uniforms.luminanceMap.value = this.luminanceRT;
		}
		else {
			this.adaptive = false;
			delete this.materialToneMap.defines["ADAPTED_LUMINANCE"];
			this.materialToneMap.uniforms.luminanceMap.value = undefined;
		}
		this.materialToneMap.needsUpdate = true;
	},

	setAdaptionRate: function( rate ) {
		if ( rate ) {
			this.materialAdaptiveLum.uniforms.tau.value = Math.abs( rate );
		}
	},

	setMaxLuminance: function( maxLum ) {
		if ( maxLum ) {
			this.materialToneMap.uniforms.maxLuminance.value = maxLum;
		}
	},

	setAverageLuminance: function( avgLum ) {
		if ( avgLum ) {
			this.materialToneMap.uniforms.averageLuminance.value = avgLum;
		}
	},

	setMiddleGrey: function( middleGrey ) {
		if ( middleGrey ) {
			this.materialToneMap.uniforms.middleGrey.value = middleGrey;
		}
	},

	dispose: function() {
		if ( this.luminanceRT ) {
			this.luminanceRT.dispose();
		}
		if ( this.previousLuminanceRT ) {
			this.previousLuminanceRT.dispose();
		}
		if ( this.currentLuminanceRT ) {
			this.currentLuminanceRT.dispose();
		}
		if ( this.materialLuminance ) {
			this.materialLuminance.dispose();
		}
		if ( this.materialAdaptiveLum ) {
			this.materialAdaptiveLum.dispose();
		}
		if ( this.composite ) {
			this.composite.dispose();
		}
		if ( this.materialToneMap ) {
			this.materialToneMap.dispose();
		}
	}

};

/**
 * @author alteredq / http://alteredqualia.com/
 */

THREE.BloomPass = function ( strength, luminanceThreshold, kernelSize, sigma, resolution ) {

	strength = ( strength !== undefined ) ? strength : 1;
	kernelSize = ( kernelSize !== undefined ) ? kernelSize : 25;
	sigma = ( sigma !== undefined ) ? sigma : 4.0;
	resolution = ( resolution !== undefined ) ? resolution : 256;
	luminanceThreshold = ( luminanceThreshold !== undefined) ? luminanceThreshold : .8;

	// render targets

	var pars = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBFormat };

	this.renderTargetX = new THREE.WebGLRenderTarget( resolution, resolution, pars );
	this.renderTargetY = new THREE.WebGLRenderTarget( resolution, resolution, pars );

	// copy material

	if ( THREE.CopyShader === undefined )
		console.error( "THREE.BloomPass relies on THREE.CopyShader" );

	var thresholdShader = THREE.ThresholdShader;
	this.thresholdUniforms = THREE.UniformsUtils.clone( thresholdShader.uniforms );
	this.thresholdUniforms["threshold"].value = luminanceThreshold;
	this.threshold = new THREE.ShaderMaterial( {
		uniforms: this.thresholdUniforms,
		vertexShader: thresholdShader.vertexShader,
		fragmentShader: thresholdShader.fragmentShader,
		depthTest: false
	} );

	var copyShader = THREE.CopyShader;
	this.compositeUniforms = THREE.UniformsUtils.clone( copyShader.uniforms );
	this.compositeUniforms[ "opacity" ].value = strength;
	this.composite = new THREE.ShaderMaterial( {

		uniforms: this.compositeUniforms,
		vertexShader: copyShader.vertexShader,
		fragmentShader: copyShader.fragmentShader,
		blending: THREE.AdditiveBlending,
		transparent: true,
		depthTest: false
	} );

	// convolution material

	if ( THREE.ConvolutionShader === undefined )
		console.error( "THREE.BloomPass relies on THREE.ConvolutionShader" );

	var convolutionShader = THREE.ConvolutionShader;

	this.convolutionUniforms = THREE.UniformsUtils.clone( convolutionShader.uniforms );

	this.convolutionUniforms[ "uImageIncrement" ].value = THREE.BloomPass.blurX;
	this.convolutionUniforms[ "cKernel" ].value = THREE.ConvolutionShader.buildKernel( sigma );

	this.materialConvolution = new THREE.ShaderMaterial( {

		uniforms: this.convolutionUniforms,
		vertexShader:  convolutionShader.vertexShader,
		fragmentShader: convolutionShader.fragmentShader,
		defines: {
			"KERNEL_SIZE_FLOAT": kernelSize.toFixed( 1 ),
			"KERNEL_SIZE_INT": kernelSize.toFixed( 0 )
		}

	} );

	this.enabled = true;
	this.needsSwap = false;
	this.clear = false;


	this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	this.scene  = new THREE.Scene();

	this.quad = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), null );
	this.scene.add( this.quad );

};

THREE.BloomPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta, maskActive ) {

		var autoClear = renderer.autoClear;
		renderer.autoClear = false;

		if ( maskActive ) renderer.context.disable( renderer.context.STENCIL_TEST );

		this.quad.material = this.threshold;

		this.thresholdUniforms[ "tDiffuse" ].value = readBuffer;
		renderer.render( this.scene, this.camera, this.renderTargetY, false );

		// Render quad with blurred scene into texture (convolution pass 1)
		this.quad.material = this.materialConvolution;

		this.convolutionUniforms[ "tDiffuse" ].value = this.renderTargetY;
		this.convolutionUniforms[ "uImageIncrement" ].value = THREE.BloomPass.blurX;

		renderer.render( this.scene, this.camera, this.renderTargetX, false );


		// Render quad with blured scene into texture (convolution pass 2)

		this.convolutionUniforms[ "tDiffuse" ].value = this.renderTargetX;
		this.convolutionUniforms[ "uImageIncrement" ].value = THREE.BloomPass.blurY;

		renderer.render( this.scene, this.camera, this.renderTargetY, false );

		// Render original scene with superimposed blur to texture

		this.quad.material = this.composite;

		this.compositeUniforms[ "tDiffuse" ].value = this.renderTargetY;

		if ( maskActive ) renderer.context.enable( renderer.context.STENCIL_TEST );

		renderer.render( this.scene, this.camera, readBuffer, false );

		// restore original state
		renderer.autoClear = autoClear;
	}

};

THREE.BloomPass.blurX = new THREE.Vector2( 0.001953125, 0.0 );
THREE.BloomPass.blurY = new THREE.Vector2( 0.0, 0.001953125 );

/**
 * Depth-of-field post-process with bokeh shader
 */


THREE.BokehPass = function ( scene, camera, params ) {

	this.scene = scene;
	this.camera = camera;

	var focus = ( params.focus !== undefined ) ? params.focus : 1.0;
	var aspect = ( params.aspect !== undefined ) ? params.aspect : camera.aspect;
	var aperture = ( params.aperture !== undefined ) ? params.aperture : 0.025;
	var maxblur = ( params.maxblur !== undefined ) ? params.maxblur : 1.0;

	// render targets

	var width = params.width || window.innerWidth || 1;
	var height = params.height || window.innerHeight || 1;

	this.renderTargetColor = new THREE.WebGLRenderTarget( width, height, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBFormat
	} );

	this.renderTargetDepth = this.renderTargetColor.clone();

	// depth material

	this.materialDepth = new THREE.MeshDepthMaterial();

	// bokeh material

	if ( THREE.BokehShader === undefined ) {
		console.error( "THREE.BokehPass relies on THREE.BokehShader" );
	}
	
	var bokehShader = THREE.BokehShader;
	var bokehUniforms = THREE.UniformsUtils.clone( bokehShader.uniforms );

	bokehUniforms[ "tDepth" ].value = this.renderTargetDepth;

	bokehUniforms[ "focus" ].value = focus;
	bokehUniforms[ "aspect" ].value = aspect;
	bokehUniforms[ "aperture" ].value = aperture;
	bokehUniforms[ "maxblur" ].value = maxblur;

	this.materialBokeh = new THREE.ShaderMaterial({
		uniforms: bokehUniforms,
		vertexShader: bokehShader.vertexShader,
		fragmentShader: bokehShader.fragmentShader
	});

	this.uniforms = bokehUniforms;
	this.enabled = true;
	this.needsSwap = false;
	this.renderToScreen = false;
	this.clear = false;

	this.camera2 = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	this.scene2  = new THREE.Scene();

	this.quad2 = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), null );
	this.scene2.add( this.quad2 );

};

THREE.BokehPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta, maskActive ) {

		this.quad2.material = this.materialBokeh;

		// Render depth into texture

		this.scene.overrideMaterial = this.materialDepth;

		renderer.render( this.scene, this.camera, this.renderTargetDepth, true );

		// Render bokeh composite

		this.uniforms[ "tColor" ].value = readBuffer;

		if ( this.renderToScreen ) {

			renderer.render( this.scene2, this.camera2 );

		} else {

			renderer.render( this.scene2, this.camera2, readBuffer, this.clear );

		}

		this.scene.overrideMaterial = null;

	}

};


/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Full-screen textured quad shader
 */

THREE.CopyShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"opacity":  { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float opacity;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 texel = texture2D( tDiffuse, vUv );",
			"gl_FragColor = opacity * texel;",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 */

THREE.DotScreenPass = function ( center, angle, scale ) {

	if ( THREE.DotScreenShader === undefined )
		console.error( "THREE.DotScreenPass relies on THREE.DotScreenShader" );

	var shader = THREE.DotScreenShader;

	this.uniforms = THREE.UniformsUtils.clone( shader.uniforms );

	if ( center !== undefined ) this.uniforms[ "center" ].value.copy( center );
	if ( angle !== undefined ) this.uniforms[ "angle"].value = angle;
	if ( scale !== undefined ) this.uniforms[ "scale"].value = scale;

	this.material = new THREE.ShaderMaterial( {

		uniforms: this.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader

	} );

	this.enabled = true;
	this.renderToScreen = false;
	this.needsSwap = true;


	this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	this.scene  = new THREE.Scene();

	this.quad = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), null );
	this.scene.add( this.quad );

};

THREE.DotScreenPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta ) {

		this.uniforms[ "tDiffuse" ].value = readBuffer;
		this.uniforms[ "tSize" ].value.set( readBuffer.width, readBuffer.height );

		this.quad.material = this.material;

		if ( this.renderToScreen ) {

			renderer.render( this.scene, this.camera );

		} else {

			renderer.render( this.scene, this.camera, writeBuffer, false );

		}

	}

};

/**
 * @author alteredq / http://alteredqualia.com/
 */

THREE.EffectComposer = function ( renderer, renderTarget ) {

	this.renderer = renderer;

	if ( renderTarget === undefined ) {

		var pixelRatio = renderer.getPixelRatio();

		var width  = Math.floor( renderer.context.canvas.width  / pixelRatio ) || 1;
		var height = Math.floor( renderer.context.canvas.height / pixelRatio ) || 1;
		var parameters = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBFormat, stencilBuffer: false };

		renderTarget = new THREE.WebGLRenderTarget( width, height, parameters );

	}

	this.renderTarget1 = renderTarget;
	this.renderTarget2 = renderTarget.clone();

	this.writeBuffer = this.renderTarget1;
	this.readBuffer = this.renderTarget2;

	this.passes = [];

	if ( THREE.CopyShader === undefined )
		console.error( "THREE.EffectComposer relies on THREE.CopyShader" );

	this.copyPass = new THREE.ShaderPass( THREE.CopyShader );

};

THREE.EffectComposer.prototype = {

	swapBuffers: function() {

		var tmp = this.readBuffer;
		this.readBuffer = this.writeBuffer;
		this.writeBuffer = tmp;

	},

	addPass: function ( pass ) {

		this.passes.push( pass );

	},

	insertPass: function ( pass, index ) {

		this.passes.splice( index, 0, pass );

	},

	render: function ( delta ) {

		this.writeBuffer = this.renderTarget1;
		this.readBuffer = this.renderTarget2;

		var maskActive = false;

		var pass, i, il = this.passes.length;

		for ( i = 0; i < il; i ++ ) {

			pass = this.passes[ i ];

			if ( !pass.enabled ) continue;

			pass.render( this.renderer, this.writeBuffer, this.readBuffer, delta, maskActive );

			if ( pass.needsSwap ) {

				if ( maskActive ) {

					var context = this.renderer.context;

					context.stencilFunc( context.NOTEQUAL, 1, 0xffffffff );

					this.copyPass.render( this.renderer, this.writeBuffer, this.readBuffer, delta );

					context.stencilFunc( context.EQUAL, 1, 0xffffffff );

				}

				this.swapBuffers();

			}

			if ( pass instanceof THREE.MaskPass ) {

				maskActive = true;

			} else if ( pass instanceof THREE.ClearMaskPass ) {

				maskActive = false;

			}

		}

	},

	reset: function ( renderTarget ) {

		if ( renderTarget === undefined ) {

			renderTarget = this.renderTarget1.clone();

			var pixelRatio = this.renderer.getPixelRatio();

			renderTarget.width  = Math.floor( this.renderer.context.canvas.width  / pixelRatio );
			renderTarget.height = Math.floor( this.renderer.context.canvas.height / pixelRatio );

		}

		this.renderTarget1 = renderTarget;
		this.renderTarget2 = renderTarget.clone();

		this.writeBuffer = this.renderTarget1;
		this.readBuffer = this.renderTarget2;

	},

	setSize: function ( width, height ) {

		var renderTarget = this.renderTarget1.clone();

		renderTarget.width = width;
		renderTarget.height = height;

		this.reset( renderTarget );

	}

};

/**
 * @author alteredq / http://alteredqualia.com/
 * @author davidedc / http://www.sketchpatch.net/
 *
 * NVIDIA FXAA by Timothy Lottes
 * http://timothylottes.blogspot.com/2011/06/fxaa3-source-released.html
 * - WebGL port by @supereggbert
 * http://www.glge.org/demos/fxaa/
 */

THREE.FXAAShader = {

	uniforms: {

		"tDiffuse":   { type: "t", value: null },
		"resolution": { type: "v2", value: new THREE.Vector2( 1 / 1024, 1 / 512 ) }

	},

	vertexShader: [

		"void main() {",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform vec2 resolution;",

		"#define FXAA_REDUCE_MIN   (1.0/128.0)",
		"#define FXAA_REDUCE_MUL   (1.0/8.0)",
		"#define FXAA_SPAN_MAX     8.0",

		"void main() {",

			"vec3 rgbNW = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( -1.0, -1.0 ) ) * resolution ).xyz;",
			"vec3 rgbNE = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( 1.0, -1.0 ) ) * resolution ).xyz;",
			"vec3 rgbSW = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( -1.0, 1.0 ) ) * resolution ).xyz;",
			"vec3 rgbSE = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( 1.0, 1.0 ) ) * resolution ).xyz;",
			"vec4 rgbaM  = texture2D( tDiffuse,  gl_FragCoord.xy  * resolution );",
			"vec3 rgbM  = rgbaM.xyz;",
			"vec3 luma = vec3( 0.299, 0.587, 0.114 );",

			"float lumaNW = dot( rgbNW, luma );",
			"float lumaNE = dot( rgbNE, luma );",
			"float lumaSW = dot( rgbSW, luma );",
			"float lumaSE = dot( rgbSE, luma );",
			"float lumaM  = dot( rgbM,  luma );",
			"float lumaMin = min( lumaM, min( min( lumaNW, lumaNE ), min( lumaSW, lumaSE ) ) );",
			"float lumaMax = max( lumaM, max( max( lumaNW, lumaNE) , max( lumaSW, lumaSE ) ) );",

			"vec2 dir;",
			"dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));",
			"dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));",

			"float dirReduce = max( ( lumaNW + lumaNE + lumaSW + lumaSE ) * ( 0.25 * FXAA_REDUCE_MUL ), FXAA_REDUCE_MIN );",

			"float rcpDirMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + dirReduce );",
			"dir = min( vec2( FXAA_SPAN_MAX,  FXAA_SPAN_MAX),",
				  "max( vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX),",
						"dir * rcpDirMin)) * resolution;",
			"vec4 rgbA = (1.0/2.0) * (",
        	"texture2D(tDiffuse,  gl_FragCoord.xy  * resolution + dir * (1.0/3.0 - 0.5)) +",
			"texture2D(tDiffuse,  gl_FragCoord.xy  * resolution + dir * (2.0/3.0 - 0.5)));",
    		"vec4 rgbB = rgbA * (1.0/2.0) + (1.0/4.0) * (",
			"texture2D(tDiffuse,  gl_FragCoord.xy  * resolution + dir * (0.0/3.0 - 0.5)) +",
      		"texture2D(tDiffuse,  gl_FragCoord.xy  * resolution + dir * (3.0/3.0 - 0.5)));",
    		"float lumaB = dot(rgbB, vec4(luma, 0.0));",

			"if ( ( lumaB < lumaMin ) || ( lumaB > lumaMax ) ) {",

				"gl_FragColor = rgbA;",

			"} else {",
				"gl_FragColor = rgbB;",

			"}",

		"}"

	].join("\n")

};

/**
 
 */

THREE.GlitchPass = function ( dt_size ) {

	if ( THREE.DigitalGlitch === undefined ) console.error( "THREE.GlitchPass relies on THREE.DigitalGlitch" );
	
	var shader = THREE.DigitalGlitch;
	this.uniforms = THREE.UniformsUtils.clone( shader.uniforms );

	if (dt_size == undefined) dt_size = 64;
	
	
	this.uniforms[ "tDisp"].value = this.generateHeightmap(dt_size);
	

	this.material = new THREE.ShaderMaterial({
		uniforms: this.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader
	});

	console.log(this.material);
	
	this.enabled = true;
	this.renderToScreen = false;
	this.needsSwap = true;


	this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	this.scene  = new THREE.Scene();

	this.quad = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), null );
	this.scene.add( this.quad );
	
	this.goWild = false;
	this.curF = 0;
	this.generateTrigger();
	
};

THREE.GlitchPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta ) 
	{
		this.uniforms[ "tDiffuse" ].value = readBuffer;
		this.uniforms[ 'seed' ].value = Math.random();//default seeding
		this.uniforms[ 'byp' ].value = 0;
		
		if (this.curF % this.randX == 0 || this.goWild == true)
		{
			this.uniforms[ 'amount' ].value = Math.random() / 30;
			this.uniforms[ 'angle' ].value = THREE.Math.randFloat(-Math.PI, Math.PI);
			this.uniforms[ 'seed_x' ].value = THREE.Math.randFloat(-1, 1);
			this.uniforms[ 'seed_y' ].value = THREE.Math.randFloat(-1, 1);
			this.uniforms[ 'distortion_x' ].value = THREE.Math.randFloat(0, 1);
			this.uniforms[ 'distortion_y' ].value = THREE.Math.randFloat(0, 1);
			this.curF = 0;
			this.generateTrigger();
		}
		else if (this.curF % this.randX < this.randX / 5)
		{
			this.uniforms[ 'amount' ].value = Math.random() / 90;
			this.uniforms[ 'angle' ].value = THREE.Math.randFloat(-Math.PI, Math.PI);
			this.uniforms[ 'distortion_x' ].value = THREE.Math.randFloat(0, 1);
			this.uniforms[ 'distortion_y' ].value = THREE.Math.randFloat(0, 1);
			this.uniforms[ 'seed_x' ].value = THREE.Math.randFloat(-0.3, 0.3);
			this.uniforms[ 'seed_y' ].value = THREE.Math.randFloat(-0.3, 0.3);
		}
		else if (this.goWild == false)
		{
			this.uniforms[ 'byp' ].value = 1;
		}
		this.curF ++;
		
		this.quad.material = this.material;
		if ( this.renderToScreen ) 
		{
			renderer.render( this.scene, this.camera );
		} 
		else 
		{
			renderer.render( this.scene, this.camera, writeBuffer, false );
		}
	},
	generateTrigger:function()
	{
		this.randX = THREE.Math.randInt(120, 240);
	},
	generateHeightmap:function(dt_size)
	{
		var data_arr = new Float32Array( dt_size * dt_size * 3 );
		console.log(dt_size);
		var length = dt_size * dt_size;
		
		for ( var i = 0; i < length; i ++) 
		{
			var val = THREE.Math.randFloat(0, 1);
			data_arr[ i * 3 + 0 ] = val;
			data_arr[ i * 3 + 1 ] = val;
			data_arr[ i * 3 + 2 ] = val;
		}
		
		var texture = new THREE.DataTexture( data_arr, dt_size, dt_size, THREE.RGBFormat, THREE.FloatType );
		console.log(texture);
		console.log(dt_size);
		texture.minFilter = THREE.NearestFilter;
		texture.magFilter = THREE.NearestFilter;
		texture.needsUpdate = true;
		texture.flipY = false;
		return texture;
	}
};
/**
 * @author alteredq / http://alteredqualia.com/
 */

THREE.MaskPass = function ( scene, camera ) {

	this.scene = scene;
	this.camera = camera;

	this.enabled = true;
	this.clear = true;
	this.needsSwap = false;

	this.inverse = false;

};

THREE.MaskPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta ) {

		var context = renderer.context;

		// don't update color or depth

		context.colorMask( false, false, false, false );
		context.depthMask( false );

		// set up stencil

		var writeValue, clearValue;

		if ( this.inverse ) {

			writeValue = 0;
			clearValue = 1;

		} else {

			writeValue = 1;
			clearValue = 0;

		}

		context.enable( context.STENCIL_TEST );
		context.stencilOp( context.REPLACE, context.REPLACE, context.REPLACE );
		context.stencilFunc( context.ALWAYS, writeValue, 0xffffffff );
		context.clearStencil( clearValue );

		// draw into the stencil buffer

		renderer.render( this.scene, this.camera, readBuffer, this.clear );
		renderer.render( this.scene, this.camera, writeBuffer, this.clear );

		// re-enable update of color and depth

		context.colorMask( true, true, true, true );
		context.depthMask( true );

		// only render where stencil is set to 1

		context.stencilFunc( context.EQUAL, 1, 0xffffffff );  // draw if == 1
		context.stencilOp( context.KEEP, context.KEEP, context.KEEP );

	}

};


THREE.ClearMaskPass = function () {

	this.enabled = true;

};

THREE.ClearMaskPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta ) {

		var context = renderer.context;

		context.disable( context.STENCIL_TEST );

	}

};

/**
 * @author alteredq / http://alteredqualia.com/
 */

THREE.RenderPass = function ( scene, camera, overrideMaterial, clearColor, clearAlpha ) {

	this.scene = scene;
	this.camera = camera;

	this.overrideMaterial = overrideMaterial;

	this.clearColor = clearColor;
	this.clearAlpha = ( clearAlpha !== undefined ) ? clearAlpha : 1;

	this.oldClearColor = new THREE.Color();
	this.oldClearAlpha = 1;

	this.enabled = true;
	this.clear = true;
	this.needsSwap = false;

};

THREE.RenderPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta ) {

		this.scene.overrideMaterial = this.overrideMaterial;

		if ( this.clearColor ) {

			this.oldClearColor.copy( renderer.getClearColor() );
			this.oldClearAlpha = renderer.getClearAlpha();

			renderer.setClearColor( this.clearColor, this.clearAlpha );

		}

		renderer.render( this.scene, this.camera, readBuffer, this.clear );

		if ( this.clearColor ) {

			renderer.setClearColor( this.oldClearColor, this.oldClearAlpha );

		}

		this.scene.overrideMaterial = null;

	}

};

/**
 * @author alteredq / http://alteredqualia.com/
 */

THREE.SavePass = function ( renderTarget ) {

	if ( THREE.CopyShader === undefined )
		console.error( "THREE.SavePass relies on THREE.CopyShader" );

	var shader = THREE.CopyShader;

	this.textureID = "tDiffuse";

	this.uniforms = THREE.UniformsUtils.clone( shader.uniforms );

	this.material = new THREE.ShaderMaterial( {

		uniforms: this.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader

	} );

	this.renderTarget = renderTarget;

	if ( this.renderTarget === undefined ) {

		this.renderTargetParameters = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBFormat, stencilBuffer: false };
		this.renderTarget = new THREE.WebGLRenderTarget( window.innerWidth, window.innerHeight, this.renderTargetParameters );

	}

	this.enabled = true;
	this.needsSwap = false;
	this.clear = false;


	this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	this.scene  = new THREE.Scene();

	this.quad = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), null );
	this.scene.add( this.quad );

};

THREE.SavePass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta ) {

		if ( this.uniforms[ this.textureID ] ) {

			this.uniforms[ this.textureID ].value = readBuffer;

		}

		this.quad.material = this.material;

		renderer.render( this.scene, this.camera, this.renderTarget, this.clear );

	}

};

/**
 * @author alteredq / http://alteredqualia.com/
 */

THREE.ShaderPass = function ( shader, textureID ) {

	this.textureID = ( textureID !== undefined ) ? textureID : "tDiffuse";

	this.uniforms = THREE.UniformsUtils.clone( shader.uniforms );

	this.material = new THREE.ShaderMaterial( {

		defines: shader.defines || {},
		uniforms: this.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader,
		//blending: shader.blending,
		//blendEquation: shader.blendEquation,
		//blendSrc: shader.blendSrc,
		//blendDst: shader.blendDst,
		//blendSrcAlpha: shader.blendSrcAlpha,
		//blendDstAlpha: shader.blendDstAlpha,
		//forceBlending: shader.forceBlending

	} );

	this.renderToScreen = false;

	this.enabled = true;
	this.needsSwap = true;
	this.clear = false;


	this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	this.scene  = new THREE.Scene();

	this.quad = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), null );
	this.scene.add( this.quad );

};

THREE.ShaderPass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta ) {

		if ( this.uniforms[ this.textureID ] ) {

			this.uniforms[ this.textureID ].value = readBuffer;

		}

		this.quad.material = this.material;

		if ( this.renderToScreen ) {

			renderer.render( this.scene, this.camera );

		} else {

			renderer.render( this.scene, this.camera, writeBuffer, this.clear );

		}

	}

};

/**
 * @author alteredq / http://alteredqualia.com/
 */

THREE.TexturePass = function ( texture, opacity ) {

	if ( THREE.CopyShader === undefined )
		console.error( "THREE.TexturePass relies on THREE.CopyShader" );

	var shader = THREE.CopyShader;

	this.uniforms = THREE.UniformsUtils.clone( shader.uniforms );

	this.uniforms[ "opacity" ].value = ( opacity !== undefined ) ? opacity : 1.0;
	this.uniforms[ "tDiffuse" ].value = texture;

	this.material = new THREE.ShaderMaterial( {

		uniforms: this.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader

	} );

	this.enabled = true;
	this.needsSwap = false;


	this.camera = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	this.scene  = new THREE.Scene();

	this.quad = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), null );
	this.scene.add( this.quad );

};

THREE.TexturePass.prototype = {

	render: function ( renderer, writeBuffer, readBuffer, delta ) {

		this.quad.material = this.material;

		renderer.render( this.scene, this.camera, readBuffer );

	}

};

/**
 * @author miibond
 *
 * Full-screen tone-mapping shader based on http://www.graphics.cornell.edu/~jaf/publications/sig02_paper.pdf
 */

THREE.ToneMapShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"averageLuminance":  { type: "f", value: 1.0 },
		"luminanceMap":  { type: "t", value: null },
		"maxLuminance":  { type: "f", value: 16.0 },
		"middleGrey":  { type: "f", value: 0.6 }
	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"uniform float middleGrey;",
		"uniform float maxLuminance;",
		"#ifdef ADAPTED_LUMINANCE",
			"uniform sampler2D luminanceMap;",
		"#else",
			"uniform float averageLuminance;",
		"#endif",
		
		"const vec3 LUM_CONVERT = vec3(0.299, 0.587, 0.114);",

		"vec3 ToneMap( vec3 vColor ) {",
			"#ifdef ADAPTED_LUMINANCE",
				// Get the calculated average luminance 
				"float fLumAvg = texture2D(luminanceMap, vec2(0.5, 0.5)).r;",
			"#else",
				"float fLumAvg = averageLuminance;",
			"#endif",
			
			// Calculate the luminance of the current pixel
			"float fLumPixel = dot(vColor, LUM_CONVERT);",

			// Apply the modified operator (Eq. 4)
			"float fLumScaled = (fLumPixel * middleGrey) / fLumAvg;",

			"float fLumCompressed = (fLumScaled * (1.0 + (fLumScaled / (maxLuminance * maxLuminance)))) / (1.0 + fLumScaled);",
			"return fLumCompressed * vColor;",
		"}",

		"void main() {",

			"vec4 texel = texture2D( tDiffuse, vUv );",
			
			"gl_FragColor = vec4( ToneMap( texel.xyz ), texel.w );",
			//Gamma 2.0
			"gl_FragColor.xyz = sqrt( gl_FragColor.xyz );",

		"}"

	].join("\n")

};

/**
 * @author mrdoob / http://www.mrdoob.com
 *
 * Simple test shader
 */

THREE.BasicShader = {

	uniforms: {},

	vertexShader: [

		"void main() {",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"void main() {",

			"gl_FragColor = vec4( 1.0, 0.0, 0.0, 0.5 );",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Bleach bypass shader [http://en.wikipedia.org/wiki/Bleach_bypass]
 * - based on Nvidia example
 * http://developer.download.nvidia.com/shaderlibrary/webpages/shader_library.html#post_bleach_bypass
 */

THREE.BleachBypassShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"opacity":  { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float opacity;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 base = texture2D( tDiffuse, vUv );",

			"vec3 lumCoeff = vec3( 0.25, 0.65, 0.1 );",
			"float lum = dot( lumCoeff, base.rgb );",
			"vec3 blend = vec3( lum );",

			"float L = min( 1.0, max( 0.0, 10.0 * ( lum - 0.45 ) ) );",

			"vec3 result1 = 2.0 * base.rgb * blend;",
			"vec3 result2 = 1.0 - 2.0 * ( 1.0 - blend ) * ( 1.0 - base.rgb );",

			"vec3 newColor = mix( result1, result2, L );",

			"float A2 = opacity * base.a;",
			"vec3 mixRGB = A2 * newColor.rgb;",
			"mixRGB += ( ( 1.0 - A2 ) * base.rgb );",

			"gl_FragColor = vec4( mixRGB, base.a );",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Blend two textures
 */

THREE.BlendShader = {

	uniforms: {

		"tDiffuse1": { type: "t", value: null },
		"tDiffuse2": { type: "t", value: null },
		"mixRatio":  { type: "f", value: 0.5 },
		"opacity":   { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float opacity;",
		"uniform float mixRatio;",

		"uniform sampler2D tDiffuse1;",
		"uniform sampler2D tDiffuse2;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 texel1 = texture2D( tDiffuse1, vUv );",
			"vec4 texel2 = texture2D( tDiffuse2, vUv );",
			"gl_FragColor = opacity * mix( texel1, texel2, mixRatio );",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Depth-of-field shader with bokeh
 * ported from GLSL shader by Martins Upitis
 * http://artmartinsh.blogspot.com/2010/02/glsl-lens-blur-filter-with-bokeh.html
 */

THREE.BokehShader = {

	uniforms: {

		"tColor":   { type: "t", value: null },
		"tDepth":   { type: "t", value: null },
		"focus":    { type: "f", value: 1.0 },
		"aspect":   { type: "f", value: 1.0 },
		"aperture": { type: "f", value: 0.025 },
		"maxblur":  { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"varying vec2 vUv;",

		"uniform sampler2D tColor;",
		"uniform sampler2D tDepth;",

		"uniform float maxblur;",  // max blur amount
		"uniform float aperture;", // aperture - bigger values for shallower depth of field

		"uniform float focus;",
		"uniform float aspect;",

		"void main() {",

			"vec2 aspectcorrect = vec2( 1.0, aspect );",

			"vec4 depth1 = texture2D( tDepth, vUv );",

			"float factor = depth1.x - focus;",

			"vec2 dofblur = vec2 ( clamp( factor * aperture, -maxblur, maxblur ) );",

			"vec2 dofblur9 = dofblur * 0.9;",
			"vec2 dofblur7 = dofblur * 0.7;",
			"vec2 dofblur4 = dofblur * 0.4;",

			"vec4 col = vec4( 0.0 );",

			"col += texture2D( tColor, vUv.xy );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.0,   0.4  ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.15,  0.37 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.29,  0.29 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.37,  0.15 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.40,  0.0  ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.37, -0.15 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.29, -0.29 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.15, -0.37 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.0,  -0.4  ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.15,  0.37 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.29,  0.29 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.37,  0.15 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.4,   0.0  ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.37, -0.15 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.29, -0.29 ) * aspectcorrect ) * dofblur );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.15, -0.37 ) * aspectcorrect ) * dofblur );",

			"col += texture2D( tColor, vUv.xy + ( vec2(  0.15,  0.37 ) * aspectcorrect ) * dofblur9 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.37,  0.15 ) * aspectcorrect ) * dofblur9 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.37, -0.15 ) * aspectcorrect ) * dofblur9 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.15, -0.37 ) * aspectcorrect ) * dofblur9 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.15,  0.37 ) * aspectcorrect ) * dofblur9 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.37,  0.15 ) * aspectcorrect ) * dofblur9 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.37, -0.15 ) * aspectcorrect ) * dofblur9 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.15, -0.37 ) * aspectcorrect ) * dofblur9 );",

			"col += texture2D( tColor, vUv.xy + ( vec2(  0.29,  0.29 ) * aspectcorrect ) * dofblur7 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.40,  0.0  ) * aspectcorrect ) * dofblur7 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.29, -0.29 ) * aspectcorrect ) * dofblur7 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.0,  -0.4  ) * aspectcorrect ) * dofblur7 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.29,  0.29 ) * aspectcorrect ) * dofblur7 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.4,   0.0  ) * aspectcorrect ) * dofblur7 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.29, -0.29 ) * aspectcorrect ) * dofblur7 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.0,   0.4  ) * aspectcorrect ) * dofblur7 );",

			"col += texture2D( tColor, vUv.xy + ( vec2(  0.29,  0.29 ) * aspectcorrect ) * dofblur4 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.4,   0.0  ) * aspectcorrect ) * dofblur4 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.29, -0.29 ) * aspectcorrect ) * dofblur4 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.0,  -0.4  ) * aspectcorrect ) * dofblur4 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.29,  0.29 ) * aspectcorrect ) * dofblur4 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.4,   0.0  ) * aspectcorrect ) * dofblur4 );",
			"col += texture2D( tColor, vUv.xy + ( vec2( -0.29, -0.29 ) * aspectcorrect ) * dofblur4 );",
			"col += texture2D( tColor, vUv.xy + ( vec2(  0.0,   0.4  ) * aspectcorrect ) * dofblur4 );",

			"gl_FragColor = col / 41.0;",
			"gl_FragColor.a = 1.0;",

		"}"

	].join("\n")

};

/**
 * @author zz85 / https://github.com/zz85 | twitter.com/blurspline
 *
 * Depth-of-field shader with bokeh
 * ported from GLSL shader by Martins Upitis
 * http://blenderartists.org/forum/showthread.php?237488-GLSL-depth-of-field-with-bokeh-v2-4-(update)
 *
 * Requires #define RINGS and SAMPLES integers
 */



THREE.BokehShader2 = {

	uniforms: {

		"textureWidth":  { type: "f", value: 1.0 },
		"textureHeight":  { type: "f", value: 1.0 },

		"focalDepth":   { type: "f", value: 1.0 },
		"focalLength":   { type: "f", value: 24.0 },
		"fstop": { type: "f", value: 0.9 },

		"tColor":   { type: "t", value: null },
		"tDepth":   { type: "t", value: null },

		"maxblur":  { type: "f", value: 1.0 },

		"showFocus":   { type: "i", value: 0 },
		"manualdof":   { type: "i", value: 0 },
		"vignetting":   { type: "i", value: 0 },
		"depthblur":   { type: "i", value: 0 },

		"threshold":  { type: "f", value: 0.5 },
		"gain":  { type: "f", value: 2.0 },
		"bias":  { type: "f", value: 0.5 },
		"fringe":  { type: "f", value: 0.7 },

		"znear":  { type: "f", value: 0.1 },
		"zfar":  { type: "f", value: 100 },

		"noise":  { type: "i", value: 1 },
		"dithering":  { type: "f", value: 0.0001 },
		"pentagon": { type: "i", value: 0 },

		"shaderFocus":  { type: "i", value: 1 },
		"focusCoords":  { type: "v2", value: new THREE.Vector2() },


	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"varying vec2 vUv;",

		"uniform sampler2D tColor;",
		"uniform sampler2D tDepth;",
		"uniform float textureWidth;",
		"uniform float textureHeight;",

		"const float PI = 3.14159265;",

		"float width = textureWidth; //texture width",
		"float height = textureHeight; //texture height",

		"vec2 texel = vec2(1.0/width,1.0/height);",

		"uniform float focalDepth;  //focal distance value in meters, but you may use autofocus option below",
		"uniform float focalLength; //focal length in mm",
		"uniform float fstop; //f-stop value",
		"uniform bool showFocus; //show debug focus point and focal range (red = focal point, green = focal range)",

		"/*",
		"make sure that these two values are the same for your camera, otherwise distances will be wrong.",
		"*/",

		"uniform float znear; // camera clipping start",
		"uniform float zfar; // camera clipping end",

		"//------------------------------------------",
		"//user variables",

		"const int samples = SAMPLES; //samples on the first ring",
		"const int rings = RINGS; //ring count",

		"const int maxringsamples = rings * samples;",

		"uniform bool manualdof; // manual dof calculation",
		"float ndofstart = 1.0; // near dof blur start",
		"float ndofdist = 2.0; // near dof blur falloff distance",
		"float fdofstart = 1.0; // far dof blur start",
		"float fdofdist = 3.0; // far dof blur falloff distance",

		"float CoC = 0.03; //circle of confusion size in mm (35mm film = 0.03mm)",

		"uniform bool vignetting; // use optical lens vignetting",

		"float vignout = 1.3; // vignetting outer border",
		"float vignin = 0.0; // vignetting inner border",
		"float vignfade = 22.0; // f-stops till vignete fades",

		"uniform bool shaderFocus;",

		"bool autofocus = shaderFocus;",
		"//use autofocus in shader - use with focusCoords",
		"// disable if you use external focalDepth value",

		"uniform vec2 focusCoords;",
		"// autofocus point on screen (0.0,0.0 - left lower corner, 1.0,1.0 - upper right)",
		"// if center of screen use vec2(0.5, 0.5);",

		"uniform float maxblur;",
		"//clamp value of max blur (0.0 = no blur, 1.0 default)",

		"uniform float threshold; // highlight threshold;",
		"uniform float gain; // highlight gain;",

		"uniform float bias; // bokeh edge bias",
		"uniform float fringe; // bokeh chromatic aberration / fringing",

		"uniform bool noise; //use noise instead of pattern for sample dithering",

		"uniform float dithering;",
		"float namount = dithering; //dither amount",

		"uniform bool depthblur; // blur the depth buffer",
		"float dbsize = 1.25; // depth blur size",

		"/*",
		"next part is experimental",
		"not looking good with small sample and ring count",
		"looks okay starting from samples = 4, rings = 4",
		"*/",

		"uniform bool pentagon; //use pentagon as bokeh shape?",
		"float feather = 0.4; //pentagon shape feather",

		"//------------------------------------------",

		"float penta(vec2 coords) {",
			"//pentagonal shape",
			"float scale = float(rings) - 1.3;",
			"vec4  HS0 = vec4( 1.0,         0.0,         0.0,  1.0);",
			"vec4  HS1 = vec4( 0.309016994, 0.951056516, 0.0,  1.0);",
			"vec4  HS2 = vec4(-0.809016994, 0.587785252, 0.0,  1.0);",
			"vec4  HS3 = vec4(-0.809016994,-0.587785252, 0.0,  1.0);",
			"vec4  HS4 = vec4( 0.309016994,-0.951056516, 0.0,  1.0);",
			"vec4  HS5 = vec4( 0.0        ,0.0         , 1.0,  1.0);",

			"vec4  one = vec4( 1.0 );",

			"vec4 P = vec4((coords),vec2(scale, scale));",

			"vec4 dist = vec4(0.0);",
			"float inorout = -4.0;",

			"dist.x = dot( P, HS0 );",
			"dist.y = dot( P, HS1 );",
			"dist.z = dot( P, HS2 );",
			"dist.w = dot( P, HS3 );",

			"dist = smoothstep( -feather, feather, dist );",

			"inorout += dot( dist, one );",

			"dist.x = dot( P, HS4 );",
			"dist.y = HS5.w - abs( P.z );",

			"dist = smoothstep( -feather, feather, dist );",
			"inorout += dist.x;",

			"return clamp( inorout, 0.0, 1.0 );",
		"}",

		"float bdepth(vec2 coords) {",
			"// Depth buffer blur",
			"float d = 0.0;",
			"float kernel[9];",
			"vec2 offset[9];",

			"vec2 wh = vec2(texel.x, texel.y) * dbsize;",

			"offset[0] = vec2(-wh.x,-wh.y);",
			"offset[1] = vec2( 0.0, -wh.y);",
			"offset[2] = vec2( wh.x -wh.y);",

			"offset[3] = vec2(-wh.x,  0.0);",
			"offset[4] = vec2( 0.0,   0.0);",
			"offset[5] = vec2( wh.x,  0.0);",

			"offset[6] = vec2(-wh.x, wh.y);",
			"offset[7] = vec2( 0.0,  wh.y);",
			"offset[8] = vec2( wh.x, wh.y);",

			"kernel[0] = 1.0/16.0;   kernel[1] = 2.0/16.0;   kernel[2] = 1.0/16.0;",
			"kernel[3] = 2.0/16.0;   kernel[4] = 4.0/16.0;   kernel[5] = 2.0/16.0;",
			"kernel[6] = 1.0/16.0;   kernel[7] = 2.0/16.0;   kernel[8] = 1.0/16.0;",


			"for( int i=0; i<9; i++ ) {",
				"float tmp = texture2D(tDepth, coords + offset[i]).r;",
				"d += tmp * kernel[i];",
			"}",

			"return d;",
		"}",


		"vec3 color(vec2 coords,float blur) {",
			"//processing the sample",

			"vec3 col = vec3(0.0);",

			"col.r = texture2D(tColor,coords + vec2(0.0,1.0)*texel*fringe*blur).r;",
			"col.g = texture2D(tColor,coords + vec2(-0.866,-0.5)*texel*fringe*blur).g;",
			"col.b = texture2D(tColor,coords + vec2(0.866,-0.5)*texel*fringe*blur).b;",

			"vec3 lumcoeff = vec3(0.299,0.587,0.114);",
			"float lum = dot(col.rgb, lumcoeff);",
			"float thresh = max((lum-threshold)*gain, 0.0);",
			"return col+mix(vec3(0.0),col,thresh*blur);",
		"}",

		"vec2 rand(vec2 coord) {",
			"// generating noise / pattern texture for dithering",

			"float noiseX = ((fract(1.0-coord.s*(width/2.0))*0.25)+(fract(coord.t*(height/2.0))*0.75))*2.0-1.0;",
			"float noiseY = ((fract(1.0-coord.s*(width/2.0))*0.75)+(fract(coord.t*(height/2.0))*0.25))*2.0-1.0;",

			"if (noise) {",
				"noiseX = clamp(fract(sin(dot(coord ,vec2(12.9898,78.233))) * 43758.5453),0.0,1.0)*2.0-1.0;",
				"noiseY = clamp(fract(sin(dot(coord ,vec2(12.9898,78.233)*2.0)) * 43758.5453),0.0,1.0)*2.0-1.0;",
			"}",

			"return vec2(noiseX,noiseY);",
		"}",

		"vec3 debugFocus(vec3 col, float blur, float depth) {",
			"float edge = 0.002*depth; //distance based edge smoothing",
			"float m = clamp(smoothstep(0.0,edge,blur),0.0,1.0);",
			"float e = clamp(smoothstep(1.0-edge,1.0,blur),0.0,1.0);",

			"col = mix(col,vec3(1.0,0.5,0.0),(1.0-m)*0.6);",
			"col = mix(col,vec3(0.0,0.5,1.0),((1.0-e)-(1.0-m))*0.2);",

			"return col;",
		"}",

		"float linearize(float depth) {",
			"return -zfar * znear / (depth * (zfar - znear) - zfar);",
		"}",


		"float vignette() {",
			"float dist = distance(vUv.xy, vec2(0.5,0.5));",
			"dist = smoothstep(vignout+(fstop/vignfade), vignin+(fstop/vignfade), dist);",
			"return clamp(dist,0.0,1.0);",
		"}",

		"float gather(float i, float j, int ringsamples, inout vec3 col, float w, float h, float blur) {",
			"float rings2 = float(rings);",
			"float step = PI*2.0 / float(ringsamples);",
			"float pw = cos(j*step)*i;",
			"float ph = sin(j*step)*i;",
			"float p = 1.0;",
			"if (pentagon) {",
				"p = penta(vec2(pw,ph));",
			"}",
			"col += color(vUv.xy + vec2(pw*w,ph*h), blur) * mix(1.0, i/rings2, bias) * p;",
			"return 1.0 * mix(1.0, i /rings2, bias) * p;",
		"}",

		"void main() {",
			"//scene depth calculation",

			"float depth = linearize(texture2D(tDepth,vUv.xy).x);",

			"// Blur depth?",
			"if (depthblur) {",
				"depth = linearize(bdepth(vUv.xy));",
			"}",

			"//focal plane calculation",

			"float fDepth = focalDepth;",

			"if (autofocus) {",

				"fDepth = linearize(texture2D(tDepth,focusCoords).x);",

			"}",

			"// dof blur factor calculation",

			"float blur = 0.0;",

			"if (manualdof) {",
				"float a = depth-fDepth; // Focal plane",
				"float b = (a-fdofstart)/fdofdist; // Far DoF",
				"float c = (-a-ndofstart)/ndofdist; // Near Dof",
				"blur = (a>0.0) ? b : c;",
			"} else {",
				"float f = focalLength; // focal length in mm",
				"float d = fDepth*1000.0; // focal plane in mm",
				"float o = depth*1000.0; // depth in mm",

				"float a = (o*f)/(o-f);",
				"float b = (d*f)/(d-f);",
				"float c = (d-f)/(d*fstop*CoC);",

				"blur = abs(a-b)*c;",
			"}",

			"blur = clamp(blur,0.0,1.0);",

			"// calculation of pattern for dithering",

			"vec2 noise = rand(vUv.xy)*namount*blur;",

			"// getting blur x and y step factor",

			"float w = (1.0/width)*blur*maxblur+noise.x;",
			"float h = (1.0/height)*blur*maxblur+noise.y;",

			"// calculation of final color",

			"vec3 col = vec3(0.0);",

			"if(blur < 0.05) {",
				"//some optimization thingy",
				"col = texture2D(tColor, vUv.xy).rgb;",
			"} else {",
				"col = texture2D(tColor, vUv.xy).rgb;",
				"float s = 1.0;",
				"int ringsamples;",

				"for (int i = 1; i <= rings; i++) {",
					"/*unboxstart*/",
					"ringsamples = i * samples;",

					"for (int j = 0 ; j < maxringsamples ; j++) {",
						"if (j >= ringsamples) break;",
						"s += gather(float(i), float(j), ringsamples, col, w, h, blur);",
					"}",
					"/*unboxend*/",
				"}",

				"col /= s; //divide by sample count",
			"}",

			"if (showFocus) {",
				"col = debugFocus(col, blur, depth);",
			"}",

			"if (vignetting) {",
				"col *= vignette();",
			"}",

			"gl_FragColor.rgb = col;",
			"gl_FragColor.a = 1.0;",
		"} "

	].join("\n")

};

/**
 * @author tapio / http://tapio.github.com/
 *
 * Brightness and contrast adjustment
 * https://github.com/evanw/glfx.js
 * brightness: -1 to 1 (-1 is solid black, 0 is no change, and 1 is solid white)
 * contrast: -1 to 1 (-1 is solid gray, 0 is no change, and 1 is maximum contrast)
 */

THREE.BrightnessContrastShader = {

	uniforms: {

		"tDiffuse":   { type: "t", value: null },
		"brightness": { type: "f", value: 0 },
		"contrast":   { type: "f", value: 0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float brightness;",
		"uniform float contrast;",

		"varying vec2 vUv;",

		"void main() {",

			"gl_FragColor = texture2D( tDiffuse, vUv );",

			"gl_FragColor.rgb += brightness;",

			"if (contrast > 0.0) {",
				"gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) / (1.0 - contrast) + 0.5;",
			"} else {",
				"gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) * (1.0 + contrast) + 0.5;",
			"}",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Color correction
 */

THREE.ColorCorrectionShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"powRGB":   { type: "v3", value: new THREE.Vector3( 2, 2, 2 ) },
		"mulRGB":   { type: "v3", value: new THREE.Vector3( 1, 1, 1 ) },
		"addRGB":   { type: "v3", value: new THREE.Vector3( 0, 0, 0 ) }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform vec3 powRGB;",
		"uniform vec3 mulRGB;",
		"uniform vec3 addRGB;",

		"varying vec2 vUv;",

		"void main() {",

			"gl_FragColor = texture2D( tDiffuse, vUv );",
			"gl_FragColor.rgb = mulRGB * pow( ( gl_FragColor.rgb + addRGB ), powRGB );",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Colorify shader
 */

THREE.ColorifyShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"color":    { type: "c", value: new THREE.Color( 0xffffff ) }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform vec3 color;",
		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 texel = texture2D( tDiffuse, vUv );",

			"vec3 luma = vec3( 0.299, 0.587, 0.114 );",
			"float v = dot( texel.xyz, luma );",

			"gl_FragColor = vec4( v * color, texel.w );",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Convolution shader
 * ported from o3d sample to WebGL / GLSL
 * http://o3d.googlecode.com/svn/trunk/samples/convolution.html
 */

THREE.ConvolutionShader = {

	defines: {

		"KERNEL_SIZE_FLOAT": "25.0",
		"KERNEL_SIZE_INT": "25",

	},

	uniforms: {

		"tDiffuse":        { type: "t", value: null },
		"uImageIncrement": { type: "v2", value: new THREE.Vector2( 0.001953125, 0.0 ) },
		"cKernel":         { type: "fv1", value: [] }

	},

	vertexShader: [

		"uniform vec2 uImageIncrement;",

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv - ( ( KERNEL_SIZE_FLOAT - 1.0 ) / 2.0 ) * uImageIncrement;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float cKernel[ KERNEL_SIZE_INT ];",

		"uniform sampler2D tDiffuse;",
		"uniform vec2 uImageIncrement;",

		"varying vec2 vUv;",

		"void main() {",

			"vec2 imageCoord = vUv;",
			"vec4 sum = vec4( 0.0, 0.0, 0.0, 0.0 );",

			"for( int i = 0; i < KERNEL_SIZE_INT; i ++ ) {",

				"sum += texture2D( tDiffuse, imageCoord ) * cKernel[ i ];",
				"imageCoord += uImageIncrement;",

			"}",

			"gl_FragColor = sum;",

		"}"


	].join("\n"),

	buildKernel: function ( sigma ) {

		// We lop off the sqrt(2 * pi) * sigma term, since we're going to normalize anyway.

		function gauss( x, sigma ) {

			return Math.exp( - ( x * x ) / ( 2.0 * sigma * sigma ) );

		}

		var i, values, sum, halfWidth, kMaxKernelSize = 25, kernelSize = 2 * Math.ceil( sigma * 3.0 ) + 1;

		if ( kernelSize > kMaxKernelSize ) kernelSize = kMaxKernelSize;
		halfWidth = ( kernelSize - 1 ) * 0.5;

		values = new Array( kernelSize );
		sum = 0.0;
		for ( i = 0; i < kernelSize; ++ i ) {

			values[ i ] = gauss( i - halfWidth, sigma );
			sum += values[ i ];

		}

		// normalize the kernel

		for ( i = 0; i < kernelSize; ++ i ) values[ i ] /= sum;

		return values;

	}

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Full-screen textured quad shader
 */

THREE.CopyShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"opacity":  { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float opacity;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 texel = texture2D( tDiffuse, vUv );",
			"gl_FragColor = opacity * texel;",

		"}"

	].join("\n")

};

/**
 * @author felixturner / http://airtight.cc/
 *
 * RGB Shift Shader
 * Shifts red and blue channels from center in opposite directions
 * Ported from http://kriss.cx/tom/2009/05/rgb-shift/
 * by Tom Butterworth / http://kriss.cx/tom/
 *
 * amount: shift distance (1 is width of input)
 * angle: shift angle in radians
 */

THREE.DigitalGlitch = {

	uniforms: {

		"tDiffuse":		{ type: "t", value: null },//diffuse texture
		"tDisp":		{ type: "t", value: null },//displacement texture for digital glitch squares
		"byp":			{ type: "i", value: 0 },//apply the glitch ?
		"amount":		{ type: "f", value: 0.08 },
		"angle":		{ type: "f", value: 0.02 },
		"seed":			{ type: "f", value: 0.02 },
		"seed_x":		{ type: "f", value: 0.02 },//-1,1
		"seed_y":		{ type: "f", value: 0.02 },//-1,1
		"distortion_x":	{ type: "f", value: 0.5 },
		"distortion_y":	{ type: "f", value: 0.6 },
		"col_s":		{ type: "f", value: 0.05 }
	},

	vertexShader: [

		"varying vec2 vUv;",
		"void main() {",
			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
		"}"
	].join("\n"),

	fragmentShader: [
		"uniform int byp;",//should we apply the glitch ?
		
		"uniform sampler2D tDiffuse;",
		"uniform sampler2D tDisp;",
		
		"uniform float amount;",
		"uniform float angle;",
		"uniform float seed;",
		"uniform float seed_x;",
		"uniform float seed_y;",
		"uniform float distortion_x;",
		"uniform float distortion_y;",
		"uniform float col_s;",
			
		"varying vec2 vUv;",
		
		
		"float rand(vec2 co){",
			"return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);",
		"}",
				
		"void main() {",
			"if(byp<1) {",
				"vec2 p = vUv;",
				"float xs = floor(gl_FragCoord.x / 0.5);",
				"float ys = floor(gl_FragCoord.y / 0.5);",
				//based on staffantans glitch shader for unity https://github.com/staffantan/unityglitch
				"vec4 normal = texture2D (tDisp, p*seed*seed);",
				"if(p.y<distortion_x+col_s && p.y>distortion_x-col_s*seed) {",
					"if(seed_x>0.){",
						"p.y = 1. - (p.y + distortion_y);",
					"}",
					"else {",
						"p.y = distortion_y;",
					"}",
				"}",
				"if(p.x<distortion_y+col_s && p.x>distortion_y-col_s*seed) {",
					"if(seed_y>0.){",
						"p.x=distortion_x;",
					"}",
					"else {",
						"p.x = 1. - (p.x + distortion_x);",
					"}",
				"}",
				"p.x+=normal.x*seed_x*(seed/5.);",
				"p.y+=normal.y*seed_y*(seed/5.);",
				//base from RGB shift shader
				"vec2 offset = amount * vec2( cos(angle), sin(angle));",
				"vec4 cr = texture2D(tDiffuse, p + offset);",
				"vec4 cga = texture2D(tDiffuse, p);",
				"vec4 cb = texture2D(tDiffuse, p - offset);",
				"gl_FragColor = vec4(cr.r, cga.g, cb.b, cga.a);",
				//add noise
				"vec4 snow = 200.*amount*vec4(rand(vec2(xs * seed,ys * seed*50.))*0.2);",
				"gl_FragColor = gl_FragColor+ snow;",
			"}",
			"else {",
				"gl_FragColor=texture2D (tDiffuse, vUv);",
			"}",
		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Depth-of-field shader using mipmaps
 * - from Matt Handley @applmak
 * - requires power-of-2 sized render target with enabled mipmaps
 */

THREE.DOFMipMapShader = {

	uniforms: {

		"tColor":   { type: "t", value: null },
		"tDepth":   { type: "t", value: null },
		"focus":    { type: "f", value: 1.0 },
		"maxblur":  { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float focus;",
		"uniform float maxblur;",

		"uniform sampler2D tColor;",
		"uniform sampler2D tDepth;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 depth = texture2D( tDepth, vUv );",

			"float factor = depth.x - focus;",

			"vec4 col = texture2D( tColor, vUv, 2.0 * maxblur * abs( focus - depth.x ) );",

			"gl_FragColor = col;",
			"gl_FragColor.a = 1.0;",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Dot screen shader
 * based on glfx.js sepia shader
 * https://github.com/evanw/glfx.js
 */

THREE.DotScreenShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"tSize":    { type: "v2", value: new THREE.Vector2( 256, 256 ) },
		"center":   { type: "v2", value: new THREE.Vector2( 0.5, 0.5 ) },
		"angle":    { type: "f", value: 1.57 },
		"scale":    { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform vec2 center;",
		"uniform float angle;",
		"uniform float scale;",
		"uniform vec2 tSize;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"float pattern() {",

			"float s = sin( angle ), c = cos( angle );",

			"vec2 tex = vUv * tSize - center;",
			"vec2 point = vec2( c * tex.x - s * tex.y, s * tex.x + c * tex.y ) * scale;",

			"return ( sin( point.x ) * sin( point.y ) ) * 4.0;",

		"}",

		"void main() {",

			"vec4 color = texture2D( tDiffuse, vUv );",

			"float average = ( color.r + color.g + color.b ) / 3.0;",

			"gl_FragColor = vec4( vec3( average * 10.0 - 5.0 + pattern() ), color.a );",

		"}"

	].join("\n")

};

/**
 * @author zz85 / https://github.com/zz85 | https://www.lab4games.net/zz85/blog
 *
 * Edge Detection Shader using Frei-Chen filter
 * Based on http://rastergrid.com/blog/2011/01/frei-chen-edge-detector
 *
 * aspect: vec2 of (1/width, 1/height)
 */

THREE.EdgeShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"aspect":    { type: "v2", value: new THREE.Vector2( 512, 512 ) },
	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"varying vec2 vUv;",

		"uniform vec2 aspect;",

		"vec2 texel = vec2(1.0 / aspect.x, 1.0 / aspect.y);",


		"mat3 G[9];",

		// hard coded matrix values!!!! as suggested in https://github.com/neilmendoza/ofxPostProcessing/blob/master/src/EdgePass.cpp#L45

		"const mat3 g0 = mat3( 0.3535533845424652, 0, -0.3535533845424652, 0.5, 0, -0.5, 0.3535533845424652, 0, -0.3535533845424652 );",
		"const mat3 g1 = mat3( 0.3535533845424652, 0.5, 0.3535533845424652, 0, 0, 0, -0.3535533845424652, -0.5, -0.3535533845424652 );",
		"const mat3 g2 = mat3( 0, 0.3535533845424652, -0.5, -0.3535533845424652, 0, 0.3535533845424652, 0.5, -0.3535533845424652, 0 );",
		"const mat3 g3 = mat3( 0.5, -0.3535533845424652, 0, -0.3535533845424652, 0, 0.3535533845424652, 0, 0.3535533845424652, -0.5 );",
		"const mat3 g4 = mat3( 0, -0.5, 0, 0.5, 0, 0.5, 0, -0.5, 0 );",
		"const mat3 g5 = mat3( -0.5, 0, 0.5, 0, 0, 0, 0.5, 0, -0.5 );",
		"const mat3 g6 = mat3( 0.1666666716337204, -0.3333333432674408, 0.1666666716337204, -0.3333333432674408, 0.6666666865348816, -0.3333333432674408, 0.1666666716337204, -0.3333333432674408, 0.1666666716337204 );",
		"const mat3 g7 = mat3( -0.3333333432674408, 0.1666666716337204, -0.3333333432674408, 0.1666666716337204, 0.6666666865348816, 0.1666666716337204, -0.3333333432674408, 0.1666666716337204, -0.3333333432674408 );",
		"const mat3 g8 = mat3( 0.3333333432674408, 0.3333333432674408, 0.3333333432674408, 0.3333333432674408, 0.3333333432674408, 0.3333333432674408, 0.3333333432674408, 0.3333333432674408, 0.3333333432674408 );",

		"void main(void)",
		"{",

			"G[0] = g0,",
			"G[1] = g1,",
			"G[2] = g2,",
			"G[3] = g3,",
			"G[4] = g4,",
			"G[5] = g5,",
			"G[6] = g6,",
			"G[7] = g7,",
			"G[8] = g8;",

			"mat3 I;",
			"float cnv[9];",
			"vec3 sample;",

			/* fetch the 3x3 neighbourhood and use the RGB vector's length as intensity value */
			"for (float i=0.0; i<3.0; i++) {",
				"for (float j=0.0; j<3.0; j++) {",
					"sample = texture2D(tDiffuse, vUv + texel * vec2(i-1.0,j-1.0) ).rgb;",
					"I[int(i)][int(j)] = length(sample);",
				"}",
			"}",

			/* calculate the convolution values for all the masks */
			"for (int i=0; i<9; i++) {",
				"float dp3 = dot(G[i][0], I[0]) + dot(G[i][1], I[1]) + dot(G[i][2], I[2]);",
				"cnv[i] = dp3 * dp3;",
			"}",

			"float M = (cnv[0] + cnv[1]) + (cnv[2] + cnv[3]);",
			"float S = (cnv[4] + cnv[5]) + (cnv[6] + cnv[7]) + (cnv[8] + M);",

			"gl_FragColor = vec4(vec3(sqrt(M/S)), 1.0);",
		"}",

	].join("\n")
};

/**
 * @author zz85 / https://github.com/zz85 | https://www.lab4games.net/zz85/blog
 *
 * Edge Detection Shader using Sobel filter
 * Based on http://rastergrid.com/blog/2011/01/frei-chen-edge-detector
 *
 * aspect: vec2 of (1/width, 1/height)
 */

THREE.EdgeShader2 = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"aspect":    { type: "v2", value: new THREE.Vector2( 512, 512 ) },
	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"varying vec2 vUv;",
		"uniform vec2 aspect;",


		"vec2 texel = vec2(1.0 / aspect.x, 1.0 / aspect.y);",

		"mat3 G[2];",

		"const mat3 g0 = mat3( 1.0, 2.0, 1.0, 0.0, 0.0, 0.0, -1.0, -2.0, -1.0 );",
		"const mat3 g1 = mat3( 1.0, 0.0, -1.0, 2.0, 0.0, -2.0, 1.0, 0.0, -1.0 );",


		"void main(void)",
		"{",
			"mat3 I;",
			"float cnv[2];",
			"vec3 sample;",

			"G[0] = g0;",
			"G[1] = g1;",

			/* fetch the 3x3 neighbourhood and use the RGB vector's length as intensity value */
			"for (float i=0.0; i<3.0; i++)",
			"for (float j=0.0; j<3.0; j++) {",
				"sample = texture2D( tDiffuse, vUv + texel * vec2(i-1.0,j-1.0) ).rgb;",
				"I[int(i)][int(j)] = length(sample);",
			"}",

			/* calculate the convolution values for all the masks */
			"for (int i=0; i<2; i++) {",
				"float dp3 = dot(G[i][0], I[0]) + dot(G[i][1], I[1]) + dot(G[i][2], I[2]);",
				"cnv[i] = dp3 * dp3; ",
			"}",

			"gl_FragColor = vec4(0.5 * sqrt(cnv[0]*cnv[0]+cnv[1]*cnv[1]));",
		"} ",

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Film grain & scanlines shader
 *
 * - ported from HLSL to WebGL / GLSL
 * http://www.truevision3d.com/forums/showcase/staticnoise_colorblackwhite_scanline_shaders-t18698.0.html
 *
 * Screen Space Static Postprocessor
 *
 * Produces an analogue noise overlay similar to a film grain / TV static
 *
 * Original implementation and noise algorithm
 * Pat 'Hawthorne' Shearon
 *
 * Optimized scanlines + noise version with intensity scaling
 * Georg 'Leviathan' Steinrohder
 *
 * This version is provided under a Creative Commons Attribution 3.0 License
 * http://creativecommons.org/licenses/by/3.0/
 */

THREE.FilmShader = {

	uniforms: {

		"tDiffuse":   { type: "t", value: null },
		"time":       { type: "f", value: 0.0 },
		"nIntensity": { type: "f", value: 0.5 },
		"sIntensity": { type: "f", value: 0.05 },
		"sCount":     { type: "f", value: 4096 },
		"grayscale":  { type: "i", value: 1 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		// control parameter
		"uniform float time;",

		"uniform bool grayscale;",

		// noise effect intensity value (0 = no effect, 1 = full effect)
		"uniform float nIntensity;",

		// scanlines effect intensity value (0 = no effect, 1 = full effect)
		"uniform float sIntensity;",

		// scanlines effect count value (0 = no effect, 4096 = full effect)
		"uniform float sCount;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			// sample the source
			"vec4 cTextureScreen = texture2D( tDiffuse, vUv );",

			// make some noise
			"float x = vUv.x * vUv.y * time *  1000.0;",
			"x = mod( x, 13.0 ) * mod( x, 123.0 );",
			"float dx = mod( x, 0.01 );",

			// add noise
			"vec3 cResult = cTextureScreen.rgb + cTextureScreen.rgb * clamp( 0.1 + dx * 100.0, 0.0, 1.0 );",

			// get us a sine and cosine
			"vec2 sc = vec2( sin( vUv.y * sCount ), cos( vUv.y * sCount ) );",

			// add scanlines
			"cResult += cTextureScreen.rgb * vec3( sc.x, sc.y, sc.x ) * sIntensity;",

			// interpolate between source and result by intensity
			"cResult = cTextureScreen.rgb + clamp( nIntensity, 0.0,1.0 ) * ( cResult - cTextureScreen.rgb );",

			// convert to grayscale if desired
			"if( grayscale ) {",

				"cResult = vec3( cResult.r * 0.3 + cResult.g * 0.59 + cResult.b * 0.11 );",

			"}",

			"gl_FragColor =  vec4( cResult, cTextureScreen.a );",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Focus shader
 * based on PaintEffect postprocess from ro.me
 * http://code.google.com/p/3-dreams-of-black/source/browse/deploy/js/effects/PaintEffect.js
 */

THREE.FocusShader = {

	uniforms : {

		"tDiffuse":       { type: "t", value: null },
		"screenWidth":    { type: "f", value: 1024 },
		"screenHeight":   { type: "f", value: 1024 },
		"sampleDistance": { type: "f", value: 0.94 },
		"waveFactor":     { type: "f", value: 0.00125 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float screenWidth;",
		"uniform float screenHeight;",
		"uniform float sampleDistance;",
		"uniform float waveFactor;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 color, org, tmp, add;",
			"float sample_dist, f;",
			"vec2 vin;",
			"vec2 uv = vUv;",

			"add = color = org = texture2D( tDiffuse, uv );",

			"vin = ( uv - vec2( 0.5 ) ) * vec2( 1.4 );",
			"sample_dist = dot( vin, vin ) * 2.0;",

			"f = ( waveFactor * 100.0 + sample_dist ) * sampleDistance * 4.0;",

			"vec2 sampleSize = vec2(  1.0 / screenWidth, 1.0 / screenHeight ) * vec2( f );",

			"add += tmp = texture2D( tDiffuse, uv + vec2( 0.111964, 0.993712 ) * sampleSize );",
			"if( tmp.b < color.b ) color = tmp;",

			"add += tmp = texture2D( tDiffuse, uv + vec2( 0.846724, 0.532032 ) * sampleSize );",
			"if( tmp.b < color.b ) color = tmp;",

			"add += tmp = texture2D( tDiffuse, uv + vec2( 0.943883, -0.330279 ) * sampleSize );",
			"if( tmp.b < color.b ) color = tmp;",

			"add += tmp = texture2D( tDiffuse, uv + vec2( 0.330279, -0.943883 ) * sampleSize );",
			"if( tmp.b < color.b ) color = tmp;",

			"add += tmp = texture2D( tDiffuse, uv + vec2( -0.532032, -0.846724 ) * sampleSize );",
			"if( tmp.b < color.b ) color = tmp;",

			"add += tmp = texture2D( tDiffuse, uv + vec2( -0.993712, -0.111964 ) * sampleSize );",
			"if( tmp.b < color.b ) color = tmp;",

			"add += tmp = texture2D( tDiffuse, uv + vec2( -0.707107, 0.707107 ) * sampleSize );",
			"if( tmp.b < color.b ) color = tmp;",

			"color = color * vec4( 2.0 ) - ( add / vec4( 8.0 ) );",
			"color = color + ( add / vec4( 8.0 ) - color ) * ( vec4( 1.0 ) - vec4( sample_dist * 0.5 ) );",

			"gl_FragColor = vec4( color.rgb * color.rgb * vec3( 0.95 ) + color.rgb, 1.0 );",

		"}"


	].join("\n")
};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Based on Nvidia Cg tutorial
 */

THREE.FresnelShader = {

	uniforms: {

		"mRefractionRatio": { type: "f", value: 1.02 },
		"mFresnelBias": { type: "f", value: 0.1 },
		"mFresnelPower": { type: "f", value: 2.0 },
		"mFresnelScale": { type: "f", value: 1.0 },
		"tCube": { type: "t", value: null }

	},

	vertexShader: [

		"uniform float mRefractionRatio;",
		"uniform float mFresnelBias;",
		"uniform float mFresnelScale;",
		"uniform float mFresnelPower;",

		"varying vec3 vReflect;",
		"varying vec3 vRefract[3];",
		"varying float vReflectionFactor;",

		"void main() {",

			"vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );",
			"vec4 worldPosition = modelMatrix * vec4( position, 1.0 );",

			"vec3 worldNormal = normalize( mat3( modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz ) * normal );",

			"vec3 I = worldPosition.xyz - cameraPosition;",

			"vReflect = reflect( I, worldNormal );",
			"vRefract[0] = refract( normalize( I ), worldNormal, mRefractionRatio );",
			"vRefract[1] = refract( normalize( I ), worldNormal, mRefractionRatio * 0.99 );",
			"vRefract[2] = refract( normalize( I ), worldNormal, mRefractionRatio * 0.98 );",
			"vReflectionFactor = mFresnelBias + mFresnelScale * pow( 1.0 + dot( normalize( I ), worldNormal ), mFresnelPower );",

			"gl_Position = projectionMatrix * mvPosition;",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform samplerCube tCube;",

		"varying vec3 vReflect;",
		"varying vec3 vRefract[3];",
		"varying float vReflectionFactor;",

		"void main() {",

			"vec4 reflectedColor = textureCube( tCube, vec3( -vReflect.x, vReflect.yz ) );",
			"vec4 refractedColor = vec4( 1.0 );",

			"refractedColor.r = textureCube( tCube, vec3( -vRefract[0].x, vRefract[0].yz ) ).r;",
			"refractedColor.g = textureCube( tCube, vec3( -vRefract[1].x, vRefract[1].yz ) ).g;",
			"refractedColor.b = textureCube( tCube, vec3( -vRefract[2].x, vRefract[2].yz ) ).b;",

			"gl_FragColor = mix( refractedColor, reflectedColor, clamp( vReflectionFactor, 0.0, 1.0 ) );",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 * @author davidedc / http://www.sketchpatch.net/
 *
 * NVIDIA FXAA by Timothy Lottes
 * http://timothylottes.blogspot.com/2011/06/fxaa3-source-released.html
 * - WebGL port by @supereggbert
 * http://www.glge.org/demos/fxaa/
 */

THREE.FXAAShader = {

	uniforms: {

		"tDiffuse":   { type: "t", value: null },
		"resolution": { type: "v2", value: new THREE.Vector2( 1 / 1024, 1 / 512 ) }

	},

	vertexShader: [

		"void main() {",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform vec2 resolution;",

		"#define FXAA_REDUCE_MIN   (1.0/128.0)",
		"#define FXAA_REDUCE_MUL   (1.0/8.0)",
		"#define FXAA_SPAN_MAX     8.0",

		"void main() {",

			"vec3 rgbNW = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( -1.0, -1.0 ) ) * resolution ).xyz;",
			"vec3 rgbNE = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( 1.0, -1.0 ) ) * resolution ).xyz;",
			"vec3 rgbSW = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( -1.0, 1.0 ) ) * resolution ).xyz;",
			"vec3 rgbSE = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( 1.0, 1.0 ) ) * resolution ).xyz;",
			"vec4 rgbaM  = texture2D( tDiffuse,  gl_FragCoord.xy  * resolution );",
			"vec3 rgbM  = rgbaM.xyz;",
			"vec3 luma = vec3( 0.299, 0.587, 0.114 );",

			"float lumaNW = dot( rgbNW, luma );",
			"float lumaNE = dot( rgbNE, luma );",
			"float lumaSW = dot( rgbSW, luma );",
			"float lumaSE = dot( rgbSE, luma );",
			"float lumaM  = dot( rgbM,  luma );",
			"float lumaMin = min( lumaM, min( min( lumaNW, lumaNE ), min( lumaSW, lumaSE ) ) );",
			"float lumaMax = max( lumaM, max( max( lumaNW, lumaNE) , max( lumaSW, lumaSE ) ) );",

			"vec2 dir;",
			"dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));",
			"dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));",

			"float dirReduce = max( ( lumaNW + lumaNE + lumaSW + lumaSE ) * ( 0.25 * FXAA_REDUCE_MUL ), FXAA_REDUCE_MIN );",

			"float rcpDirMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + dirReduce );",
			"dir = min( vec2( FXAA_SPAN_MAX,  FXAA_SPAN_MAX),",
				  "max( vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX),",
						"dir * rcpDirMin)) * resolution;",
			"vec4 rgbA = (1.0/2.0) * (",
        	"texture2D(tDiffuse,  gl_FragCoord.xy  * resolution + dir * (1.0/3.0 - 0.5)) +",
			"texture2D(tDiffuse,  gl_FragCoord.xy  * resolution + dir * (2.0/3.0 - 0.5)));",
    		"vec4 rgbB = rgbA * (1.0/2.0) + (1.0/4.0) * (",
			"texture2D(tDiffuse,  gl_FragCoord.xy  * resolution + dir * (0.0/3.0 - 0.5)) +",
      		"texture2D(tDiffuse,  gl_FragCoord.xy  * resolution + dir * (3.0/3.0 - 0.5)));",
    		"float lumaB = dot(rgbB, vec4(luma, 0.0));",

			"if ( ( lumaB < lumaMin ) || ( lumaB > lumaMax ) ) {",

				"gl_FragColor = rgbA;",

			"} else {",
				"gl_FragColor = rgbB;",

			"}",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Full-screen textured quad shader
 */

THREE.GammaCorrectionShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 texel = texture2D( tDiffuse, vUv );",
			"gl_FragColor = vec4(sqrt(texel.xyz), 1.0);",

		"}"

	].join("\n")

};

/**
 * @author zz85 / http://www.lab4games.net/zz85/blog
 *
 * Two pass Gaussian blur filter (horizontal and vertical blur shaders)
 * - described in http://www.gamerendering.com/2008/10/11/gaussian-blur-filter-shader/
 *   and used in http://www.cake23.de/traveling-wavefronts-lit-up.html
 *
 * - 9 samples per pass
 * - standard deviation 2.7
 * - "h" and "v" parameters should be set to "1 / width" and "1 / height"
 */

THREE.HorizontalBlurShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"h":        { type: "f", value: 1.0 / 512.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float h;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 sum = vec4( 0.0 );",

			"sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * h, vUv.y ) ) * 0.051;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * h, vUv.y ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * h, vUv.y ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * h, vUv.y ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * h, vUv.y ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * h, vUv.y ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * h, vUv.y ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * h, vUv.y ) ) * 0.051;",

			"gl_FragColor = sum;",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Simple fake tilt-shift effect, modulating two pass Gaussian blur (see above) by vertical position
 *
 * - 9 samples per pass
 * - standard deviation 2.7
 * - "h" and "v" parameters should be set to "1 / width" and "1 / height"
 * - "r" parameter control where "focused" horizontal line lies
 */

THREE.HorizontalTiltShiftShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"h":        { type: "f", value: 1.0 / 512.0 },
		"r":        { type: "f", value: 0.35 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float h;",
		"uniform float r;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 sum = vec4( 0.0 );",

			"float hh = h * abs( r - vUv.y );",

			"sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * hh, vUv.y ) ) * 0.051;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * hh, vUv.y ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * hh, vUv.y ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * hh, vUv.y ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * hh, vUv.y ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * hh, vUv.y ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * hh, vUv.y ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * hh, vUv.y ) ) * 0.051;",

			"gl_FragColor = sum;",

		"}"

	].join("\n")

};

/**
 * @author tapio / http://tapio.github.com/
 *
 * Hue and saturation adjustment
 * https://github.com/evanw/glfx.js
 * hue: -1 to 1 (-1 is 180 degrees in the negative direction, 0 is no change, etc.
 * saturation: -1 to 1 (-1 is solid gray, 0 is no change, and 1 is maximum contrast)
 */

THREE.HueSaturationShader = {

	uniforms: {

		"tDiffuse":   { type: "t", value: null },
		"hue":        { type: "f", value: 0 },
		"saturation": { type: "f", value: 0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float hue;",
		"uniform float saturation;",

		"varying vec2 vUv;",

		"void main() {",

			"gl_FragColor = texture2D( tDiffuse, vUv );",

			// hue
			"float angle = hue * 3.14159265;",
			"float s = sin(angle), c = cos(angle);",
			"vec3 weights = (vec3(2.0 * c, -sqrt(3.0) * s - c, sqrt(3.0) * s - c) + 1.0) / 3.0;",
			"float len = length(gl_FragColor.rgb);",
			"gl_FragColor.rgb = vec3(",
				"dot(gl_FragColor.rgb, weights.xyz),",
				"dot(gl_FragColor.rgb, weights.zxy),",
				"dot(gl_FragColor.rgb, weights.yzx)",
			");",

			// saturation
			"float average = (gl_FragColor.r + gl_FragColor.g + gl_FragColor.b) / 3.0;",
			"if (saturation > 0.0) {",
				"gl_FragColor.rgb += (average - gl_FragColor.rgb) * (1.0 - 1.0 / (1.001 - saturation));",
			"} else {",
				"gl_FragColor.rgb += (average - gl_FragColor.rgb) * (-saturation);",
			"}",

		"}"

	].join("\n")

};

/**
 * @author felixturner / http://airtight.cc/
 *
 * Kaleidoscope Shader
 * Radial reflection around center point
 * Ported from: http://pixelshaders.com/editor/
 * by Toby Schachman / http://tobyschachman.com/
 *
 * sides: number of reflections
 * angle: initial angle in radians
 */

THREE.KaleidoShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"sides":    { type: "f", value: 6.0 },
		"angle":    { type: "f", value: 0.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float sides;",
		"uniform float angle;",
		
		"varying vec2 vUv;",

		"void main() {",

			"vec2 p = vUv - 0.5;",
			"float r = length(p);",
			"float a = atan(p.y, p.x) + angle;",
			"float tau = 2. * 3.1416 ;",
			"a = mod(a, tau/sides);",
			"a = abs(a - tau/sides/2.) ;",
			"p = r * vec2(cos(a), sin(a));",
			"vec4 color = texture2D(tDiffuse, p + 0.5);",
			"gl_FragColor = color;",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Luminosity
 * http://en.wikipedia.org/wiki/Luminosity
 */

THREE.LuminosityShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 texel = texture2D( tDiffuse, vUv );",

			"vec3 luma = vec3( 0.299, 0.587, 0.114 );",

			"float v = dot( texel.xyz, luma );",

			"gl_FragColor = vec4( v, v, v, texel.w );",

		"}"

	].join("\n")

};

/**
 * @author felixturner / http://airtight.cc/
 *
 * Mirror Shader
 * Copies half the input to the other half
 *
 * side: side of input to mirror (0 = left, 1 = right, 2 = top, 3 = bottom)
 */

THREE.MirrorShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"side":     { type: "i", value: 1 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform int side;",
		
		"varying vec2 vUv;",

		"void main() {",

			"vec2 p = vUv;",
			"if (side == 0){",
				"if (p.x > 0.5) p.x = 1.0 - p.x;",
			"}else if (side == 1){",
				"if (p.x < 0.5) p.x = 1.0 - p.x;",
			"}else if (side == 2){",
				"if (p.y < 0.5) p.y = 1.0 - p.y;",
			"}else if (side == 3){",
				"if (p.y > 0.5) p.y = 1.0 - p.y;",
			"} ",
			"vec4 color = texture2D(tDiffuse, p);",
			"gl_FragColor = color;",

		"}"

	].join("\n")

};

/*
 * @author alteredq / http://alteredqualia.com/
 *
 * Normal map shader
 *  - Blinn-Phong
 *  - normal + diffuse + specular + AO + displacement + reflection + shadow maps
 *  - point and directional lights (use with "lights: true" material option)
 */

THREE.NormalDisplacementShader = {

	uniforms: THREE.UniformsUtils.merge( [

		THREE.UniformsLib[ "fog" ],
		THREE.UniformsLib[ "lights" ],
		THREE.UniformsLib[ "shadowmap" ],

		{

		"enableAO"          : { type: "i", value: 0 },
		"enableDiffuse"     : { type: "i", value: 0 },
		"enableSpecular"    : { type: "i", value: 0 },
		"enableReflection"  : { type: "i", value: 0 },
		"enableDisplacement": { type: "i", value: 0 },

		"tDisplacement": { type: "t", value: null }, // must go first as this is vertex texture
		"tDiffuse"     : { type: "t", value: null },
		"tCube"        : { type: "t", value: null },
		"tNormal"      : { type: "t", value: null },
		"tSpecular"    : { type: "t", value: null },
		"tAO"          : { type: "t", value: null },

		"uNormalScale": { type: "v2", value: new THREE.Vector2( 1, 1 ) },

		"uDisplacementBias": { type: "f", value: 0.0 },
		"uDisplacementScale": { type: "f", value: 1.0 },

		"diffuse": { type: "c", value: new THREE.Color( 0xffffff ) },
		"specular": { type: "c", value: new THREE.Color( 0x111111 ) },
		"shininess": { type: "f", value: 30 },
		"opacity": { type: "f", value: 1 },

		"refractionRatio": { type: "f", value: 0.98 },
		"reflectivity": { type: "f", value: 0.5 },

		"uOffset" : { type: "v2", value: new THREE.Vector2( 0, 0 ) },
		"uRepeat" : { type: "v2", value: new THREE.Vector2( 1, 1 ) },

		"wrapRGB" : { type: "v3", value: new THREE.Vector3( 1, 1, 1 ) }

		}

	] ),

	fragmentShader: [

		"uniform vec3 diffuse;",
		"uniform vec3 specular;",
		"uniform float shininess;",
		"uniform float opacity;",

		"uniform bool enableDiffuse;",
		"uniform bool enableSpecular;",
		"uniform bool enableAO;",
		"uniform bool enableReflection;",

		"uniform sampler2D tDiffuse;",
		"uniform sampler2D tNormal;",
		"uniform sampler2D tSpecular;",
		"uniform sampler2D tAO;",

		"uniform samplerCube tCube;",

		"uniform vec2 uNormalScale;",

		"uniform float refractionRatio;",
		"uniform float reflectivity;",

		"varying vec3 vTangent;",
		"varying vec3 vBinormal;",
		"varying vec3 vNormal;",
		"varying vec2 vUv;",

		"uniform vec3 ambientLightColor;",

		"#if MAX_DIR_LIGHTS > 0",

		"	uniform vec3 directionalLightColor[ MAX_DIR_LIGHTS ];",
		"	uniform vec3 directionalLightDirection[ MAX_DIR_LIGHTS ];",

		"#endif",

		"#if MAX_HEMI_LIGHTS > 0",

		"	uniform vec3 hemisphereLightSkyColor[ MAX_HEMI_LIGHTS ];",
		"	uniform vec3 hemisphereLightGroundColor[ MAX_HEMI_LIGHTS ];",
		"	uniform vec3 hemisphereLightDirection[ MAX_HEMI_LIGHTS ];",

		"#endif",

		"#if MAX_POINT_LIGHTS > 0",

		"	uniform vec3 pointLightColor[ MAX_POINT_LIGHTS ];",
		"	uniform vec3 pointLightPosition[ MAX_POINT_LIGHTS ];",
		"	uniform float pointLightDistance[ MAX_POINT_LIGHTS ];",

		"#endif",

		"#if MAX_SPOT_LIGHTS > 0",

		"	uniform vec3 spotLightColor[ MAX_SPOT_LIGHTS ];",
		"	uniform vec3 spotLightPosition[ MAX_SPOT_LIGHTS ];",
		"	uniform vec3 spotLightDirection[ MAX_SPOT_LIGHTS ];",
		"	uniform float spotLightAngleCos[ MAX_SPOT_LIGHTS ];",
		"	uniform float spotLightExponent[ MAX_SPOT_LIGHTS ];",
		"	uniform float spotLightDistance[ MAX_SPOT_LIGHTS ];",

		"#endif",

		"#ifdef WRAP_AROUND",

		"	uniform vec3 wrapRGB;",

		"#endif",

		"varying vec3 vWorldPosition;",
		"varying vec3 vViewPosition;",

		THREE.ShaderChunk[ "common" ],
		THREE.ShaderChunk[ "shadowmap_pars_fragment" ],
		THREE.ShaderChunk[ "fog_pars_fragment" ],
		THREE.ShaderChunk[ "logdepthbuf_pars_fragment" ],

		"void main() {",
			THREE.ShaderChunk[ "logdepthbuf_fragment" ],

		"	vec3 outgoingLight = vec3( 0.0 );",	// outgoing light does not have an alpha, the surface does
		"	vec4 diffuseColor = vec4( diffuse, opacity );",

		"	vec3 specularTex = vec3( 1.0 );",

		"	vec3 normalTex = texture2D( tNormal, vUv ).xyz * 2.0 - 1.0;",
		"	normalTex.xy *= uNormalScale;",
		"	normalTex = normalize( normalTex );",

		"	if( enableDiffuse ) {",

		"		#ifdef GAMMA_INPUT",

		"			vec4 texelColor = texture2D( tDiffuse, vUv );",
		"			texelColor.xyz *= texelColor.xyz;",

		"			diffuseColor *= texelColor;",

		"		#else",

		"			diffuseColor *= texture2D( tDiffuse, vUv );",

		"		#endif",

		"	}",

		"	if( enableAO ) {",

		"		#ifdef GAMMA_INPUT",

		"			vec4 aoColor = texture2D( tAO, vUv );",
		"			aoColor.xyz *= aoColor.xyz;",

		"			diffuseColor.rgb *= aoColor.xyz;",

		"		#else",

		"			diffuseColor.rgb *= texture2D( tAO, vUv ).xyz;",

		"		#endif",

		"	}",

		THREE.ShaderChunk[ "alphatest_fragment" ],

		"	if( enableSpecular )",
		"		specularTex = texture2D( tSpecular, vUv ).xyz;",

		"	mat3 tsb = mat3( normalize( vTangent ), normalize( vBinormal ), normalize( vNormal ) );",
		"	vec3 finalNormal = tsb * normalTex;",

		"	#ifdef FLIP_SIDED",

		"		finalNormal = -finalNormal;",

		"	#endif",

		"	vec3 normal = normalize( finalNormal );",
		"	vec3 viewPosition = normalize( vViewPosition );",

		"	vec3 totalDiffuseLight = vec3( 0.0 );",
		"	vec3 totalSpecularLight = vec3( 0.0 );",

			// point lights

		"	#if MAX_POINT_LIGHTS > 0",

		"		for ( int i = 0; i < MAX_POINT_LIGHTS; i ++ ) {",

		"			vec4 lPosition = viewMatrix * vec4( pointLightPosition[ i ], 1.0 );",
		"			vec3 pointVector = lPosition.xyz + vViewPosition.xyz;",

		"			float pointDistance = 1.0;",
		"			if ( pointLightDistance[ i ] > 0.0 )",
		"				pointDistance = 1.0 - min( ( length( pointVector ) / pointLightDistance[ i ] ), 1.0 );",

		"			pointVector = normalize( pointVector );",

					// diffuse

		"			#ifdef WRAP_AROUND",

		"				float pointDiffuseWeightFull = max( dot( normal, pointVector ), 0.0 );",
		"				float pointDiffuseWeightHalf = max( 0.5 * dot( normal, pointVector ) + 0.5, 0.0 );",

		"				vec3 pointDiffuseWeight = mix( vec3( pointDiffuseWeightFull ), vec3( pointDiffuseWeightHalf ), wrapRGB );",

		"			#else",

		"				float pointDiffuseWeight = max( dot( normal, pointVector ), 0.0 );",

		"			#endif",

		"			totalDiffuseLight += pointDistance * pointLightColor[ i ] * pointDiffuseWeight;",

					// specular

		"			vec3 pointHalfVector = normalize( pointVector + viewPosition );",
		"			float pointDotNormalHalf = max( dot( normal, pointHalfVector ), 0.0 );",
		"			float pointSpecularWeight = specularTex.r * max( pow( pointDotNormalHalf, shininess ), 0.0 );",

		"			float specularNormalization = ( shininess + 2.0 ) / 8.0;",

		"			vec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( pointVector, pointHalfVector ), 0.0 ), 5.0 );",
		"			totalSpecularLight += schlick * pointLightColor[ i ] * pointSpecularWeight * pointDiffuseWeight * pointDistance * specularNormalization;",

		"		}",

		"	#endif",

			// spot lights

		"	#if MAX_SPOT_LIGHTS > 0",

		"		for ( int i = 0; i < MAX_SPOT_LIGHTS; i ++ ) {",

		"			vec4 lPosition = viewMatrix * vec4( spotLightPosition[ i ], 1.0 );",
		"			vec3 spotVector = lPosition.xyz + vViewPosition.xyz;",

		"			float spotDistance = 1.0;",
		"			if ( spotLightDistance[ i ] > 0.0 )",
		"				spotDistance = 1.0 - min( ( length( spotVector ) / spotLightDistance[ i ] ), 1.0 );",

		"			spotVector = normalize( spotVector );",

		"			float spotEffect = dot( spotLightDirection[ i ], normalize( spotLightPosition[ i ] - vWorldPosition ) );",

		"			if ( spotEffect > spotLightAngleCos[ i ] ) {",

		"				spotEffect = max( pow( max( spotEffect, 0.0 ), spotLightExponent[ i ] ), 0.0 );",

						// diffuse

		"				#ifdef WRAP_AROUND",

		"					float spotDiffuseWeightFull = max( dot( normal, spotVector ), 0.0 );",
		"					float spotDiffuseWeightHalf = max( 0.5 * dot( normal, spotVector ) + 0.5, 0.0 );",

		"					vec3 spotDiffuseWeight = mix( vec3( spotDiffuseWeightFull ), vec3( spotDiffuseWeightHalf ), wrapRGB );",

		"				#else",

		"					float spotDiffuseWeight = max( dot( normal, spotVector ), 0.0 );",

		"				#endif",

		"				totalDiffuseLight += spotDistance * spotLightColor[ i ] * spotDiffuseWeight * spotEffect;",

						// specular

		"				vec3 spotHalfVector = normalize( spotVector + viewPosition );",
		"				float spotDotNormalHalf = max( dot( normal, spotHalfVector ), 0.0 );",
		"				float spotSpecularWeight = specularTex.r * max( pow( spotDotNormalHalf, shininess ), 0.0 );",

		"				float specularNormalization = ( shininess + 2.0 ) / 8.0;",

		"				vec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( spotVector, spotHalfVector ), 0.0 ), 5.0 );",
		"				totalSpecularLight += schlick * spotLightColor[ i ] * spotSpecularWeight * spotDiffuseWeight * spotDistance * specularNormalization * spotEffect;",

		"			}",

		"		}",

		"	#endif",

			// directional lights

		"	#if MAX_DIR_LIGHTS > 0",

		"		for( int i = 0; i < MAX_DIR_LIGHTS; i++ ) {",

		"			vec4 lDirection = viewMatrix * vec4( directionalLightDirection[ i ], 0.0 );",
		"			vec3 dirVector = normalize( lDirection.xyz );",

					// diffuse

		"			#ifdef WRAP_AROUND",

		"				float directionalLightWeightingFull = max( dot( normal, dirVector ), 0.0 );",
		"				float directionalLightWeightingHalf = max( 0.5 * dot( normal, dirVector ) + 0.5, 0.0 );",

		"				vec3 dirDiffuseWeight = mix( vec3( directionalLightWeightingFull ), vec3( directionalLightWeightingHalf ), wrapRGB );",

		"			#else",

		"				float dirDiffuseWeight = max( dot( normal, dirVector ), 0.0 );",

		"			#endif",

		"			totalDiffuseLight += directionalLightColor[ i ] * dirDiffuseWeight;",

					// specular

		"			vec3 dirHalfVector = normalize( dirVector + viewPosition );",
		"			float dirDotNormalHalf = max( dot( normal, dirHalfVector ), 0.0 );",
		"			float dirSpecularWeight = specularTex.r * max( pow( dirDotNormalHalf, shininess ), 0.0 );",

		"			float specularNormalization = ( shininess + 2.0 ) / 8.0;",

		"			vec3 schlick = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( dirVector, dirHalfVector ), 0.0 ), 5.0 );",
		"			totalSpecularLight += schlick * directionalLightColor[ i ] * dirSpecularWeight * dirDiffuseWeight * specularNormalization;",

		"		}",

		"	#endif",

			// hemisphere lights

		"	#if MAX_HEMI_LIGHTS > 0",

		"		for( int i = 0; i < MAX_HEMI_LIGHTS; i ++ ) {",

		"			vec4 lDirection = viewMatrix * vec4( hemisphereLightDirection[ i ], 0.0 );",
		"			vec3 lVector = normalize( lDirection.xyz );",

					// diffuse

		"			float dotProduct = dot( normal, lVector );",
		"			float hemiDiffuseWeight = 0.5 * dotProduct + 0.5;",

		"			vec3 hemiColor = mix( hemisphereLightGroundColor[ i ], hemisphereLightSkyColor[ i ], hemiDiffuseWeight );",

		"			totalDiffuseLight += hemiColor;",

					// specular (sky light)


		"			vec3 hemiHalfVectorSky = normalize( lVector + viewPosition );",
		"			float hemiDotNormalHalfSky = 0.5 * dot( normal, hemiHalfVectorSky ) + 0.5;",
		"			float hemiSpecularWeightSky = specularTex.r * max( pow( max( hemiDotNormalHalfSky, 0.0 ), shininess ), 0.0 );",

					// specular (ground light)

		"			vec3 lVectorGround = -lVector;",

		"			vec3 hemiHalfVectorGround = normalize( lVectorGround + viewPosition );",
		"			float hemiDotNormalHalfGround = 0.5 * dot( normal, hemiHalfVectorGround ) + 0.5;",
		"			float hemiSpecularWeightGround = specularTex.r * max( pow( max( hemiDotNormalHalfGround, 0.0 ), shininess ), 0.0 );",

		"			float dotProductGround = dot( normal, lVectorGround );",

		"			float specularNormalization = ( shininess + 2.0 ) / 8.0;",

		"			vec3 schlickSky = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVector, hemiHalfVectorSky ), 0.0 ), 5.0 );",
		"			vec3 schlickGround = specular + vec3( 1.0 - specular ) * pow( max( 1.0 - dot( lVectorGround, hemiHalfVectorGround ), 0.0 ), 5.0 );",
		"			totalSpecularLight += hemiColor * specularNormalization * ( schlickSky * hemiSpecularWeightSky * max( dotProduct, 0.0 ) + schlickGround * hemiSpecularWeightGround * max( dotProductGround, 0.0 ) );",

		"		}",

		"	#endif",

		"	#ifdef METAL",

		"		outgoingLight += diffuseColor.xyz * ( totalDiffuseLight + ambientLightColor + totalSpecularLight );",

		"	#else",

		"		outgoingLight += diffuseColor.xyz * ( totalDiffuseLight + ambientLightColor ) + totalSpecularLight;",

		"	#endif",

		"	if ( enableReflection ) {",

		"		vec3 cameraToVertex = normalize( vWorldPosition - cameraPosition );",

		"		#ifdef ENVMAP_MODE_REFLECTION",

		"			vec3 vReflect = reflect( cameraToVertex, normal );",

		"		#else",

		"			vec3 vReflect = refract( cameraToVertex, normal, refractionRatio );",

		"		#endif",

		"		vec4 cubeColor = textureCube( tCube, vec3( -vReflect.x, vReflect.yz ) );",

		"		#ifdef GAMMA_INPUT",

		"			cubeColor.xyz *= cubeColor.xyz;",

		"		#endif",

		"		outgoingLight = mix( outgoingLight, cubeColor.xyz, specularTex.r * reflectivity );",

		"	}",

			THREE.ShaderChunk[ "shadowmap_fragment" ],
			THREE.ShaderChunk[ "linear_to_gamma_fragment" ],
			THREE.ShaderChunk[ "fog_fragment" ],

		"	gl_FragColor = vec4( outgoingLight, diffuseColor.a );",	// TODO, this should be pre-multiplied to allow for bright highlights on very transparent objects

		"}"

	].join("\n"),

	vertexShader: [

		"attribute vec4 tangent;",

		"uniform vec2 uOffset;",
		"uniform vec2 uRepeat;",

		"uniform bool enableDisplacement;",

		"#ifdef VERTEX_TEXTURES",

		"	uniform sampler2D tDisplacement;",
		"	uniform float uDisplacementScale;",
		"	uniform float uDisplacementBias;",

		"#endif",

		"varying vec3 vTangent;",
		"varying vec3 vBinormal;",
		"varying vec3 vNormal;",
		"varying vec2 vUv;",

		"varying vec3 vWorldPosition;",
		"varying vec3 vViewPosition;",

		THREE.ShaderChunk[ "skinning_pars_vertex" ],
		THREE.ShaderChunk[ "shadowmap_pars_vertex" ],
		THREE.ShaderChunk[ "logdepthbuf_pars_vertex" ],

		"void main() {",

			THREE.ShaderChunk[ "skinbase_vertex" ],
			THREE.ShaderChunk[ "skinnormal_vertex" ],

			// normal, tangent and binormal vectors

		"	#ifdef USE_SKINNING",

		"		vNormal = normalize( normalMatrix * skinnedNormal.xyz );",

		"		vec4 skinnedTangent = skinMatrix * vec4( tangent.xyz, 0.0 );",
		"		vTangent = normalize( normalMatrix * skinnedTangent.xyz );",

		"	#else",

		"		vNormal = normalize( normalMatrix * normal );",
		"		vTangent = normalize( normalMatrix * tangent.xyz );",

		"	#endif",

		"	vBinormal = normalize( cross( vNormal, vTangent ) * tangent.w );",

		"	vUv = uv * uRepeat + uOffset;",

			// displacement mapping

		"	vec3 displacedPosition;",

		"	#ifdef VERTEX_TEXTURES",

		"		if ( enableDisplacement ) {",

		"			vec3 dv = texture2D( tDisplacement, uv ).xyz;",
		"			float df = uDisplacementScale * dv.x + uDisplacementBias;",
		"			displacedPosition = position + normalize( normal ) * df;",

		"		} else {",

		"			#ifdef USE_SKINNING",

		"				vec4 skinVertex = bindMatrix * vec4( position, 1.0 );",

		"				vec4 skinned = vec4( 0.0 );",
		"				skinned += boneMatX * skinVertex * skinWeight.x;",
		"				skinned += boneMatY * skinVertex * skinWeight.y;",
		"				skinned += boneMatZ * skinVertex * skinWeight.z;",
		"				skinned += boneMatW * skinVertex * skinWeight.w;",
		"				skinned  = bindMatrixInverse * skinned;",

		"				displacedPosition = skinned.xyz;",

		"			#else",

		"				displacedPosition = position;",

		"			#endif",

		"		}",

		"	#else",

		"		#ifdef USE_SKINNING",

		"			vec4 skinVertex = bindMatrix * vec4( position, 1.0 );",

		"			vec4 skinned = vec4( 0.0 );",
		"			skinned += boneMatX * skinVertex * skinWeight.x;",
		"			skinned += boneMatY * skinVertex * skinWeight.y;",
		"			skinned += boneMatZ * skinVertex * skinWeight.z;",
		"			skinned += boneMatW * skinVertex * skinWeight.w;",
		"			skinned  = bindMatrixInverse * skinned;",

		"			displacedPosition = skinned.xyz;",

		"		#else",

		"			displacedPosition = position;",

		"		#endif",

		"	#endif",

			//

		"	vec4 mvPosition = modelViewMatrix * vec4( displacedPosition, 1.0 );",
		"	vec4 worldPosition = modelMatrix * vec4( displacedPosition, 1.0 );",

		"	gl_Position = projectionMatrix * mvPosition;",

			THREE.ShaderChunk[ "logdepthbuf_vertex" ],

			//

		"	vWorldPosition = worldPosition.xyz;",
		"	vViewPosition = -mvPosition.xyz;",

			// shadows

		"	#ifdef USE_SHADOWMAP",

		"		for( int i = 0; i < MAX_SHADOWS; i ++ ) {",

		"			vShadowCoord[ i ] = shadowMatrix[ i ] * worldPosition;",

		"		}",

		"	#endif",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Normal map shader
 * - compute normals from heightmap
 */

THREE.NormalMapShader = {

	uniforms: {

		"heightMap":  { type: "t", value: null },
		"resolution": { type: "v2", value: new THREE.Vector2( 512, 512 ) },
		"scale":      { type: "v2", value: new THREE.Vector2( 1, 1 ) },
		"height":     { type: "f", value: 0.05 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float height;",
		"uniform vec2 resolution;",
		"uniform sampler2D heightMap;",

		"varying vec2 vUv;",

		"void main() {",

			"float val = texture2D( heightMap, vUv ).x;",

			"float valU = texture2D( heightMap, vUv + vec2( 1.0 / resolution.x, 0.0 ) ).x;",
			"float valV = texture2D( heightMap, vUv + vec2( 0.0, 1.0 / resolution.y ) ).x;",

			"gl_FragColor = vec4( ( 0.5 * normalize( vec3( val - valU, val - valV, height  ) ) + 0.5 ), 1.0 );",

		"}"

	].join("\n")

};

// Author: Aleksandr Albert
// Website: www.routter.co.tt

// Description: A deep water ocean shader set
// based on an implementation of a Tessendorf Waves
// originally presented by David Li ( www.david.li/waves )

// The general method is to apply shaders to simulation Framebuffers
// and then sample these framebuffers when rendering the ocean mesh

// The set uses 7 shaders:

// -- Simulation shaders
// [1] ocean_sim_vertex         -> Vertex shader used to set up a 2x2 simulation plane centered at (0,0)
// [2] ocean_subtransform       -> Fragment shader used to subtransform the mesh (generates the displacement map)
// [3] ocean_initial_spectrum   -> Fragment shader used to set intitial wave frequency at a texel coordinate
// [4] ocean_phase              -> Fragment shader used to set wave phase at a texel coordinate
// [5] ocean_spectrum           -> Fragment shader used to set current wave frequency at a texel coordinate
// [6] ocean_normal             -> Fragment shader used to set face normals at a texel coordinate

// -- Rendering Shader
// [7] ocean_main               -> Vertex and Fragment shader used to create the final render


THREE.ShaderLib['ocean_sim_vertex'] = {
	varying: {
		"vUV": { type: "v2" }
	},
	vertexShader: [
		'varying vec2 vUV;',

		'void main (void) {',
			'vUV = position.xy * 0.5 + 0.5;',
			'gl_Position = vec4(position, 1.0 );',
		'}'
	].join('\n')
};
THREE.ShaderLib['ocean_subtransform'] = {
	uniforms: {
		"u_input": { type: "t", value: null },
		"u_transformSize": { type: "f", value: 512.0 },
		"u_subtransformSize": { type: "f", value: 250.0 }
	},
	varying: {
		"vUV": { type: "v2" }
	},
	fragmentShader: [
		//GPU FFT using a Stockham formulation
		'precision highp float;',

		'const float PI = 3.14159265359;',

		'uniform sampler2D u_input;',
		'uniform float u_transformSize;',
		'uniform float u_subtransformSize;',

		'varying vec2 vUV;',
		
		'vec2 multiplyComplex (vec2 a, vec2 b) {',
			'return vec2(a[0] * b[0] - a[1] * b[1], a[1] * b[0] + a[0] * b[1]);',
		'}',

		'void main (void) {',
			'#ifdef HORIZONTAL',
			'float index = vUV.x * u_transformSize - 0.5;',
			'#else',
			'float index = vUV.y * u_transformSize - 0.5;',
			'#endif',

			'float evenIndex = floor(index / u_subtransformSize) * (u_subtransformSize * 0.5) + mod(index, u_subtransformSize * 0.5);',

			//transform two complex sequences simultaneously
			'#ifdef HORIZONTAL',
			'vec4 even = texture2D(u_input, vec2(evenIndex + 0.5, gl_FragCoord.y) / u_transformSize).rgba;',
			'vec4 odd = texture2D(u_input, vec2(evenIndex + u_transformSize * 0.5 + 0.5, gl_FragCoord.y) / u_transformSize).rgba;',
			'#else',
			'vec4 even = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + 0.5) / u_transformSize).rgba;',
			'vec4 odd = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + u_transformSize * 0.5 + 0.5) / u_transformSize).rgba;',
			'#endif',

			'float twiddleArgument = -2.0 * PI * (index / u_subtransformSize);',
			'vec2 twiddle = vec2(cos(twiddleArgument), sin(twiddleArgument));',

			'vec2 outputA = even.xy + multiplyComplex(twiddle, odd.xy);',
			'vec2 outputB = even.zw + multiplyComplex(twiddle, odd.zw);',

			'gl_FragColor = vec4(outputA, outputB);',
		'}'
	].join('\n')
};
THREE.ShaderLib['ocean_initial_spectrum'] = {
	uniforms: {
		"u_wind": { type: "v2", value: new THREE.Vector2(10.0, 10.0) },
		"u_resolution": { type: "f", value: 512.0 },
		"u_size": { type: "f", value: 250.0 },
	},
	fragmentShader: [
		'precision highp float;',

		'const float PI = 3.14159265359;',
		'const float G = 9.81;',
		'const float KM = 370.0;',
		'const float CM = 0.23;',

		'uniform vec2 u_wind;',
		'uniform float u_resolution;',
		'uniform float u_size;',
		
		'float square (float x) {',
			'return x * x;',
		'}',

		'float omega (float k) {',
			'return sqrt(G * k * (1.0 + square(k / KM)));',
		'}',

		'float tanh (float x) {',
			'return (1.0 - exp(-2.0 * x)) / (1.0 + exp(-2.0 * x));',
		'}',

		'void main (void) {',
			'vec2 coordinates = gl_FragCoord.xy - 0.5;',
			
			'float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;',
			'float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;',
			
			'vec2 K = (2.0 * PI * vec2(n, m)) / u_size;',
			'float k = length(K);',
			
			'float l_wind = length(u_wind);',

			'float Omega = 0.84;',
			'float kp = G * square(Omega / l_wind);',

			'float c = omega(k) / k;',
			'float cp = omega(kp) / kp;',

			'float Lpm = exp(-1.25 * square(kp / k));',
			'float gamma = 1.7;',
			'float sigma = 0.08 * (1.0 + 4.0 * pow(Omega, -3.0));',
			'float Gamma = exp(-square(sqrt(k / kp) - 1.0) / 2.0 * square(sigma));',
			'float Jp = pow(gamma, Gamma);',
			'float Fp = Lpm * Jp * exp(-Omega / sqrt(10.0) * (sqrt(k / kp) - 1.0));',
			'float alphap = 0.006 * sqrt(Omega);',
			'float Bl = 0.5 * alphap * cp / c * Fp;',

			'float z0 = 0.000037 * square(l_wind) / G * pow(l_wind / cp, 0.9);',
			'float uStar = 0.41 * l_wind / log(10.0 / z0);',
			'float alpham = 0.01 * ((uStar < CM) ? (1.0 + log(uStar / CM)) : (1.0 + 3.0 * log(uStar / CM)));',
			'float Fm = exp(-0.25 * square(k / KM - 1.0));',
			'float Bh = 0.5 * alpham * CM / c * Fm * Lpm;',

			'float a0 = log(2.0) / 4.0;',
			'float am = 0.13 * uStar / CM;',
			'float Delta = tanh(a0 + 4.0 * pow(c / cp, 2.5) + am * pow(CM / c, 2.5));',

			'float cosPhi = dot(normalize(u_wind), normalize(K));',

			'float S = (1.0 / (2.0 * PI)) * pow(k, -4.0) * (Bl + Bh) * (1.0 + Delta * (2.0 * cosPhi * cosPhi - 1.0));',

			'float dk = 2.0 * PI / u_size;',
			'float h = sqrt(S / 2.0) * dk;',

			'if (K.x == 0.0 && K.y == 0.0) {',
				'h = 0.0;', //no DC term
			'}',
			'gl_FragColor = vec4(h, 0.0, 0.0, 0.0);',
		'}'
	].join('\n')
};
THREE.ShaderLib['ocean_phase'] = {
	uniforms: {
		"u_phases": { type: "t", value: null },
		"u_deltaTime": { type: "f", value: null },
		"u_resolution": { type: "f", value: null },
		"u_size": { type: "f", value: null },
	},
	varying: {
		"vUV": { type: "v2" }
	},
	fragmentShader: [
		'precision highp float;',

		'const float PI = 3.14159265359;',
		'const float G = 9.81;',
		'const float KM = 370.0;',

		'varying vec2 vUV;',

		'uniform sampler2D u_phases;',
		'uniform float u_deltaTime;',
		'uniform float u_resolution;',
		'uniform float u_size;',

		'float omega (float k) {',
			'return sqrt(G * k * (1.0 + k * k / KM * KM));',
		'}',

		'void main (void) {',
			'float deltaTime = 1.0 / 60.0;',
			'vec2 coordinates = gl_FragCoord.xy - 0.5;',
			'float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;',
			'float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;',
			'vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;',

			'float phase = texture2D(u_phases, vUV).r;',
			'float deltaPhase = omega(length(waveVector)) * u_deltaTime;',
			'phase = mod(phase + deltaPhase, 2.0 * PI);',
		
			'gl_FragColor = vec4(phase, 0.0, 0.0, 0.0);',
		'}'
	].join('\n')
};
THREE.ShaderLib['ocean_spectrum'] = {
	uniforms: {
		"u_size": { type: "f", value: null },
		"u_resolution": { type: "f", value: null },
		"u_choppiness": { type: "f", value: null },
		"u_phases": { type: "t", value: null },
		"u_initialSpectrum": { type: "t", value: null },
	},
	varying: {
		"vUV": { type: "v2" }
	},
	fragmentShader: [
		'precision highp float;',

		'const float PI = 3.14159265359;',
		'const float G = 9.81;',
		'const float KM = 370.0;',

		'varying vec2 vUV;',

		'uniform float u_size;',
		'uniform float u_resolution;',
		'uniform float u_choppiness;',
		'uniform sampler2D u_phases;',
		'uniform sampler2D u_initialSpectrum;',

		'vec2 multiplyComplex (vec2 a, vec2 b) {',
			'return vec2(a[0] * b[0] - a[1] * b[1], a[1] * b[0] + a[0] * b[1]);',
		'}',

		'vec2 multiplyByI (vec2 z) {',
			'return vec2(-z[1], z[0]);',
		'}',

		'float omega (float k) {',
			'return sqrt(G * k * (1.0 + k * k / KM * KM));',
		'}',

		'void main (void) {',
			'vec2 coordinates = gl_FragCoord.xy - 0.5;',
			'float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;',
			'float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;',
			'vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;',

			'float phase = texture2D(u_phases, vUV).r;',
			'vec2 phaseVector = vec2(cos(phase), sin(phase));',

			'vec2 h0 = texture2D(u_initialSpectrum, vUV).rg;',
			'vec2 h0Star = texture2D(u_initialSpectrum, vec2(1.0 - vUV + 1.0 / u_resolution)).rg;',
			'h0Star.y *= -1.0;',

			'vec2 h = multiplyComplex(h0, phaseVector) + multiplyComplex(h0Star, vec2(phaseVector.x, -phaseVector.y));',

			'vec2 hX = -multiplyByI(h * (waveVector.x / length(waveVector))) * u_choppiness;',
			'vec2 hZ = -multiplyByI(h * (waveVector.y / length(waveVector))) * u_choppiness;',

			//no DC term
			'if (waveVector.x == 0.0 && waveVector.y == 0.0) {',
				'h = vec2(0.0);',
				'hX = vec2(0.0);',
				'hZ = vec2(0.0);',
			'}',
		
			'gl_FragColor = vec4(hX + multiplyByI(h), hZ);',
		'}'
	].join('\n')
};
THREE.ShaderLib['ocean_normals'] = {
	uniforms: {
		"u_displacementMap": { type: "t", value: null },
		"u_resolution": { type: "f", value: null },
		"u_size": { type: "f", value: null },
	},
	varying: {
		"vUV": { type: "v2" }
	},
	fragmentShader: [
		'precision highp float;',

		'varying vec2 vUV;',
		
		'uniform sampler2D u_displacementMap;',
		'uniform float u_resolution;',
		'uniform float u_size;',

		'void main (void) {',
			'float texel = 1.0 / u_resolution;',
			'float texelSize = u_size / u_resolution;',

			'vec3 center = texture2D(u_displacementMap, vUV).rgb;',
			'vec3 right = vec3(texelSize, 0.0, 0.0) + texture2D(u_displacementMap, vUV + vec2(texel, 0.0)).rgb - center;',
			'vec3 left = vec3(-texelSize, 0.0, 0.0) + texture2D(u_displacementMap, vUV + vec2(-texel, 0.0)).rgb - center;',
			'vec3 top = vec3(0.0, 0.0, -texelSize) + texture2D(u_displacementMap, vUV + vec2(0.0, -texel)).rgb - center;',
			'vec3 bottom = vec3(0.0, 0.0, texelSize) + texture2D(u_displacementMap, vUV + vec2(0.0, texel)).rgb - center;',

			'vec3 topRight = cross(right, top);',
			'vec3 topLeft = cross(top, left);',
			'vec3 bottomLeft = cross(left, bottom);',
			'vec3 bottomRight = cross(bottom, right);',
		
			'gl_FragColor = vec4(normalize(topRight + topLeft + bottomLeft + bottomRight), 1.0);',
		'}'
	].join('\n')
};
THREE.ShaderLib['ocean_main'] = {
	uniforms: {
		"u_displacementMap": { type: "t", value: null },
		"u_normalMap": { type: "t", value: null },
		"u_geometrySize": { type: "f", value: null },
		"u_size": { type: "f", value: null },
		"u_projectionMatrix": { type: "m4", value: null },
		"u_viewMatrix": { type: "m4", value: null },
		"u_cameraPosition": { type: "v3", value: null },
		"u_skyColor": { type: "v3", value: null },
		"u_oceanColor": { type: "v3", value: null },
		"u_sunDirection": { type: "v3", value: null },
		"u_exposure": { type: "f", value: null },
	},
	varying: {
		"vPos": { type: "v3" },
		"vUV": { type: "v2" }
	},
	vertexShader: [
		'precision highp float;',
		
		'varying vec3 vPos;',
		'varying vec2 vUV;',

		'uniform mat4 u_projectionMatrix;',
		'uniform mat4 u_viewMatrix;',
		'uniform float u_size;',
		'uniform float u_geometrySize;',
		'uniform sampler2D u_displacementMap;',

		'void main (void) {',
			'vec3 newPos = position + texture2D(u_displacementMap, uv).rgb * (u_geometrySize / u_size);',
			'vPos = newPos;',
			'vUV = uv;',
			'gl_Position = u_projectionMatrix * u_viewMatrix * vec4(newPos, 1.0);',
		'}'
	].join('\n'),
	fragmentShader: [
		'precision highp float;',

		'varying vec3 vPos;',
		'varying vec2 vUV;',

		'uniform sampler2D u_displacementMap;',
		'uniform sampler2D u_normalMap;',
		'uniform vec3 u_cameraPosition;',
		'uniform vec3 u_oceanColor;',
		'uniform vec3 u_skyColor;',
		'uniform vec3 u_sunDirection;',
		'uniform float u_exposure;',

		'vec3 hdr (vec3 color, float exposure) {',
			'return 1.0 - exp(-color * exposure);',
		'}',

		'void main (void) {',
			'vec3 normal = texture2D(u_normalMap, vUV).rgb;',

			'vec3 view = normalize(u_cameraPosition - vPos);',
			'float fresnel = 0.02 + 0.98 * pow(1.0 - dot(normal, view), 5.0);',
			'vec3 sky = fresnel * u_skyColor;',

			'float diffuse = clamp(dot(normal, normalize(u_sunDirection)), 0.0, 1.0);',
			'vec3 water = (1.0 - fresnel) * u_oceanColor * u_skyColor * diffuse;',

			'vec3 color = sky + water;',

			'gl_FragColor = vec4(hdr(color, u_exposure), 1.0);',
		'}'
	].join('\n')
};
// Parallax Occlusion shaders from
//    http://sunandblackcat.com/tipFullView.php?topicid=28
// No tangent-space transforms logic based on
//   http://mmikkelsen3d.blogspot.sk/2012/02/parallaxpoc-mapping-and-no-tangent.html

THREE.ParallaxShader = {
	// Ordered from fastest to best quality.
	modes: {
		none:  'NO_PARALLAX',
		basic: 'USE_BASIC_PARALLAX',
		steep: 'USE_STEEP_PARALLAX',
		occlusion: 'USE_OCLUSION_PARALLAX', // a.k.a. POM
		relief: 'USE_RELIEF_PARALLAX',
	},

	uniforms: {
		"bumpMap": { type: "t", value: null },
		"map": { type: "t", value: null },
		"parallaxScale": { type: "f", value: null },
		"parallaxMinLayers": { type: "f", value: null },
		"parallaxMaxLayers": { type: "f", value: null }
	},

	vertexShader: [
		"varying vec2 vUv;",
		"varying vec3 vViewPosition;",
		"varying vec3 vNormal;",

		"void main() {",

			"vUv = uv;",
			"vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );",
			"vViewPosition = -mvPosition.xyz;",
			"vNormal = normalize( normalMatrix * normal );",
			"gl_Position = projectionMatrix * mvPosition;",

		"}"

  ].join( "\n" ),

	fragmentShader: [
		"uniform sampler2D bumpMap;",
		"uniform sampler2D map;",

		"uniform float parallaxScale;",
		"uniform float parallaxMinLayers;",
		"uniform float parallaxMaxLayers;",

		"varying vec2 vUv;",
		"varying vec3 vViewPosition;",
		"varying vec3 vNormal;",

		"#ifdef USE_BASIC_PARALLAX",

			"vec2 parallaxMap( in vec3 V ) {",

				"float initialHeight = texture2D( bumpMap, vUv ).r;",

				// No Offset Limitting: messy, floating output at grazing angles.
				//"vec2 texCoordOffset = parallaxScale * V.xy / V.z * initialHeight;",

				// Offset Limiting
				"vec2 texCoordOffset = parallaxScale * V.xy * initialHeight;",
				"return vUv - texCoordOffset;",

			"}",

		"#else",

			"vec2 parallaxMap( in vec3 V ) {",

				// Determine number of layers from angle between V and N
				"float numLayers = mix( parallaxMaxLayers, parallaxMinLayers, abs( dot( vec3( 0.0, 0.0, 1.0 ), V ) ) );",

				"float layerHeight = 1.0 / numLayers;",
				"float currentLayerHeight = 0.0;",
				// Shift of texture coordinates for each iteration
				"vec2 dtex = parallaxScale * V.xy / V.z / numLayers;",

				"vec2 currentTextureCoords = vUv;",

				"float heightFromTexture = texture2D( bumpMap, currentTextureCoords ).r;",

				// while ( heightFromTexture > currentLayerHeight )
				"for ( int i = 0; i == 0; i += 0 ) {",
					"if ( heightFromTexture <= currentLayerHeight ) {",
						"break;",
					"}",
					"currentLayerHeight += layerHeight;",
					// Shift texture coordinates along vector V
					"currentTextureCoords -= dtex;",
					"heightFromTexture = texture2D( bumpMap, currentTextureCoords ).r;",
				"}",

				"#ifdef USE_STEEP_PARALLAX",

					"return currentTextureCoords;",

				"#elif defined( USE_RELIEF_PARALLAX )",

					"vec2 deltaTexCoord = dtex / 2.0;",
					"float deltaHeight = layerHeight / 2.0;",

					// Return to the mid point of previous layer
					"currentTextureCoords += deltaTexCoord;",
					"currentLayerHeight -= deltaHeight;",

					// Binary search to increase precision of Steep Parallax Mapping
					"const int numSearches = 5;",
					"for ( int i = 0; i < numSearches; i += 1 ) {",

						"deltaTexCoord /= 2.0;",
						"deltaHeight /= 2.0;",
						"heightFromTexture = texture2D( bumpMap, currentTextureCoords ).r;",
						// Shift along or against vector V
						"if( heightFromTexture > currentLayerHeight ) {", // Below the surface

							"currentTextureCoords -= deltaTexCoord;",
							"currentLayerHeight += deltaHeight;",

						"} else {", // above the surface

							"currentTextureCoords += deltaTexCoord;",
							"currentLayerHeight -= deltaHeight;",

						"}",

					"}",
					"return currentTextureCoords;",

				"#elif defined( USE_OCLUSION_PARALLAX )",

					"vec2 prevTCoords = currentTextureCoords + dtex;",

					// Heights for linear interpolation
					"float nextH = heightFromTexture - currentLayerHeight;",
					"float prevH = texture2D( bumpMap, prevTCoords ).r - currentLayerHeight + layerHeight;",

					// Proportions for linear interpolation
					"float weight = nextH / ( nextH - prevH );",

					// Interpolation of texture coordinates
					"return prevTCoords * weight + currentTextureCoords * ( 1.0 - weight );",

				"#else", // NO_PARALLAX

					"return vUv;",

				"#endif",

			"}",
		"#endif",

		"vec2 perturbUv( vec3 surfPosition, vec3 surfNormal, vec3 viewPosition ) {",

 			"vec2 texDx = dFdx( vUv );",
			"vec2 texDy = dFdy( vUv );",

			"vec3 vSigmaX = dFdx( surfPosition );",
			"vec3 vSigmaY = dFdy( surfPosition );",
			"vec3 vR1 = cross( vSigmaY, surfNormal );",
			"vec3 vR2 = cross( surfNormal, vSigmaX );",
			"float fDet = dot( vSigmaX, vR1 );",

			"vec2 vProjVscr = ( 1.0 / fDet ) * vec2( dot( vR1, viewPosition ), dot( vR2, viewPosition ) );",
			"vec3 vProjVtex;",
			"vProjVtex.xy = texDx * vProjVscr.x + texDy * vProjVscr.y;",
			"vProjVtex.z = dot( surfNormal, viewPosition );",

			"return parallaxMap( vProjVtex );",
		"}",

		"void main() {",

			"vec2 mapUv = perturbUv( -vViewPosition, normalize( vNormal ), normalize( vViewPosition ) );",
			"gl_FragColor = texture2D( map, mapUv );",

		"}",

  ].join( "\n" )

};

/**
 * @author felixturner / http://airtight.cc/
 *
 * RGB Shift Shader
 * Shifts red and blue channels from center in opposite directions
 * Ported from http://kriss.cx/tom/2009/05/rgb-shift/
 * by Tom Butterworth / http://kriss.cx/tom/
 *
 * amount: shift distance (1 is width of input)
 * angle: shift angle in radians
 */

THREE.RGBShiftShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"amount":   { type: "f", value: 0.005 },
		"angle":    { type: "f", value: 0.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float amount;",
		"uniform float angle;",

		"varying vec2 vUv;",

		"void main() {",

			"vec2 offset = amount * vec2( cos(angle), sin(angle));",
			"vec4 cr = texture2D(tDiffuse, vUv + offset);",
			"vec4 cga = texture2D(tDiffuse, vUv);",
			"vec4 cb = texture2D(tDiffuse, vUv - offset);",
			"gl_FragColor = vec4(cr.r, cga.g, cb.b, cga.a);",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Sepia tone shader
 * based on glfx.js sepia shader
 * https://github.com/evanw/glfx.js
 */

THREE.SepiaShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"amount":   { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float amount;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 color = texture2D( tDiffuse, vUv );",
			"vec3 c = color.rgb;",

			"color.r = dot( c, vec3( 1.0 - 0.607 * amount, 0.769 * amount, 0.189 * amount ) );",
			"color.g = dot( c, vec3( 0.349 * amount, 1.0 - 0.314 * amount, 0.168 * amount ) );",
			"color.b = dot( c, vec3( 0.272 * amount, 0.534 * amount, 1.0 - 0.869 * amount ) );",

			"gl_FragColor = vec4( min( vec3( 1.0 ), color.rgb ), color.a );",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Screen-space ambient occlusion shader
 * - ported from
 *   SSAO GLSL shader v1.2
 *   assembled by Martins Upitis (martinsh) (http://devlog-martinsh.blogspot.com)
 *   original technique is made by ArKano22 (http://www.gamedev.net/topic/550699-ssao-no-halo-artifacts/)
 * - modifications
 * - modified to use RGBA packed depth texture (use clear color 1,1,1,1 for depth pass)
 * - refactoring and optimizations
 */

THREE.SSAOShader = {

	uniforms: {

		"tDiffuse":     { type: "t", value: null },
		"tDepth":       { type: "t", value: null },
		"size":         { type: "v2", value: new THREE.Vector2( 512, 512 ) },
		"cameraNear":   { type: "f", value: 1 },
		"cameraFar":    { type: "f", value: 100 },
		"onlyAO":       { type: "i", value: 0 },
		"aoClamp":      { type: "f", value: 0.5 },
		"lumInfluence": { type: "f", value: 0.5 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",

			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float cameraNear;",
		"uniform float cameraFar;",

		"uniform bool onlyAO;",      // use only ambient occlusion pass?

		"uniform vec2 size;",        // texture width, height
		"uniform float aoClamp;",    // depth clamp - reduces haloing at screen edges

		"uniform float lumInfluence;",  // how much luminance affects occlusion

		"uniform sampler2D tDiffuse;",
		"uniform sampler2D tDepth;",

		"varying vec2 vUv;",

		// "#define PI 3.14159265",
		"#define DL 2.399963229728653",  // PI * ( 3.0 - sqrt( 5.0 ) )
		"#define EULER 2.718281828459045",

		// helpers

		"float width = size.x;",   // texture width
		"float height = size.y;",  // texture height

		"float cameraFarPlusNear = cameraFar + cameraNear;",
		"float cameraFarMinusNear = cameraFar - cameraNear;",
		"float cameraCoef = 2.0 * cameraNear;",

		// user variables

		"const int samples = 8;",     // ao sample count
		"const float radius = 5.0;",  // ao radius

		"const bool useNoise = false;",      // use noise instead of pattern for sample dithering
		"const float noiseAmount = 0.0003;", // dithering amount

		"const float diffArea = 0.4;",   // self-shadowing reduction
		"const float gDisplace = 0.4;",  // gauss bell center


		// RGBA depth

		"float unpackDepth( const in vec4 rgba_depth ) {",

			"const vec4 bit_shift = vec4( 1.0 / ( 256.0 * 256.0 * 256.0 ), 1.0 / ( 256.0 * 256.0 ), 1.0 / 256.0, 1.0 );",
			"float depth = dot( rgba_depth, bit_shift );",
			"return depth;",

		"}",

		// generating noise / pattern texture for dithering

		"vec2 rand( const vec2 coord ) {",

			"vec2 noise;",

			"if ( useNoise ) {",

				"float nx = dot ( coord, vec2( 12.9898, 78.233 ) );",
				"float ny = dot ( coord, vec2( 12.9898, 78.233 ) * 2.0 );",

				"noise = clamp( fract ( 43758.5453 * sin( vec2( nx, ny ) ) ), 0.0, 1.0 );",

			"} else {",

				"float ff = fract( 1.0 - coord.s * ( width / 2.0 ) );",
				"float gg = fract( coord.t * ( height / 2.0 ) );",

				"noise = vec2( 0.25, 0.75 ) * vec2( ff ) + vec2( 0.75, 0.25 ) * gg;",

			"}",

			"return ( noise * 2.0  - 1.0 ) * noiseAmount;",

		"}",

		"float readDepth( const in vec2 coord ) {",

			// "return ( 2.0 * cameraNear ) / ( cameraFar + cameraNear - unpackDepth( texture2D( tDepth, coord ) ) * ( cameraFar - cameraNear ) );",
			"return cameraCoef / ( cameraFarPlusNear - unpackDepth( texture2D( tDepth, coord ) ) * cameraFarMinusNear );",


		"}",

		"float compareDepths( const in float depth1, const in float depth2, inout int far ) {",

			"float garea = 2.0;",                         // gauss bell width
			"float diff = ( depth1 - depth2 ) * 100.0;",  // depth difference (0-100)

			// reduce left bell width to avoid self-shadowing

			"if ( diff < gDisplace ) {",

				"garea = diffArea;",

			"} else {",

				"far = 1;",

			"}",

			"float dd = diff - gDisplace;",
			"float gauss = pow( EULER, -2.0 * dd * dd / ( garea * garea ) );",
			"return gauss;",

		"}",

		"float calcAO( float depth, float dw, float dh ) {",

			"float dd = radius - depth * radius;",
			"vec2 vv = vec2( dw, dh );",

			"vec2 coord1 = vUv + dd * vv;",
			"vec2 coord2 = vUv - dd * vv;",

			"float temp1 = 0.0;",
			"float temp2 = 0.0;",

			"int far = 0;",
			"temp1 = compareDepths( depth, readDepth( coord1 ), far );",

			// DEPTH EXTRAPOLATION

			"if ( far > 0 ) {",

				"temp2 = compareDepths( readDepth( coord2 ), depth, far );",
				"temp1 += ( 1.0 - temp1 ) * temp2;",

			"}",

			"return temp1;",

		"}",

		"void main() {",

			"vec2 noise = rand( vUv );",
			"float depth = readDepth( vUv );",

			"float tt = clamp( depth, aoClamp, 1.0 );",

			"float w = ( 1.0 / width )  / tt + ( noise.x * ( 1.0 - noise.x ) );",
			"float h = ( 1.0 / height ) / tt + ( noise.y * ( 1.0 - noise.y ) );",

			"float ao = 0.0;",

			"float dz = 1.0 / float( samples );",
			"float z = 1.0 - dz / 2.0;",
			"float l = 0.0;",

			"for ( int i = 0; i <= samples; i ++ ) {",

				"float r = sqrt( 1.0 - z );",

				"float pw = cos( l ) * r;",
				"float ph = sin( l ) * r;",
				"ao += calcAO( depth, pw * w, ph * h );",
				"z = z - dz;",
				"l = l + DL;",

			"}",

			"ao /= float( samples );",
			"ao = 1.0 - ao;",

			"vec3 color = texture2D( tDiffuse, vUv ).rgb;",

			"vec3 lumcoeff = vec3( 0.299, 0.587, 0.114 );",
			"float lum = dot( color.rgb, lumcoeff );",
			"vec3 luminance = vec3( lum );",

			"vec3 final = vec3( color * mix( vec3( ao ), vec3( 1.0 ), luminance * lumInfluence ) );",  // mix( color * ao, white, luminance )

			"if ( onlyAO ) {",

				"final = vec3( mix( vec3( ao ), vec3( 1.0 ), luminance * lumInfluence ) );",  // ambient occlusion only

			"}",

			"gl_FragColor = vec4( final, 1.0 );",

		"}"

	].join("\n")

};

/**
 * @author flimshaw / http://charliehoey.com
 *
 * Technicolor Shader
 * Simulates the look of the two-strip technicolor process popular in early 20th century films.
 * More historical info here: http://www.widescreenmuseum.com/oldcolor/technicolor1.htm
 * Demo here: http://charliehoey.com/technicolor_shader/shader_test.html
 */

THREE.TechnicolorShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"varying vec2 vUv;",

		"void main() {",

			"vec4 tex = texture2D( tDiffuse, vec2( vUv.x, vUv.y ) );",
			"vec4 newTex = vec4(tex.r, (tex.g + tex.b) * .5, (tex.g + tex.b) * .5, 1.0);",

			"gl_FragColor = newTex;",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Full-screen textured quad shader
 */

THREE.ThresholdShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"threshold":  { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float threshold;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",
			"vec4 texel = texture2D( tDiffuse, vUv );",
			"float lum = dot(texel.xyz, vec3(.299, .587, .114));",
			"if (lum < threshold) texel *= 0.0;",
			"gl_FragColor = texel;",

		"}"

	].join("\n")

};

/**
 * @author miibond
 *
 * Full-screen tone-mapping shader based on http://www.graphics.cornell.edu/~jaf/publications/sig02_paper.pdf
 */

THREE.ToneMapShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"averageLuminance":  { type: "f", value: 1.0 },
		"luminanceMap":  { type: "t", value: null },
		"maxLuminance":  { type: "f", value: 16.0 },
		"middleGrey":  { type: "f", value: 0.6 }
	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"uniform float middleGrey;",
		"uniform float maxLuminance;",
		"#ifdef ADAPTED_LUMINANCE",
			"uniform sampler2D luminanceMap;",
		"#else",
			"uniform float averageLuminance;",
		"#endif",
		
		"const vec3 LUM_CONVERT = vec3(0.299, 0.587, 0.114);",

		"vec3 ToneMap( vec3 vColor ) {",
			"#ifdef ADAPTED_LUMINANCE",
				// Get the calculated average luminance 
				"float fLumAvg = texture2D(luminanceMap, vec2(0.5, 0.5)).r;",
			"#else",
				"float fLumAvg = averageLuminance;",
			"#endif",
			
			// Calculate the luminance of the current pixel
			"float fLumPixel = dot(vColor, LUM_CONVERT);",

			// Apply the modified operator (Eq. 4)
			"float fLumScaled = (fLumPixel * middleGrey) / fLumAvg;",

			"float fLumCompressed = (fLumScaled * (1.0 + (fLumScaled / (maxLuminance * maxLuminance)))) / (1.0 + fLumScaled);",
			"return fLumCompressed * vColor;",
		"}",

		"void main() {",

			"vec4 texel = texture2D( tDiffuse, vUv );",
			
			"gl_FragColor = vec4( ToneMap( texel.xyz ), texel.w );",
			//Gamma 2.0
			"gl_FragColor.xyz = sqrt( gl_FragColor.xyz );",

		"}"

	].join("\n")

};

/**
 * @author zz85 / http://www.lab4games.net/zz85/blog
 *
 * Triangle blur shader
 * based on glfx.js triangle blur shader
 * https://github.com/evanw/glfx.js
 *
 * A basic blur filter, which convolves the image with a
 * pyramid filter. The pyramid filter is separable and is applied as two
 * perpendicular triangle filters.
 */

THREE.TriangleBlurShader = {

	uniforms : {

		"texture": { type: "t", value: null },
		"delta":   { type: "v2", value:new THREE.Vector2( 1, 1 ) }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"#define ITERATIONS 10.0",

		"uniform sampler2D texture;",
		"uniform vec2 delta;",

		"varying vec2 vUv;",

		"float random( vec3 scale, float seed ) {",

			// use the fragment position for a different seed per-pixel

			"return fract( sin( dot( gl_FragCoord.xyz + seed, scale ) ) * 43758.5453 + seed );",

		"}",

		"void main() {",

			"vec4 color = vec4( 0.0 );",

			"float total = 0.0;",

			// randomize the lookup values to hide the fixed number of samples

			"float offset = random( vec3( 12.9898, 78.233, 151.7182 ), 0.0 );",

			"for ( float t = -ITERATIONS; t <= ITERATIONS; t ++ ) {",

				"float percent = ( t + offset - 0.5 ) / ITERATIONS;",
				"float weight = 1.0 - abs( percent );",

				"color += texture2D( texture, vUv + delta * percent ) * weight;",
				"total += weight;",

			"}",

			"gl_FragColor = color / total;",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Unpack RGBA depth shader
 * - show RGBA encoded depth as monochrome color
 */

THREE.UnpackDepthRGBAShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"opacity":  { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float opacity;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		// RGBA depth

		"float unpackDepth( const in vec4 rgba_depth ) {",

			"const vec4 bit_shift = vec4( 1.0 / ( 256.0 * 256.0 * 256.0 ), 1.0 / ( 256.0 * 256.0 ), 1.0 / 256.0, 1.0 );",
			"float depth = dot( rgba_depth, bit_shift );",
			"return depth;",

		"}",

		"void main() {",

			"float depth = 1.0 - unpackDepth( texture2D( tDiffuse, vUv ) );",
			"gl_FragColor = opacity * vec4( vec3( depth ), 1.0 );",

		"}"

	].join("\n")

};

/**
 * @author zz85 / http://www.lab4games.net/zz85/blog
 *
 * Two pass Gaussian blur filter (horizontal and vertical blur shaders)
 * - described in http://www.gamerendering.com/2008/10/11/gaussian-blur-filter-shader/
 *   and used in http://www.cake23.de/traveling-wavefronts-lit-up.html
 *
 * - 9 samples per pass
 * - standard deviation 2.7
 * - "h" and "v" parameters should be set to "1 / width" and "1 / height"
 */

THREE.VerticalBlurShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"v":        { type: "f", value: 1.0 / 512.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float v;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 sum = vec4( 0.0 );",

			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * v ) ) * 0.051;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * v ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * v ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * v ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * v ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * v ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * v ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * v ) ) * 0.051;",

			"gl_FragColor = sum;",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Simple fake tilt-shift effect, modulating two pass Gaussian blur (see above) by vertical position
 *
 * - 9 samples per pass
 * - standard deviation 2.7
 * - "h" and "v" parameters should be set to "1 / width" and "1 / height"
 * - "r" parameter control where "focused" horizontal line lies
 */

THREE.VerticalTiltShiftShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"v":        { type: "f", value: 1.0 / 512.0 },
		"r":        { type: "f", value: 0.35 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float v;",
		"uniform float r;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 sum = vec4( 0.0 );",

			"float vv = v * abs( r - vUv.y );",

			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * vv ) ) * 0.051;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * vv ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * vv ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * vv ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * vv ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * vv ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * vv ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * vv ) ) * 0.051;",

			"gl_FragColor = sum;",

		"}"

	].join("\n")

};

/**
 * @author alteredq / http://alteredqualia.com/
 *
 * Vignette shader
 * based on PaintEffect postprocess from ro.me
 * http://code.google.com/p/3-dreams-of-black/source/browse/deploy/js/effects/PaintEffect.js
 */

THREE.VignetteShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"offset":   { type: "f", value: 1.0 },
		"darkness": { type: "f", value: 1.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform float offset;",
		"uniform float darkness;",

		"uniform sampler2D tDiffuse;",

		"varying vec2 vUv;",

		"void main() {",

			// Eskil's vignette

			"vec4 texel = texture2D( tDiffuse, vUv );",
			"vec2 uv = ( vUv - vec2( 0.5 ) ) * vec2( offset );",
			"gl_FragColor = vec4( mix( texel.rgb, vec3( 1.0 - darkness ), dot( uv, uv ) ), texel.a );",

			/*
			// alternative version from glfx.js
			// this one makes more "dusty" look (as opposed to "burned")

			"vec4 color = texture2D( tDiffuse, vUv );",
			"float dist = distance( vUv, vec2( 0.5 ) );",
			"color.rgb *= smoothstep( 0.8, offset * 0.799, dist *( darkness + offset ) );",
			"gl_FragColor = color;",
			*/

		"}"

	].join("\n")

};

ShaderLibrary = {
    get: function(filename)
    {
        return ShaderLibrary[filename + ".glsl"];
    }
};
ShaderLibrary['floor_fragment.glsl'] = 'varying vec2 shadowUV;\nvarying vec3 viewPosition;\n\nuniform vec3 color;\nuniform float fogDensity;\nuniform vec3 fogColor;\n\nuniform sampler2D shadowMap;\n\n\nvoid main() {\n//    vec2 shadowUV = lightProj.xy / lightProj.w * .5 + .5;\n\n	vec4 shadow = texture2D( shadowMap, shadowUV );\n\n	float factor = shadowUV.y * 1.1;\n	shadow = mix(shadow, vec4(1.0), factor);\n\n	vec3 col = color * shadow.xyz;\n	float viewLen = length(viewPosition);\n	float fog = clamp(exp(-fogDensity * viewLen), 0.0, 1.0);\n\n	col = mix(fogColor, col, fog);\n	col = sqrt(col);\n\n    gl_FragColor = vec4(col, 1.0);\n}\n';

ShaderLibrary['floor_vertex.glsl'] = 'uniform mat4 lightMatrix;\n\nvarying vec3 viewPosition;\nvarying vec2 shadowUV;\n\nvoid main() {\n    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);\n    vec4 lightProj = lightMatrix * vec4(position, 1.0);\n    shadowUV = lightProj.xy / lightProj.w * .5 + .5;\n    // TODO: Figure out why this correction is necessary\n    shadowUV.y += .07;\n    gl_Position = projectionMatrix * viewPos;\n\n    viewPosition = viewPos.xyz;\n}';

ShaderLibrary['metal_fragment.glsl'] = '#define RECIPROCAL_PI2 0.15915494\n\nvarying vec3 worldPosition;\nvarying vec3 worldNormal;\nvarying vec2 texCoords;\n\nuniform float shininess;\nuniform vec3 color;\n\nuniform sampler2D envMap;\n\n#ifdef LOCAL_ENV_MAP\nuniform float skyboxSize;\n#endif\n\n#ifdef ALBEDO_MAP\nuniform sampler2D albedoMap;\n#endif\n\n#ifdef OCCLUSION_MAP\nuniform sampler2D occlusionMap;\n#endif\n\n#ifdef NORMAL_GLOSS_MAP\n\nuniform sampler2D normalGlossMap;\n\nvarying vec3 worldTangent;\nvarying vec3 worldBitangent;\n\nvec3 perturbNormal2Arb(vec3 normalSample ) {\n\n	vec3 S = normalize(worldBitangent);\n	vec3 T = normalize(worldTangent);\n	vec3 N = normalize(worldNormal);\n\n	vec3 mapN = normalSample * 2.0 - 1.0;\n	mat3 tsn = mat3( T, S, N );\n	return normalize( tsn * mapN );\n}\n\n#endif\n\nvec3 intersectCubeMap(vec3 rayOrigin, vec3 rayDir, float cubeSize)\n{\n    vec3 t = (cubeSize * sign(rayDir) - rayOrigin) / rayDir;\n    float minT = min(min(t.x, t.y), t.z);\n    return normalize(rayOrigin + minT * rayDir);\n}\n\nvoid main() {\n	float gloss = shininess;\n\n    #ifdef NORMAL_GLOSS_MAP\n    	vec4 normalGloss = texture2D( normalGlossMap, texCoords );\n    	vec3 normal = perturbNormal2Arb(normalGloss.xyz);\n    #else\n    	vec3 normal = normalize(worldNormal);\n    #endif\n\n    vec3 viewDir = normalize(cameraPosition - worldPosition);\n\n	vec3 refl = reflect(viewDir, normal);\n\n	#ifdef LOCAL_ENV_MAP\n	refl = intersectCubeMap(worldPosition, refl, skyboxSize);\n	#endif\n\n	vec2 envMapUV;\n	refl = -refl;\n	envMapUV.x = atan( refl.z, refl.x ) * RECIPROCAL_PI2 + 0.5;\n	envMapUV.y = refl.y * 0.5 + 0.5;\n	vec3 col = texture2D( envMap, envMapUV ).xyz;\n	col *= col;\n	#ifdef ENV_MAP_BRIGHTNESS\n	col *= ENV_MAP_BRIGHTNESS;\n	#endif\n\n	#ifdef ALBEDO_MAP\n		vec4 albedoSample = texture2D( albedoMap, texCoords );\n		vec3 albedo = albedoSample.xyz * color;\n	#else\n		vec3 albedo = color;\n	#endif\n\n	float angle = 1.0 - dot(viewDir, normal);\n	float fresnelFactor = angle * angle; // ^2\n	fresnelFactor *= fresnelFactor; // ^4\n	fresnelFactor *= angle; // ^5\n	vec3 fresnelReflection = albedo + (vec3(1.0) - albedo) * fresnelFactor;\n\n	col *= fresnelReflection;\n\n// will be handled by tonemap\n	col = sqrt(col);\n\n#ifdef OCCLUSION_MAP\n	vec4 occlusionSample = texture2D( occlusionMap, texCoords );\n	col *= occlusionSample.xyz;\n#endif\n\n    gl_FragColor = vec4(col, 1.0);\n}\n';

ShaderLibrary['metal_vertex.glsl'] = 'varying vec3 worldPosition;\nvarying vec3 worldNormal;\nvarying vec2 texCoords;\n\n#ifdef NORMAL_GLOSS_MAP\nattribute vec4 tangent;\n\nvarying vec3 worldTangent;\nvarying vec3 worldBitangent;\n#endif\n\n#ifdef USE_SKINNING\n	uniform mat4 bindMatrix;\n	uniform mat4 bindMatrixInverse;\n\n    uniform mat4 boneGlobalMatrices[ MAX_BONES ];\n\n    mat4 getBoneMatrix( const in float i ) {\n        mat4 bone = boneGlobalMatrices[ int(i) ];\n        return bone;\n    }\n#endif\n\nuniform vec2 texOffset;\n\n\nvoid main() {\n#ifdef USE_SKINNING\n\n	vec4 skinVertex = bindMatrix * vec4( position, 1.0 );\n\n	mat4 boneMatX = getBoneMatrix( skinIndex.x );\n    mat4 boneMatY = getBoneMatrix( skinIndex.y );\n    mat4 boneMatZ = getBoneMatrix( skinIndex.z );\n    mat4 boneMatW = getBoneMatrix( skinIndex.w );\n\n    mat4 skinMatrix = mat4( 0.0 );\n	skinMatrix += skinWeight.x * boneMatX;\n	skinMatrix += skinWeight.y * boneMatY;\n	skinMatrix += skinWeight.z * boneMatZ;\n	skinMatrix += skinWeight.w * boneMatW;\n	skinMatrix  = bindMatrixInverse * skinMatrix * bindMatrix;\n	vec4 skinned  = skinMatrix * vec4( position, 1.0);\n	vec3 skinnedNormal = (skinMatrix * vec4( normal, 0.0 )).xyz;\n	#ifdef NORMAL_GLOSS_MAP\n	vec3 skinnedTangent = (skinMatrix * vec4( tangent.xyz, 0.0 )).xyz;\n	#endif\n\n#else\n    vec4 skinned = vec4(position, 1.0);\n    vec3 skinnedNormal = normal;\n    #ifdef NORMAL_GLOSS_MAP\n    vec3 skinnedTangent = tangent.xyz;\n    #endif\n#endif\n\n    worldPosition = (modelMatrix * skinned).xyz;\n    worldNormal = mat3(modelMatrix) * skinnedNormal;\n    gl_Position = projectionMatrix * modelViewMatrix * skinned;\n    texCoords = uv + texOffset;\n\n#ifdef NORMAL_GLOSS_MAP\n    worldTangent = mat3(modelMatrix) * skinnedTangent;\n    worldBitangent = normalize( cross( worldTangent, worldNormal ) * tangent.w );\n#endif\n}';

ShaderLibrary['shadow_fragment.glsl'] = 'void main()\n{\n    // there\'s no need to render anything else but colour, since caster and receiver are completely separate\n    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\n}\n';

ShaderLibrary['shadow_vertex.glsl'] = 'varying vec4 proj;\n\nvoid main() {\n    proj = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n    gl_Position = proj;\n}';

ShaderLibrary['default_post_vertex.glsl'] = 'varying vec2 vUv;\n\nvoid main()\n{\n    gl_Position = vec4( position, 1.0 );\n    vUv = uv;\n}';

ShaderLibrary['filmic_tonemapping_fragment.glsl'] = 'uniform sampler2D tDiffuse;\n\nvarying vec2 vUv;\n\nuniform float exposure;\n\nvoid main() {\n    vec4 color = texture2D(tDiffuse, vUv) * exposure;\n\n    // Jim Hejl and Richard Burgess-Dawson\n    vec3 x = max(vec3(0.0), color.xyz - 0.004);\n\n    float a = 6.2;\n    float b = .5;\n    float c = 6.2;\n    float d = 1.7;\n    float e = 0.06;\n\n    gl_FragColor = vec4(clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0), 1.0);\n}';

FloorMaterial = function(options)
{
    var defines = "";
    options = options || {};

    if (options.color) {
        options.color = new THREE.Color(options.color);
        if (!options.colorIsLinear)
            options.color.convertGammaToLinear();
    }

    var materialUniforms =
    {
        "lightMatrix": {
            type: "m4",
            value: new THREE.Matrix4()
        },
        "color": {
            type: "c",
            value: options.color
        },
        "fogColor": {
            type: "c",
            value: options.fogColor? options.fogColor : new THREE.Color(1, 1, 1)
        },
        "fogDensity": {
            type: "f",
            value: options.fogDensity === undefined? .01 : options.fogDensity
        },
        "shadowMap": {
            type: "t",
            value: options.shadowMap
        }
    };

    THREE.ShaderMaterial.call(this,
        {
            uniforms: materialUniforms,

            vertexShader: defines + ShaderLibrary.get("floor_vertex"),
            fragmentShader: defines + ShaderLibrary.get("floor_fragment")
        }
    );

    this.uniforms["shadowMap"].value = options.shadowMap;
};

FloorMaterial.prototype = Object.create( THREE.ShaderMaterial.prototype );
MetalMaterial = function(options)
{
    var defines = "";
    options = options || {};

    if (options.map) defines += "#define ALBEDO_MAP\n";
    if (options.occlusionMap) defines += "#define OCCLUSION_MAP\n";
    if (options.normalMap) defines += "#define NORMAL_GLOSS_MAP\n";
    if (options.skyboxSize) defines += "#define LOCAL_ENV_MAP\n";
    if (options.envMapExposure) defines += "#define ENV_MAP_BRIGHTNESS float(" + Math.pow(2, options.envMapExposure) + ")\n";

    this.useSpotsAsPoints = !!options.useSpotsAsPoints;

    if (options.color) {
        options.color = new THREE.Color(options.color);
        if (!options.colorIsLinear)
            options.color.convertGammaToLinear();
    }

    var materialUniforms =
    {
        "color": {
            type: "c",
            value: options.color
        },
        "skyboxSize": {
            type: "f",
            value: options.skyboxSize === undefined? 0.0: options.skyboxSize
        },
        "envMap": {
            type: "t",
            value: options.envMap
        },
        "normalGlossMap": {
            type: "t",
            value: options.normalMap
        },
        "albedoMap": {
            type: "t",
            value: options.map
        },
        "occlusionMap": {
            type: "t",
            value: options.occlusionMap
        },
        "shininess": {
            type: "f",
            value: options.shininess === undefined? 20 : options.shininess
        }
    };

    THREE.ShaderMaterial.call(this,
        {
            uniforms: materialUniforms,

            vertexShader: defines + ShaderLibrary.get("metal_vertex"),
            fragmentShader: defines + ShaderLibrary.get("metal_fragment")
        }
    );

    this.uniforms["normalGlossMap"].value = options.normalMap;
    this.uniforms["albedoMap"].value = options.map;
    this.uniforms["occlusionMap"].value = options.occlusionMap;
    this.uniforms["envMap"].value = options.envMap;
};

MetalMaterial.prototype = Object.create( THREE.ShaderMaterial.prototype );
/**
 * @author zz85 / http://www.lab4games.net/zz85/blog
 *
 * Two pass Gaussian blur filter (horizontal and vertical blur shaders)
 * - described in http://www.gamerendering.com/2008/10/11/gaussian-blur-filter-shader/
 *   and used in http://www.cake23.de/traveling-wavefronts-lit-up.html
 *
 * - 9 samples per pass
 * - standard deviation 2.7
 * - "h" and "v" parameters should be set to "1 / width" and "1 / height"
 */

THREE.ShadowHorizontalBlurShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"h":        { type: "f", value: 1.0 / 512.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float h;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 sum = vec4( 0.0 );",
			"float h2 = h * vUv.y;",

			"sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * h2, vUv.y ) ) * 0.051;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * h2, vUv.y ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * h2, vUv.y ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * h2, vUv.y ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * h2, vUv.y ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * h2, vUv.y ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * h2, vUv.y ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * h2, vUv.y ) ) * 0.051;",

			"gl_FragColor = sum;",

		"}"

	].join("\n")

};

ShadowMaterial = function(options)
{
    var defines = "";
    options = options || {};

    var materialUniforms =
    {
    };

    THREE.ShaderMaterial.call(this,
        {
            uniforms: materialUniforms,

            vertexShader: defines + ShaderLibrary.get("shadow_vertex"),
            fragmentShader: defines + ShaderLibrary.get("shadow_fragment"),
        }
    );
};

ShadowMaterial.prototype = Object.create( THREE.ShaderMaterial.prototype );
function ShadowRenderer(scene, renderer, resolutionH, resolutionV)
{
    // this renders a fake very soft shadow map over a couple of frames
    resolutionH = resolutionH || 128;
    resolutionV = resolutionV || 64;

    // TODO: We could store depth in shadow map alpha, and use it for blurring
    // (using abs(depth - storedDepth)

    this.shadowMap = new THREE.WebGLRenderTarget( resolutionH, resolutionV,
        {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            stencilBuffer: false
        });

    var lightCamera = new THREE.PerspectiveCamera(5, 1, .1, 100.0);
    var shadowMaterial = new ShadowMaterial();

    this.lightMatrix = new THREE.Matrix4();
    lightCamera.position.set(0.0, .8, -50.0);
    lightCamera.lookAt(new THREE.Vector3(0.0, 1.0, 0.0));
    lightCamera.updateProjectionMatrix();
    lightCamera.updateMatrixWorld();
    lightCamera.matrixWorldInverse.getInverse(lightCamera.matrixWorld);
    this.lightMatrix.multiplyMatrices(lightCamera.projectionMatrix, lightCamera.matrixWorldInverse);


    var renderPass = new THREE.RenderPass(scene, lightCamera, shadowMaterial);
    renderPass.clearColor = new THREE.Color(1, 1, 1);

    this.effectComposer = new THREE.EffectComposer(renderer, this.shadowMap);
    this.effectComposer.addPass(renderPass);

    var hBlur = new THREE.ShaderPass(THREE.ShadowHorizontalBlurShader);
    var vBlur = new THREE.ShaderPass(THREE.ShadowVerticalBlurShader);
    hBlur.uniforms["h"].value = 1/resolutionH;
    vBlur.uniforms["v"].value = 1/resolutionV;


    this.effectComposer.addPass(hBlur);
    this.effectComposer.addPass(vBlur);
    this.effectComposer.addPass(vBlur);

    var hBlur = new THREE.ShaderPass(THREE.HorizontalBlurShader);
    var vBlur = new THREE.ShaderPass(THREE.VerticalBlurShader);
    hBlur.uniforms["h"].value = 1/resolutionH;
    vBlur.uniforms["v"].value = 1/resolutionV;

    this.effectComposer.addPass(hBlur);
    this.effectComposer.addPass(vBlur);
}

ShadowRenderer.prototype =
{
    // only one casting model
    // renderables is a hack to replace materials
    render: function()
    {
        this.effectComposer.render(1/60);
    }
};
/**
 * @author zz85 / http://www.lab4games.net/zz85/blog
 *
 * Two pass Gaussian blur filter (horizontal and vertical blur shaders)
 * - described in http://www.gamerendering.com/2008/10/11/gaussian-blur-filter-shader/
 *   and used in http://www.cake23.de/traveling-wavefronts-lit-up.html
 *
 * - 9 samples per pass
 * - standard deviation 2.7
 * - "h" and "v" parameters should be set to "1 / width" and "1 / height"
 */

THREE.ShadowVerticalBlurShader = {

	uniforms: {

		"tDiffuse": { type: "t", value: null },
		"v":        { type: "f", value: 1.0 / 512.0 }

	},

	vertexShader: [

		"varying vec2 vUv;",

		"void main() {",

			"vUv = uv;",
			"gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",

		"}"

	].join("\n"),

	fragmentShader: [

		"uniform sampler2D tDiffuse;",
		"uniform float v;",

		"varying vec2 vUv;",

		"void main() {",

			"vec4 sum = vec4( 0.0 );",
			"float v2 = v * vUv.y;",

			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * v2 ) ) * 0.051;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * v2 ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * v2 ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * v2 ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * v2 ) ) * 0.1531;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * v2 ) ) * 0.12245;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * v2 ) ) * 0.0918;",
			"sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * v2 ) ) * 0.051;",

			"gl_FragColor = sum;",

		"}"

	].join("\n")

};

OrbitController = function(target, lookAtTarget)
{
    this._coords = new THREE.Vector3(-Math.PI *.75, Math.PI * .4, 1.0);   // azimuth, polar, radius
    this._localAcceleration = new THREE.Vector3(0.0, 0.0, 0.0);
    this._localVelocity = new THREE.Vector3(0.0, 0.0, 0.0);

    this.maxRadius = 10.0;
    this.minRadius = 1.0;
    this.dampen = .9;
    this._lookAtTarget = lookAtTarget || new THREE.Vector3(0.0, 0.0, 0.0);
    this._oldMouseX = 0;
    this._oldMouseY = 0;
    this._target = target;
    this._target.matrixAutoUpdate = false;
    this._onMouseWheel = null;
    this._onMouseMove = null;
    this._init();
};

OrbitController.prototype =
{
    get radius()
    {
        return this._coords.z;
    },
    set radius(value)
    {
        this._coords.z = value;
    },

    get azimuth()
    {
        return this._coords.x;
    },
    set azimuth(value)
    {
        this._coords.x = value;
    },

    get polar()
    {
        return this._coords.y;
    },
    set polar(value)
    {
        this._coords.y = value;
    },

    _init: function ()
    {
        var self = this;

        this._onMouseWheel = function (event)
        {
            self.setZoomImpulse(-event.wheelDelta * .0001);
        };

        this._onMouseMove = function (event)
        {
            var leftDown = event.buttons & 1;
            if (leftDown) {
                // it's not a continuous force
                var dx = event.screenX - this._oldMouseX;
                var dy = event.screenY - this._oldMouseY;
                self.setAzimuthImpulse(dx * .005);
                self.setPolarImpulse(-dy * .005);
            }
            this._oldMouseX = event.screenX;
            this._oldMouseY = event.screenY;
        };

        document.addEventListener("mousewheel", this._onMouseWheel);
        document.addEventListener("mousemove", this._onMouseMove);
    },

    update: function (dt)
    {
        this._localVelocity.x *= this.dampen;
        this._localVelocity.y *= this.dampen;
        this._localVelocity.z *= this.dampen;
        this._localVelocity.x += this._localAcceleration.x;
        this._localVelocity.y += this._localAcceleration.y;
        this._localVelocity.z += this._localAcceleration.z;
        this._localAcceleration.x = 0.0;
        this._localAcceleration.y = 0.0;
        this._localAcceleration.z = 0.0;

        this._coords.add(this._localVelocity);
        this._coords.y = THREE.Math.clamp(this._coords.y, 0.1, Math.PI - .1);
        this._coords.z = THREE.Math.clamp(this._coords.z, this.minRadius, this.maxRadius);

        var matrix = this._target.matrix;
        var pos = this._fromSphericalCoordinates(this._coords.z, this._coords.x, this._coords.y);
        pos.add(this._lookAtTarget);
        matrix.lookAt(pos, this._lookAtTarget, new THREE.Vector3(0, 1, 0));
        matrix.setPosition(pos);

        this._target.matrixWorldNeedsUpdate = true;
    },

    _fromSphericalCoordinates: function(radius, azimuthalAngle, polarAngle)
    {
        var v = new THREE.Vector3();
        v.x = radius*Math.sin(polarAngle)*Math.cos(azimuthalAngle);
        v.y = radius*Math.cos(polarAngle);
        v.z = radius*Math.sin(polarAngle)*Math.sin(azimuthalAngle);
        return v;
    },

// ratio is "how far the controller is pushed", from -1 to 1
    setAzimuthImpulse: function (value)
    {
        this._localAcceleration.x = value;
    },

    setPolarImpulse: function (value)
    {
        this._localAcceleration.y = value;
    },

    setZoomImpulse: function (value)
    {
        this._localAcceleration.z = value;
    }
};
FilmicTonemapShader = {
    uniforms: {

        "tDiffuse":   { type: "t", value: null },
        "exposure": { type: "f", value: 1.0 }   // this should be 2 ^ stop

    },

    vertexShader: ShaderLibrary.get("default_post_vertex"),

    fragmentShader: ShaderLibrary.get("filmic_tonemapping_fragment")
};
var scene;
var camera;
var renderer;
var container;
var stats;
var cameraController;
var light;
//var skyboxIrradianceMap;    // in reverse order of roughness
var skyboxSpecularMaps = [];    // in reverse order of roughness
var ringMaterial;
var rings = [];
var visibleRing;
var effectsComposer;
var fxaaPass;
var hdrRenderTarget;
var useHDR;
var shadowRenderer;
var floor;
var shadowsInvalid = false;
var backgroundColor = new THREE.Color(0xf0f0f0);
var backgroundColorGamma = new THREE.Color();
backgroundColorGamma.copyLinearToGamma(backgroundColor);


function initHDRTarget()
{
    var parameters = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: false };

    var extensions = new THREE.WebGLExtensions( renderer.getContext() );

    if ( extensions.get('OES_texture_half_float_linear') ) {
        parameters.type = THREE.FloatType;
        useHDR = true;
        hdrRenderTarget = new THREE.WebGLRenderTarget( window.innerWidth, window.innerHeight, parameters );
    }
    else
        useHDR = false;
}

function initThree()
{
    renderer = new THREE.WebGLRenderer({ antialias: true } );
    renderer.setClearColor(backgroundColorGamma);

    initHDRTarget();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    camera.near = .1;
    camera.far = 100.0;
    cameraController = new OrbitController(camera, new THREE.Vector3(0,.9, 0));
    cameraController.radius = 4.0;
    scene.add(camera);

    shadowRenderer = new ShadowRenderer(scene, renderer);

    container = document.createElement('div');
    document.body.insertBefore(container, document.body.lastChild);

    //renderer.domElement.style.position = "relative";
    container.appendChild(renderer.domElement);

    stats = new Stats();
    stats.domElement.style.position = 'absolute';
    stats.domElement.style.top = '0px';
    stats.domElement.style.zIndex = 100;
    container.appendChild(stats.domElement);

    window.addEventListener('resize', onWindowResize, false);
    resizeCanvas();
}

function initPostProcessing()
{
    fxaaPass = new THREE.ShaderPass( THREE.FXAAShader );

    var bloom = new THREE.BloomPass(1.0, 1.5, 25, 8.0);

    var tonemapPass = new THREE.ShaderPass( FilmicTonemapShader );
    //var tonemapPass = new THREE.AdaptiveToneMappingPass(false);
    //tonemapPass.setAverageLuminance(.1);
    //tonemapPass.setMaxLuminance( 8.0 );
    //tonemapPass.setMiddleGrey( .04 );

    var gammaCorrectionPass = new THREE.ShaderPass( THREE.GammaCorrectionShader );
    var postEffects;
    //if (useHDR)
    //    postEffects = [ bloom, fxaaPass, tonemapPass/*, gammaCorrectionPass*/ ];
    //else
        postEffects = [ bloom, fxaaPass/*, gammaCorrectionPass*/ ];



    if (postEffects && postEffects.length > 0) {
        var renderScene = new THREE.RenderPass(scene, camera);
        effectsComposer = new THREE.EffectComposer(renderer, hdrRenderTarget);
        effectsComposer.addPass(renderScene);

        for (var i = 0; i < postEffects.length; ++i) {
            effectsComposer.addPass(postEffects[i]);
        }

        postEffects[i-1].renderToScreen = true;
    }
}

function onWindowResize()
{
    resizeCanvas();
}

function resizeCanvas()
{
    var width = window.innerWidth;
    var height = window.innerHeight;
    renderer.setSize(width, height);
    renderer.domElement.style.width = width + "px";
    renderer.domElement.style.height = height + "px";
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    if (effectsComposer)
        effectsComposer.setSize(width, height);

    if (fxaaPass)
        fxaaPass.uniforms['resolution'].value.set(1 / width, 1 / height);

    if (hdrRenderTarget)
        hdrRenderTarget.setSize(width, height);
}

function initSkyboxes()
{
    skyboxSpecularMaps[0] = THREE.ImageUtils.loadTexture( "./assets/textures/env/Photo-studio-with-umbrella_panorama_specular_0.png");
    skyboxSpecularMaps[1] = THREE.ImageUtils.loadTexture( "./assets/textures/env/Photo-studio-with-umbrella_panorama_specular_1.png");
    skyboxSpecularMaps[2] = THREE.ImageUtils.loadTexture( "./assets/textures/env/Photo-studio-with-umbrella_panorama_specular_2.png");
    skyboxSpecularMaps[3] = THREE.ImageUtils.loadTexture( "./assets/textures/env/Photo-studio-with-umbrella_panorama_specular_3.png");
    skyboxSpecularMaps[4] = THREE.ImageUtils.loadTexture( "./assets/textures/env/Photo-studio-with-umbrella_panorama_specular_4.png");
    //skyboxIrradianceMap = THREE.ImageUtils.loadTexture( "./assets/textures/env/Photo-studio-with-umbrella_panorama_irradiance.png");

    for (var i = 0; i < skyboxSpecularMaps.length; ++i) {
        skyboxSpecularMaps[i].wrapS = THREE.RepeatWrapping;
        skyboxSpecularMaps[i].wrapT = THREE.RepeatWrapping;
        // somehow, mipmapping doesn't work on panorama
        skyboxSpecularMaps[i].minFilter = THREE.LinearFilter;
    }

    //skyboxIrradianceMap.wrapS = THREE.RepeatWrapping;
    //skyboxIrradianceMap.wrapT = THREE.RepeatWrapping;
    //skyboxIrradianceMap.minFilter = THREE.LinearFilter;
}

function initMaterial()
{
    ringMaterial = new MetalMaterial(
        {
            // gold:
            color: new THREE.Color(1, 0.765557, 0.336057),
            // silver:
            //color: new THREE.Color(0.971519, 0.959915, 0.915324),
            envMap: skyboxSpecularMaps[1],
            envMapExposure: 3,
            // 3 meters
            skyboxSize: 100.0
        }
    );
}

function initTorus()
{
    var tubeRadius = .1;
    var geometry = new THREE.TorusGeometry( .9, tubeRadius, 16, 100 );

    var torus = new THREE.Mesh(geometry, ringMaterial);
    torus.castShadow = true;
    // TODO: stand on end and generate nice AO
    //torus.rotation.x = -.7; Math.PI * .5;
    //torus.position.y = .9 + tubeRadius;
    torus.rotation.x = -.7;
    torus.position.y = .9;
    torus.receiveShadow = true;
    return torus;
}

function initRing(filename, index)
{
    var loader = new THREE.JSONLoader();
    loader.load("./assets/models/" + filename,
        function(geometry, materials ) {
            var ring = new THREE.Mesh(geometry, ringMaterial);
            ring.geometry = geometry;
            ring.scale.set(.1,.1,.1);
            ring.rotation.x = -.7;
            ring.position.y = .9;
            rings[index] = ring;
            if (!visibleRing) showRing(index);
        }
    );
}

function initFloor()
{
    var geometry = new THREE.PlaneBufferGeometry( 300.0, 300.0, 10, 10 );
    /*var material = new FloorMaterial(
        {
            color: 0xffffff,
            color: 0xf0f0f0,
            ringRadius:.9
            //skyboxSize: 100.0
            //envMap: skyboxIrradianceMap,
            //envMapExposure: 3
        }
    );*/
    var material = new FloorMaterial(
        {
            color: new THREE.Color(0xdddddd),
            shadowMap: shadowRenderer.shadowMap,
            fogColor: backgroundColor,
            fogDensity:.05
        });
    floor = new THREE.Mesh(geometry, material);
    floor.castShadow = false;
    floor.receiveShadow = true;
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
}

function initScene()
{
    initSkyboxes();
    initMaterial();
    rings[0] = initTorus();
    initRing("Arizona.json", 1, true);
    initRing("Delaware.json", 2);
    initRing("Georgia.json", 3);
    initRing("Idaho.json", 4);
    initFloor();
}

function renderShadows()
{
    floor.visible = false;
    shadowRenderer.render();
    floor.visible = true;

    floor.material.uniforms["lightMatrix"].value = shadowRenderer.lightMatrix;
}

function render()
{
    requestAnimationFrame(render);

    if (shadowsInvalid)
        renderShadows();

    cameraController.update();
    //renderer.render(scene, camera);
    if (effectsComposer)
        effectsComposer.render( 1 / 60 );
    else
        renderer.render(scene, camera);

    stats.update();
}

window.onload = function()
{
    initThree();
    initScene();
    initPostProcessing();
    requestAnimationFrame(render);
};

function setRingColor(r, g, b)
{
    // gamma gamma hey!
    r *= r;
    g *= g;
    b *= b;
    ringMaterial.uniforms["color"].value = new THREE.Color(r, g, b);
}

function setSkybox(index)
{
    ringMaterial.uniforms["envMap"].value = skyboxSpecularMaps[index];
}

function showRing(index)
{
    if (!rings[index] || visibleRing === rings[index]) return;

    if (visibleRing) scene.remove(visibleRing);
    visibleRing = rings[index];
    shadowsInvalid = true;
    scene.add(visibleRing);
}