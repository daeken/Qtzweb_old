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

function QCPatch() {
  this.nodes = {};
}
QCPatch.prototype.update = function(sub) {
  if(sub !== undefined)
    this.updater = sub;
  else
    this.updater();
};

function QCInterpolation(params) {
  this.params = params;
  this.outs = {};
}
QCInterpolation.prototype.update = function() {
  switch(this.params.Repeat) {
    case 0: // None
      if(time < this.params.Duration) {
        var comp = time / this.params.Duration;
        this.outs.Value = (this.params.Value2 - this.params.Value1) * comp + this.params.Value1;
      } else
        this.outs.Value = this.params.Value2;
      break;
    case 1: // Loop
      var comp = (time % this.params.Duration) / this.params.Duration;
      this.outs.Value = (this.params.Value2 - this.params.Value1) * comp + this.params.Value1;
      break;
    case 2: // Mirrored loop
      var comp = time % (this.params.Duration * 2);
      if(comp >= this.params.Duration) {
        comp -= this.params.Duration;
        comp = this.params.Duration - comp;
      }
      this.outs.Value = (this.params.Value2 - this.params.Value1) * comp + this.params.Value1;
      break;
    case 3: // Mirrored loop once
      if(time < this.params.Duration * 2) {
        var comp = time;
        if(comp >= this.params.Duration) {
          comp -= this.params.Duration;
          comp = this.params.Duration - comp;
        }
        this.outs.Value = (this.params.Value2 - this.params.Value1) * comp + this.params.Value1;
      } else
        this.outs.Value = this.params.Value1;
      break;
  }
};

function QCClear(params) {
  this.params = params;
}
QCClear.prototype.update = function() {
  gl.clearColor(this.params.Color[0], this.params.Color[1], this.params.Color[2], this.params.Color[3]);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
};

function QCSplitter(params) {
  this.params = params;
  this.outs = {};
}
QCSplitter.prototype.update = function() {
  this.outs.output = this.params.input;
};

function QCColorFromComponents(params) {
  this.params = params;
  this.outs = {};
}
QCColorFromComponents.prototype.update = function() {
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

function run(patch) {
  var elem = document.createElement('canvas');
  elem.width = elem.style.width = 640;
  elem.height = elem.style.height = 480;
  document.body.appendChild(elem);

  gl = elem.getContext('experimental-webgl') || elem.getContext('webgl');
  if(!gl)
    alert('No WebGL support :(');

  var start = new Date;

  function render() {
    time = (new Date - start) / 1000;
    patch.update();
    window.requestAnimationFrame(render, elem);
  }
  render()
}
