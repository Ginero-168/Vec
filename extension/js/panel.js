"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/pngjs/lib/chunkstream.js
  var require_chunkstream = __commonJS({
    "node_modules/pngjs/lib/chunkstream.js"(exports, module) {
      "use strict";
      var util = __require("util");
      var Stream = __require("stream");
      var ChunkStream = module.exports = function() {
        Stream.call(this);
        this._buffers = [];
        this._buffered = 0;
        this._reads = [];
        this._paused = false;
        this._encoding = "utf8";
        this.writable = true;
      };
      util.inherits(ChunkStream, Stream);
      ChunkStream.prototype.read = function(length, callback) {
        this._reads.push({
          length: Math.abs(length),
          // if length < 0 then at most this length
          allowLess: length < 0,
          func: callback
        });
        process.nextTick(
          function() {
            this._process();
            if (this._paused && this._reads && this._reads.length > 0) {
              this._paused = false;
              this.emit("drain");
            }
          }.bind(this)
        );
      };
      ChunkStream.prototype.write = function(data, encoding) {
        if (!this.writable) {
          this.emit("error", new Error("Stream not writable"));
          return false;
        }
        let dataBuffer;
        if (Buffer.isBuffer(data)) {
          dataBuffer = data;
        } else {
          dataBuffer = Buffer.from(data, encoding || this._encoding);
        }
        this._buffers.push(dataBuffer);
        this._buffered += dataBuffer.length;
        this._process();
        if (this._reads && this._reads.length === 0) {
          this._paused = true;
        }
        return this.writable && !this._paused;
      };
      ChunkStream.prototype.end = function(data, encoding) {
        if (data) {
          this.write(data, encoding);
        }
        this.writable = false;
        if (!this._buffers) {
          return;
        }
        if (this._buffers.length === 0) {
          this._end();
        } else {
          this._buffers.push(null);
          this._process();
        }
      };
      ChunkStream.prototype.destroySoon = ChunkStream.prototype.end;
      ChunkStream.prototype._end = function() {
        if (this._reads.length > 0) {
          this.emit("error", new Error("Unexpected end of input"));
        }
        this.destroy();
      };
      ChunkStream.prototype.destroy = function() {
        if (!this._buffers) {
          return;
        }
        this.writable = false;
        this._reads = null;
        this._buffers = null;
        this.emit("close");
      };
      ChunkStream.prototype._processReadAllowingLess = function(read) {
        this._reads.shift();
        let smallerBuf = this._buffers[0];
        if (smallerBuf.length > read.length) {
          this._buffered -= read.length;
          this._buffers[0] = smallerBuf.slice(read.length);
          read.func.call(this, smallerBuf.slice(0, read.length));
        } else {
          this._buffered -= smallerBuf.length;
          this._buffers.shift();
          read.func.call(this, smallerBuf);
        }
      };
      ChunkStream.prototype._processRead = function(read) {
        this._reads.shift();
        let pos = 0;
        let count = 0;
        let data = Buffer.alloc(read.length);
        while (pos < read.length) {
          let buf = this._buffers[count++];
          let len = Math.min(buf.length, read.length - pos);
          buf.copy(data, pos, 0, len);
          pos += len;
          if (len !== buf.length) {
            this._buffers[--count] = buf.slice(len);
          }
        }
        if (count > 0) {
          this._buffers.splice(0, count);
        }
        this._buffered -= read.length;
        read.func.call(this, data);
      };
      ChunkStream.prototype._process = function() {
        try {
          while (this._buffered > 0 && this._reads && this._reads.length > 0) {
            let read = this._reads[0];
            if (read.allowLess) {
              this._processReadAllowingLess(read);
            } else if (this._buffered >= read.length) {
              this._processRead(read);
            } else {
              break;
            }
          }
          if (this._buffers && !this.writable) {
            this._end();
          }
        } catch (ex) {
          this.emit("error", ex);
        }
      };
    }
  });

  // node_modules/pngjs/lib/interlace.js
  var require_interlace = __commonJS({
    "node_modules/pngjs/lib/interlace.js"(exports) {
      "use strict";
      var imagePasses = [
        {
          // pass 1 - 1px
          x: [0],
          y: [0]
        },
        {
          // pass 2 - 1px
          x: [4],
          y: [0]
        },
        {
          // pass 3 - 2px
          x: [0, 4],
          y: [4]
        },
        {
          // pass 4 - 4px
          x: [2, 6],
          y: [0, 4]
        },
        {
          // pass 5 - 8px
          x: [0, 2, 4, 6],
          y: [2, 6]
        },
        {
          // pass 6 - 16px
          x: [1, 3, 5, 7],
          y: [0, 2, 4, 6]
        },
        {
          // pass 7 - 32px
          x: [0, 1, 2, 3, 4, 5, 6, 7],
          y: [1, 3, 5, 7]
        }
      ];
      exports.getImagePasses = function(width, height) {
        let images = [];
        let xLeftOver = width % 8;
        let yLeftOver = height % 8;
        let xRepeats = (width - xLeftOver) / 8;
        let yRepeats = (height - yLeftOver) / 8;
        for (let i = 0; i < imagePasses.length; i++) {
          let pass = imagePasses[i];
          let passWidth = xRepeats * pass.x.length;
          let passHeight = yRepeats * pass.y.length;
          for (let j = 0; j < pass.x.length; j++) {
            if (pass.x[j] < xLeftOver) {
              passWidth++;
            } else {
              break;
            }
          }
          for (let j = 0; j < pass.y.length; j++) {
            if (pass.y[j] < yLeftOver) {
              passHeight++;
            } else {
              break;
            }
          }
          if (passWidth > 0 && passHeight > 0) {
            images.push({ width: passWidth, height: passHeight, index: i });
          }
        }
        return images;
      };
      exports.getInterlaceIterator = function(width) {
        return function(x, y, pass) {
          let outerXLeftOver = x % imagePasses[pass].x.length;
          let outerX = (x - outerXLeftOver) / imagePasses[pass].x.length * 8 + imagePasses[pass].x[outerXLeftOver];
          let outerYLeftOver = y % imagePasses[pass].y.length;
          let outerY = (y - outerYLeftOver) / imagePasses[pass].y.length * 8 + imagePasses[pass].y[outerYLeftOver];
          return outerX * 4 + outerY * width * 4;
        };
      };
    }
  });

  // node_modules/pngjs/lib/paeth-predictor.js
  var require_paeth_predictor = __commonJS({
    "node_modules/pngjs/lib/paeth-predictor.js"(exports, module) {
      "use strict";
      module.exports = function paethPredictor(left, above, upLeft) {
        let paeth = left + above - upLeft;
        let pLeft = Math.abs(paeth - left);
        let pAbove = Math.abs(paeth - above);
        let pUpLeft = Math.abs(paeth - upLeft);
        if (pLeft <= pAbove && pLeft <= pUpLeft) {
          return left;
        }
        if (pAbove <= pUpLeft) {
          return above;
        }
        return upLeft;
      };
    }
  });

  // node_modules/pngjs/lib/filter-parse.js
  var require_filter_parse = __commonJS({
    "node_modules/pngjs/lib/filter-parse.js"(exports, module) {
      "use strict";
      var interlaceUtils = require_interlace();
      var paethPredictor = require_paeth_predictor();
      function getByteWidth(width, bpp, depth) {
        let byteWidth = width * bpp;
        if (depth !== 8) {
          byteWidth = Math.ceil(byteWidth / (8 / depth));
        }
        return byteWidth;
      }
      var Filter = module.exports = function(bitmapInfo, dependencies) {
        let width = bitmapInfo.width;
        let height = bitmapInfo.height;
        let interlace = bitmapInfo.interlace;
        let bpp = bitmapInfo.bpp;
        let depth = bitmapInfo.depth;
        this.read = dependencies.read;
        this.write = dependencies.write;
        this.complete = dependencies.complete;
        this._imageIndex = 0;
        this._images = [];
        if (interlace) {
          let passes = interlaceUtils.getImagePasses(width, height);
          for (let i = 0; i < passes.length; i++) {
            this._images.push({
              byteWidth: getByteWidth(passes[i].width, bpp, depth),
              height: passes[i].height,
              lineIndex: 0
            });
          }
        } else {
          this._images.push({
            byteWidth: getByteWidth(width, bpp, depth),
            height,
            lineIndex: 0
          });
        }
        if (depth === 8) {
          this._xComparison = bpp;
        } else if (depth === 16) {
          this._xComparison = bpp * 2;
        } else {
          this._xComparison = 1;
        }
      };
      Filter.prototype.start = function() {
        this.read(
          this._images[this._imageIndex].byteWidth + 1,
          this._reverseFilterLine.bind(this)
        );
      };
      Filter.prototype._unFilterType1 = function(rawData, unfilteredLine, byteWidth) {
        let xComparison = this._xComparison;
        let xBiggerThan = xComparison - 1;
        for (let x = 0; x < byteWidth; x++) {
          let rawByte = rawData[1 + x];
          let f1Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
          unfilteredLine[x] = rawByte + f1Left;
        }
      };
      Filter.prototype._unFilterType2 = function(rawData, unfilteredLine, byteWidth) {
        let lastLine = this._lastLine;
        for (let x = 0; x < byteWidth; x++) {
          let rawByte = rawData[1 + x];
          let f2Up = lastLine ? lastLine[x] : 0;
          unfilteredLine[x] = rawByte + f2Up;
        }
      };
      Filter.prototype._unFilterType3 = function(rawData, unfilteredLine, byteWidth) {
        let xComparison = this._xComparison;
        let xBiggerThan = xComparison - 1;
        let lastLine = this._lastLine;
        for (let x = 0; x < byteWidth; x++) {
          let rawByte = rawData[1 + x];
          let f3Up = lastLine ? lastLine[x] : 0;
          let f3Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
          let f3Add = Math.floor((f3Left + f3Up) / 2);
          unfilteredLine[x] = rawByte + f3Add;
        }
      };
      Filter.prototype._unFilterType4 = function(rawData, unfilteredLine, byteWidth) {
        let xComparison = this._xComparison;
        let xBiggerThan = xComparison - 1;
        let lastLine = this._lastLine;
        for (let x = 0; x < byteWidth; x++) {
          let rawByte = rawData[1 + x];
          let f4Up = lastLine ? lastLine[x] : 0;
          let f4Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
          let f4UpLeft = x > xBiggerThan && lastLine ? lastLine[x - xComparison] : 0;
          let f4Add = paethPredictor(f4Left, f4Up, f4UpLeft);
          unfilteredLine[x] = rawByte + f4Add;
        }
      };
      Filter.prototype._reverseFilterLine = function(rawData) {
        let filter = rawData[0];
        let unfilteredLine;
        let currentImage = this._images[this._imageIndex];
        let byteWidth = currentImage.byteWidth;
        if (filter === 0) {
          unfilteredLine = rawData.slice(1, byteWidth + 1);
        } else {
          unfilteredLine = Buffer.alloc(byteWidth);
          switch (filter) {
            case 1:
              this._unFilterType1(rawData, unfilteredLine, byteWidth);
              break;
            case 2:
              this._unFilterType2(rawData, unfilteredLine, byteWidth);
              break;
            case 3:
              this._unFilterType3(rawData, unfilteredLine, byteWidth);
              break;
            case 4:
              this._unFilterType4(rawData, unfilteredLine, byteWidth);
              break;
            default:
              throw new Error("Unrecognised filter type - " + filter);
          }
        }
        this.write(unfilteredLine);
        currentImage.lineIndex++;
        if (currentImage.lineIndex >= currentImage.height) {
          this._lastLine = null;
          this._imageIndex++;
          currentImage = this._images[this._imageIndex];
        } else {
          this._lastLine = unfilteredLine;
        }
        if (currentImage) {
          this.read(currentImage.byteWidth + 1, this._reverseFilterLine.bind(this));
        } else {
          this._lastLine = null;
          this.complete();
        }
      };
    }
  });

  // node_modules/pngjs/lib/filter-parse-async.js
  var require_filter_parse_async = __commonJS({
    "node_modules/pngjs/lib/filter-parse-async.js"(exports, module) {
      "use strict";
      var util = __require("util");
      var ChunkStream = require_chunkstream();
      var Filter = require_filter_parse();
      var FilterAsync = module.exports = function(bitmapInfo) {
        ChunkStream.call(this);
        let buffers = [];
        let that = this;
        this._filter = new Filter(bitmapInfo, {
          read: this.read.bind(this),
          write: function(buffer) {
            buffers.push(buffer);
          },
          complete: function() {
            that.emit("complete", Buffer.concat(buffers));
          }
        });
        this._filter.start();
      };
      util.inherits(FilterAsync, ChunkStream);
    }
  });

  // node_modules/pngjs/lib/constants.js
  var require_constants = __commonJS({
    "node_modules/pngjs/lib/constants.js"(exports, module) {
      "use strict";
      module.exports = {
        PNG_SIGNATURE: [137, 80, 78, 71, 13, 10, 26, 10],
        TYPE_IHDR: 1229472850,
        TYPE_IEND: 1229278788,
        TYPE_IDAT: 1229209940,
        TYPE_PLTE: 1347179589,
        TYPE_tRNS: 1951551059,
        // eslint-disable-line camelcase
        TYPE_gAMA: 1732332865,
        // eslint-disable-line camelcase
        // color-type bits
        COLORTYPE_GRAYSCALE: 0,
        COLORTYPE_PALETTE: 1,
        COLORTYPE_COLOR: 2,
        COLORTYPE_ALPHA: 4,
        // e.g. grayscale and alpha
        // color-type combinations
        COLORTYPE_PALETTE_COLOR: 3,
        COLORTYPE_COLOR_ALPHA: 6,
        COLORTYPE_TO_BPP_MAP: {
          0: 1,
          2: 3,
          3: 1,
          4: 2,
          6: 4
        },
        GAMMA_DIVISION: 1e5
      };
    }
  });

  // node_modules/pngjs/lib/crc.js
  var require_crc = __commonJS({
    "node_modules/pngjs/lib/crc.js"(exports, module) {
      "use strict";
      var crcTable = [];
      (function() {
        for (let i = 0; i < 256; i++) {
          let currentCrc = i;
          for (let j = 0; j < 8; j++) {
            if (currentCrc & 1) {
              currentCrc = 3988292384 ^ currentCrc >>> 1;
            } else {
              currentCrc = currentCrc >>> 1;
            }
          }
          crcTable[i] = currentCrc;
        }
      })();
      var CrcCalculator = module.exports = function() {
        this._crc = -1;
      };
      CrcCalculator.prototype.write = function(data) {
        for (let i = 0; i < data.length; i++) {
          this._crc = crcTable[(this._crc ^ data[i]) & 255] ^ this._crc >>> 8;
        }
        return true;
      };
      CrcCalculator.prototype.crc32 = function() {
        return this._crc ^ -1;
      };
      CrcCalculator.crc32 = function(buf) {
        let crc = -1;
        for (let i = 0; i < buf.length; i++) {
          crc = crcTable[(crc ^ buf[i]) & 255] ^ crc >>> 8;
        }
        return crc ^ -1;
      };
    }
  });

  // node_modules/pngjs/lib/parser.js
  var require_parser = __commonJS({
    "node_modules/pngjs/lib/parser.js"(exports, module) {
      "use strict";
      var constants = require_constants();
      var CrcCalculator = require_crc();
      var Parser = module.exports = function(options, dependencies) {
        this._options = options;
        options.checkCRC = options.checkCRC !== false;
        this._hasIHDR = false;
        this._hasIEND = false;
        this._emittedHeadersFinished = false;
        this._palette = [];
        this._colorType = 0;
        this._chunks = {};
        this._chunks[constants.TYPE_IHDR] = this._handleIHDR.bind(this);
        this._chunks[constants.TYPE_IEND] = this._handleIEND.bind(this);
        this._chunks[constants.TYPE_IDAT] = this._handleIDAT.bind(this);
        this._chunks[constants.TYPE_PLTE] = this._handlePLTE.bind(this);
        this._chunks[constants.TYPE_tRNS] = this._handleTRNS.bind(this);
        this._chunks[constants.TYPE_gAMA] = this._handleGAMA.bind(this);
        this.read = dependencies.read;
        this.error = dependencies.error;
        this.metadata = dependencies.metadata;
        this.gamma = dependencies.gamma;
        this.transColor = dependencies.transColor;
        this.palette = dependencies.palette;
        this.parsed = dependencies.parsed;
        this.inflateData = dependencies.inflateData;
        this.finished = dependencies.finished;
        this.simpleTransparency = dependencies.simpleTransparency;
        this.headersFinished = dependencies.headersFinished || function() {
        };
      };
      Parser.prototype.start = function() {
        this.read(constants.PNG_SIGNATURE.length, this._parseSignature.bind(this));
      };
      Parser.prototype._parseSignature = function(data) {
        let signature = constants.PNG_SIGNATURE;
        for (let i = 0; i < signature.length; i++) {
          if (data[i] !== signature[i]) {
            this.error(new Error("Invalid file signature"));
            return;
          }
        }
        this.read(8, this._parseChunkBegin.bind(this));
      };
      Parser.prototype._parseChunkBegin = function(data) {
        let length = data.readUInt32BE(0);
        let type = data.readUInt32BE(4);
        let name = "";
        for (let i = 4; i < 8; i++) {
          name += String.fromCharCode(data[i]);
        }
        let ancillary = Boolean(data[4] & 32);
        if (!this._hasIHDR && type !== constants.TYPE_IHDR) {
          this.error(new Error("Expected IHDR on beggining"));
          return;
        }
        this._crc = new CrcCalculator();
        this._crc.write(Buffer.from(name));
        if (this._chunks[type]) {
          return this._chunks[type](length);
        }
        if (!ancillary) {
          this.error(new Error("Unsupported critical chunk type " + name));
          return;
        }
        this.read(length + 4, this._skipChunk.bind(this));
      };
      Parser.prototype._skipChunk = function() {
        this.read(8, this._parseChunkBegin.bind(this));
      };
      Parser.prototype._handleChunkEnd = function() {
        this.read(4, this._parseChunkEnd.bind(this));
      };
      Parser.prototype._parseChunkEnd = function(data) {
        let fileCrc = data.readInt32BE(0);
        let calcCrc = this._crc.crc32();
        if (this._options.checkCRC && calcCrc !== fileCrc) {
          this.error(new Error("Crc error - " + fileCrc + " - " + calcCrc));
          return;
        }
        if (!this._hasIEND) {
          this.read(8, this._parseChunkBegin.bind(this));
        }
      };
      Parser.prototype._handleIHDR = function(length) {
        this.read(length, this._parseIHDR.bind(this));
      };
      Parser.prototype._parseIHDR = function(data) {
        this._crc.write(data);
        let width = data.readUInt32BE(0);
        let height = data.readUInt32BE(4);
        let depth = data[8];
        let colorType = data[9];
        let compr = data[10];
        let filter = data[11];
        let interlace = data[12];
        if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1 && depth !== 16) {
          this.error(new Error("Unsupported bit depth " + depth));
          return;
        }
        if (!(colorType in constants.COLORTYPE_TO_BPP_MAP)) {
          this.error(new Error("Unsupported color type"));
          return;
        }
        if (compr !== 0) {
          this.error(new Error("Unsupported compression method"));
          return;
        }
        if (filter !== 0) {
          this.error(new Error("Unsupported filter method"));
          return;
        }
        if (interlace !== 0 && interlace !== 1) {
          this.error(new Error("Unsupported interlace method"));
          return;
        }
        this._colorType = colorType;
        let bpp = constants.COLORTYPE_TO_BPP_MAP[this._colorType];
        this._hasIHDR = true;
        this.metadata({
          width,
          height,
          depth,
          interlace: Boolean(interlace),
          palette: Boolean(colorType & constants.COLORTYPE_PALETTE),
          color: Boolean(colorType & constants.COLORTYPE_COLOR),
          alpha: Boolean(colorType & constants.COLORTYPE_ALPHA),
          bpp,
          colorType
        });
        this._handleChunkEnd();
      };
      Parser.prototype._handlePLTE = function(length) {
        this.read(length, this._parsePLTE.bind(this));
      };
      Parser.prototype._parsePLTE = function(data) {
        this._crc.write(data);
        let entries = Math.floor(data.length / 3);
        for (let i = 0; i < entries; i++) {
          this._palette.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255]);
        }
        this.palette(this._palette);
        this._handleChunkEnd();
      };
      Parser.prototype._handleTRNS = function(length) {
        this.simpleTransparency();
        this.read(length, this._parseTRNS.bind(this));
      };
      Parser.prototype._parseTRNS = function(data) {
        this._crc.write(data);
        if (this._colorType === constants.COLORTYPE_PALETTE_COLOR) {
          if (this._palette.length === 0) {
            this.error(new Error("Transparency chunk must be after palette"));
            return;
          }
          if (data.length > this._palette.length) {
            this.error(new Error("More transparent colors than palette size"));
            return;
          }
          for (let i = 0; i < data.length; i++) {
            this._palette[i][3] = data[i];
          }
          this.palette(this._palette);
        }
        if (this._colorType === constants.COLORTYPE_GRAYSCALE) {
          this.transColor([data.readUInt16BE(0)]);
        }
        if (this._colorType === constants.COLORTYPE_COLOR) {
          this.transColor([
            data.readUInt16BE(0),
            data.readUInt16BE(2),
            data.readUInt16BE(4)
          ]);
        }
        this._handleChunkEnd();
      };
      Parser.prototype._handleGAMA = function(length) {
        this.read(length, this._parseGAMA.bind(this));
      };
      Parser.prototype._parseGAMA = function(data) {
        this._crc.write(data);
        this.gamma(data.readUInt32BE(0) / constants.GAMMA_DIVISION);
        this._handleChunkEnd();
      };
      Parser.prototype._handleIDAT = function(length) {
        if (!this._emittedHeadersFinished) {
          this._emittedHeadersFinished = true;
          this.headersFinished();
        }
        this.read(-length, this._parseIDAT.bind(this, length));
      };
      Parser.prototype._parseIDAT = function(length, data) {
        this._crc.write(data);
        if (this._colorType === constants.COLORTYPE_PALETTE_COLOR && this._palette.length === 0) {
          throw new Error("Expected palette not found");
        }
        this.inflateData(data);
        let leftOverLength = length - data.length;
        if (leftOverLength > 0) {
          this._handleIDAT(leftOverLength);
        } else {
          this._handleChunkEnd();
        }
      };
      Parser.prototype._handleIEND = function(length) {
        this.read(length, this._parseIEND.bind(this));
      };
      Parser.prototype._parseIEND = function(data) {
        this._crc.write(data);
        this._hasIEND = true;
        this._handleChunkEnd();
        if (this.finished) {
          this.finished();
        }
      };
    }
  });

  // node_modules/pngjs/lib/bitmapper.js
  var require_bitmapper = __commonJS({
    "node_modules/pngjs/lib/bitmapper.js"(exports) {
      "use strict";
      var interlaceUtils = require_interlace();
      var pixelBppMapper = [
        // 0 - dummy entry
        function() {
        },
        // 1 - L
        // 0: 0, 1: 0, 2: 0, 3: 0xff
        function(pxData, data, pxPos, rawPos) {
          if (rawPos === data.length) {
            throw new Error("Ran out of data");
          }
          let pixel = data[rawPos];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = 255;
        },
        // 2 - LA
        // 0: 0, 1: 0, 2: 0, 3: 1
        function(pxData, data, pxPos, rawPos) {
          if (rawPos + 1 >= data.length) {
            throw new Error("Ran out of data");
          }
          let pixel = data[rawPos];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = data[rawPos + 1];
        },
        // 3 - RGB
        // 0: 0, 1: 1, 2: 2, 3: 0xff
        function(pxData, data, pxPos, rawPos) {
          if (rawPos + 2 >= data.length) {
            throw new Error("Ran out of data");
          }
          pxData[pxPos] = data[rawPos];
          pxData[pxPos + 1] = data[rawPos + 1];
          pxData[pxPos + 2] = data[rawPos + 2];
          pxData[pxPos + 3] = 255;
        },
        // 4 - RGBA
        // 0: 0, 1: 1, 2: 2, 3: 3
        function(pxData, data, pxPos, rawPos) {
          if (rawPos + 3 >= data.length) {
            throw new Error("Ran out of data");
          }
          pxData[pxPos] = data[rawPos];
          pxData[pxPos + 1] = data[rawPos + 1];
          pxData[pxPos + 2] = data[rawPos + 2];
          pxData[pxPos + 3] = data[rawPos + 3];
        }
      ];
      var pixelBppCustomMapper = [
        // 0 - dummy entry
        function() {
        },
        // 1 - L
        // 0: 0, 1: 0, 2: 0, 3: 0xff
        function(pxData, pixelData, pxPos, maxBit) {
          let pixel = pixelData[0];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = maxBit;
        },
        // 2 - LA
        // 0: 0, 1: 0, 2: 0, 3: 1
        function(pxData, pixelData, pxPos) {
          let pixel = pixelData[0];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = pixelData[1];
        },
        // 3 - RGB
        // 0: 0, 1: 1, 2: 2, 3: 0xff
        function(pxData, pixelData, pxPos, maxBit) {
          pxData[pxPos] = pixelData[0];
          pxData[pxPos + 1] = pixelData[1];
          pxData[pxPos + 2] = pixelData[2];
          pxData[pxPos + 3] = maxBit;
        },
        // 4 - RGBA
        // 0: 0, 1: 1, 2: 2, 3: 3
        function(pxData, pixelData, pxPos) {
          pxData[pxPos] = pixelData[0];
          pxData[pxPos + 1] = pixelData[1];
          pxData[pxPos + 2] = pixelData[2];
          pxData[pxPos + 3] = pixelData[3];
        }
      ];
      function bitRetriever(data, depth) {
        let leftOver = [];
        let i = 0;
        function split() {
          if (i === data.length) {
            throw new Error("Ran out of data");
          }
          let byte = data[i];
          i++;
          let byte8, byte7, byte6, byte5, byte4, byte3, byte2, byte1;
          switch (depth) {
            default:
              throw new Error("unrecognised depth");
            case 16:
              byte2 = data[i];
              i++;
              leftOver.push((byte << 8) + byte2);
              break;
            case 4:
              byte2 = byte & 15;
              byte1 = byte >> 4;
              leftOver.push(byte1, byte2);
              break;
            case 2:
              byte4 = byte & 3;
              byte3 = byte >> 2 & 3;
              byte2 = byte >> 4 & 3;
              byte1 = byte >> 6 & 3;
              leftOver.push(byte1, byte2, byte3, byte4);
              break;
            case 1:
              byte8 = byte & 1;
              byte7 = byte >> 1 & 1;
              byte6 = byte >> 2 & 1;
              byte5 = byte >> 3 & 1;
              byte4 = byte >> 4 & 1;
              byte3 = byte >> 5 & 1;
              byte2 = byte >> 6 & 1;
              byte1 = byte >> 7 & 1;
              leftOver.push(byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8);
              break;
          }
        }
        return {
          get: function(count) {
            while (leftOver.length < count) {
              split();
            }
            let returner = leftOver.slice(0, count);
            leftOver = leftOver.slice(count);
            return returner;
          },
          resetAfterLine: function() {
            leftOver.length = 0;
          },
          end: function() {
            if (i !== data.length) {
              throw new Error("extra data found");
            }
          }
        };
      }
      function mapImage8Bit(image, pxData, getPxPos, bpp, data, rawPos) {
        let imageWidth = image.width;
        let imageHeight = image.height;
        let imagePass = image.index;
        for (let y = 0; y < imageHeight; y++) {
          for (let x = 0; x < imageWidth; x++) {
            let pxPos = getPxPos(x, y, imagePass);
            pixelBppMapper[bpp](pxData, data, pxPos, rawPos);
            rawPos += bpp;
          }
        }
        return rawPos;
      }
      function mapImageCustomBit(image, pxData, getPxPos, bpp, bits, maxBit) {
        let imageWidth = image.width;
        let imageHeight = image.height;
        let imagePass = image.index;
        for (let y = 0; y < imageHeight; y++) {
          for (let x = 0; x < imageWidth; x++) {
            let pixelData = bits.get(bpp);
            let pxPos = getPxPos(x, y, imagePass);
            pixelBppCustomMapper[bpp](pxData, pixelData, pxPos, maxBit);
          }
          bits.resetAfterLine();
        }
      }
      exports.dataToBitMap = function(data, bitmapInfo) {
        let width = bitmapInfo.width;
        let height = bitmapInfo.height;
        let depth = bitmapInfo.depth;
        let bpp = bitmapInfo.bpp;
        let interlace = bitmapInfo.interlace;
        let bits;
        if (depth !== 8) {
          bits = bitRetriever(data, depth);
        }
        let pxData;
        if (depth <= 8) {
          pxData = Buffer.alloc(width * height * 4);
        } else {
          pxData = new Uint16Array(width * height * 4);
        }
        let maxBit = Math.pow(2, depth) - 1;
        let rawPos = 0;
        let images;
        let getPxPos;
        if (interlace) {
          images = interlaceUtils.getImagePasses(width, height);
          getPxPos = interlaceUtils.getInterlaceIterator(width, height);
        } else {
          let nonInterlacedPxPos = 0;
          getPxPos = function() {
            let returner = nonInterlacedPxPos;
            nonInterlacedPxPos += 4;
            return returner;
          };
          images = [{ width, height }];
        }
        for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
          if (depth === 8) {
            rawPos = mapImage8Bit(
              images[imageIndex],
              pxData,
              getPxPos,
              bpp,
              data,
              rawPos
            );
          } else {
            mapImageCustomBit(
              images[imageIndex],
              pxData,
              getPxPos,
              bpp,
              bits,
              maxBit
            );
          }
        }
        if (depth === 8) {
          if (rawPos !== data.length) {
            throw new Error("extra data found");
          }
        } else {
          bits.end();
        }
        return pxData;
      };
    }
  });

  // node_modules/pngjs/lib/format-normaliser.js
  var require_format_normaliser = __commonJS({
    "node_modules/pngjs/lib/format-normaliser.js"(exports, module) {
      "use strict";
      function dePalette(indata, outdata, width, height, palette) {
        let pxPos = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let color = palette[indata[pxPos]];
            if (!color) {
              throw new Error("index " + indata[pxPos] + " not in palette");
            }
            for (let i = 0; i < 4; i++) {
              outdata[pxPos + i] = color[i];
            }
            pxPos += 4;
          }
        }
      }
      function replaceTransparentColor(indata, outdata, width, height, transColor) {
        let pxPos = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let makeTrans = false;
            if (transColor.length === 1) {
              if (transColor[0] === indata[pxPos]) {
                makeTrans = true;
              }
            } else if (transColor[0] === indata[pxPos] && transColor[1] === indata[pxPos + 1] && transColor[2] === indata[pxPos + 2]) {
              makeTrans = true;
            }
            if (makeTrans) {
              for (let i = 0; i < 4; i++) {
                outdata[pxPos + i] = 0;
              }
            }
            pxPos += 4;
          }
        }
      }
      function scaleDepth(indata, outdata, width, height, depth) {
        let maxOutSample = 255;
        let maxInSample = Math.pow(2, depth) - 1;
        let pxPos = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            for (let i = 0; i < 4; i++) {
              outdata[pxPos + i] = Math.floor(
                indata[pxPos + i] * maxOutSample / maxInSample + 0.5
              );
            }
            pxPos += 4;
          }
        }
      }
      module.exports = function(indata, imageData, skipRescale = false) {
        let depth = imageData.depth;
        let width = imageData.width;
        let height = imageData.height;
        let colorType = imageData.colorType;
        let transColor = imageData.transColor;
        let palette = imageData.palette;
        let outdata = indata;
        if (colorType === 3) {
          dePalette(indata, outdata, width, height, palette);
        } else {
          if (transColor) {
            replaceTransparentColor(indata, outdata, width, height, transColor);
          }
          if (depth !== 8 && !skipRescale) {
            if (depth === 16) {
              outdata = Buffer.alloc(width * height * 4);
            }
            scaleDepth(indata, outdata, width, height, depth);
          }
        }
        return outdata;
      };
    }
  });

  // node_modules/pngjs/lib/parser-async.js
  var require_parser_async = __commonJS({
    "node_modules/pngjs/lib/parser-async.js"(exports, module) {
      "use strict";
      var util = __require("util");
      var zlib = __require("zlib");
      var ChunkStream = require_chunkstream();
      var FilterAsync = require_filter_parse_async();
      var Parser = require_parser();
      var bitmapper = require_bitmapper();
      var formatNormaliser = require_format_normaliser();
      var ParserAsync = module.exports = function(options) {
        ChunkStream.call(this);
        this._parser = new Parser(options, {
          read: this.read.bind(this),
          error: this._handleError.bind(this),
          metadata: this._handleMetaData.bind(this),
          gamma: this.emit.bind(this, "gamma"),
          palette: this._handlePalette.bind(this),
          transColor: this._handleTransColor.bind(this),
          finished: this._finished.bind(this),
          inflateData: this._inflateData.bind(this),
          simpleTransparency: this._simpleTransparency.bind(this),
          headersFinished: this._headersFinished.bind(this)
        });
        this._options = options;
        this.writable = true;
        this._parser.start();
      };
      util.inherits(ParserAsync, ChunkStream);
      ParserAsync.prototype._handleError = function(err) {
        this.emit("error", err);
        this.writable = false;
        this.destroy();
        if (this._inflate && this._inflate.destroy) {
          this._inflate.destroy();
        }
        if (this._filter) {
          this._filter.destroy();
          this._filter.on("error", function() {
          });
        }
        this.errord = true;
      };
      ParserAsync.prototype._inflateData = function(data) {
        if (!this._inflate) {
          if (this._bitmapInfo.interlace) {
            this._inflate = zlib.createInflate();
            this._inflate.on("error", this.emit.bind(this, "error"));
            this._filter.on("complete", this._complete.bind(this));
            this._inflate.pipe(this._filter);
          } else {
            let rowSize = (this._bitmapInfo.width * this._bitmapInfo.bpp * this._bitmapInfo.depth + 7 >> 3) + 1;
            let imageSize = rowSize * this._bitmapInfo.height;
            let chunkSize = Math.max(imageSize, zlib.Z_MIN_CHUNK);
            this._inflate = zlib.createInflate({ chunkSize });
            let leftToInflate = imageSize;
            let emitError = this.emit.bind(this, "error");
            this._inflate.on("error", function(err) {
              if (!leftToInflate) {
                return;
              }
              emitError(err);
            });
            this._filter.on("complete", this._complete.bind(this));
            let filterWrite = this._filter.write.bind(this._filter);
            this._inflate.on("data", function(chunk) {
              if (!leftToInflate) {
                return;
              }
              if (chunk.length > leftToInflate) {
                chunk = chunk.slice(0, leftToInflate);
              }
              leftToInflate -= chunk.length;
              filterWrite(chunk);
            });
            this._inflate.on("end", this._filter.end.bind(this._filter));
          }
        }
        this._inflate.write(data);
      };
      ParserAsync.prototype._handleMetaData = function(metaData) {
        this._metaData = metaData;
        this._bitmapInfo = Object.create(metaData);
        this._filter = new FilterAsync(this._bitmapInfo);
      };
      ParserAsync.prototype._handleTransColor = function(transColor) {
        this._bitmapInfo.transColor = transColor;
      };
      ParserAsync.prototype._handlePalette = function(palette) {
        this._bitmapInfo.palette = palette;
      };
      ParserAsync.prototype._simpleTransparency = function() {
        this._metaData.alpha = true;
      };
      ParserAsync.prototype._headersFinished = function() {
        this.emit("metadata", this._metaData);
      };
      ParserAsync.prototype._finished = function() {
        if (this.errord) {
          return;
        }
        if (!this._inflate) {
          this.emit("error", "No Inflate block");
        } else {
          this._inflate.end();
        }
      };
      ParserAsync.prototype._complete = function(filteredData) {
        if (this.errord) {
          return;
        }
        let normalisedBitmapData;
        try {
          let bitmapData = bitmapper.dataToBitMap(filteredData, this._bitmapInfo);
          normalisedBitmapData = formatNormaliser(
            bitmapData,
            this._bitmapInfo,
            this._options.skipRescale
          );
          bitmapData = null;
        } catch (ex) {
          this._handleError(ex);
          return;
        }
        this.emit("parsed", normalisedBitmapData);
      };
    }
  });

  // node_modules/pngjs/lib/bitpacker.js
  var require_bitpacker = __commonJS({
    "node_modules/pngjs/lib/bitpacker.js"(exports, module) {
      "use strict";
      var constants = require_constants();
      module.exports = function(dataIn, width, height, options) {
        let outHasAlpha = [constants.COLORTYPE_COLOR_ALPHA, constants.COLORTYPE_ALPHA].indexOf(
          options.colorType
        ) !== -1;
        if (options.colorType === options.inputColorType) {
          let bigEndian = (function() {
            let buffer = new ArrayBuffer(2);
            new DataView(buffer).setInt16(
              0,
              256,
              true
              /* littleEndian */
            );
            return new Int16Array(buffer)[0] !== 256;
          })();
          if (options.bitDepth === 8 || options.bitDepth === 16 && bigEndian) {
            return dataIn;
          }
        }
        let data = options.bitDepth !== 16 ? dataIn : new Uint16Array(dataIn.buffer);
        let maxValue = 255;
        let inBpp = constants.COLORTYPE_TO_BPP_MAP[options.inputColorType];
        if (inBpp === 4 && !options.inputHasAlpha) {
          inBpp = 3;
        }
        let outBpp = constants.COLORTYPE_TO_BPP_MAP[options.colorType];
        if (options.bitDepth === 16) {
          maxValue = 65535;
          outBpp *= 2;
        }
        let outData = Buffer.alloc(width * height * outBpp);
        let inIndex = 0;
        let outIndex = 0;
        let bgColor = options.bgColor || {};
        if (bgColor.red === void 0) {
          bgColor.red = maxValue;
        }
        if (bgColor.green === void 0) {
          bgColor.green = maxValue;
        }
        if (bgColor.blue === void 0) {
          bgColor.blue = maxValue;
        }
        function getRGBA() {
          let red;
          let green;
          let blue;
          let alpha = maxValue;
          switch (options.inputColorType) {
            case constants.COLORTYPE_COLOR_ALPHA:
              alpha = data[inIndex + 3];
              red = data[inIndex];
              green = data[inIndex + 1];
              blue = data[inIndex + 2];
              break;
            case constants.COLORTYPE_COLOR:
              red = data[inIndex];
              green = data[inIndex + 1];
              blue = data[inIndex + 2];
              break;
            case constants.COLORTYPE_ALPHA:
              alpha = data[inIndex + 1];
              red = data[inIndex];
              green = red;
              blue = red;
              break;
            case constants.COLORTYPE_GRAYSCALE:
              red = data[inIndex];
              green = red;
              blue = red;
              break;
            default:
              throw new Error(
                "input color type:" + options.inputColorType + " is not supported at present"
              );
          }
          if (options.inputHasAlpha) {
            if (!outHasAlpha) {
              alpha /= maxValue;
              red = Math.min(
                Math.max(Math.round((1 - alpha) * bgColor.red + alpha * red), 0),
                maxValue
              );
              green = Math.min(
                Math.max(Math.round((1 - alpha) * bgColor.green + alpha * green), 0),
                maxValue
              );
              blue = Math.min(
                Math.max(Math.round((1 - alpha) * bgColor.blue + alpha * blue), 0),
                maxValue
              );
            }
          }
          return { red, green, blue, alpha };
        }
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let rgba = getRGBA(data, inIndex);
            switch (options.colorType) {
              case constants.COLORTYPE_COLOR_ALPHA:
              case constants.COLORTYPE_COLOR:
                if (options.bitDepth === 8) {
                  outData[outIndex] = rgba.red;
                  outData[outIndex + 1] = rgba.green;
                  outData[outIndex + 2] = rgba.blue;
                  if (outHasAlpha) {
                    outData[outIndex + 3] = rgba.alpha;
                  }
                } else {
                  outData.writeUInt16BE(rgba.red, outIndex);
                  outData.writeUInt16BE(rgba.green, outIndex + 2);
                  outData.writeUInt16BE(rgba.blue, outIndex + 4);
                  if (outHasAlpha) {
                    outData.writeUInt16BE(rgba.alpha, outIndex + 6);
                  }
                }
                break;
              case constants.COLORTYPE_ALPHA:
              case constants.COLORTYPE_GRAYSCALE: {
                let grayscale = (rgba.red + rgba.green + rgba.blue) / 3;
                if (options.bitDepth === 8) {
                  outData[outIndex] = grayscale;
                  if (outHasAlpha) {
                    outData[outIndex + 1] = rgba.alpha;
                  }
                } else {
                  outData.writeUInt16BE(grayscale, outIndex);
                  if (outHasAlpha) {
                    outData.writeUInt16BE(rgba.alpha, outIndex + 2);
                  }
                }
                break;
              }
              default:
                throw new Error("unrecognised color Type " + options.colorType);
            }
            inIndex += inBpp;
            outIndex += outBpp;
          }
        }
        return outData;
      };
    }
  });

  // node_modules/pngjs/lib/filter-pack.js
  var require_filter_pack = __commonJS({
    "node_modules/pngjs/lib/filter-pack.js"(exports, module) {
      "use strict";
      var paethPredictor = require_paeth_predictor();
      function filterNone(pxData, pxPos, byteWidth, rawData, rawPos) {
        for (let x = 0; x < byteWidth; x++) {
          rawData[rawPos + x] = pxData[pxPos + x];
        }
      }
      function filterSumNone(pxData, pxPos, byteWidth) {
        let sum = 0;
        let length = pxPos + byteWidth;
        for (let i = pxPos; i < length; i++) {
          sum += Math.abs(pxData[i]);
        }
        return sum;
      }
      function filterSub(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
        for (let x = 0; x < byteWidth; x++) {
          let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          let val = pxData[pxPos + x] - left;
          rawData[rawPos + x] = val;
        }
      }
      function filterSumSub(pxData, pxPos, byteWidth, bpp) {
        let sum = 0;
        for (let x = 0; x < byteWidth; x++) {
          let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          let val = pxData[pxPos + x] - left;
          sum += Math.abs(val);
        }
        return sum;
      }
      function filterUp(pxData, pxPos, byteWidth, rawData, rawPos) {
        for (let x = 0; x < byteWidth; x++) {
          let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          let val = pxData[pxPos + x] - up;
          rawData[rawPos + x] = val;
        }
      }
      function filterSumUp(pxData, pxPos, byteWidth) {
        let sum = 0;
        let length = pxPos + byteWidth;
        for (let x = pxPos; x < length; x++) {
          let up = pxPos > 0 ? pxData[x - byteWidth] : 0;
          let val = pxData[x] - up;
          sum += Math.abs(val);
        }
        return sum;
      }
      function filterAvg(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
        for (let x = 0; x < byteWidth; x++) {
          let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          let val = pxData[pxPos + x] - (left + up >> 1);
          rawData[rawPos + x] = val;
        }
      }
      function filterSumAvg(pxData, pxPos, byteWidth, bpp) {
        let sum = 0;
        for (let x = 0; x < byteWidth; x++) {
          let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          let val = pxData[pxPos + x] - (left + up >> 1);
          sum += Math.abs(val);
        }
        return sum;
      }
      function filterPaeth(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
        for (let x = 0; x < byteWidth; x++) {
          let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
          let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
          rawData[rawPos + x] = val;
        }
      }
      function filterSumPaeth(pxData, pxPos, byteWidth, bpp) {
        let sum = 0;
        for (let x = 0; x < byteWidth; x++) {
          let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
          let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
          sum += Math.abs(val);
        }
        return sum;
      }
      var filters = {
        0: filterNone,
        1: filterSub,
        2: filterUp,
        3: filterAvg,
        4: filterPaeth
      };
      var filterSums = {
        0: filterSumNone,
        1: filterSumSub,
        2: filterSumUp,
        3: filterSumAvg,
        4: filterSumPaeth
      };
      module.exports = function(pxData, width, height, options, bpp) {
        let filterTypes;
        if (!("filterType" in options) || options.filterType === -1) {
          filterTypes = [0, 1, 2, 3, 4];
        } else if (typeof options.filterType === "number") {
          filterTypes = [options.filterType];
        } else {
          throw new Error("unrecognised filter types");
        }
        if (options.bitDepth === 16) {
          bpp *= 2;
        }
        let byteWidth = width * bpp;
        let rawPos = 0;
        let pxPos = 0;
        let rawData = Buffer.alloc((byteWidth + 1) * height);
        let sel = filterTypes[0];
        for (let y = 0; y < height; y++) {
          if (filterTypes.length > 1) {
            let min = Infinity;
            for (let i = 0; i < filterTypes.length; i++) {
              let sum = filterSums[filterTypes[i]](pxData, pxPos, byteWidth, bpp);
              if (sum < min) {
                sel = filterTypes[i];
                min = sum;
              }
            }
          }
          rawData[rawPos] = sel;
          rawPos++;
          filters[sel](pxData, pxPos, byteWidth, rawData, rawPos, bpp);
          rawPos += byteWidth;
          pxPos += byteWidth;
        }
        return rawData;
      };
    }
  });

  // node_modules/pngjs/lib/packer.js
  var require_packer = __commonJS({
    "node_modules/pngjs/lib/packer.js"(exports, module) {
      "use strict";
      var constants = require_constants();
      var CrcStream = require_crc();
      var bitPacker = require_bitpacker();
      var filter = require_filter_pack();
      var zlib = __require("zlib");
      var Packer = module.exports = function(options) {
        this._options = options;
        options.deflateChunkSize = options.deflateChunkSize || 32 * 1024;
        options.deflateLevel = options.deflateLevel != null ? options.deflateLevel : 9;
        options.deflateStrategy = options.deflateStrategy != null ? options.deflateStrategy : 3;
        options.inputHasAlpha = options.inputHasAlpha != null ? options.inputHasAlpha : true;
        options.deflateFactory = options.deflateFactory || zlib.createDeflate;
        options.bitDepth = options.bitDepth || 8;
        options.colorType = typeof options.colorType === "number" ? options.colorType : constants.COLORTYPE_COLOR_ALPHA;
        options.inputColorType = typeof options.inputColorType === "number" ? options.inputColorType : constants.COLORTYPE_COLOR_ALPHA;
        if ([
          constants.COLORTYPE_GRAYSCALE,
          constants.COLORTYPE_COLOR,
          constants.COLORTYPE_COLOR_ALPHA,
          constants.COLORTYPE_ALPHA
        ].indexOf(options.colorType) === -1) {
          throw new Error(
            "option color type:" + options.colorType + " is not supported at present"
          );
        }
        if ([
          constants.COLORTYPE_GRAYSCALE,
          constants.COLORTYPE_COLOR,
          constants.COLORTYPE_COLOR_ALPHA,
          constants.COLORTYPE_ALPHA
        ].indexOf(options.inputColorType) === -1) {
          throw new Error(
            "option input color type:" + options.inputColorType + " is not supported at present"
          );
        }
        if (options.bitDepth !== 8 && options.bitDepth !== 16) {
          throw new Error(
            "option bit depth:" + options.bitDepth + " is not supported at present"
          );
        }
      };
      Packer.prototype.getDeflateOptions = function() {
        return {
          chunkSize: this._options.deflateChunkSize,
          level: this._options.deflateLevel,
          strategy: this._options.deflateStrategy
        };
      };
      Packer.prototype.createDeflate = function() {
        return this._options.deflateFactory(this.getDeflateOptions());
      };
      Packer.prototype.filterData = function(data, width, height) {
        let packedData = bitPacker(data, width, height, this._options);
        let bpp = constants.COLORTYPE_TO_BPP_MAP[this._options.colorType];
        let filteredData = filter(packedData, width, height, this._options, bpp);
        return filteredData;
      };
      Packer.prototype._packChunk = function(type, data) {
        let len = data ? data.length : 0;
        let buf = Buffer.alloc(len + 12);
        buf.writeUInt32BE(len, 0);
        buf.writeUInt32BE(type, 4);
        if (data) {
          data.copy(buf, 8);
        }
        buf.writeInt32BE(
          CrcStream.crc32(buf.slice(4, buf.length - 4)),
          buf.length - 4
        );
        return buf;
      };
      Packer.prototype.packGAMA = function(gamma) {
        let buf = Buffer.alloc(4);
        buf.writeUInt32BE(Math.floor(gamma * constants.GAMMA_DIVISION), 0);
        return this._packChunk(constants.TYPE_gAMA, buf);
      };
      Packer.prototype.packIHDR = function(width, height) {
        let buf = Buffer.alloc(13);
        buf.writeUInt32BE(width, 0);
        buf.writeUInt32BE(height, 4);
        buf[8] = this._options.bitDepth;
        buf[9] = this._options.colorType;
        buf[10] = 0;
        buf[11] = 0;
        buf[12] = 0;
        return this._packChunk(constants.TYPE_IHDR, buf);
      };
      Packer.prototype.packIDAT = function(data) {
        return this._packChunk(constants.TYPE_IDAT, data);
      };
      Packer.prototype.packIEND = function() {
        return this._packChunk(constants.TYPE_IEND, null);
      };
    }
  });

  // node_modules/pngjs/lib/packer-async.js
  var require_packer_async = __commonJS({
    "node_modules/pngjs/lib/packer-async.js"(exports, module) {
      "use strict";
      var util = __require("util");
      var Stream = __require("stream");
      var constants = require_constants();
      var Packer = require_packer();
      var PackerAsync = module.exports = function(opt) {
        Stream.call(this);
        let options = opt || {};
        this._packer = new Packer(options);
        this._deflate = this._packer.createDeflate();
        this.readable = true;
      };
      util.inherits(PackerAsync, Stream);
      PackerAsync.prototype.pack = function(data, width, height, gamma) {
        this.emit("data", Buffer.from(constants.PNG_SIGNATURE));
        this.emit("data", this._packer.packIHDR(width, height));
        if (gamma) {
          this.emit("data", this._packer.packGAMA(gamma));
        }
        let filteredData = this._packer.filterData(data, width, height);
        this._deflate.on("error", this.emit.bind(this, "error"));
        this._deflate.on(
          "data",
          function(compressedData) {
            this.emit("data", this._packer.packIDAT(compressedData));
          }.bind(this)
        );
        this._deflate.on(
          "end",
          function() {
            this.emit("data", this._packer.packIEND());
            this.emit("end");
          }.bind(this)
        );
        this._deflate.end(filteredData);
      };
    }
  });

  // node_modules/pngjs/lib/sync-inflate.js
  var require_sync_inflate = __commonJS({
    "node_modules/pngjs/lib/sync-inflate.js"(exports, module) {
      "use strict";
      var assert = __require("assert").ok;
      var zlib = __require("zlib");
      var util = __require("util");
      var kMaxLength = __require("buffer").kMaxLength;
      function Inflate(opts) {
        if (!(this instanceof Inflate)) {
          return new Inflate(opts);
        }
        if (opts && opts.chunkSize < zlib.Z_MIN_CHUNK) {
          opts.chunkSize = zlib.Z_MIN_CHUNK;
        }
        zlib.Inflate.call(this, opts);
        this._offset = this._offset === void 0 ? this._outOffset : this._offset;
        this._buffer = this._buffer || this._outBuffer;
        if (opts && opts.maxLength != null) {
          this._maxLength = opts.maxLength;
        }
      }
      function createInflate(opts) {
        return new Inflate(opts);
      }
      function _close(engine, callback) {
        if (callback) {
          process.nextTick(callback);
        }
        if (!engine._handle) {
          return;
        }
        engine._handle.close();
        engine._handle = null;
      }
      Inflate.prototype._processChunk = function(chunk, flushFlag, asyncCb) {
        if (typeof asyncCb === "function") {
          return zlib.Inflate._processChunk.call(this, chunk, flushFlag, asyncCb);
        }
        let self = this;
        let availInBefore = chunk && chunk.length;
        let availOutBefore = this._chunkSize - this._offset;
        let leftToInflate = this._maxLength;
        let inOff = 0;
        let buffers = [];
        let nread = 0;
        let error;
        this.on("error", function(err) {
          error = err;
        });
        function handleChunk(availInAfter, availOutAfter) {
          if (self._hadError) {
            return;
          }
          let have = availOutBefore - availOutAfter;
          assert(have >= 0, "have should not go down");
          if (have > 0) {
            let out = self._buffer.slice(self._offset, self._offset + have);
            self._offset += have;
            if (out.length > leftToInflate) {
              out = out.slice(0, leftToInflate);
            }
            buffers.push(out);
            nread += out.length;
            leftToInflate -= out.length;
            if (leftToInflate === 0) {
              return false;
            }
          }
          if (availOutAfter === 0 || self._offset >= self._chunkSize) {
            availOutBefore = self._chunkSize;
            self._offset = 0;
            self._buffer = Buffer.allocUnsafe(self._chunkSize);
          }
          if (availOutAfter === 0) {
            inOff += availInBefore - availInAfter;
            availInBefore = availInAfter;
            return true;
          }
          return false;
        }
        assert(this._handle, "zlib binding closed");
        let res;
        do {
          res = this._handle.writeSync(
            flushFlag,
            chunk,
            // in
            inOff,
            // in_off
            availInBefore,
            // in_len
            this._buffer,
            // out
            this._offset,
            //out_off
            availOutBefore
          );
          res = res || this._writeState;
        } while (!this._hadError && handleChunk(res[0], res[1]));
        if (this._hadError) {
          throw error;
        }
        if (nread >= kMaxLength) {
          _close(this);
          throw new RangeError(
            "Cannot create final Buffer. It would be larger than 0x" + kMaxLength.toString(16) + " bytes"
          );
        }
        let buf = Buffer.concat(buffers, nread);
        _close(this);
        return buf;
      };
      util.inherits(Inflate, zlib.Inflate);
      function zlibBufferSync(engine, buffer) {
        if (typeof buffer === "string") {
          buffer = Buffer.from(buffer);
        }
        if (!(buffer instanceof Buffer)) {
          throw new TypeError("Not a string or buffer");
        }
        let flushFlag = engine._finishFlushFlag;
        if (flushFlag == null) {
          flushFlag = zlib.Z_FINISH;
        }
        return engine._processChunk(buffer, flushFlag);
      }
      function inflateSync(buffer, opts) {
        return zlibBufferSync(new Inflate(opts), buffer);
      }
      module.exports = exports = inflateSync;
      exports.Inflate = Inflate;
      exports.createInflate = createInflate;
      exports.inflateSync = inflateSync;
    }
  });

  // node_modules/pngjs/lib/sync-reader.js
  var require_sync_reader = __commonJS({
    "node_modules/pngjs/lib/sync-reader.js"(exports, module) {
      "use strict";
      var SyncReader = module.exports = function(buffer) {
        this._buffer = buffer;
        this._reads = [];
      };
      SyncReader.prototype.read = function(length, callback) {
        this._reads.push({
          length: Math.abs(length),
          // if length < 0 then at most this length
          allowLess: length < 0,
          func: callback
        });
      };
      SyncReader.prototype.process = function() {
        while (this._reads.length > 0 && this._buffer.length) {
          let read = this._reads[0];
          if (this._buffer.length && (this._buffer.length >= read.length || read.allowLess)) {
            this._reads.shift();
            let buf = this._buffer;
            this._buffer = buf.slice(read.length);
            read.func.call(this, buf.slice(0, read.length));
          } else {
            break;
          }
        }
        if (this._reads.length > 0) {
          throw new Error("There are some read requests waitng on finished stream");
        }
        if (this._buffer.length > 0) {
          throw new Error("unrecognised content at end of stream");
        }
      };
    }
  });

  // node_modules/pngjs/lib/filter-parse-sync.js
  var require_filter_parse_sync = __commonJS({
    "node_modules/pngjs/lib/filter-parse-sync.js"(exports) {
      "use strict";
      var SyncReader = require_sync_reader();
      var Filter = require_filter_parse();
      exports.process = function(inBuffer, bitmapInfo) {
        let outBuffers = [];
        let reader = new SyncReader(inBuffer);
        let filter = new Filter(bitmapInfo, {
          read: reader.read.bind(reader),
          write: function(bufferPart) {
            outBuffers.push(bufferPart);
          },
          complete: function() {
          }
        });
        filter.start();
        reader.process();
        return Buffer.concat(outBuffers);
      };
    }
  });

  // node_modules/pngjs/lib/parser-sync.js
  var require_parser_sync = __commonJS({
    "node_modules/pngjs/lib/parser-sync.js"(exports, module) {
      "use strict";
      var hasSyncZlib = true;
      var zlib = __require("zlib");
      var inflateSync = require_sync_inflate();
      if (!zlib.deflateSync) {
        hasSyncZlib = false;
      }
      var SyncReader = require_sync_reader();
      var FilterSync = require_filter_parse_sync();
      var Parser = require_parser();
      var bitmapper = require_bitmapper();
      var formatNormaliser = require_format_normaliser();
      module.exports = function(buffer, options) {
        if (!hasSyncZlib) {
          throw new Error(
            "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
          );
        }
        let err;
        function handleError(_err_) {
          err = _err_;
        }
        let metaData;
        function handleMetaData(_metaData_) {
          metaData = _metaData_;
        }
        function handleTransColor(transColor) {
          metaData.transColor = transColor;
        }
        function handlePalette(palette) {
          metaData.palette = palette;
        }
        function handleSimpleTransparency() {
          metaData.alpha = true;
        }
        let gamma;
        function handleGamma(_gamma_) {
          gamma = _gamma_;
        }
        let inflateDataList = [];
        function handleInflateData(inflatedData2) {
          inflateDataList.push(inflatedData2);
        }
        let reader = new SyncReader(buffer);
        let parser = new Parser(options, {
          read: reader.read.bind(reader),
          error: handleError,
          metadata: handleMetaData,
          gamma: handleGamma,
          palette: handlePalette,
          transColor: handleTransColor,
          inflateData: handleInflateData,
          simpleTransparency: handleSimpleTransparency
        });
        parser.start();
        reader.process();
        if (err) {
          throw err;
        }
        let inflateData = Buffer.concat(inflateDataList);
        inflateDataList.length = 0;
        let inflatedData;
        if (metaData.interlace) {
          inflatedData = zlib.inflateSync(inflateData);
        } else {
          let rowSize = (metaData.width * metaData.bpp * metaData.depth + 7 >> 3) + 1;
          let imageSize = rowSize * metaData.height;
          inflatedData = inflateSync(inflateData, {
            chunkSize: imageSize,
            maxLength: imageSize
          });
        }
        inflateData = null;
        if (!inflatedData || !inflatedData.length) {
          throw new Error("bad png - invalid inflate data response");
        }
        let unfilteredData = FilterSync.process(inflatedData, metaData);
        inflateData = null;
        let bitmapData = bitmapper.dataToBitMap(unfilteredData, metaData);
        unfilteredData = null;
        let normalisedBitmapData = formatNormaliser(
          bitmapData,
          metaData,
          options.skipRescale
        );
        metaData.data = normalisedBitmapData;
        metaData.gamma = gamma || 0;
        return metaData;
      };
    }
  });

  // node_modules/pngjs/lib/packer-sync.js
  var require_packer_sync = __commonJS({
    "node_modules/pngjs/lib/packer-sync.js"(exports, module) {
      "use strict";
      var hasSyncZlib = true;
      var zlib = __require("zlib");
      if (!zlib.deflateSync) {
        hasSyncZlib = false;
      }
      var constants = require_constants();
      var Packer = require_packer();
      module.exports = function(metaData, opt) {
        if (!hasSyncZlib) {
          throw new Error(
            "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
          );
        }
        let options = opt || {};
        let packer = new Packer(options);
        let chunks = [];
        chunks.push(Buffer.from(constants.PNG_SIGNATURE));
        chunks.push(packer.packIHDR(metaData.width, metaData.height));
        if (metaData.gamma) {
          chunks.push(packer.packGAMA(metaData.gamma));
        }
        let filteredData = packer.filterData(
          metaData.data,
          metaData.width,
          metaData.height
        );
        let compressedData = zlib.deflateSync(
          filteredData,
          packer.getDeflateOptions()
        );
        filteredData = null;
        if (!compressedData || !compressedData.length) {
          throw new Error("bad png - invalid compressed data response");
        }
        chunks.push(packer.packIDAT(compressedData));
        chunks.push(packer.packIEND());
        return Buffer.concat(chunks);
      };
    }
  });

  // node_modules/pngjs/lib/png-sync.js
  var require_png_sync = __commonJS({
    "node_modules/pngjs/lib/png-sync.js"(exports) {
      "use strict";
      var parse = require_parser_sync();
      var pack = require_packer_sync();
      exports.read = function(buffer, options) {
        return parse(buffer, options || {});
      };
      exports.write = function(png, options) {
        return pack(png, options);
      };
    }
  });

  // node_modules/pngjs/lib/png.js
  var require_png = __commonJS({
    "node_modules/pngjs/lib/png.js"(exports) {
      "use strict";
      var util = __require("util");
      var Stream = __require("stream");
      var Parser = require_parser_async();
      var Packer = require_packer_async();
      var PNGSync = require_png_sync();
      var PNG2 = exports.PNG = function(options) {
        Stream.call(this);
        options = options || {};
        this.width = options.width | 0;
        this.height = options.height | 0;
        this.data = this.width > 0 && this.height > 0 ? Buffer.alloc(4 * this.width * this.height) : null;
        if (options.fill && this.data) {
          this.data.fill(0);
        }
        this.gamma = 0;
        this.readable = this.writable = true;
        this._parser = new Parser(options);
        this._parser.on("error", this.emit.bind(this, "error"));
        this._parser.on("close", this._handleClose.bind(this));
        this._parser.on("metadata", this._metadata.bind(this));
        this._parser.on("gamma", this._gamma.bind(this));
        this._parser.on(
          "parsed",
          function(data) {
            this.data = data;
            this.emit("parsed", data);
          }.bind(this)
        );
        this._packer = new Packer(options);
        this._packer.on("data", this.emit.bind(this, "data"));
        this._packer.on("end", this.emit.bind(this, "end"));
        this._parser.on("close", this._handleClose.bind(this));
        this._packer.on("error", this.emit.bind(this, "error"));
      };
      util.inherits(PNG2, Stream);
      PNG2.sync = PNGSync;
      PNG2.prototype.pack = function() {
        if (!this.data || !this.data.length) {
          this.emit("error", "No data provided");
          return this;
        }
        process.nextTick(
          function() {
            this._packer.pack(this.data, this.width, this.height, this.gamma);
          }.bind(this)
        );
        return this;
      };
      PNG2.prototype.parse = function(data, callback) {
        if (callback) {
          let onParsed, onError;
          onParsed = function(parsedData) {
            this.removeListener("error", onError);
            this.data = parsedData;
            callback(null, this);
          }.bind(this);
          onError = function(err) {
            this.removeListener("parsed", onParsed);
            callback(err, null);
          }.bind(this);
          this.once("parsed", onParsed);
          this.once("error", onError);
        }
        this.end(data);
        return this;
      };
      PNG2.prototype.write = function(data) {
        this._parser.write(data);
        return true;
      };
      PNG2.prototype.end = function(data) {
        this._parser.end(data);
      };
      PNG2.prototype._metadata = function(metadata) {
        this.width = metadata.width;
        this.height = metadata.height;
        this.emit("metadata", metadata);
      };
      PNG2.prototype._gamma = function(gamma) {
        this.gamma = gamma;
      };
      PNG2.prototype._handleClose = function() {
        if (!this._parser.writable && !this._packer.readable) {
          this.emit("close");
        }
      };
      PNG2.bitblt = function(src, dst, srcX, srcY, width, height, deltaX, deltaY) {
        srcX |= 0;
        srcY |= 0;
        width |= 0;
        height |= 0;
        deltaX |= 0;
        deltaY |= 0;
        if (srcX > src.width || srcY > src.height || srcX + width > src.width || srcY + height > src.height) {
          throw new Error("bitblt reading outside image");
        }
        if (deltaX > dst.width || deltaY > dst.height || deltaX + width > dst.width || deltaY + height > dst.height) {
          throw new Error("bitblt writing outside image");
        }
        for (let y = 0; y < height; y++) {
          src.data.copy(
            dst.data,
            (deltaY + y) * dst.width + deltaX << 2,
            (srcY + y) * src.width + srcX << 2,
            (srcY + y) * src.width + srcX + width << 2
          );
        }
      };
      PNG2.prototype.bitblt = function(dst, srcX, srcY, width, height, deltaX, deltaY) {
        PNG2.bitblt(this, dst, srcX, srcY, width, height, deltaX, deltaY);
        return this;
      };
      PNG2.adjustGamma = function(src) {
        if (src.gamma) {
          for (let y = 0; y < src.height; y++) {
            for (let x = 0; x < src.width; x++) {
              let idx = src.width * y + x << 2;
              for (let i = 0; i < 3; i++) {
                let sample = src.data[idx + i] / 255;
                sample = Math.pow(sample, 1 / 2.2 / src.gamma);
                src.data[idx + i] = Math.round(sample * 255);
              }
            }
          }
          src.gamma = 0;
        }
      };
      PNG2.prototype.adjustGamma = function() {
        PNG2.adjustGamma(this);
      };
    }
  });

  // src/panel.ts
  var crypto = __toESM(__require("crypto"));
  var fs3 = __toESM(__require("fs"));
  var os2 = __toESM(__require("os"));
  var path2 = __toESM(__require("path"));

  // src/engine.ts
  var childProcess = __toESM(__require("child_process"));
  var fs2 = __toESM(__require("fs"));
  var os = __toESM(__require("os"));
  var path = __toESM(__require("path"));

  // src/geometry.ts
  var KAPPA = 0.5522847498307936;
  function same(a, b) {
    return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;
  }
  function readNumber(d, i) {
    const nlen = d.length;
    let j = i;
    if (d[j] === "+" || d[j] === "-") j++;
    let saw = false;
    const mark = j;
    while (j < nlen && d[j] >= "0" && d[j] <= "9") {
      saw = true;
      j++;
    }
    if (j < nlen && d[j] === ".") {
      j++;
      while (j < nlen && d[j] >= "0" && d[j] <= "9") {
        saw = true;
        j++;
      }
    }
    if (!saw || j === mark) return null;
    if (j < nlen && (d[j] === "e" || d[j] === "E")) {
      let k = j + 1;
      if (d[k] === "+" || d[k] === "-") k++;
      const expStart = k;
      while (k < nlen && d[k] >= "0" && d[k] <= "9") k++;
      if (k > expStart) j = k;
    }
    return { n: Number(d.slice(i, j)), i: j };
  }
  function isCommand(ch) {
    if (ch === void 0) return false;
    const c = ch.charCodeAt(0);
    return c >= 65 && c <= 90 || c >= 97 && c <= 122;
  }
  function skipSep(d, i) {
    while (i < d.length) {
      const ch = d[i];
      if (ch === " " || ch === "," || ch === "\n" || ch === "\r" || ch === "	") i++;
      else break;
    }
    return i;
  }
  function parsePathData(d) {
    const subpaths = [];
    let i = 0;
    let cmd = "";
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let prevC = null;
    let prevQ = null;
    let current = null;
    let unsupported = false;
    const finish = () => {
      if (current !== null && (current.segs.length > 0 || current.closed)) subpaths.push(current);
      current = null;
    };
    while (i < d.length) {
      i = skipSep(d, i);
      if (i >= d.length) break;
      const ch = d[i];
      if (ch !== void 0 && isCommand(ch)) {
        cmd = ch;
        i++;
        if (cmd === "Z" || cmd === "z") {
          if (current !== null && !same({ x: cx, y: cy }, { x: sx, y: sy })) {
            current.segs.push({ kind: "L", to: { x: sx, y: sy } });
          }
          if (current !== null) current.closed = true;
          cx = sx;
          cy = sy;
          prevC = null;
          prevQ = null;
          finish();
          cmd = "";
        }
        continue;
      }
      const take = (count) => {
        const values = [];
        let p = i;
        for (let n = 0; n < count; n++) {
          p = skipSep(d, p);
          const num = readNumber(d, p);
          if (num === null) return null;
          values.push(num.n);
          p = num.i;
        }
        i = p;
        return values;
      };
      const rel = cmd === cmd.toLowerCase();
      if (cmd === "M" || cmd === "m") {
        const v = take(2);
        if (v === null) break;
        finish();
        cx = rel ? cx + (v[0] ?? 0) : v[0] ?? 0;
        cy = rel ? cy + (v[1] ?? 0) : v[1] ?? 0;
        sx = cx;
        sy = cy;
        current = { start: { x: cx, y: cy }, segs: [], closed: false };
        prevC = null;
        prevQ = null;
        cmd = rel ? "l" : "L";
        continue;
      }
      if (current === null) break;
      if (cmd === "L" || cmd === "l") {
        const v = take(2);
        if (v === null) break;
        cx = rel ? cx + (v[0] ?? 0) : v[0] ?? 0;
        cy = rel ? cy + (v[1] ?? 0) : v[1] ?? 0;
        current.segs.push({ kind: "L", to: { x: cx, y: cy } });
        prevC = null;
        prevQ = null;
        continue;
      }
      if (cmd === "H" || cmd === "h") {
        const v = take(1);
        if (v === null) break;
        cx = rel ? cx + (v[0] ?? 0) : v[0] ?? 0;
        current.segs.push({ kind: "L", to: { x: cx, y: cy } });
        prevC = null;
        prevQ = null;
        continue;
      }
      if (cmd === "V" || cmd === "v") {
        const v = take(1);
        if (v === null) break;
        cy = rel ? cy + (v[0] ?? 0) : v[0] ?? 0;
        current.segs.push({ kind: "L", to: { x: cx, y: cy } });
        prevC = null;
        prevQ = null;
        continue;
      }
      if (cmd === "C" || cmd === "c") {
        const v = take(6);
        if (v === null) break;
        const c1x = rel ? cx + (v[0] ?? 0) : v[0] ?? 0;
        const c1y = rel ? cy + (v[1] ?? 0) : v[1] ?? 0;
        const c2x = rel ? cx + (v[2] ?? 0) : v[2] ?? 0;
        const c2y = rel ? cy + (v[3] ?? 0) : v[3] ?? 0;
        cx = rel ? cx + (v[4] ?? 0) : v[4] ?? 0;
        cy = rel ? cy + (v[5] ?? 0) : v[5] ?? 0;
        current.segs.push({ kind: "C", c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, to: { x: cx, y: cy } });
        prevC = { x: c2x, y: c2y };
        prevQ = null;
        continue;
      }
      if (cmd === "S" || cmd === "s") {
        const v = take(4);
        if (v === null) break;
        const c1 = prevC === null ? { x: cx, y: cy } : { x: 2 * cx - prevC.x, y: 2 * cy - prevC.y };
        const c2x = rel ? cx + (v[0] ?? 0) : v[0] ?? 0;
        const c2y = rel ? cy + (v[1] ?? 0) : v[1] ?? 0;
        cx = rel ? cx + (v[2] ?? 0) : v[2] ?? 0;
        cy = rel ? cy + (v[3] ?? 0) : v[3] ?? 0;
        current.segs.push({ kind: "C", c1, c2: { x: c2x, y: c2y }, to: { x: cx, y: cy } });
        prevC = { x: c2x, y: c2y };
        prevQ = null;
        continue;
      }
      if (cmd === "Q" || cmd === "q" || cmd === "T" || cmd === "t" || cmd === "A" || cmd === "a") {
        unsupported = true;
        break;
      }
      break;
    }
    finish();
    return { subpaths, unsupported };
  }
  function fmt(n, precision) {
    const text = n.toFixed(precision).replace(/\.?0+$/, "");
    return text === "-0" ? "0" : text;
  }
  function emitSubpaths(subpaths, precision) {
    let out = "";
    for (const sub of subpaths) {
      out += (out.length > 0 ? "" : "") + "M" + fmt(sub.start.x, precision) + "," + fmt(sub.start.y, precision);
      let x = sub.start.x;
      let y = sub.start.y;
      for (const seg of sub.segs) {
        if (seg.kind === "L") {
          out += "L" + fmt(seg.to.x, precision) + "," + fmt(seg.to.y, precision);
        } else {
          out += "C" + fmt(seg.c1.x, precision) + "," + fmt(seg.c1.y, precision) + "," + fmt(seg.c2.x, precision) + "," + fmt(seg.c2.y, precision) + "," + fmt(seg.to.x, precision) + "," + fmt(seg.to.y, precision);
        }
        x = seg.to.x;
        y = seg.to.y;
      }
      if (sub.closed && !same({ x, y }, sub.start)) out += "L" + fmt(sub.start.x, precision) + "," + fmt(sub.start.y, precision);
      if (sub.closed) out += "Z";
    }
    return out;
  }
  function cubicAt(a, c1, c2, b, t) {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    return {
      x: uu * u * a.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * b.x,
      y: uu * u * a.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * b.y
    };
  }
  function sampleSeg(from, seg, steps) {
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      pts.push(seg.kind === "L" ? { x: from.x + (seg.to.x - from.x) * t, y: from.y + (seg.to.y - from.y) * t } : cubicAt(from, seg.c1, seg.c2, seg.to, t));
    }
    return pts;
  }
  function deflection(a, b, c) {
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const n1 = Math.hypot(v1x, v1y);
    const n2 = Math.hypot(v2x, v2y);
    if (n1 < 1e-9 || n2 < 1e-9) return 0;
    const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
    return Math.acos(cos) * 180 / Math.PI;
  }
  function pointLineDistance(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
  }
  function flattenCubic(a, c1, c2, b, tol, out, depth) {
    const d1 = pointLineDistance(c1, a, b);
    const d2 = pointLineDistance(c2, a, b);
    if (d1 <= tol && d2 <= tol || depth > 8) {
      out.push(b);
      return;
    }
    const ab1 = { x: (a.x + c1.x) / 2, y: (a.y + c1.y) / 2 };
    const b1b2 = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
    const b2b = { x: (c2.x + b.x) / 2, y: (c2.y + b.y) / 2 };
    const m1 = { x: (ab1.x + b1b2.x) / 2, y: (ab1.y + b1b2.y) / 2 };
    const m2 = { x: (b1b2.x + b2b.x) / 2, y: (b1b2.y + b2b.y) / 2 };
    const mid = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 };
    flattenCubic(a, ab1, m1, mid, tol, out, depth + 1);
    flattenCubic(mid, m2, b2b, b, tol, out, depth + 1);
  }
  function maxErrorToCubic(samples, a, c1, c2, b) {
    const poly = [a];
    flattenCubic(a, c1, c2, b, 0.35, poly, 0);
    let max = 0;
    for (const p of samples) {
      let best = Infinity;
      for (let i = 1; i < poly.length; i++) {
        const u = poly[i - 1];
        const v = poly[i];
        if (u === void 0 || v === void 0) continue;
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - u.x) * dx + (p.y - u.y) * dy) / len2));
        const dist = Math.hypot(p.x - (u.x + dx * t), p.y - (u.y + dy * t));
        if (dist < best) best = dist;
      }
      if (best > max) max = best;
    }
    return max;
  }
  function unit(x, y) {
    const n = Math.hypot(x, y);
    if (n < 1e-9) return null;
    return { x: x / n, y: y / n };
  }
  function startTangent(from, seg) {
    if (seg.kind === "L") return unit(seg.to.x - from.x, seg.to.y - from.y) ?? { x: 1, y: 0 };
    return unit(seg.c1.x - from.x, seg.c1.y - from.y) ?? unit(seg.to.x - from.x, seg.to.y - from.y) ?? { x: 1, y: 0 };
  }
  function endTangent(from, seg) {
    if (seg.kind === "L") return unit(seg.to.x - from.x, seg.to.y - from.y) ?? { x: 1, y: 0 };
    return unit(seg.to.x - seg.c2.x, seg.to.y - seg.c2.y) ?? unit(seg.to.x - from.x, seg.to.y - from.y) ?? { x: 1, y: 0 };
  }
  function fitCubic(samples, tan1, tan2) {
    const n = samples.length;
    const p0 = samples[0];
    const p3 = samples[n - 1];
    if (p0 === void 0 || p3 === void 0 || n < 2) return null;
    const u = new Float64Array(n);
    let total = 0;
    for (let i = 1; i < n; i++) {
      const prev = samples[i - 1];
      const cur = samples[i];
      if (prev === void 0 || cur === void 0) continue;
      total += Math.hypot(cur.x - prev.x, cur.y - prev.y);
      u[i] = total;
    }
    if (total < 1e-6) return null;
    for (let i = 0; i < n; i++) u[i] = (u[i] ?? 0) / total;
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    for (let i = 0; i < n; i++) {
      const t = u[i] ?? 0;
      const mt = 1 - t;
      const b1 = 3 * mt * mt * t;
      const b2 = 3 * mt * t * t;
      const b0 = mt * mt * mt;
      const b3 = t * t * t;
      const targetX = (samples[i]?.x ?? 0) - (b0 * p0.x + b3 * p3.x);
      const targetY = (samples[i]?.y ?? 0) - (b0 * p0.y + b3 * p3.y);
      const v1x = b1 * tan1.x;
      const v1y = b1 * tan1.y;
      const v2x = b2 * -tan2.x;
      const v2y = b2 * -tan2.y;
      c00 += v1x * v1x + v1y * v1y;
      c01 += v1x * v2x + v1y * v2y;
      c11 += v2x * v2x + v2y * v2y;
      x0 += v1x * targetX + v1y * targetY;
      x1 += v2x * targetX + v2y * targetY;
    }
    const det = c00 * c11 - c01 * c01;
    const fallback = total / 3;
    let alpha = fallback;
    let beta = fallback;
    if (Math.abs(det) > 1e-10) {
      alpha = (x0 * c11 - x1 * c01) / det;
      beta = (x1 * c00 - x0 * c01) / det;
    }
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > total * 3) alpha = fallback;
    if (!Number.isFinite(beta) || beta <= 0 || beta > total * 3) beta = fallback;
    return {
      c1: { x: p0.x + tan1.x * alpha, y: p0.y + tan1.y * alpha },
      c2: { x: p3.x - tan2.x * beta, y: p3.y - tan2.y * beta }
    };
  }
  function toRing(sub) {
    const points = [sub.start];
    const segs = [];
    for (const seg of sub.segs) {
      if (sub.closed && same(seg.to, sub.start) && segs.length === sub.segs.length - 1 && points.length > 1) {
        segs.push(seg);
        break;
      }
      if (same(seg.to, points[points.length - 1] ?? seg.to) && seg.kind === "L") continue;
      points.push(seg.to);
      segs.push(seg);
    }
    if (sub.closed && points.length > 1 && same(points[points.length - 1] ?? sub.start, sub.start)) {
      points.pop();
    }
    const spans = [];
    for (let i = 0; i < segs.length; i++) {
      const from = points[i] ?? points[0];
      const seg = segs[i];
      if (from === void 0 || seg === void 0) continue;
      const origin = sampleSeg(from, seg, 8).slice(0, -1).map((p) => ({ p, tol: 0.5 }));
      spans.push({ seg, origin });
    }
    return { points, spans, closed: sub.closed };
  }
  function fromRing(ring) {
    const start2 = ring.points[0];
    if (start2 === void 0) return { start: { x: 0, y: 0 }, segs: [], closed: ring.closed };
    return { start: start2, segs: ring.spans.map((span) => span.seg), closed: ring.closed };
  }
  function sampleGrad(grad, width, height, p) {
    const x = Math.max(0, Math.min(width - 1, Math.round(p.x)));
    const y = Math.max(0, Math.min(height - 1, Math.round(p.y)));
    return grad[y * width + x] ?? 0;
  }
  function assignedTolerance(origin, grad, width, height, opt) {
    return origin.map((sample) => {
      const strength = sampleGrad(grad, width, height, sample.p);
      const tol = strength < opt.weakGradient ? opt.simplify * opt.weakScale : opt.simplify;
      return { p: sample.p, tol };
    });
  }
  function withinTolerance(samples, a, seg) {
    if (seg.kind === "L") {
      return samples.every((sample) => pointLineDistance(sample.p, a, seg.to) <= sample.tol + 1e-6);
    }
    const pts = samples.map((sample) => sample.p);
    const err = maxErrorToCubic(pts, a, seg.c1, seg.c2, seg.to);
    if (err === 0) return true;
    const flat = [a];
    flattenCubic(a, seg.c1, seg.c2, seg.to, 0.3, flat, 0);
    for (const sample of samples) {
      let best = Infinity;
      for (let i = 1; i < flat.length; i++) {
        const u = flat[i - 1];
        const v = flat[i];
        if (u === void 0 || v === void 0) continue;
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((sample.p.x - u.x) * dx + (sample.p.y - u.y) * dy) / len2));
        best = Math.min(best, Math.hypot(sample.p.x - (u.x + dx * t), sample.p.y - (u.y + dy * t)));
      }
      if (best > sample.tol + 1e-6) return false;
    }
    return true;
  }
  function simplifyRing(ring, grad, width, height, opt) {
    if (!opt.adaptive || opt.simplify <= 0) return ring;
    const points = ring.points.map((p) => ({ x: p.x, y: p.y }));
    const spans = ring.spans.map((span) => ({ seg: span.seg, origin: assignedTolerance(span.origin, grad, width, height, opt) }));
    const closed = ring.closed;
    const count = () => points.length;
    for (let pass = 0; pass < 6; pass++) {
      let removed = false;
      let i = 0;
      while (i < count()) {
        const n = count();
        if (n <= (closed ? 4 : 2)) break;
        if (!closed && (i === 0 || i === n - 1)) {
          i++;
          continue;
        }
        const prev = (i - 1 + n) % n;
        const next = (i + 1) % n;
        const a = points[prev];
        const b = points[i];
        const c = points[next];
        const spanIn = closed ? spans[prev] : spans[i - 1];
        const spanOut = spans[i];
        if (a === void 0 || b === void 0 || c === void 0 || spanIn === void 0 || spanOut === void 0) {
          i++;
          continue;
        }
        if (deflection(a, b, c) >= opt.cornerThreshold) {
          i++;
          continue;
        }
        const origin = spanIn.origin.concat(spanOut.origin);
        const line = { kind: "L", to: { x: c.x, y: c.y } };
        let replacement = withinTolerance(origin, a, line) ? line : null;
        if (replacement === null) {
          const fit = fitCubic(origin.map((sample) => sample.p), startTangent(a, spanIn.seg), endTangent(b, spanOut.seg));
          if (fit !== null) {
            const cubic = { kind: "C", c1: fit.c1, c2: fit.c2, to: { x: c.x, y: c.y } };
            if (withinTolerance(origin, a, cubic)) replacement = cubic;
          }
        }
        if (replacement === null) {
          i++;
          continue;
        }
        const merged = { seg: replacement, origin };
        points.splice(i, 1);
        if (closed) {
          spans[prev] = merged;
          spans.splice(i === 0 ? 0 : i, 1);
        } else {
          spans[i - 1] = merged;
          spans.splice(i, 1);
        }
        removed = true;
        if (i >= points.length) break;
      }
      if (!removed) break;
    }
    if (closed && spans.length !== points.length) return ring;
    if (!closed && spans.length !== points.length - 1) return ring;
    return { points, spans, closed };
  }
  function signedArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === void 0 || b === void 0) continue;
      sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
  }
  function ellipseError(points, cx, cy, rx, ry, rot) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    let max = 0;
    for (const p of points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const r = Math.hypot(lx / rx, ly / ry);
      if (r < 1e-6) {
        max = Math.max(max, Math.max(rx, ry));
        continue;
      }
      const ex = lx / r * rx;
      const ey = ly / r * ry;
      max = Math.max(max, Math.hypot(lx - ex, ly - ey));
    }
    return max;
  }
  function fitEllipse(points) {
    const n = points.length;
    if (n < 8) return null;
    let cx = 0;
    let cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    cx /= n;
    cy /= n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    sxx /= n;
    syy /= n;
    sxy /= n;
    const trace = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const disc = Math.max(0, trace * trace - 4 * det);
    const l1 = (trace + Math.sqrt(disc)) / 2;
    const l2 = (trace - Math.sqrt(disc)) / 2;
    if (l1 <= 1e-6 || l2 <= 1e-6) return null;
    const rot = Math.abs(sxy) < 1e-8 && sxx >= syy ? 0 : Math.atan2(l1 - sxx, sxy);
    const rx = Math.sqrt(2 * l1);
    const ry = Math.sqrt(2 * l2);
    if (rx < 2 || ry < 2) return null;
    return { cx, cy, rx, ry, rot, error: ellipseError(points, cx, cy, rx, ry, rot) };
  }
  function ellipseRing(cx, cy, rx, ry, rot, clockwise) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const map = (x, y) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
    const sign = clockwise ? -1 : 1;
    const k = KAPPA;
    const raw = [
      map(rx, 0),
      map(rx, sign * ry * k),
      map(rx * k, sign * ry),
      map(0, sign * ry),
      map(-rx * k, sign * ry),
      map(-rx, sign * ry * k),
      map(-rx, 0),
      map(-rx, -sign * ry * k),
      map(-rx * k, -sign * ry),
      map(0, -sign * ry),
      map(rx * k, -sign * ry),
      map(rx, -sign * ry * k),
      map(rx, 0)
    ];
    const start2 = raw[0];
    if (start2 === void 0) return { points: [], spans: [], closed: true };
    const points = [start2, raw[3], raw[6], raw[9]];
    const spans = [];
    for (let i = 0; i < 4; i++) {
      const c1 = raw[i * 3 + 1];
      const c2 = raw[i * 3 + 2];
      const to = raw[i * 3 + 3];
      if (c1 === void 0 || c2 === void 0 || to === void 0) continue;
      const seg = { kind: "C", c1, c2, to };
      const from = points[i];
      const origin = from === void 0 ? [] : sampleSeg(from, seg, 6).slice(0, -1).map((p) => ({ p, tol: 0.5 }));
      spans.push({ seg, origin });
    }
    return { points, spans, closed: true };
  }
  function contourPoints(ring) {
    const pts = [];
    for (let i = 0; i < ring.spans.length; i++) {
      const from = ring.points[i];
      const span = ring.spans[i];
      if (from === void 0 || span === void 0) continue;
      const samples = sampleSeg(from, span.seg, 6);
      for (let s = 0; s < samples.length - 1; s++) {
        const p = samples[s];
        if (p !== void 0) pts.push(p);
      }
    }
    return pts;
  }
  function maybeEllipse(ring, tolerance) {
    if (!ring.closed || ring.points.length < 6) return ring;
    const samples = contourPoints(ring);
    const fit = fitEllipse(samples);
    if (fit === null || fit.error > tolerance) return ring;
    const area = signedArea(samples);
    return ellipseRing(fit.cx, fit.cy, fit.rx, fit.ry, fit.rot, area < 0);
  }
  function processSvg(svg, grad, width, height, opt) {
    const fills = /* @__PURE__ */ new Set();
    let paths = 0;
    const next = svg.replace(/<path\b([^>]*)>/g, (full, attrs) => {
      paths++;
      const fill = /fill="([^"]+)"/.exec(attrs);
      if (fill?.[1]) fills.add(fill[1].toLowerCase());
      const found = /\bd="([^"]*)"/.exec(attrs);
      const d = found?.[1];
      if (d === void 0) return full;
      const parsed = parsePathData(d);
      if (parsed.unsupported) return full;
      const subpaths = parsed.subpaths.map((sub) => {
        let ring = toRing(sub);
        if (grad !== null) ring = simplifyRing(ring, grad, width, height, opt);
        if (opt.ellipseFit) ring = maybeEllipse(ring, opt.ellipseTolerance);
        return fromRing(ring);
      });
      const emitted = emitSubpaths(subpaths, opt.precision);
      const updated = attrs.replace(/\bd="[^"]*"/, ' d="' + emitted + '"');
      return "<path" + updated + ">";
    });
    return { svg: next, stats: analyzeSvg(next, fills.size, paths) };
  }
  function anchorCount(sub) {
    if (sub.segs.length === 0) return 1;
    let n = 1;
    for (let i = 0; i < sub.segs.length; i++) {
      const seg = sub.segs[i];
      if (seg === void 0) continue;
      if (sub.closed && i === sub.segs.length - 1 && same(seg.to, sub.start)) continue;
      n++;
    }
    return n;
  }
  function cornersOf(sub, threshold) {
    const ring = toRing(sub);
    const pts = ring.points;
    const n = pts.length;
    if (n < 3) return 0;
    let corners = 0;
    const last = ring.closed ? n : n - 1;
    const first = ring.closed ? 0 : 1;
    for (let i = first; i < last; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      if (a === void 0 || b === void 0 || c === void 0) continue;
      if (deflection(a, b, c) >= threshold) corners++;
    }
    return corners;
  }
  function analyzeSvg(svg, knownFills, knownPaths) {
    let paths = 0;
    let nodes = 0;
    let corners45 = 0;
    const fills = /* @__PURE__ */ new Set();
    const re = /<path\b([^>]*)>/g;
    let match;
    while ((match = re.exec(svg)) !== null) {
      paths++;
      const attrs = match[1] ?? "";
      const fill = /fill="([^"]+)"/.exec(attrs);
      if (fill?.[1]) fills.add(fill[1].toLowerCase());
      const d = /\bd="([^"]*)"/.exec(attrs)?.[1];
      if (d === void 0) continue;
      const parsed = parsePathData(d);
      for (const sub of parsed.subpaths) {
        nodes += anchorCount(sub);
        corners45 += cornersOf(sub, 45);
      }
    }
    return {
      paths: knownPaths ?? paths,
      nodes,
      corners45,
      fills: knownFills ?? fills.size
    };
  }

  // src/raster.ts
  var fs = __toESM(__require("fs"));
  var import_pngjs = __toESM(require_png());
  function readPng(file) {
    const png = import_pngjs.PNG.sync.read(fs.readFileSync(file));
    return { width: png.width, height: png.height, data: png.data };
  }
  function writePng(file, raster) {
    const png = new import_pngjs.PNG({ width: raster.width, height: raster.height });
    png.data = raster.data;
    fs.writeFileSync(file, import_pngjs.PNG.sync.write(png));
  }
  function areaDownscale(src, maxEdge) {
    const longEdge = Math.max(src.width, src.height);
    if (maxEdge <= 0 || longEdge <= maxEdge) return src;
    const scale = maxEdge / longEdge;
    const dw = Math.max(1, Math.round(src.width * scale));
    const dh = Math.max(1, Math.round(src.height * scale));
    const dst = Buffer.alloc(dw * dh * 4);
    const sw = src.width;
    const sh = src.height;
    const sd = src.data;
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * sh / dh);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / dh));
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * sw / dw);
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / dw));
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let weight = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy++) {
          let i = (yy * sw + x0) * 4;
          for (let xx = x0; xx < x1; xx++) {
            const al = sd[i + 3] ?? 0;
            a += al;
            n++;
            if (al > 0) {
              r += (sd[i] ?? 0) * al;
              g += (sd[i + 1] ?? 0) * al;
              b += (sd[i + 2] ?? 0) * al;
              weight += al;
            }
            i += 4;
          }
        }
        const o = (y * dw + x) * 4;
        dst[o] = weight > 0 ? Math.round(r / weight) : 0;
        dst[o + 1] = weight > 0 ? Math.round(g / weight) : 0;
        dst[o + 2] = weight > 0 ? Math.round(b / weight) : 0;
        dst[o + 3] = n > 0 ? Math.round(a / n) : 0;
      }
    }
    return { width: dw, height: dh, data: dst };
  }
  function bilinear2x(src) {
    const sw = src.width;
    const sh = src.height;
    const dw = sw * 2;
    const dh = sh * 2;
    const dst = Buffer.alloc(dw * dh * 4);
    const sd = src.data;
    const at = (x, y, c) => {
      const xx = Math.max(0, Math.min(sw - 1, x));
      const yy = Math.max(0, Math.min(sh - 1, y));
      return sd[(yy * sw + xx) * 4 + c] ?? 0;
    };
    for (let y = 0; y < dh; y++) {
      const sy = (y + 0.5) / 2 - 0.5;
      const y0 = Math.floor(sy);
      const fy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = (x + 0.5) / 2 - 0.5;
        const x0 = Math.floor(sx);
        const fx = sx - x0;
        const o = (y * dw + x) * 4;
        for (let c = 0; c < 4; c++) {
          const v = at(x0, y0, c) * (1 - fx) * (1 - fy) + at(x0 + 1, y0, c) * fx * (1 - fy) + at(x0, y0 + 1, c) * (1 - fx) * fy + at(x0 + 1, y0 + 1, c) * fx * fy;
          dst[o + c] = Math.round(v);
        }
      }
    }
    return { width: dw, height: dh, data: dst };
  }
  function gatedDenoise(src, threshold, passes) {
    const limit = threshold * threshold;
    let current = src.data;
    const w = src.width;
    const h = src.height;
    for (let pass = 0; pass < passes; pass++) {
      const next = Buffer.alloc(current.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const a0 = current[i + 3] ?? 0;
          if (a0 < 128) {
            next[i] = current[i] ?? 0;
            next[i + 1] = current[i + 1] ?? 0;
            next[i + 2] = current[i + 2] ?? 0;
            next[i + 3] = a0;
            continue;
          }
          const r0 = current[i] ?? 0;
          const g0 = current[i + 1] ?? 0;
          const b0 = current[i + 2] ?? 0;
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              const j = (yy * w + xx) * 4;
              if ((current[j + 3] ?? 0) < 128) continue;
              const dr = (current[j] ?? 0) - r0;
              const dg = (current[j + 1] ?? 0) - g0;
              const db = (current[j + 2] ?? 0) - b0;
              if (dr * dr + dg * dg + db * db > limit) continue;
              r += current[j] ?? 0;
              g += current[j + 1] ?? 0;
              b += current[j + 2] ?? 0;
              n++;
            }
          }
          next[i] = n > 0 ? Math.round(r / n) : r0;
          next[i + 1] = n > 0 ? Math.round(g / n) : g0;
          next[i + 2] = n > 0 ? Math.round(b / n) : b0;
          next[i + 3] = a0;
        }
      }
      current = next;
    }
    return { width: w, height: h, data: current };
  }
  function srgbToLinear(channel) {
    const x = channel / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }
  function linearToSrgb(channel) {
    const x = channel <= 31308e-7 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(255, Math.max(0, x * 255)));
  }
  function rgbToOklab(r, g, b) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return {
      L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    };
  }
  function oklabToRgb(lab) {
    const l = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    const m = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    const s = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;
    const l3 = l * l * l;
    const m3 = m * m * m;
    const s3 = s * s * s;
    const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    const b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
    return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
  }
  function hexOf(r, g, b) {
    const h = (n) => n.toString(16).padStart(2, "0");
    return "#" + h(r) + h(g) + h(b);
  }
  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function collectSamples(raster) {
    const w = raster.width;
    const h = raster.height;
    const data = raster.data;
    const opaque = [];
    const dark = [];
    const stride = Math.max(1, Math.floor(Math.sqrt(w * h / 7e3)));
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const i = (y * w + x) * 4;
        if ((data[i + 3] ?? 0) < 200) continue;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const lab = rgbToOklab(r, g, b);
        if (luminance(r, g, b) < 48 && dark.length < 900) dark.push(lab.L, lab.a, lab.b);
        else opaque.push(lab.L, lab.a, lab.b);
      }
    }
    if (opaque.length > 6e3 * 3) opaque.length = 6e3 * 3;
    const merged = opaque.concat(dark);
    return Float64Array.from(merged);
  }
  function nearestIndex(points, index, centers, k) {
    const L = points[index * 3] ?? 0;
    const a = points[index * 3 + 1] ?? 0;
    const b = points[index * 3 + 2] ?? 0;
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dL = L - (centers[c * 3] ?? 0);
      const da = a - (centers[c * 3 + 1] ?? 0);
      const db = b - (centers[c * 3 + 2] ?? 0);
      const d = dL * dL + da * da + db * db;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return { index: best, dist: bestD };
  }
  function kmeans(points, k) {
    const n = Math.floor(points.length / 3);
    const centers = new Float64Array(k * 3);
    if (n === 0) return { centers, inertia: 0 };
    const used = /* @__PURE__ */ new Set();
    let first = 0;
    used.add(first);
    centers[0] = points[0] ?? 0;
    centers[1] = points[1] ?? 0;
    centers[2] = points[2] ?? 0;
    for (let c = 1; c < k; c++) {
      let far = 0;
      let farD = -1;
      for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;
        const hit = nearestIndex(points, i, centers, c);
        if (hit.dist > farD) {
          farD = hit.dist;
          far = i;
        }
      }
      used.add(far);
      centers[c * 3] = points[far * 3] ?? 0;
      centers[c * 3 + 1] = points[far * 3 + 1] ?? 0;
      centers[c * 3 + 2] = points[far * 3 + 2] ?? 0;
    }
    const assign = new Int32Array(n);
    for (let iter = 0; iter < 12; iter++) {
      const sum = new Float64Array(k * 3);
      const count = new Int32Array(k);
      for (let i = 0; i < n; i++) {
        const hit = nearestIndex(points, i, centers, k);
        assign[i] = hit.index;
        const base = hit.index * 3;
        const point = i * 3;
        sum[base] = (sum[base] ?? 0) + (points[point] ?? 0);
        sum[base + 1] = (sum[base + 1] ?? 0) + (points[point + 1] ?? 0);
        sum[base + 2] = (sum[base + 2] ?? 0) + (points[point + 2] ?? 0);
        count[hit.index] = (count[hit.index] ?? 0) + 1;
      }
      for (let c = 0; c < k; c++) {
        const cnt = count[c] ?? 0;
        if (cnt === 0) {
          let far = 0;
          let farD = -1;
          for (let i = 0; i < n; i++) {
            const hit = nearestIndex(points, i, centers, k);
            if (hit.dist > farD) {
              farD = hit.dist;
              far = i;
            }
          }
          centers[c * 3] = points[far * 3] ?? 0;
          centers[c * 3 + 1] = points[far * 3 + 1] ?? 0;
          centers[c * 3 + 2] = points[far * 3 + 2] ?? 0;
        } else {
          centers[c * 3] = (sum[c * 3] ?? 0) / cnt;
          centers[c * 3 + 1] = (sum[c * 3 + 1] ?? 0) / cnt;
          centers[c * 3 + 2] = (sum[c * 3 + 2] ?? 0) / cnt;
        }
      }
    }
    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += nearestIndex(points, i, centers, k).dist;
    return { centers, inertia: n > 0 ? inertia / n : 0 };
  }
  function rmseK(ks, inertias, rmse) {
    const limit = rmse * rmse;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (k !== void 0 && (inertias[i] ?? Infinity) <= limit) return k;
    }
    return ks[ks.length - 1] ?? 8;
  }
  function elbowK(ks, inertias) {
    const n = ks.length;
    const firstK = ks[0];
    const lastK = ks[n - 1];
    if (firstK === void 0 || lastK === void 0 || n === 0) return 8;
    if (n === 1) return firstK;
    const y0 = inertias[0] ?? 0;
    const y1 = inertias[n - 1] ?? 0;
    let bestK = firstK;
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const k = ks[i];
      if (k === void 0) continue;
      const x = (k - firstK) / (lastK - firstK || 1);
      const y = ((inertias[i] ?? 0) - y1) / (y0 - y1 || 1);
      const gap = 1 - x - y;
      if (gap > best) {
        best = gap;
        bestK = k;
      }
    }
    return bestK;
  }
  function detectPalette(raster, minK, maxK, exact, rule = "rmse", rmse = 0.02) {
    const cap = Math.max(2, Math.min(32, maxK));
    const floor = Math.max(2, Math.min(cap, minK));
    const samples = collectSamples(raster);
    const tried = [];
    const inertias = [];
    const fits = /* @__PURE__ */ new Map();
    if (exact !== null) {
      const k = Math.max(2, Math.min(32, exact));
      const fit = kmeans(samples, k);
      fits.set(k, fit.centers);
      tried.push(k);
      inertias.push(fit.inertia);
    } else {
      for (let k = floor; k <= cap; k += 2) {
        const fit = kmeans(samples, k);
        fits.set(k, fit.centers);
        tried.push(k);
        inertias.push(fit.inertia);
      }
      if (cap % 2 === 1 || (tried[tried.length - 1] ?? 0) !== cap) {
        const fit = kmeans(samples, cap);
        fits.set(cap, fit.centers);
        tried.push(cap);
        inertias.push(fit.inertia);
      }
    }
    const chosen = exact !== null ? Math.max(2, Math.min(32, exact)) : rule === "rmse" ? rmseK(tried, inertias, rmse) : elbowK(tried, inertias);
    const centers = fits.get(chosen) ?? kmeans(samples, chosen).centers;
    const lab = [];
    const hex = [];
    const seen = /* @__PURE__ */ new Set();
    for (let c = 0; c < chosen; c++) {
      const color = { L: centers[c * 3] ?? 0, a: centers[c * 3 + 1] ?? 0, b: centers[c * 3 + 2] ?? 0 };
      const [r, g, b] = oklabToRgb(color);
      const text = hexOf(r, g, b);
      if (seen.has(text)) continue;
      seen.add(text);
      lab.push(color);
      hex.push(text);
    }
    return { hex, lab, inertia: inertias, triedK: tried };
  }
  function snapToPalette(src, palette) {
    const bins = 32;
    const lut = new Int16Array(bins * bins * bins);
    lut.fill(-1);
    const nearest = (r, g, b) => {
      const lab = rgbToOklab(r, g, b);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < palette.length; i++) {
        const c = palette[i];
        if (c === void 0) continue;
        const dL = lab.L - c.L;
        const da = lab.a - c.a;
        const db = lab.b - c.b;
        const d = dL * dL + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    const rgb = palette.map((c) => oklabToRgb(c));
    const dst = Buffer.from(src.data);
    const w = src.width;
    const h = src.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if ((dst[i + 3] ?? 0) < 128) continue;
        const r = dst[i] ?? 0;
        const g = dst[i + 1] ?? 0;
        const b = dst[i + 2] ?? 0;
        const key = r >> 3 << 10 | g >> 3 << 5 | b >> 3;
        let idx = lut[key] ?? -1;
        if (idx < 0) {
          idx = nearest(r, g, b);
          lut[key] = idx;
        }
        const color = rgb[idx];
        if (color === void 0) continue;
        dst[i] = color[0];
        dst[i + 1] = color[1];
        dst[i + 2] = color[2];
      }
    }
    return { width: w, height: h, data: dst };
  }
  function gradientMagnitude(raster) {
    const w = raster.width;
    const h = raster.height;
    const data = raster.data;
    const mag = new Float32Array(w * h);
    const lum = (x, y) => {
      const xx = Math.max(0, Math.min(w - 1, x));
      const yy = Math.max(0, Math.min(h - 1, y));
      const i = (yy * w + xx) * 4;
      if ((data[i + 3] ?? 0) < 128) return 0;
      return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = -lum(x - 1, y - 1) + lum(x + 1, y - 1) + -2 * lum(x - 1, y) + 2 * lum(x + 1, y) + -lum(x - 1, y + 1) + lum(x + 1, y + 1);
        const gy = -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1) + lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);
        mag[y * w + x] = Math.hypot(gx, gy);
      }
    }
    return mag;
  }

  // src/engine.ts
  var PRESET_UI = {
    fast: { colors: 16, simplify: 1.6, autoPalette: true },
    balanced: { colors: 16, simplify: 1.6, autoPalette: true },
    detail: { colors: 24, simplify: 1.4, autoPalette: true }
  };
  var SPEED = {
    fast: {
      id: "fast",
      legacy: false,
      maxEdge: 2109,
      denoise: "gated",
      denoisePasses: 2,
      denoiseThreshold: 34,
      supersample: 1,
      paletteMode: "auto",
      paletteMin: 2,
      paletteCap: 16,
      paletteRule: "rmse",
      paletteRmse: 0.02,
      snapPalette: true,
      passPalette: true,
      vtracerPreset: "poster",
      hierarchical: "stacked",
      mode: "spline",
      clustering: "color-cluster",
      filterSpeckle: 5,
      colorPrecision: 8,
      gradientStep: 48,
      cornerThreshold: 80,
      simplify: 1.6,
      optimize: 1,
      pathPrecision: 2,
      adaptive: true,
      weakGradient: 90,
      weakScale: 2.2,
      ellipseFit: true,
      ellipseTolerance: 0.9
    },
    balanced: {
      id: "balanced",
      legacy: false,
      maxEdge: 2109,
      denoise: "gated",
      denoisePasses: 2,
      denoiseThreshold: 34,
      supersample: 1,
      paletteMode: "auto",
      paletteMin: 2,
      paletteCap: 16,
      paletteRule: "rmse",
      paletteRmse: 0.02,
      snapPalette: true,
      passPalette: true,
      vtracerPreset: "poster",
      hierarchical: "stacked",
      mode: "spline",
      clustering: "color-cluster",
      filterSpeckle: 5,
      colorPrecision: 8,
      gradientStep: 48,
      cornerThreshold: 90,
      simplify: 1.6,
      optimize: 1,
      pathPrecision: 2,
      adaptive: true,
      weakGradient: 90,
      weakScale: 2.2,
      ellipseFit: true,
      ellipseTolerance: 0.9
    },
    detail: {
      id: "detail",
      legacy: false,
      maxEdge: 2800,
      denoise: "gated",
      denoisePasses: 1,
      denoiseThreshold: 28,
      supersample: 1,
      paletteMode: "auto",
      paletteMin: 2,
      paletteCap: 24,
      paletteRule: "rmse",
      paletteRmse: 0.016,
      snapPalette: true,
      passPalette: true,
      vtracerPreset: "poster",
      hierarchical: "stacked",
      mode: "spline",
      clustering: "color-cluster",
      filterSpeckle: 5,
      colorPrecision: 8,
      gradientStep: 48,
      cornerThreshold: 130,
      simplify: 1.4,
      optimize: 1,
      pathPrecision: 2,
      adaptive: true,
      weakGradient: 90,
      weakScale: 2.2,
      ellipseFit: true,
      ellipseTolerance: 0.9
    }
  };
  function speedSpec(preset, maxColors, simplify, manualPalette) {
    const base = SPEED[preset];
    return {
      ...base,
      paletteMode: manualPalette ? "fixed" : "auto",
      paletteCap: maxColors,
      simplify
    };
  }
  function legacyArguments(input, output, spec) {
    const args = [input, output];
    if (spec.id === "legacy-photo") {
      args.push("--preset", "photo", "--max-colors", String(spec.paletteCap));
    } else {
      args.push("--preset", "poster", "--hierarchical", "cutout", "--max-colors", String(spec.paletteCap));
      if (spec.id === "legacy-icon") args.push("--mode", "polygon");
    }
    if (spec.simplify > 0) args.push("--simplify", String(roundNum(spec.simplify)));
    args.push("--optimize", "1");
    return args;
  }
  function roundNum(value) {
    return String(Math.round(value * 1e3) / 1e3);
  }
  function modernArguments(input, output, spec, palette) {
    const scale = spec.supersample;
    const args = [input, output];
    if (spec.vtracerPreset !== "none") args.push("--preset", spec.vtracerPreset);
    if (spec.clustering !== "color-cluster") args.push("--clustering", spec.clustering);
    args.push("--hierarchical", spec.hierarchical, "--mode", spec.mode);
    args.push("--filter-speckle", String(Math.max(0, Math.min(128, Math.round(spec.filterSpeckle * scale)))));
    args.push("--color-precision", String(spec.colorPrecision));
    args.push("--gradient-step", String(spec.gradientStep));
    args.push("--corner-threshold", String(spec.cornerThreshold));
    if (spec.simplify > 0) args.push("--simplify", roundNum(spec.simplify * scale));
    args.push("--optimize", String(spec.optimize));
    args.push("--path-precision", String(spec.pathPrecision));
    if (spec.passPalette && palette.length > 0) args.push("--palette", palette.join(","));
    else if (spec.paletteMode === "fixed") args.push("--max-colors", String(spec.paletteCap));
    return args;
  }
  function runVtracer(binary, args, onChild) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const rssFile = path.join(os.tmpdir(), "vtracer-rss-" + process.pid + "-" + started);
      const timed = onChild === void 0 && fs2.existsSync("/usr/bin/time");
      const command = timed ? "/usr/bin/time" : binary;
      const commandArgs = timed ? ["-o", rssFile, "-f", "%M", binary, ...args] : args;
      const child = childProcess.spawn(command, commandArgs, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      onChild?.(child);
      let peak = 0;
      const timer = setInterval(() => {
        const pid = child.pid;
        if (pid === void 0) return;
        const targets = [pid];
        try {
          const children = fs2.readFileSync("/proc/" + pid + "/task/" + pid + "/children", "utf8").trim().split(/\s+/);
          for (const entry of children) if (entry) targets.push(Number(entry));
        } catch (_) {
        }
        for (const target of targets) {
          try {
            const status = fs2.readFileSync("/proc/" + target + "/status", "utf8");
            const match = /VmHWM:\s+(\d+)/.exec(status);
            if (match?.[1]) peak = Math.max(peak, Number(match[1]));
          } catch (_) {
          }
        }
      }, 10);
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        if (stderr.length < 4e3) stderr += chunk.toString("utf8").slice(0, 4e3 - stderr.length);
      });
      child.once("error", (error) => {
        clearInterval(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearInterval(timer);
        if (timed) {
          try {
            const text = fs2.readFileSync(rssFile, "utf8").trim();
            const value = Number(text.split(/\s+/)[0]);
            if (Number.isFinite(value)) peak = Math.max(peak, value);
          } catch (_) {
          }
          try {
            fs2.rmSync(rssFile, { force: true });
          } catch (_) {
          }
        }
        if (code === 0) resolve({ ms: Date.now() - started, peakRssKb: peak });
        else reject(new Error("VTracer \u0E41\u0E1B\u0E25\u0E07\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" + (stderr ? ": " + stderr.trim() : "")));
      });
    });
  }
  function prepare(input, spec) {
    let raster = spec.maxEdge > 0 ? areaDownscale(input, spec.maxEdge) : input;
    if (spec.denoise === "gated" && spec.denoisePasses > 0) {
      raster = gatedDenoise(raster, spec.denoiseThreshold, spec.denoisePasses);
    }
    let palette = [];
    let triedK = [];
    let inertia = [];
    if (spec.paletteMode !== "off") {
      const exact = spec.paletteMode === "fixed" ? spec.paletteCap : null;
      const detected = detectPalette(raster, spec.paletteMin, spec.paletteCap, exact, spec.paletteRule, spec.paletteRmse);
      palette = detected.hex;
      triedK = detected.triedK;
      inertia = detected.inertia;
      if (spec.snapPalette && detected.lab.length > 0) raster = snapToPalette(raster, detected.lab);
    }
    if (spec.supersample === 2) raster = bilinear2x(raster);
    return { raster, palette, triedK, inertia };
  }
  async function traceFile(options) {
    const pipelineStarted = Date.now();
    const spec = options.spec;
    let palette = [];
    let triedK = [];
    let inertia = [];
    let workingWidth = 0;
    let workingHeight = 0;
    let prepared = null;
    const preprocessStarted = Date.now();
    let traceInput = options.inputPath;
    if (!spec.legacy) {
      const preparedRaster = prepare(readPng(options.inputPath), spec);
      if (options.isCancelled?.()) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
      writePng(options.preparedPath, preparedRaster.raster);
      prepared = preparedRaster.raster;
      palette = preparedRaster.palette;
      triedK = preparedRaster.triedK;
      inertia = preparedRaster.inertia;
      workingWidth = preparedRaster.raster.width;
      workingHeight = preparedRaster.raster.height;
      traceInput = options.preparedPath;
    }
    const preprocessMs = Date.now() - preprocessStarted;
    const args = spec.legacy ? legacyArguments(traceInput, options.outputPath, spec) : modernArguments(traceInput, options.outputPath, spec, palette);
    const traced = await runVtracer(options.binary, args, options.onChild);
    if (options.isCancelled?.()) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    const postStarted = Date.now();
    let svg = fs2.readFileSync(options.outputPath, "utf8");
    let stats = analyzeSvg(svg);
    if (!spec.legacy && prepared !== null && (spec.adaptive || spec.ellipseFit)) {
      const scale = spec.supersample;
      const processed = processSvg(svg, gradientMagnitude(prepared), prepared.width, prepared.height, {
        simplify: spec.simplify * scale,
        cornerThreshold: spec.cornerThreshold,
        weakGradient: spec.weakGradient,
        weakScale: spec.weakScale,
        adaptive: spec.adaptive,
        ellipseFit: spec.ellipseFit,
        ellipseTolerance: spec.ellipseTolerance * scale,
        precision: spec.pathPrecision
      });
      svg = processed.svg;
      stats = processed.stats;
      fs2.writeFileSync(options.outputPath, svg);
    }
    const postMs = Date.now() - postStarted;
    if (spec.legacy) {
      const size = readPng(options.inputPath);
      workingWidth = size.width;
      workingHeight = size.height;
    }
    return {
      ok: true,
      specId: spec.id,
      paletteSize: palette.length || stats.fills,
      palette,
      triedK,
      inertia,
      workingWidth,
      workingHeight,
      preprocessMs: spec.legacy ? 0 : preprocessMs,
      vtracerMs: traced.ms,
      postMs,
      pipelineMs: Date.now() - pipelineStarted,
      peakRssKb: traced.peakRssKb,
      svgBytes: Buffer.byteLength(svg),
      paths: stats.paths,
      nodes: stats.nodes,
      corners45: stats.corners45,
      fills: stats.fills,
      args,
      resolved: spec
    };
  }

  // src/panel.ts
  var HostTimeoutError = class extends Error {
    constructor() {
      super("Illustrator \u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E20\u0E32\u0E22\u0E43\u0E19\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14");
    }
  };
  function getElement(id) {
    const value = document.getElementById(id);
    if (value === null) throw new Error("Missing panel element: " + id);
    return value;
  }
  function getButton(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLButtonElement)) throw new Error("Expected button: " + id);
    return value;
  }
  function getInput(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLInputElement)) throw new Error("Expected input: " + id);
    return value;
  }
  function getOutput(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLOutputElement)) throw new Error("Expected output: " + id);
    return value;
  }
  function getUi() {
    const preview = getElement("preview");
    const preset = getElement("preset");
    if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
    if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
    return {
      selection: getElement("selection"),
      status: getElement("status"),
      phase: getElement("phase"),
      preview,
      previewEmpty: getElement("preview-empty"),
      refresh: getButton("refresh"),
      trace: getButton("trace"),
      cancel: getButton("cancel"),
      apply: getButton("apply"),
      preset,
      colors: getInput("colors"),
      colorsValue: getOutput("colors-value"),
      smooth: getInput("smooth"),
      smoothValue: getOutput("smooth-value"),
      autoPalette: getInput("auto-palette")
    };
  }
  function parseHostResult(raw) {
    if (raw === "EvalScript error.") throw new Error("Illustrator \u0E40\u0E23\u0E35\u0E22\u0E01\u0E2A\u0E04\u0E23\u0E34\u0E1B\u0E15\u0E4C\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
    const parts = raw.split("|");
    const kind = parts[0];
    if (kind === "ERR") throw new Error(decodeURIComponent(parts[1] ?? "Illustrator error"));
    if (kind !== "OK") throw new Error("Illustrator \u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E23\u0E39\u0E49\u0E08\u0E31\u0E01");
    return parts.slice(1).map((part) => decodeURIComponent(part));
  }
  function parsePositiveNumber(raw, label) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error("\u0E04\u0E48\u0E32\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: " + label);
    return value;
  }
  function parseFiniteNumber(raw, label) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("\u0E04\u0E48\u0E32\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: " + label);
    return value;
  }
  function parseSelection(parts) {
    if (parts.length !== 11) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const itemType = parts[3];
    if (itemType !== "PlacedItem" && itemType !== "RasterItem") throw new Error("\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E1E raster \u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E");
    const uuid = parts[4];
    if (!uuid) throw new Error("\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E21\u0E35 Illustrator UUID");
    const left = parseFiniteNumber(parts[5], "left");
    const top = parseFiniteNumber(parts[6], "top");
    const right = parseFiniteNumber(parts[7], "right");
    const bottom = parseFiniteNumber(parts[8], "bottom");
    return {
      documentName: parts[0] ?? "",
      documentIdentity: parts[1] ?? "",
      itemName: parts[2] ?? "",
      itemType,
      uuid,
      bounds: [left, top, right, bottom],
      widthPt: parsePositiveNumber(String(right - left), "width"),
      heightPt: parsePositiveNumber(String(top - bottom), "height"),
      embedded: parts[9] === "1",
      fromResult: parts[10] === "1"
    };
  }
  function callHost(host, method, args = []) {
    const encoded = args.map((value) => '"' + encodeURIComponent(value) + '"').join(",");
    const script = method + "(" + encoded + ")";
    return new Promise((resolve, reject) => {
      let finished = false;
      const timer = window.setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new HostTimeoutError());
      }, 18e4);
      host.evalScript(script, (raw) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        try {
          resolve(parseHostResult(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function newJob(settings) {
    const directory = fs3.mkdtempSync(path2.join(os2.tmpdir(), "vector-panel-"));
    return {
      id: crypto.randomBytes(8).toString("hex"),
      directory,
      pngPath: path2.join(directory, "source.png"),
      svgPath: path2.join(directory, "result.svg"),
      settings,
      resolvedColors: settings.maxColors,
      cancelled: false
    };
  }
  function cleanJob(job) {
    try {
      fs3.rmSync(job.directory, { recursive: true, force: true });
    } catch (_) {
    }
  }
  function cleanStaleJobs() {
    try {
      const root = os2.tmpdir();
      for (const name of fs3.readdirSync(root)) {
        if (!name.startsWith("vector-panel-")) continue;
        const directory = path2.join(root, name);
        const stat = fs3.statSync(directory);
        if (stat.isDirectory() && Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1e3) {
          fs3.rmSync(directory, { recursive: true, force: true });
        }
      }
    } catch (_) {
    }
  }
  function readSettings(ui) {
    const preset = ui.preset.value;
    if (preset !== "fast" && preset !== "balanced" && preset !== "detail") throw new Error("Preset \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    const maxColors = Number(ui.colors.value);
    const simplify = Number(ui.smooth.value) / 10;
    if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error("\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    if (!Number.isFinite(simplify) || simplify < 0 || simplify > 3) throw new Error("\u0E04\u0E48\u0E32\u0E04\u0E27\u0E32\u0E21\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    return { preset, maxColors, simplify, autoPalette: ui.autoPalette.checked };
  }
  function showSelection(ui, selection) {
    ui.selection.replaceChildren();
    if (selection === null) {
      ui.selection.textContent = "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E20\u0E32\u0E1E raster \u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E\u0E1A\u0E19 artboard";
      return;
    }
    const title = document.createElement("strong");
    title.textContent = selection.itemName || selection.itemType;
    const detail = document.createElement("small");
    detail.textContent = selection.documentName + " \xB7 " + (selection.embedded ? "embedded" : "linked") + " \xB7 " + Math.round(selection.widthPt) + " \xD7 " + Math.round(selection.heightPt) + " pt";
    if (selection.fromResult) detail.textContent += " \xB7 \u0E41\u0E1B\u0E25\u0E07\u0E0B\u0E49\u0E33\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48";
    ui.selection.append(title, detail);
  }
  function currentSelection(state) {
    switch (state.kind) {
      case "empty":
        return null;
      case "loading":
        return null;
      case "selected":
      case "capturing":
      case "tracing":
      case "preview":
      case "applying":
        return state.selection;
      default: {
        const exhaustive = state;
        return exhaustive;
      }
    }
  }
  function start() {
    const ui = getUi();
    let state = { kind: "empty" };
    const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
    const host = typeof CSInterface === "undefined" ? null : new CSInterface();
    function message(value, isError = false) {
      ui.status.textContent = value;
      ui.status.classList.toggle("error", isError);
    }
    function render() {
      showSelection(ui, currentSelection(state));
      const busy = state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying";
      ui.refresh.disabled = busy;
      ui.trace.disabled = busy || state.kind === "empty";
      ui.trace.textContent = currentSelection(state)?.fromResult ? "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48" : "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07";
      ui.apply.disabled = state.kind !== "preview";
      ui.cancel.hidden = state.kind !== "tracing";
      ui.phase.textContent = state.kind === "loading" ? "\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E" : state.kind === "capturing" ? "\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E" : state.kind === "tracing" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E1B\u0E25\u0E07" : state.kind === "applying" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E43\u0E2A\u0E48\u0E1C\u0E25" : state.kind === "preview" ? "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25" : "\u0E1E\u0E23\u0E49\u0E2D\u0E21";
      if (state.kind === "preview" || state.kind === "applying") {
        ui.preview.src = state.dataUrl;
        ui.preview.hidden = false;
        ui.previewEmpty.hidden = true;
      } else {
        ui.preview.removeAttribute("src");
        ui.preview.hidden = true;
        ui.previewEmpty.hidden = false;
      }
    }
    async function refresh() {
      if (host === null) {
        message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
        return;
      }
      if (state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying") return;
      if (state.kind === "preview") cleanJob(state.job);
      state = { kind: "loading" };
      render();
      try {
        const selection = parseSelection(await callHost(host, "VP_snapshot"));
        state = { kind: "selected", selection };
        message("\u0E20\u0E32\u0E1E\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E41\u0E1B\u0E25\u0E07");
      } catch (error) {
        state = { kind: "empty" };
        message(errorMessage(error), true);
      }
      render();
    }
    async function trace() {
      if (host === null) return;
      if (state.kind !== "selected" && state.kind !== "preview") return;
      const selection = state.selection;
      if (state.kind === "preview") cleanJob(state.job);
      let job = null;
      try {
        job = newJob(readSettings(ui));
        state = { kind: "capturing", selection, job };
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator\u2026");
        render();
        await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
        if (!fs3.existsSync(job.pngPath) || fs3.statSync(job.pngPath).size === 0) throw new Error("Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E20\u0E32\u0E1E PNG \u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32");
        const binary = path2.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
        if (!fs3.existsSync(binary)) throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A VTracer binary \u0E43\u0E19 extension/bin");
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E20\u0E32\u0E1E\u0E41\u0E25\u0E30\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C\u2026");
        const report = await traceFile({
          binary,
          inputPath: job.pngPath,
          outputPath: job.svgPath,
          preparedPath: path2.join(job.directory, "prepared.png"),
          spec: speedSpec(job.settings.preset, job.settings.maxColors, job.settings.simplify, !job.settings.autoPalette),
          isCancelled: () => job?.cancelled === true,
          onChild: (child) => {
            if (job === null) return;
            state = { kind: "tracing", selection, job, child };
            render();
          }
        });
        job.resolvedColors = report.paletteSize;
        const svg = fs3.readFileSync(job.svgPath);
        state = { kind: "preview", selection, job, dataUrl: "data:image/svg+xml;base64," + svg.toString("base64") };
        message("\u0E14\u0E39\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E43\u0E2A\u0E48\u0E43\u0E19 Illustrator");
        render();
      } catch (error) {
        if (job !== null) cleanJob(job);
        state = { kind: "selected", selection };
        message(errorMessage(error), true);
        render();
      }
    }
    async function apply() {
      if (host === null || state.kind !== "preview") return;
      const { selection, job, dataUrl } = state;
      state = { kind: "applying", selection, job, dataUrl };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E19\u0E33 path \u0E40\u0E02\u0E49\u0E32 Illustrator\u2026");
      render();
      try {
        const settings = "preset=" + job.settings.preset + ";colors=" + job.resolvedColors + ";cap=" + job.settings.maxColors + ";simplify=" + job.settings.simplify + ";auto=" + (job.settings.autoPalette ? "1" : "0");
        const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
        message("\u0E43\u0E2A\u0E48\u0E1C\u0E25\u0E41\u0E25\u0E49\u0E27: " + (result[1] ?? "0") + " paths \xB7 \u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48");
        cleanJob(job);
        state = { kind: "selected", selection };
      } catch (error) {
        if (error instanceof HostTimeoutError) {
          message("Illustrator \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A \u0E15\u0E23\u0E27\u0E08 Layers \u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E25\u0E0B\u0E49\u0E33", true);
          state = { kind: "selected", selection };
        } else {
          message(errorMessage(error), true);
          state = { kind: "preview", selection, job, dataUrl };
        }
      }
      render();
    }
    ui.refresh.addEventListener("click", () => {
      void refresh();
    });
    ui.trace.addEventListener("click", () => {
      void trace();
    });
    ui.apply.addEventListener("click", () => {
      void apply();
    });
    ui.cancel.addEventListener("click", () => {
      if (state.kind !== "tracing") return;
      state.job.cancelled = true;
      state.child.kill();
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
    });
    ui.colors.addEventListener("input", () => {
      ui.colorsValue.value = ui.colors.value;
    });
    ui.smooth.addEventListener("input", () => {
      ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
    });
    function applyPresetDefaults() {
      const preset = ui.preset.value;
      if (preset !== "fast" && preset !== "balanced" && preset !== "detail") return;
      const defaults = PRESET_UI[preset];
      ui.colors.value = String(defaults.colors);
      ui.colorsValue.value = ui.colors.value;
      ui.smooth.value = String(Math.round(defaults.simplify * 10));
      ui.smoothValue.value = defaults.simplify.toFixed(1);
      ui.autoPalette.checked = defaults.autoPalette;
    }
    ui.preset.addEventListener("change", applyPresetDefaults);
    window.addEventListener("beforeunload", () => {
      if (state.kind === "preview") cleanJob(state.job);
      if (state.kind === "tracing") {
        state.job.cancelled = true;
        state.child.kill();
        cleanJob(state.job);
      }
    });
    cleanStaleJobs();
    render();
    void refresh();
  }
  start();
})();
