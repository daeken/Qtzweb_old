(function() {
    var lastTime = 0;
    var vendors = ['ms', 'moz', 'webkit', 'o'];
    for(var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x]+'CancelAnimationFrame'] 
                                   || window[vendors[x]+'CancelRequestAnimationFrame'];
    }
 
    if (!window.requestAnimationFrame)
        window.requestAnimationFrame = function(callback, element) {
            var currTime = new Date().getTime();
            var timeToCall = Math.max(0, 16 - (currTime - lastTime));
            var id = window.setTimeout(function() { callback(currTime + timeToCall); }, 
              timeToCall);
            lastTime = currTime + timeToCall;
            return id;
        };
 
    if (!window.cancelAnimationFrame)
        window.cancelAnimationFrame = function(id) {
            clearTimeout(id);
        };
}());

// From http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
function hslToRgb(h, s, l, a){
    var r, g, b;

    if(s == 0){
        r = g = b = l; // achromatic
    }else{
        function hue2rgb(p, q, t){
            if(t < 0) t += 1;
            if(t > 1) t -= 1;
            if(t < 1/6) return p + (q - p) * 6 * t;
            if(t < 1/2) return q;
            if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        }

        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    return [r, g, b, a];
}

function degrad(angle) {
  return angle * Math.PI / 180;
}

function color(x, components) {
  if(components == 3)
    return [x.red || x[0] || x, x.green || x[1] || x, x.blue || x[2] || x];
  else
    return [x.red || x[0] || x, x.green || x[1] || x, x.blue || x[2] || x, x.alpha || x[3] || 1.0];
}

function interp(a, b, mix, type) {
  if(a == b)
    return a;
  switch(type) {
    case 0:
      return (b - a) * mix + a;
    default:
      throw 'Unknown interpolation: ' + type;
  }
}

function QCPatch() {
  this.nodes = {};
  this.params = {}

  this.update = function(sub) {
    if(sub !== undefined)
      this.updater = sub;
    else if(this.params._enable !== false)
      this.updater();
  }
}

function QCLighting(subpatch, params) {
  this.subpatch = subpatch;
  this.params = params;

  this.update = function() {
    if(this.params._enable === false)
      return;

    QCLighting.stack.push(QCLighting.current);
    QCLighting.current = this;
    this.register();
    this.subpatch.update();
    QCLighting.current = QCLighting.stack.pop();
    if(QCLighting.current)
      QCLighting.current.register();
    else
      gl.uniform1i(gl.program.useLighting, false);
  }

  this.register = function() {
    with(this.params) {
      gl.uniform1i(gl.program.useLighting, true);
      gl.uniform3fv(gl.program.ambientColor, color(AmbientColor, 3));
      gl.uniform1f(gl.program.specular, ObjectSpecular);
      gl.uniform1f(gl.program.shininess, ObjectShininess);
      // XXX: Support lightcount != 1
      gl.uniform3f(gl.program.lightPosition, positionX_1, positionY_1, positionZ_1);
      gl.uniform3fv(gl.program.lightColor, color(color_1, 3));
    }
  }
}
QCLighting.stack = [];

function QCTime(params) {
  this.outs = {};

  this.update = function() {
    this.outs.Time = time;
  }
}

function QCMath(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    var value = this.params.Value;
    for(var i = 1, count = this.params.OperationCount+1; i < count; ++i) {
      var operand = this.params['operand_' + i];
      switch(this.params['operation_' + i]) {
        case 0:
          value += operand;
          break;
        case 1:
          value -= operand;
          break;
        case 2:
          value *= operand;
          break;
        case 3:
          value /= operand;
          break;
        case 4:
          value %= operand;
          break;
      }
    }
    this.outs.Value = value;
  }
}

function QCInterpolation(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    with(this.params)
      switch(Repeat) {
        case 0: // None
          if(time < Duration) {
            this.outs.Value = interp(Value1, Value2, time / Duration, Interpolation);
          } else
            this.outs.Value = this.params.Value2;
          break;
        case 1: // Loop
          var comp = (time % this.params.Duration) / this.params.Duration;
          this.outs.Value = interp(Value1, Value2, comp, Interpolation);
          break;
        case 2: // Mirrored loop
          var comp = time % (this.params.Duration * 2);
          if(comp >= this.params.Duration) {
            comp -= this.params.Duration;
            comp = this.params.Duration - comp;
          }
          comp /= this.params.Duration;
          this.outs.Value = interp(Value1, Value2, comp, Interpolation);
          break;
        case 3: // Mirrored loop once
          if(time < this.params.Duration * 2) {
            var comp = time;
            if(comp >= this.params.Duration) {
              comp -= this.params.Duration;
              comp = this.params.Duration - comp;
            }
            comp /= this.params.Duration;
            this.outs.Value = interp(Value1, Value2, comp, Interpolation);
          } else
            this.outs.Value = this.params.Value1;
          break;
      }
  }
}

function QCLFO(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    with(this.params)
      switch(Type) {
        case 0: // Sin
          this.outs.Value = Math.sin(time / Period * 2 * Math.PI + degrad(Phase)) * Amplitude + Offset;
          break;
        case 1: // Cos
          this.outs.Value = Math.cos(time / Period * 2 * Math.PI + degrad(Phase)) * Amplitude + Offset;
          break;
      }
  }
}

function QCCamera(subpatch, params) {
  this.subpatch = subpatch;
  this.params = params;

  this.update = function() {
    with(this.params) {
      gl.push();

      // rotation around an origin point, followed by translation, followed by scale around an origin point.
      mat4.scale(gl.mvMatrix, [ScaleX, ScaleY, ScaleZ]);

      mat4.translate(gl.mvMatrix, [TranslateX, TranslateY, TranslateZ]);

      mat4.rotate(gl.mvMatrix, degrad(RotateX), [1, 0, 0]);
      mat4.rotate(gl.mvMatrix, degrad(RotateY), [0, 1, 0]);
      mat4.rotate(gl.mvMatrix, degrad(RotateZ), [0, 0, 1]);
      
      mat4.translate(gl.mvMatrix, [OriginX, OriginY, OriginZ]);

      this.subpatch.update();
      gl.pop();
    }
  }
}

function QCClear(params) {
  this.params = params;

  this.update = function() {
    var c = color(this.params.Color);
    gl.clearColor(c[0], c[1], c[2], c[3]);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  }
}

function QCSplitter(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    this.outs.output = this.params.input;
  }
}

function QCColorFromComponents(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    var elems = [this.params._1, this.params._2, this.params._3, this.params.Alpha];
    switch(this.params._format) {
      case 'hsl':
        this.outs.Color = hslToRgb(elems[0], elems[1], elems[2], elems[3]);
        break;
      case 'rgb':
        this.outs.Color = elems;
        break;
    }
  }
}

// sin(), cos(), tan(), asin(), acos(), atan(), atan2(), sinh(), cosh(), tanh(), exp(),
// ln(), log(), abs(), sqrt(), ceil(), floor(), min(), max(), rand(), fmod(), and round().
var degmath = {
  abs: Math.abs,
  sin: function(x) { return Math.sin(degrad(x)); }, 
  fmod: function(x, m) { return x % m; }, 
  cos: function(x) { return Math.cos(degrad(x)); }, 
  atan: Math.atan, 
};

function QCExpression(params) {
  this.params = params;
  this.outs = {};

  this.update = new Function('with(this.params) with(degmath) this.outs.Result = ' + params.Expression);
}

function QCColorMixer(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    var a = color(this.params.Color1);
    var b = color(this.params.Color2);
    this.outs.Color = [
      interp(a[0], b[0], this.params.Mix, this.params.Interpolation), 
      interp(a[1], b[1], this.params.Mix, this.params.Interpolation), 
      interp(a[2], b[2], this.params.Mix, this.params.Interpolation), 
      interp(a[3], b[3], this.params.Mix, this.params.Interpolation)
    ];
  }
}

function QCReplicator(subpatch, params) {
  this.subpatch = subpatch;
  this.params = params;

  this.update = function() {
    with(this.params)
      for(var i = 0; i < Copies; ++i) {
        var comp = i / (Copies - 1);
        gl.push();
        var scale = (Scale - 1.0) * comp + 1.0;
        mat4.scale(gl.mvMatrix, [scale, scale, scale]);

        mat4.translate(gl.mvMatrix, [TranslationX * comp, TranslationY * comp, TranslationZ * comp]);

        mat4.rotate(gl.mvMatrix, degrad(RotationX * comp), [1, 0, 0]);
        mat4.rotate(gl.mvMatrix, degrad(RotationY * comp), [0, 1, 0]);
        mat4.rotate(gl.mvMatrix, degrad(RotationZ * comp), [0, 0, 1]);
        
        mat4.translate(gl.mvMatrix, [OriginX, OriginY, OriginZ]);

        mat4.rotate(gl.mvMatrix, degrad(OrientationX * comp), [1, 0, 0]);
        mat4.rotate(gl.mvMatrix, degrad(OrientationY * comp), [0, 1, 0]);
        mat4.rotate(gl.mvMatrix, degrad(OrientationZ * comp), [0, 0, 1]);

        this.subpatch.update();
        gl.pop();
      }
  }
}

function QCIterator(subpatch, params) {
  this.subpatch = subpatch;
  this.params = params;

  this.update = function() {
    var count = this.subpatch.Count = ~~this.params.Count;
    
    for(var i = 0; i < count; ++i) {
      this.subpatch.Index = i;
      this.subpatch.Position = i / (count - 1);
      this.subpatch.update();
    }
  }
}

function QCDemultiplexer(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    with(this.params) {
      switch(PortClass) {
        case 'QCBooleanPort':
          if(ResetOutputs)
            for(var i = 0; i < OutputCount; ++i)
              this.outs['destination_' + i] = Reset;
          this.outs['destination_' + (~~Index)] = input;
          break;
      }
    }
  }
}

function QCJavaScript(func, params) {
  this.params = params;
  this.outs = {};
  this.func = func;

  this.update = function() {
    this.outs = this.func(this.params);
  };
}

function QCConditional(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    with(this.params) {
      var diff = Value2 - Value1;
      switch(Test) {
        case 0: // Is Equal
          this.outs.Result = Math.abs(diff) <= Tolerance;
          break;
        case 1: // Is Not Equal
          this.outs.Result = Math.abs(diff) > Tolerance;
          break;
        case 2: // Is Greater Than
          this.outs.Result = Value1 > Value2 - Tolerance;
          break;
        case 3: // Is Lower Than
          this.outs.Result = Value1 < Value2 + Tolerance;
          break;
        case 4: // Is Greater Than or Equal To
          this.outs.Result = Value1 >= Value2 - Tolerance;
          break;
        case 5: // Is Lower Than or Equal To
          this.outs.Result = Value1 <= Value2 + Tolerance;
          break;
      }
    }
  }
}

function QCSprite(params) {
  this.params = params;
  this.outs = {};
  
  this.update = function() {
    with(this.params) {
      if(this.elem === undefined) {
        this.elem = document.createElement('span');
        document.body.appendChild(this.elem);
        this.elem.innerHTML = this.params.Image.String;
      }
    }
  }
}

function QCLogic(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    with(this.params) {
      switch(Operation) {
        case 0: // AND
          this.outs.Result = Value1 && Value2;
          break;
        case 1: // OR
          this.outs.Result = Value1 || Value2;
          break;
        case 2: // XOR
          this.outs.Result = (Value1 || Value2) && !(Value1 && Value2);
          break;
        case 3: // NOT
          this.outs.Result = !Value1;
          break;
        case 4: // NAND
          this.outs.Result = !(Value1 && Value2);
          break;
        case 5: // NOR
          this.outs.Result = !(Value1 || Value2);
          break;
        case 6: // NXOR
          this.outs.Result = !((Value1 || Value2) && !(Value1 && Value2));
          break;
      }
    }
  }
}

function QCTextImage(params) {
  this.params = params;
  this.outs = {};

  this.update = function() {
    this.outs['Image'] = this.params;
  }
}

function QCCube(params) {
  this.params = params;

  if(QCCube.vertBuffer === undefined) {
    QCCube.vertBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, QCCube.vertBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(QCCube.vertices), gl.STATIC_DRAW);
    QCCube.vertBuffer.itemSize = 3;
    QCCube.vertBuffer.numItems = 24;

    QCCube.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, QCCube.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(QCCube.indices), gl.STATIC_DRAW);
    QCCube.indexBuffer.itemSize = 1;
    QCCube.indexBuffer.numItems = 36;

    QCCube.normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, QCCube.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(QCCube.normals), gl.STATIC_DRAW);
    QCCube.normalBuffer.itemSize = 3;
    QCCube.normalBuffer.numItems = 24;

    QCCube.colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, QCCube.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QCCube.colors = new Float32Array(24*4), gl.DYNAMIC_DRAW);
    QCCube.colorBuffer.itemSize = 4;
    QCCube.colorBuffer.numItems = 24;
    QCCube.curColor = [[],[],[],[],[],[]];
  }

  this.update = function() {
    with(this.params) {
      gl.bindBuffer(gl.ARRAY_BUFFER, QCCube.vertBuffer);
      gl.vertexAttribPointer(gl.program.aVertexPosition, QCCube.vertBuffer.itemSize, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, QCCube.normalBuffer);
      gl.vertexAttribPointer(gl.program.aVertexNormal, QCCube.normalBuffer.itemSize, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, QCCube.colorBuffer);
      var colors = [
        ColorFront, 
        ColorBack, 
        ColorTop, 
        ColorBottom, 
        ColorRight, 
        ColorLeft
      ];
      var updated = false;
      for(var i in colors) {
        var c = color(colors[i]);
        if(c[0] != QCCube.curColor[i][0] || 
           c[1] != QCCube.curColor[i][1] || 
           c[2] != QCCube.curColor[i][2] || 
           c[3] != QCCube.curColor[i][3]
        ) {
          for(var j = 0; j < 16; j += 4) {
            QCCube.colors[i*16+j  ] = c[0];
            QCCube.colors[i*16+j+1] = c[1];
            QCCube.colors[i*16+j+2] = c[2];
            QCCube.colors[i*16+j+3] = c[3];
          }
          QCCube.curColor[i] = c;
          updated = true;
        } else
          break; // Hack while all cubes are similarly colored.
      }

      if(updated) {
        gl.bufferData(gl.ARRAY_BUFFER, QCCube.colors, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(gl.program.aVertexColor, QCCube.colorBuffer.itemSize, gl.FLOAT, false, 0, 0);
      }

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, QCCube.indexBuffer);

      gl.push();

      if(X != 0 || Y != 0 || Z != 0)
        mat4.translate(gl.mvMatrix, [X, Y, Z]);

      if(RX)
        mat4.rotate(gl.mvMatrix, degrad(RX), [1, 0, 0]);
      if(RY)
        mat4.rotate(gl.mvMatrix, degrad(RY), [0, 1, 0]);
      if(RZ)
        mat4.rotate(gl.mvMatrix, degrad(RZ), [0, 0, 1]);

      if(Width != 1 || Height != 1 || Depth != 1)
        mat4.scale(gl.mvMatrix, [Width, Height, Depth]);

      gl.matUpdate();
      gl.drawElements(gl.TRIANGLES, QCCube.indexBuffer.numItems, gl.UNSIGNED_SHORT, 0);

      gl.pop();
    }
  }
}
QCCube.vertices = [
  // Front face
  -0.5, -0.5,  0.5,
   0.5, -0.5,  0.5,
   0.5,  0.5,  0.5,
  -0.5,  0.5,  0.5,

  // Back face
  -0.5, -0.5, -0.5,
  -0.5,  0.5, -0.5,
   0.5,  0.5, -0.5,
   0.5, -0.5, -0.5,

  // Top face
  -0.5,  0.5, -0.5,
  -0.5,  0.5,  0.5,
   0.5,  0.5,  0.5,
   0.5,  0.5, -0.5,

  // Bottom face
  -0.5, -0.5, -0.5,
   0.5, -0.5, -0.5,
   0.5, -0.5,  0.5,
  -0.5, -0.5,  0.5,

  // Right face
   0.5, -0.5, -0.5,
   0.5,  0.5, -0.5,
   0.5,  0.5,  0.5,
   0.5, -0.5,  0.5,

  // Left face
  -0.5, -0.5, -0.5,
  -0.5, -0.5,  0.5,
  -0.5,  0.5,  0.5,
  -0.5,  0.5, -0.5,
];
QCCube.indices = [
  0,  1,  2,    0,  2,  3,    // Front face
  4,  5,  6,    4,  6,  7,    // Back face
  8,  9,  10,   8,  10, 11,  // Top face
  12, 13, 14,   12, 14, 15, // Bottom face
  16, 17, 18,   16, 18, 19, // Right face
  20, 21, 22,   20, 22, 23  // Left face
];
QCCube.normals = [
  // Front
   0.0,  0.0,  1.0,
   0.0,  0.0,  1.0,
   0.0,  0.0,  1.0,
   0.0,  0.0,  1.0,
   
  // Back
   0.0,  0.0, -1.0,
   0.0,  0.0, -1.0,
   0.0,  0.0, -1.0,
   0.0,  0.0, -1.0,
   
  // Top
   0.0,  1.0,  0.0,
   0.0,  1.0,  0.0,
   0.0,  1.0,  0.0,
   0.0,  1.0,  0.0,
   
  // Bottom
   0.0, -1.0,  0.0,
   0.0, -1.0,  0.0,
   0.0, -1.0,  0.0,
   0.0, -1.0,  0.0,
   
  // Right
   1.0,  0.0,  0.0,
   1.0,  0.0,  0.0,
   1.0,  0.0,  0.0,
   1.0,  0.0,  0.0,
   
  // Left
  -1.0,  0.0,  0.0,
  -1.0,  0.0,  0.0,
  -1.0,  0.0,  0.0,
  -1.0,  0.0,  0.0
];

function QCSphere(params) {
  this.params = params;

  if(QCSphere.vertBuffer === undefined) {
    var stacks = 12, slices = 24; // This is in theory defined by the spheres in the file, but... good luck.

    var verts = new Float32Array(stacks * slices * 3), vi = 0;
    var indices = new Uint16Array(stacks * slices * 6), ii = 0;
    var texcoords = new Float32Array(stacks * slices * 2), ti = 0;
    QCSphere.colors = new Float32Array(stacks * slices * 4);
    QCSphere.curColor = [1, 1, 1, 1];

    stacks -= 1;
    slices -= 1;

    for(var stack = 0; stack <= stacks; ++stack) {
      var theta = stack * Math.PI / stacks;
      var sint = Math.sin(theta);
      var cost = Math.cos(theta);

      for(var slice = 0; slice <= slices; ++slice) {
        var phi = slice * 2 * Math.PI / slices;
        var sinp = Math.sin(phi);
        var cosp = Math.cos(phi);

        var x = cosp * sint, y = cost, z = sinp * sint;
        var u = 1 - (slice / slices), v = 1 - (stack / stacks);

        texcoords[ti++] = u;
        texcoords[ti++] = v;

        verts[vi++] = x;
        verts[vi++] = y;
        verts[vi++] = z;
      }
    }

    for(var stack = 0; stack < stacks; ++stack) {
      for(var slice = 0; slice < slices; ++slice) {
        var first = (stack * (slices + 1)) + slice;
        var second = first + slices + 1;

        indices[ii++] = first;
        indices[ii++] = second;
        indices[ii++] = first + 1;

        indices[ii++] = second;
        indices[ii++] = second + 1;
        indices[ii++] = first + 1;
      }
    }

    QCSphere.vertBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, QCSphere.vertBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    QCSphere.vertBuffer.itemSize = 3;
    QCSphere.vertBuffer.numItems = verts.length / 3;
    
    QCSphere.colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, QCSphere.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QCSphere.colors, gl.DYNAMIC_DRAW);
    QCSphere.colorBuffer.itemSize = 4;
    QCSphere.colorBuffer.numItems = verts.length / 3;
    
    QCSphere.texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, QCSphere.texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
    QCSphere.texcoordBuffer.itemSize = 2;
    QCSphere.texcoordBuffer.numItems = texcoords.length / 3;
    
    QCSphere.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, QCSphere.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    QCSphere.indexBuffer.itemSize = 1;
    QCSphere.indexBuffer.numItems = indices.length;
  }

  this.update = function() {
    with(this.params) {
      // Yep, our vertex and normal buffers are the same.
      gl.bindBuffer(gl.ARRAY_BUFFER, QCSphere.vertBuffer);
      gl.vertexAttribPointer(gl.program.aVertexPosition, QCSphere.vertBuffer.itemSize, gl.FLOAT, false, 0, 0);
      gl.vertexAttribPointer(gl.program.aVertexNormal, QCSphere.vertBuffer.itemSize, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, QCSphere.colorBuffer);
      var c = color(Color), colors = QCSphere.colors, cur = QCSphere.curColor;
      if(c[0] != cur[0] || c[1] != cur[1] || c[2] != cur[2] || c[3] != cur[3]) {
        for(var i = 0, j = colors.length; i < j; i += 4) {
          colors[i  ] = c[0];
          colors[i+1] = c[1];
          colors[i+2] = c[2];
          colors[i+3] = c[3];
        }

        QCSphere.curColor = c;

        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
      }
      gl.vertexAttribPointer(gl.program.aVertexColor, QCSphere.colorBuffer.itemSize, gl.FLOAT, false, 0, 0);

      gl.push();

      if(X != 0 || Y != 0 || Z != 0)
        mat4.translate(gl.mvMatrix, [X, Y, Z]);

      if(RX)
        mat4.rotate(gl.mvMatrix, degrad(RX), [1, 0, 0]);
      if(RY)
        mat4.rotate(gl.mvMatrix, degrad(RY), [0, 1, 0]);
      if(RZ)
        mat4.rotate(gl.mvMatrix, degrad(RZ), [0, 0, 1]);

      mat4.scale(gl.mvMatrix, [Scale / 2, Scale / 2, Scale / 2]);

      gl.matUpdate();

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, QCSphere.indexBuffer);
      gl.drawElements(gl.TRIANGLES, QCSphere.indexBuffer.numItems, gl.UNSIGNED_SHORT, 0);

      gl.pop();
    }
  }
}

var default_vs = 'attribute vec3 aVertexPosition; \
attribute vec3 aVertexNormal; \
attribute vec4 aVertexColor; \
uniform mat4 uMVMatrix; \
uniform mat4 uPMatrix; \
uniform mat4 uNMatrix; \
varying vec4 vColor; \
varying vec4 vPosition; \
varying vec3 vNormal; \
void main(void) { \
  vPosition = uMVMatrix * vec4(aVertexPosition, 1.0); \
  gl_Position = uPMatrix * vPosition; \
  vNormal = (uNMatrix * vec4(aVertexNormal, 1.0)).xyz; \
  vColor = aVertexColor; \
}';
var default_fs = 'precision mediump float; \
varying vec4 vColor; \
varying vec4 vPosition; \
varying vec3 vNormal; \
uniform bool useLighting; \
uniform vec3 ambientColor; \
uniform float specular, shininess; \
uniform vec3 lightPosition, lightColor; \
void main(void) { \
  vec3 weight; \
  if (!useLighting) \
    gl_FragColor = vColor; \
  else { \
    vec3 normal = normalize(vNormal); \
    float spec, ndotl = max(dot(normal, lightPosition), 0.0); \
    vec3 light = ambientColor + lightColor * ndotl; \
    if(ndotl >= 0.0) { \
      vec3 viewDir = normalize(-vPosition.xyz); \
      spec = specular * pow(max(0.0, dot(reflect(-normalize(lightPosition), normal), viewDir)), shininess); \
    } else { \
      spec = 0.0; \
    } \
    gl_FragColor = vec4(vColor.rgb * light + spec, vColor.a); \
  } \
}';

function compile(vs, fs, attribs, uniforms) {
  function sub(src, type) {
    var shdr = gl.createShader(type);
    gl.shaderSource(shdr, src);
    gl.compileShader(shdr);

    if(!gl.getShaderParameter(shdr, gl.COMPILE_STATUS)) {
      console.log('Shader compilation failed');
      console.log(gl.getShaderInfoLog(shdr));
    }

    return shdr;
  }

  var prog = gl.createProgram();
  gl.attachShader(prog, sub(vs, gl.VERTEX_SHADER));
  gl.attachShader(prog, sub(fs, gl.FRAGMENT_SHADER));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  for(var i in attribs)
    gl.enableVertexAttribArray(prog[attribs[i]] = gl.getAttribLocation(prog, attribs[i]));
  for(var i in uniforms)
    prog[uniforms[i]] = gl.getUniformLocation(prog, uniforms[i]);

  return prog;
}

function init() {
  elem = document.createElement('canvas');
  elem.width = 640;
  elem.height = 480;
  document.body.appendChild(elem);

  gl = elem.getContext('experimental-webgl') || elem.getContext('webgl');
  if(!gl)
    alert('No WebGL support :(');

  gl.enable(gl.DEPTH_TEST);

  gl.program = compile(
    default_vs, 
    default_fs, 
    [
      'aVertexPosition', 
      'aVertexColor', 
      'aVertexNormal'
    ], 
    [
      'uPMatrix', 
      'uMVMatrix', 
      'uNMatrix',  
      'useLighting', 
      'ambientColor', 
      'specular', 
      'shininess', 
      'lightPosition', 
      'lightColor'
    ]
  );

  gl.mvMatrix = mat4.create();
  gl.mvStack = [];
  gl.pMatrix = mat4.create();
  gl.push = function() {
    var _ = mat4.create();
    mat4.set(this.mvMatrix, _);
    gl.mvStack.push(_);
  };
  gl.pop = function() {
    gl.mvMatrix = gl.mvStack.pop();
  };
  gl.matUpdate = function() {
    gl.uniformMatrix4fv(gl.program.uPMatrix, false, gl.pMatrix);
    gl.uniformMatrix4fv(gl.program.uMVMatrix, false, gl.mvMatrix);

    var nMatrix = mat4.create();
    mat4.inverse(gl.mvMatrix, nMatrix);
    mat4.transpose(nMatrix);
    gl.uniformMatrix4fv(gl.program.uNMatrix, false, nMatrix);
  };

  gl.width = elem.width;
  gl.height = elem.height;

  gl.uniform1i(gl.program.useLighting, false);

  gl.cullFace(gl.BACK);
}


function run(patch, audio, div) {
  audio.play();
  
  function render() {
    if(!div) {
      elem.width = gl.width = window.innerWidth;
      elem.height = gl.height = window.innerHeight;
    }
    gl.viewport(0, 0, gl.width, gl.height);
    mat4.perspective(45, gl.width / gl.height, 0.1, 100, gl.pMatrix);
    mat4.identity(gl.mvMatrix);

    mat4.translate(gl.mvMatrix, [0.0, 0.0, -1.8]);

    time = audio.currentTime;
    if(div)
      div.innerHTML = time;
    patch.update();
    window.requestAnimationFrame(render, elem);
  }
  render()
}
