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

  // node_modules/jpeg-js/lib/encoder.js
  var require_encoder = __commonJS({
    "node_modules/jpeg-js/lib/encoder.js"(exports, module) {
      var btoa = btoa || function(buf) {
        return Buffer.from(buf).toString("base64");
      };
      function JPEGEncoder(quality) {
        var self = this;
        var fround = Math.round;
        var ffloor = Math.floor;
        var YTable = new Array(64);
        var UVTable = new Array(64);
        var fdtbl_Y = new Array(64);
        var fdtbl_UV = new Array(64);
        var YDC_HT;
        var UVDC_HT;
        var YAC_HT;
        var UVAC_HT;
        var bitcode = new Array(65535);
        var category = new Array(65535);
        var outputfDCTQuant = new Array(64);
        var DU = new Array(64);
        var byteout = [];
        var bytenew = 0;
        var bytepos = 7;
        var YDU = new Array(64);
        var UDU = new Array(64);
        var VDU = new Array(64);
        var clt = new Array(256);
        var RGB_YUV_TABLE = new Array(2048);
        var currentQuality;
        var ZigZag = [
          0,
          1,
          5,
          6,
          14,
          15,
          27,
          28,
          2,
          4,
          7,
          13,
          16,
          26,
          29,
          42,
          3,
          8,
          12,
          17,
          25,
          30,
          41,
          43,
          9,
          11,
          18,
          24,
          31,
          40,
          44,
          53,
          10,
          19,
          23,
          32,
          39,
          45,
          52,
          54,
          20,
          22,
          33,
          38,
          46,
          51,
          55,
          60,
          21,
          34,
          37,
          47,
          50,
          56,
          59,
          61,
          35,
          36,
          48,
          49,
          57,
          58,
          62,
          63
        ];
        var std_dc_luminance_nrcodes = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
        var std_dc_luminance_values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        var std_ac_luminance_nrcodes = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
        var std_ac_luminance_values = [
          1,
          2,
          3,
          0,
          4,
          17,
          5,
          18,
          33,
          49,
          65,
          6,
          19,
          81,
          97,
          7,
          34,
          113,
          20,
          50,
          129,
          145,
          161,
          8,
          35,
          66,
          177,
          193,
          21,
          82,
          209,
          240,
          36,
          51,
          98,
          114,
          130,
          9,
          10,
          22,
          23,
          24,
          25,
          26,
          37,
          38,
          39,
          40,
          41,
          42,
          52,
          53,
          54,
          55,
          56,
          57,
          58,
          67,
          68,
          69,
          70,
          71,
          72,
          73,
          74,
          83,
          84,
          85,
          86,
          87,
          88,
          89,
          90,
          99,
          100,
          101,
          102,
          103,
          104,
          105,
          106,
          115,
          116,
          117,
          118,
          119,
          120,
          121,
          122,
          131,
          132,
          133,
          134,
          135,
          136,
          137,
          138,
          146,
          147,
          148,
          149,
          150,
          151,
          152,
          153,
          154,
          162,
          163,
          164,
          165,
          166,
          167,
          168,
          169,
          170,
          178,
          179,
          180,
          181,
          182,
          183,
          184,
          185,
          186,
          194,
          195,
          196,
          197,
          198,
          199,
          200,
          201,
          202,
          210,
          211,
          212,
          213,
          214,
          215,
          216,
          217,
          218,
          225,
          226,
          227,
          228,
          229,
          230,
          231,
          232,
          233,
          234,
          241,
          242,
          243,
          244,
          245,
          246,
          247,
          248,
          249,
          250
        ];
        var std_dc_chrominance_nrcodes = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
        var std_dc_chrominance_values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        var std_ac_chrominance_nrcodes = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119];
        var std_ac_chrominance_values = [
          0,
          1,
          2,
          3,
          17,
          4,
          5,
          33,
          49,
          6,
          18,
          65,
          81,
          7,
          97,
          113,
          19,
          34,
          50,
          129,
          8,
          20,
          66,
          145,
          161,
          177,
          193,
          9,
          35,
          51,
          82,
          240,
          21,
          98,
          114,
          209,
          10,
          22,
          36,
          52,
          225,
          37,
          241,
          23,
          24,
          25,
          26,
          38,
          39,
          40,
          41,
          42,
          53,
          54,
          55,
          56,
          57,
          58,
          67,
          68,
          69,
          70,
          71,
          72,
          73,
          74,
          83,
          84,
          85,
          86,
          87,
          88,
          89,
          90,
          99,
          100,
          101,
          102,
          103,
          104,
          105,
          106,
          115,
          116,
          117,
          118,
          119,
          120,
          121,
          122,
          130,
          131,
          132,
          133,
          134,
          135,
          136,
          137,
          138,
          146,
          147,
          148,
          149,
          150,
          151,
          152,
          153,
          154,
          162,
          163,
          164,
          165,
          166,
          167,
          168,
          169,
          170,
          178,
          179,
          180,
          181,
          182,
          183,
          184,
          185,
          186,
          194,
          195,
          196,
          197,
          198,
          199,
          200,
          201,
          202,
          210,
          211,
          212,
          213,
          214,
          215,
          216,
          217,
          218,
          226,
          227,
          228,
          229,
          230,
          231,
          232,
          233,
          234,
          242,
          243,
          244,
          245,
          246,
          247,
          248,
          249,
          250
        ];
        function initQuantTables(sf) {
          var YQT = [
            16,
            11,
            10,
            16,
            24,
            40,
            51,
            61,
            12,
            12,
            14,
            19,
            26,
            58,
            60,
            55,
            14,
            13,
            16,
            24,
            40,
            57,
            69,
            56,
            14,
            17,
            22,
            29,
            51,
            87,
            80,
            62,
            18,
            22,
            37,
            56,
            68,
            109,
            103,
            77,
            24,
            35,
            55,
            64,
            81,
            104,
            113,
            92,
            49,
            64,
            78,
            87,
            103,
            121,
            120,
            101,
            72,
            92,
            95,
            98,
            112,
            100,
            103,
            99
          ];
          for (var i = 0; i < 64; i++) {
            var t = ffloor((YQT[i] * sf + 50) / 100);
            if (t < 1) {
              t = 1;
            } else if (t > 255) {
              t = 255;
            }
            YTable[ZigZag[i]] = t;
          }
          var UVQT = [
            17,
            18,
            24,
            47,
            99,
            99,
            99,
            99,
            18,
            21,
            26,
            66,
            99,
            99,
            99,
            99,
            24,
            26,
            56,
            99,
            99,
            99,
            99,
            99,
            47,
            66,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99,
            99
          ];
          for (var j = 0; j < 64; j++) {
            var u = ffloor((UVQT[j] * sf + 50) / 100);
            if (u < 1) {
              u = 1;
            } else if (u > 255) {
              u = 255;
            }
            UVTable[ZigZag[j]] = u;
          }
          var aasf = [
            1,
            1.387039845,
            1.306562965,
            1.175875602,
            1,
            0.785694958,
            0.5411961,
            0.275899379
          ];
          var k = 0;
          for (var row = 0; row < 8; row++) {
            for (var col = 0; col < 8; col++) {
              fdtbl_Y[k] = 1 / (YTable[ZigZag[k]] * aasf[row] * aasf[col] * 8);
              fdtbl_UV[k] = 1 / (UVTable[ZigZag[k]] * aasf[row] * aasf[col] * 8);
              k++;
            }
          }
        }
        function computeHuffmanTbl(nrcodes, std_table) {
          var codevalue = 0;
          var pos_in_table = 0;
          var HT = new Array();
          for (var k = 1; k <= 16; k++) {
            for (var j = 1; j <= nrcodes[k]; j++) {
              HT[std_table[pos_in_table]] = [];
              HT[std_table[pos_in_table]][0] = codevalue;
              HT[std_table[pos_in_table]][1] = k;
              pos_in_table++;
              codevalue++;
            }
            codevalue *= 2;
          }
          return HT;
        }
        function initHuffmanTbl() {
          YDC_HT = computeHuffmanTbl(std_dc_luminance_nrcodes, std_dc_luminance_values);
          UVDC_HT = computeHuffmanTbl(std_dc_chrominance_nrcodes, std_dc_chrominance_values);
          YAC_HT = computeHuffmanTbl(std_ac_luminance_nrcodes, std_ac_luminance_values);
          UVAC_HT = computeHuffmanTbl(std_ac_chrominance_nrcodes, std_ac_chrominance_values);
        }
        function initCategoryNumber() {
          var nrlower = 1;
          var nrupper = 2;
          for (var cat = 1; cat <= 15; cat++) {
            for (var nr = nrlower; nr < nrupper; nr++) {
              category[32767 + nr] = cat;
              bitcode[32767 + nr] = [];
              bitcode[32767 + nr][1] = cat;
              bitcode[32767 + nr][0] = nr;
            }
            for (var nrneg = -(nrupper - 1); nrneg <= -nrlower; nrneg++) {
              category[32767 + nrneg] = cat;
              bitcode[32767 + nrneg] = [];
              bitcode[32767 + nrneg][1] = cat;
              bitcode[32767 + nrneg][0] = nrupper - 1 + nrneg;
            }
            nrlower <<= 1;
            nrupper <<= 1;
          }
        }
        function initRGBYUVTable() {
          for (var i = 0; i < 256; i++) {
            RGB_YUV_TABLE[i] = 19595 * i;
            RGB_YUV_TABLE[i + 256 >> 0] = 38470 * i;
            RGB_YUV_TABLE[i + 512 >> 0] = 7471 * i + 32768;
            RGB_YUV_TABLE[i + 768 >> 0] = -11059 * i;
            RGB_YUV_TABLE[i + 1024 >> 0] = -21709 * i;
            RGB_YUV_TABLE[i + 1280 >> 0] = 32768 * i + 8421375;
            RGB_YUV_TABLE[i + 1536 >> 0] = -27439 * i;
            RGB_YUV_TABLE[i + 1792 >> 0] = -5329 * i;
          }
        }
        function writeBits(bs) {
          var value = bs[0];
          var posval = bs[1] - 1;
          while (posval >= 0) {
            if (value & 1 << posval) {
              bytenew |= 1 << bytepos;
            }
            posval--;
            bytepos--;
            if (bytepos < 0) {
              if (bytenew == 255) {
                writeByte(255);
                writeByte(0);
              } else {
                writeByte(bytenew);
              }
              bytepos = 7;
              bytenew = 0;
            }
          }
        }
        function writeByte(value) {
          byteout.push(value);
        }
        function writeWord(value) {
          writeByte(value >> 8 & 255);
          writeByte(value & 255);
        }
        function fDCTQuant(data, fdtbl) {
          var d0, d1, d2, d3, d4, d5, d6, d7;
          var dataOff = 0;
          var i;
          var I8 = 8;
          var I64 = 64;
          for (i = 0; i < I8; ++i) {
            d0 = data[dataOff];
            d1 = data[dataOff + 1];
            d2 = data[dataOff + 2];
            d3 = data[dataOff + 3];
            d4 = data[dataOff + 4];
            d5 = data[dataOff + 5];
            d6 = data[dataOff + 6];
            d7 = data[dataOff + 7];
            var tmp0 = d0 + d7;
            var tmp7 = d0 - d7;
            var tmp1 = d1 + d6;
            var tmp6 = d1 - d6;
            var tmp2 = d2 + d5;
            var tmp5 = d2 - d5;
            var tmp3 = d3 + d4;
            var tmp4 = d3 - d4;
            var tmp10 = tmp0 + tmp3;
            var tmp13 = tmp0 - tmp3;
            var tmp11 = tmp1 + tmp2;
            var tmp12 = tmp1 - tmp2;
            data[dataOff] = tmp10 + tmp11;
            data[dataOff + 4] = tmp10 - tmp11;
            var z1 = (tmp12 + tmp13) * 0.707106781;
            data[dataOff + 2] = tmp13 + z1;
            data[dataOff + 6] = tmp13 - z1;
            tmp10 = tmp4 + tmp5;
            tmp11 = tmp5 + tmp6;
            tmp12 = tmp6 + tmp7;
            var z5 = (tmp10 - tmp12) * 0.382683433;
            var z2 = 0.5411961 * tmp10 + z5;
            var z4 = 1.306562965 * tmp12 + z5;
            var z3 = tmp11 * 0.707106781;
            var z11 = tmp7 + z3;
            var z13 = tmp7 - z3;
            data[dataOff + 5] = z13 + z2;
            data[dataOff + 3] = z13 - z2;
            data[dataOff + 1] = z11 + z4;
            data[dataOff + 7] = z11 - z4;
            dataOff += 8;
          }
          dataOff = 0;
          for (i = 0; i < I8; ++i) {
            d0 = data[dataOff];
            d1 = data[dataOff + 8];
            d2 = data[dataOff + 16];
            d3 = data[dataOff + 24];
            d4 = data[dataOff + 32];
            d5 = data[dataOff + 40];
            d6 = data[dataOff + 48];
            d7 = data[dataOff + 56];
            var tmp0p2 = d0 + d7;
            var tmp7p2 = d0 - d7;
            var tmp1p2 = d1 + d6;
            var tmp6p2 = d1 - d6;
            var tmp2p2 = d2 + d5;
            var tmp5p2 = d2 - d5;
            var tmp3p2 = d3 + d4;
            var tmp4p2 = d3 - d4;
            var tmp10p2 = tmp0p2 + tmp3p2;
            var tmp13p2 = tmp0p2 - tmp3p2;
            var tmp11p2 = tmp1p2 + tmp2p2;
            var tmp12p2 = tmp1p2 - tmp2p2;
            data[dataOff] = tmp10p2 + tmp11p2;
            data[dataOff + 32] = tmp10p2 - tmp11p2;
            var z1p2 = (tmp12p2 + tmp13p2) * 0.707106781;
            data[dataOff + 16] = tmp13p2 + z1p2;
            data[dataOff + 48] = tmp13p2 - z1p2;
            tmp10p2 = tmp4p2 + tmp5p2;
            tmp11p2 = tmp5p2 + tmp6p2;
            tmp12p2 = tmp6p2 + tmp7p2;
            var z5p2 = (tmp10p2 - tmp12p2) * 0.382683433;
            var z2p2 = 0.5411961 * tmp10p2 + z5p2;
            var z4p2 = 1.306562965 * tmp12p2 + z5p2;
            var z3p2 = tmp11p2 * 0.707106781;
            var z11p2 = tmp7p2 + z3p2;
            var z13p2 = tmp7p2 - z3p2;
            data[dataOff + 40] = z13p2 + z2p2;
            data[dataOff + 24] = z13p2 - z2p2;
            data[dataOff + 8] = z11p2 + z4p2;
            data[dataOff + 56] = z11p2 - z4p2;
            dataOff++;
          }
          var fDCTQuant2;
          for (i = 0; i < I64; ++i) {
            fDCTQuant2 = data[i] * fdtbl[i];
            outputfDCTQuant[i] = fDCTQuant2 > 0 ? fDCTQuant2 + 0.5 | 0 : fDCTQuant2 - 0.5 | 0;
          }
          return outputfDCTQuant;
        }
        function writeAPP0() {
          writeWord(65504);
          writeWord(16);
          writeByte(74);
          writeByte(70);
          writeByte(73);
          writeByte(70);
          writeByte(0);
          writeByte(1);
          writeByte(1);
          writeByte(0);
          writeWord(1);
          writeWord(1);
          writeByte(0);
          writeByte(0);
        }
        function writeAPP1(exifBuffer) {
          if (!exifBuffer) return;
          writeWord(65505);
          if (exifBuffer[0] === 69 && exifBuffer[1] === 120 && exifBuffer[2] === 105 && exifBuffer[3] === 102) {
            writeWord(exifBuffer.length + 2);
          } else {
            writeWord(exifBuffer.length + 5 + 2);
            writeByte(69);
            writeByte(120);
            writeByte(105);
            writeByte(102);
            writeByte(0);
          }
          for (var i = 0; i < exifBuffer.length; i++) {
            writeByte(exifBuffer[i]);
          }
        }
        function writeSOF0(width, height) {
          writeWord(65472);
          writeWord(17);
          writeByte(8);
          writeWord(height);
          writeWord(width);
          writeByte(3);
          writeByte(1);
          writeByte(17);
          writeByte(0);
          writeByte(2);
          writeByte(17);
          writeByte(1);
          writeByte(3);
          writeByte(17);
          writeByte(1);
        }
        function writeDQT() {
          writeWord(65499);
          writeWord(132);
          writeByte(0);
          for (var i = 0; i < 64; i++) {
            writeByte(YTable[i]);
          }
          writeByte(1);
          for (var j = 0; j < 64; j++) {
            writeByte(UVTable[j]);
          }
        }
        function writeDHT() {
          writeWord(65476);
          writeWord(418);
          writeByte(0);
          for (var i = 0; i < 16; i++) {
            writeByte(std_dc_luminance_nrcodes[i + 1]);
          }
          for (var j = 0; j <= 11; j++) {
            writeByte(std_dc_luminance_values[j]);
          }
          writeByte(16);
          for (var k = 0; k < 16; k++) {
            writeByte(std_ac_luminance_nrcodes[k + 1]);
          }
          for (var l = 0; l <= 161; l++) {
            writeByte(std_ac_luminance_values[l]);
          }
          writeByte(1);
          for (var m = 0; m < 16; m++) {
            writeByte(std_dc_chrominance_nrcodes[m + 1]);
          }
          for (var n = 0; n <= 11; n++) {
            writeByte(std_dc_chrominance_values[n]);
          }
          writeByte(17);
          for (var o = 0; o < 16; o++) {
            writeByte(std_ac_chrominance_nrcodes[o + 1]);
          }
          for (var p = 0; p <= 161; p++) {
            writeByte(std_ac_chrominance_values[p]);
          }
        }
        function writeCOM(comments) {
          if (typeof comments === "undefined" || comments.constructor !== Array) return;
          comments.forEach((e) => {
            if (typeof e !== "string") return;
            writeWord(65534);
            var l = e.length;
            writeWord(l + 2);
            var i;
            for (i = 0; i < l; i++)
              writeByte(e.charCodeAt(i));
          });
        }
        function writeSOS() {
          writeWord(65498);
          writeWord(12);
          writeByte(3);
          writeByte(1);
          writeByte(0);
          writeByte(2);
          writeByte(17);
          writeByte(3);
          writeByte(17);
          writeByte(0);
          writeByte(63);
          writeByte(0);
        }
        function processDU(CDU, fdtbl, DC, HTDC, HTAC) {
          var EOB = HTAC[0];
          var M16zeroes = HTAC[240];
          var pos;
          var I16 = 16;
          var I63 = 63;
          var I64 = 64;
          var DU_DCT = fDCTQuant(CDU, fdtbl);
          for (var j = 0; j < I64; ++j) {
            DU[ZigZag[j]] = DU_DCT[j];
          }
          var Diff = DU[0] - DC;
          DC = DU[0];
          if (Diff == 0) {
            writeBits(HTDC[0]);
          } else {
            pos = 32767 + Diff;
            writeBits(HTDC[category[pos]]);
            writeBits(bitcode[pos]);
          }
          var end0pos = 63;
          for (; end0pos > 0 && DU[end0pos] == 0; end0pos--) {
          }
          ;
          if (end0pos == 0) {
            writeBits(EOB);
            return DC;
          }
          var i = 1;
          var lng;
          while (i <= end0pos) {
            var startpos = i;
            for (; DU[i] == 0 && i <= end0pos; ++i) {
            }
            var nrzeroes = i - startpos;
            if (nrzeroes >= I16) {
              lng = nrzeroes >> 4;
              for (var nrmarker = 1; nrmarker <= lng; ++nrmarker)
                writeBits(M16zeroes);
              nrzeroes = nrzeroes & 15;
            }
            pos = 32767 + DU[i];
            writeBits(HTAC[(nrzeroes << 4) + category[pos]]);
            writeBits(bitcode[pos]);
            i++;
          }
          if (end0pos != I63) {
            writeBits(EOB);
          }
          return DC;
        }
        function initCharLookupTable() {
          var sfcc = String.fromCharCode;
          for (var i = 0; i < 256; i++) {
            clt[i] = sfcc(i);
          }
        }
        this.encode = function(image, quality2) {
          var time_start = (/* @__PURE__ */ new Date()).getTime();
          if (quality2) setQuality(quality2);
          byteout = new Array();
          bytenew = 0;
          bytepos = 7;
          writeWord(65496);
          writeAPP0();
          writeCOM(image.comments);
          writeAPP1(image.exifBuffer);
          writeDQT();
          writeSOF0(image.width, image.height);
          writeDHT();
          writeSOS();
          var DCY = 0;
          var DCU = 0;
          var DCV = 0;
          bytenew = 0;
          bytepos = 7;
          this.encode.displayName = "_encode_";
          var imageData = image.data;
          var width = image.width;
          var height = image.height;
          var quadWidth = width * 4;
          var tripleWidth = width * 3;
          var x, y = 0;
          var r, g, b;
          var start2, p, col, row, pos;
          while (y < height) {
            x = 0;
            while (x < quadWidth) {
              start2 = quadWidth * y + x;
              p = start2;
              col = -1;
              row = 0;
              for (pos = 0; pos < 64; pos++) {
                row = pos >> 3;
                col = (pos & 7) * 4;
                p = start2 + row * quadWidth + col;
                if (y + row >= height) {
                  p -= quadWidth * (y + 1 + row - height);
                }
                if (x + col >= quadWidth) {
                  p -= x + col - quadWidth + 4;
                }
                r = imageData[p++];
                g = imageData[p++];
                b = imageData[p++];
                YDU[pos] = (RGB_YUV_TABLE[r] + RGB_YUV_TABLE[g + 256 >> 0] + RGB_YUV_TABLE[b + 512 >> 0] >> 16) - 128;
                UDU[pos] = (RGB_YUV_TABLE[r + 768 >> 0] + RGB_YUV_TABLE[g + 1024 >> 0] + RGB_YUV_TABLE[b + 1280 >> 0] >> 16) - 128;
                VDU[pos] = (RGB_YUV_TABLE[r + 1280 >> 0] + RGB_YUV_TABLE[g + 1536 >> 0] + RGB_YUV_TABLE[b + 1792 >> 0] >> 16) - 128;
              }
              DCY = processDU(YDU, fdtbl_Y, DCY, YDC_HT, YAC_HT);
              DCU = processDU(UDU, fdtbl_UV, DCU, UVDC_HT, UVAC_HT);
              DCV = processDU(VDU, fdtbl_UV, DCV, UVDC_HT, UVAC_HT);
              x += 32;
            }
            y += 8;
          }
          if (bytepos >= 0) {
            var fillbits = [];
            fillbits[1] = bytepos + 1;
            fillbits[0] = (1 << bytepos + 1) - 1;
            writeBits(fillbits);
          }
          writeWord(65497);
          if (typeof module === "undefined") return new Uint8Array(byteout);
          return Buffer.from(byteout);
          var jpegDataUri = "data:image/jpeg;base64," + btoa(byteout.join(""));
          byteout = [];
          var duration = (/* @__PURE__ */ new Date()).getTime() - time_start;
          return jpegDataUri;
        };
        function setQuality(quality2) {
          if (quality2 <= 0) {
            quality2 = 1;
          }
          if (quality2 > 100) {
            quality2 = 100;
          }
          if (currentQuality == quality2) return;
          var sf = 0;
          if (quality2 < 50) {
            sf = Math.floor(5e3 / quality2);
          } else {
            sf = Math.floor(200 - quality2 * 2);
          }
          initQuantTables(sf);
          currentQuality = quality2;
        }
        function init() {
          var time_start = (/* @__PURE__ */ new Date()).getTime();
          if (!quality) quality = 50;
          initCharLookupTable();
          initHuffmanTbl();
          initCategoryNumber();
          initRGBYUVTable();
          setQuality(quality);
          var duration = (/* @__PURE__ */ new Date()).getTime() - time_start;
        }
        init();
      }
      if (typeof module !== "undefined") {
        module.exports = encode;
      } else if (typeof window !== "undefined") {
        window["jpeg-js"] = window["jpeg-js"] || {};
        window["jpeg-js"].encode = encode;
      }
      function encode(imgData, qu) {
        if (typeof qu === "undefined") qu = 50;
        var encoder = new JPEGEncoder(qu);
        var data = encoder.encode(imgData, qu);
        return {
          data,
          width: imgData.width,
          height: imgData.height
        };
      }
    }
  });

  // node_modules/jpeg-js/lib/decoder.js
  var require_decoder = __commonJS({
    "node_modules/jpeg-js/lib/decoder.js"(exports, module) {
      var JpegImage = (function jpegImage() {
        "use strict";
        var dctZigZag = new Int32Array([
          0,
          1,
          8,
          16,
          9,
          2,
          3,
          10,
          17,
          24,
          32,
          25,
          18,
          11,
          4,
          5,
          12,
          19,
          26,
          33,
          40,
          48,
          41,
          34,
          27,
          20,
          13,
          6,
          7,
          14,
          21,
          28,
          35,
          42,
          49,
          56,
          57,
          50,
          43,
          36,
          29,
          22,
          15,
          23,
          30,
          37,
          44,
          51,
          58,
          59,
          52,
          45,
          38,
          31,
          39,
          46,
          53,
          60,
          61,
          54,
          47,
          55,
          62,
          63
        ]);
        var dctCos1 = 4017;
        var dctSin1 = 799;
        var dctCos3 = 3406;
        var dctSin3 = 2276;
        var dctCos6 = 1567;
        var dctSin6 = 3784;
        var dctSqrt2 = 5793;
        var dctSqrt1d2 = 2896;
        function constructor() {
        }
        function buildHuffmanTable(codeLengths, values) {
          var k = 0, code = [], i, j, length = 16;
          while (length > 0 && !codeLengths[length - 1])
            length--;
          code.push({ children: [], index: 0 });
          var p = code[0], q;
          for (i = 0; i < length; i++) {
            for (j = 0; j < codeLengths[i]; j++) {
              p = code.pop();
              p.children[p.index] = values[k];
              while (p.index > 0) {
                if (code.length === 0)
                  throw new Error("Could not recreate Huffman Table");
                p = code.pop();
              }
              p.index++;
              code.push(p);
              while (code.length <= i) {
                code.push(q = { children: [], index: 0 });
                p.children[p.index] = q.children;
                p = q;
              }
              k++;
            }
            if (i + 1 < length) {
              code.push(q = { children: [], index: 0 });
              p.children[p.index] = q.children;
              p = q;
            }
          }
          return code[0].children;
        }
        function decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successivePrev, successive, opts) {
          var precision = frame.precision;
          var samplesPerLine = frame.samplesPerLine;
          var scanLines = frame.scanLines;
          var mcusPerLine = frame.mcusPerLine;
          var progressive = frame.progressive;
          var maxH = frame.maxH, maxV = frame.maxV;
          var startOffset = offset, bitsData = 0, bitsCount = 0;
          function readBit() {
            if (bitsCount > 0) {
              bitsCount--;
              return bitsData >> bitsCount & 1;
            }
            bitsData = data[offset++];
            if (bitsData == 255) {
              var nextByte = data[offset++];
              if (nextByte) {
                throw new Error("unexpected marker: " + (bitsData << 8 | nextByte).toString(16));
              }
            }
            bitsCount = 7;
            return bitsData >>> 7;
          }
          function decodeHuffman(tree) {
            var node = tree, bit;
            while ((bit = readBit()) !== null) {
              node = node[bit];
              if (typeof node === "number")
                return node;
              if (typeof node !== "object")
                throw new Error("invalid huffman sequence");
            }
            return null;
          }
          function receive(length) {
            var n2 = 0;
            while (length > 0) {
              var bit = readBit();
              if (bit === null) return;
              n2 = n2 << 1 | bit;
              length--;
            }
            return n2;
          }
          function receiveAndExtend(length) {
            var n2 = receive(length);
            if (n2 >= 1 << length - 1)
              return n2;
            return n2 + (-1 << length) + 1;
          }
          function decodeBaseline(component2, zz) {
            var t = decodeHuffman(component2.huffmanTableDC);
            var diff = t === 0 ? 0 : receiveAndExtend(t);
            zz[0] = component2.pred += diff;
            var k2 = 1;
            while (k2 < 64) {
              var rs = decodeHuffman(component2.huffmanTableAC);
              var s = rs & 15, r = rs >> 4;
              if (s === 0) {
                if (r < 15)
                  break;
                k2 += 16;
                continue;
              }
              k2 += r;
              var z = dctZigZag[k2];
              zz[z] = receiveAndExtend(s);
              k2++;
            }
          }
          function decodeDCFirst(component2, zz) {
            var t = decodeHuffman(component2.huffmanTableDC);
            var diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
            zz[0] = component2.pred += diff;
          }
          function decodeDCSuccessive(component2, zz) {
            zz[0] |= readBit() << successive;
          }
          var eobrun = 0;
          function decodeACFirst(component2, zz) {
            if (eobrun > 0) {
              eobrun--;
              return;
            }
            var k2 = spectralStart, e = spectralEnd;
            while (k2 <= e) {
              var rs = decodeHuffman(component2.huffmanTableAC);
              var s = rs & 15, r = rs >> 4;
              if (s === 0) {
                if (r < 15) {
                  eobrun = receive(r) + (1 << r) - 1;
                  break;
                }
                k2 += 16;
                continue;
              }
              k2 += r;
              var z = dctZigZag[k2];
              zz[z] = receiveAndExtend(s) * (1 << successive);
              k2++;
            }
          }
          var successiveACState = 0, successiveACNextValue;
          function decodeACSuccessive(component2, zz) {
            var k2 = spectralStart, e = spectralEnd, r = 0;
            while (k2 <= e) {
              var z = dctZigZag[k2];
              var direction = zz[z] < 0 ? -1 : 1;
              switch (successiveACState) {
                case 0:
                  var rs = decodeHuffman(component2.huffmanTableAC);
                  var s = rs & 15, r = rs >> 4;
                  if (s === 0) {
                    if (r < 15) {
                      eobrun = receive(r) + (1 << r);
                      successiveACState = 4;
                    } else {
                      r = 16;
                      successiveACState = 1;
                    }
                  } else {
                    if (s !== 1)
                      throw new Error("invalid ACn encoding");
                    successiveACNextValue = receiveAndExtend(s);
                    successiveACState = r ? 2 : 3;
                  }
                  continue;
                case 1:
                // skipping r zero items
                case 2:
                  if (zz[z])
                    zz[z] += (readBit() << successive) * direction;
                  else {
                    r--;
                    if (r === 0)
                      successiveACState = successiveACState == 2 ? 3 : 0;
                  }
                  break;
                case 3:
                  if (zz[z])
                    zz[z] += (readBit() << successive) * direction;
                  else {
                    zz[z] = successiveACNextValue << successive;
                    successiveACState = 0;
                  }
                  break;
                case 4:
                  if (zz[z])
                    zz[z] += (readBit() << successive) * direction;
                  break;
              }
              k2++;
            }
            if (successiveACState === 4) {
              eobrun--;
              if (eobrun === 0)
                successiveACState = 0;
            }
          }
          function decodeMcu(component2, decode2, mcu2, row, col) {
            var mcuRow = mcu2 / mcusPerLine | 0;
            var mcuCol = mcu2 % mcusPerLine;
            var blockRow = mcuRow * component2.v + row;
            var blockCol = mcuCol * component2.h + col;
            if (component2.blocks[blockRow] === void 0 && opts.tolerantDecoding)
              return;
            decode2(component2, component2.blocks[blockRow][blockCol]);
          }
          function decodeBlock(component2, decode2, mcu2) {
            var blockRow = mcu2 / component2.blocksPerLine | 0;
            var blockCol = mcu2 % component2.blocksPerLine;
            if (component2.blocks[blockRow] === void 0 && opts.tolerantDecoding)
              return;
            decode2(component2, component2.blocks[blockRow][blockCol]);
          }
          var componentsLength = components.length;
          var component, i, j, k, n;
          var decodeFn;
          if (progressive) {
            if (spectralStart === 0)
              decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
            else
              decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
          } else {
            decodeFn = decodeBaseline;
          }
          var mcu = 0, marker;
          var mcuExpected;
          if (componentsLength == 1) {
            mcuExpected = components[0].blocksPerLine * components[0].blocksPerColumn;
          } else {
            mcuExpected = mcusPerLine * frame.mcusPerColumn;
          }
          if (!resetInterval) resetInterval = mcuExpected;
          var h, v;
          while (mcu < mcuExpected) {
            for (i = 0; i < componentsLength; i++)
              components[i].pred = 0;
            eobrun = 0;
            if (componentsLength == 1) {
              component = components[0];
              for (n = 0; n < resetInterval; n++) {
                decodeBlock(component, decodeFn, mcu);
                mcu++;
              }
            } else {
              for (n = 0; n < resetInterval; n++) {
                for (i = 0; i < componentsLength; i++) {
                  component = components[i];
                  h = component.h;
                  v = component.v;
                  for (j = 0; j < v; j++) {
                    for (k = 0; k < h; k++) {
                      decodeMcu(component, decodeFn, mcu, j, k);
                    }
                  }
                }
                mcu++;
                if (mcu === mcuExpected) break;
              }
            }
            if (mcu === mcuExpected) {
              do {
                if (data[offset] === 255) {
                  if (data[offset + 1] !== 0) {
                    break;
                  }
                }
                offset += 1;
              } while (offset < data.length - 2);
            }
            bitsCount = 0;
            marker = data[offset] << 8 | data[offset + 1];
            if (marker < 65280) {
              throw new Error("marker was not found");
            }
            if (marker >= 65488 && marker <= 65495) {
              offset += 2;
            } else
              break;
          }
          return offset - startOffset;
        }
        function buildComponentData(frame, component) {
          var lines = [];
          var blocksPerLine = component.blocksPerLine;
          var blocksPerColumn = component.blocksPerColumn;
          var samplesPerLine = blocksPerLine << 3;
          var R = new Int32Array(64), r = new Uint8Array(64);
          function quantizeAndInverse(zz, dataOut, dataIn) {
            var qt = component.quantizationTable;
            var v0, v1, v2, v3, v4, v5, v6, v7, t;
            var p = dataIn;
            var i2;
            for (i2 = 0; i2 < 64; i2++)
              p[i2] = zz[i2] * qt[i2];
            for (i2 = 0; i2 < 8; ++i2) {
              var row = 8 * i2;
              if (p[1 + row] == 0 && p[2 + row] == 0 && p[3 + row] == 0 && p[4 + row] == 0 && p[5 + row] == 0 && p[6 + row] == 0 && p[7 + row] == 0) {
                t = dctSqrt2 * p[0 + row] + 512 >> 10;
                p[0 + row] = t;
                p[1 + row] = t;
                p[2 + row] = t;
                p[3 + row] = t;
                p[4 + row] = t;
                p[5 + row] = t;
                p[6 + row] = t;
                p[7 + row] = t;
                continue;
              }
              v0 = dctSqrt2 * p[0 + row] + 128 >> 8;
              v1 = dctSqrt2 * p[4 + row] + 128 >> 8;
              v2 = p[2 + row];
              v3 = p[6 + row];
              v4 = dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128 >> 8;
              v7 = dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128 >> 8;
              v5 = p[3 + row] << 4;
              v6 = p[5 + row] << 4;
              t = v0 - v1 + 1 >> 1;
              v0 = v0 + v1 + 1 >> 1;
              v1 = t;
              t = v2 * dctSin6 + v3 * dctCos6 + 128 >> 8;
              v2 = v2 * dctCos6 - v3 * dctSin6 + 128 >> 8;
              v3 = t;
              t = v4 - v6 + 1 >> 1;
              v4 = v4 + v6 + 1 >> 1;
              v6 = t;
              t = v7 + v5 + 1 >> 1;
              v5 = v7 - v5 + 1 >> 1;
              v7 = t;
              t = v0 - v3 + 1 >> 1;
              v0 = v0 + v3 + 1 >> 1;
              v3 = t;
              t = v1 - v2 + 1 >> 1;
              v1 = v1 + v2 + 1 >> 1;
              v2 = t;
              t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
              v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
              v7 = t;
              t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
              v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
              v6 = t;
              p[0 + row] = v0 + v7;
              p[7 + row] = v0 - v7;
              p[1 + row] = v1 + v6;
              p[6 + row] = v1 - v6;
              p[2 + row] = v2 + v5;
              p[5 + row] = v2 - v5;
              p[3 + row] = v3 + v4;
              p[4 + row] = v3 - v4;
            }
            for (i2 = 0; i2 < 8; ++i2) {
              var col = i2;
              if (p[1 * 8 + col] == 0 && p[2 * 8 + col] == 0 && p[3 * 8 + col] == 0 && p[4 * 8 + col] == 0 && p[5 * 8 + col] == 0 && p[6 * 8 + col] == 0 && p[7 * 8 + col] == 0) {
                t = dctSqrt2 * dataIn[i2 + 0] + 8192 >> 14;
                p[0 * 8 + col] = t;
                p[1 * 8 + col] = t;
                p[2 * 8 + col] = t;
                p[3 * 8 + col] = t;
                p[4 * 8 + col] = t;
                p[5 * 8 + col] = t;
                p[6 * 8 + col] = t;
                p[7 * 8 + col] = t;
                continue;
              }
              v0 = dctSqrt2 * p[0 * 8 + col] + 2048 >> 12;
              v1 = dctSqrt2 * p[4 * 8 + col] + 2048 >> 12;
              v2 = p[2 * 8 + col];
              v3 = p[6 * 8 + col];
              v4 = dctSqrt1d2 * (p[1 * 8 + col] - p[7 * 8 + col]) + 2048 >> 12;
              v7 = dctSqrt1d2 * (p[1 * 8 + col] + p[7 * 8 + col]) + 2048 >> 12;
              v5 = p[3 * 8 + col];
              v6 = p[5 * 8 + col];
              t = v0 - v1 + 1 >> 1;
              v0 = v0 + v1 + 1 >> 1;
              v1 = t;
              t = v2 * dctSin6 + v3 * dctCos6 + 2048 >> 12;
              v2 = v2 * dctCos6 - v3 * dctSin6 + 2048 >> 12;
              v3 = t;
              t = v4 - v6 + 1 >> 1;
              v4 = v4 + v6 + 1 >> 1;
              v6 = t;
              t = v7 + v5 + 1 >> 1;
              v5 = v7 - v5 + 1 >> 1;
              v7 = t;
              t = v0 - v3 + 1 >> 1;
              v0 = v0 + v3 + 1 >> 1;
              v3 = t;
              t = v1 - v2 + 1 >> 1;
              v1 = v1 + v2 + 1 >> 1;
              v2 = t;
              t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
              v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
              v7 = t;
              t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
              v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
              v6 = t;
              p[0 * 8 + col] = v0 + v7;
              p[7 * 8 + col] = v0 - v7;
              p[1 * 8 + col] = v1 + v6;
              p[6 * 8 + col] = v1 - v6;
              p[2 * 8 + col] = v2 + v5;
              p[5 * 8 + col] = v2 - v5;
              p[3 * 8 + col] = v3 + v4;
              p[4 * 8 + col] = v3 - v4;
            }
            for (i2 = 0; i2 < 64; ++i2) {
              var sample2 = 128 + (p[i2] + 8 >> 4);
              dataOut[i2] = sample2 < 0 ? 0 : sample2 > 255 ? 255 : sample2;
            }
          }
          requestMemoryAllocation(samplesPerLine * blocksPerColumn * 8);
          var i, j;
          for (var blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
            var scanLine = blockRow << 3;
            for (i = 0; i < 8; i++)
              lines.push(new Uint8Array(samplesPerLine));
            for (var blockCol = 0; blockCol < blocksPerLine; blockCol++) {
              quantizeAndInverse(component.blocks[blockRow][blockCol], r, R);
              var offset = 0, sample = blockCol << 3;
              for (j = 0; j < 8; j++) {
                var line = lines[scanLine + j];
                for (i = 0; i < 8; i++)
                  line[sample + i] = r[offset++];
              }
            }
          }
          return lines;
        }
        function clampTo8bit(a) {
          return a < 0 ? 0 : a > 255 ? 255 : a;
        }
        constructor.prototype = {
          load: function load(path3) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", path3, true);
            xhr.responseType = "arraybuffer";
            xhr.onload = (function() {
              var data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
              this.parse(data);
              if (this.onload)
                this.onload();
            }).bind(this);
            xhr.send(null);
          },
          parse: function parse(data) {
            var maxResolutionInPixels = this.opts.maxResolutionInMP * 1e3 * 1e3;
            var offset = 0, length = data.length;
            function readUint16() {
              var value = data[offset] << 8 | data[offset + 1];
              offset += 2;
              return value;
            }
            function readDataBlock() {
              var length2 = readUint16();
              var array = data.subarray(offset, offset + length2 - 2);
              offset += array.length;
              return array;
            }
            function prepareComponents(frame2) {
              var maxH2 = 1, maxV2 = 1;
              var component2, componentId2;
              for (componentId2 in frame2.components) {
                if (frame2.components.hasOwnProperty(componentId2)) {
                  component2 = frame2.components[componentId2];
                  if (maxH2 < component2.h) maxH2 = component2.h;
                  if (maxV2 < component2.v) maxV2 = component2.v;
                }
              }
              var mcusPerLine = Math.ceil(frame2.samplesPerLine / 8 / maxH2);
              var mcusPerColumn = Math.ceil(frame2.scanLines / 8 / maxV2);
              for (componentId2 in frame2.components) {
                if (frame2.components.hasOwnProperty(componentId2)) {
                  component2 = frame2.components[componentId2];
                  var blocksPerLine = Math.ceil(Math.ceil(frame2.samplesPerLine / 8) * component2.h / maxH2);
                  var blocksPerColumn = Math.ceil(Math.ceil(frame2.scanLines / 8) * component2.v / maxV2);
                  var blocksPerLineForMcu = mcusPerLine * component2.h;
                  var blocksPerColumnForMcu = mcusPerColumn * component2.v;
                  var blocksToAllocate = blocksPerColumnForMcu * blocksPerLineForMcu;
                  var blocks = [];
                  requestMemoryAllocation(blocksToAllocate * 256);
                  for (var i2 = 0; i2 < blocksPerColumnForMcu; i2++) {
                    var row = [];
                    for (var j2 = 0; j2 < blocksPerLineForMcu; j2++)
                      row.push(new Int32Array(64));
                    blocks.push(row);
                  }
                  component2.blocksPerLine = blocksPerLine;
                  component2.blocksPerColumn = blocksPerColumn;
                  component2.blocks = blocks;
                }
              }
              frame2.maxH = maxH2;
              frame2.maxV = maxV2;
              frame2.mcusPerLine = mcusPerLine;
              frame2.mcusPerColumn = mcusPerColumn;
            }
            var jfif = null;
            var adobe = null;
            var pixels = null;
            var frame, resetInterval;
            var quantizationTables = [], frames = [];
            var huffmanTablesAC = [], huffmanTablesDC = [];
            var fileMarker = readUint16();
            var malformedDataOffset = -1;
            this.comments = [];
            if (fileMarker != 65496) {
              throw new Error("SOI not found");
            }
            fileMarker = readUint16();
            while (fileMarker != 65497) {
              var i, j, l;
              switch (fileMarker) {
                case 65280:
                  break;
                case 65504:
                // APP0 (Application Specific)
                case 65505:
                // APP1
                case 65506:
                // APP2
                case 65507:
                // APP3
                case 65508:
                // APP4
                case 65509:
                // APP5
                case 65510:
                // APP6
                case 65511:
                // APP7
                case 65512:
                // APP8
                case 65513:
                // APP9
                case 65514:
                // APP10
                case 65515:
                // APP11
                case 65516:
                // APP12
                case 65517:
                // APP13
                case 65518:
                // APP14
                case 65519:
                // APP15
                case 65534:
                  var appData = readDataBlock();
                  if (fileMarker === 65534) {
                    var comment = String.fromCharCode.apply(null, appData);
                    this.comments.push(comment);
                  }
                  if (fileMarker === 65504) {
                    if (appData[0] === 74 && appData[1] === 70 && appData[2] === 73 && appData[3] === 70 && appData[4] === 0) {
                      jfif = {
                        version: { major: appData[5], minor: appData[6] },
                        densityUnits: appData[7],
                        xDensity: appData[8] << 8 | appData[9],
                        yDensity: appData[10] << 8 | appData[11],
                        thumbWidth: appData[12],
                        thumbHeight: appData[13],
                        thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
                      };
                    }
                  }
                  if (fileMarker === 65505) {
                    if (appData[0] === 69 && appData[1] === 120 && appData[2] === 105 && appData[3] === 102 && appData[4] === 0) {
                      this.exifBuffer = appData.subarray(5, appData.length);
                    }
                  }
                  if (fileMarker === 65518) {
                    if (appData[0] === 65 && appData[1] === 100 && appData[2] === 111 && appData[3] === 98 && appData[4] === 101 && appData[5] === 0) {
                      adobe = {
                        version: appData[6],
                        flags0: appData[7] << 8 | appData[8],
                        flags1: appData[9] << 8 | appData[10],
                        transformCode: appData[11]
                      };
                    }
                  }
                  break;
                case 65499:
                  var quantizationTablesLength = readUint16();
                  var quantizationTablesEnd = quantizationTablesLength + offset - 2;
                  while (offset < quantizationTablesEnd) {
                    var quantizationTableSpec = data[offset++];
                    requestMemoryAllocation(64 * 4);
                    var tableData = new Int32Array(64);
                    if (quantizationTableSpec >> 4 === 0) {
                      for (j = 0; j < 64; j++) {
                        var z = dctZigZag[j];
                        tableData[z] = data[offset++];
                      }
                    } else if (quantizationTableSpec >> 4 === 1) {
                      for (j = 0; j < 64; j++) {
                        var z = dctZigZag[j];
                        tableData[z] = readUint16();
                      }
                    } else
                      throw new Error("DQT: invalid table spec");
                    quantizationTables[quantizationTableSpec & 15] = tableData;
                  }
                  break;
                case 65472:
                // SOF0 (Start of Frame, Baseline DCT)
                case 65473:
                // SOF1 (Start of Frame, Extended DCT)
                case 65474:
                  readUint16();
                  frame = {};
                  frame.extended = fileMarker === 65473;
                  frame.progressive = fileMarker === 65474;
                  frame.precision = data[offset++];
                  frame.scanLines = readUint16();
                  frame.samplesPerLine = readUint16();
                  frame.components = {};
                  frame.componentsOrder = [];
                  var pixelsInFrame = frame.scanLines * frame.samplesPerLine;
                  if (pixelsInFrame > maxResolutionInPixels) {
                    var exceededAmount = Math.ceil((pixelsInFrame - maxResolutionInPixels) / 1e6);
                    throw new Error(`maxResolutionInMP limit exceeded by ${exceededAmount}MP`);
                  }
                  var componentsCount = data[offset++], componentId;
                  var maxH = 0, maxV = 0;
                  for (i = 0; i < componentsCount; i++) {
                    componentId = data[offset];
                    var h = data[offset + 1] >> 4;
                    var v = data[offset + 1] & 15;
                    var qId = data[offset + 2];
                    if (h <= 0 || v <= 0) {
                      throw new Error("Invalid sampling factor, expected values above 0");
                    }
                    frame.componentsOrder.push(componentId);
                    frame.components[componentId] = {
                      h,
                      v,
                      quantizationIdx: qId
                    };
                    offset += 3;
                  }
                  prepareComponents(frame);
                  frames.push(frame);
                  break;
                case 65476:
                  var huffmanLength = readUint16();
                  for (i = 2; i < huffmanLength; ) {
                    var huffmanTableSpec = data[offset++];
                    var codeLengths = new Uint8Array(16);
                    var codeLengthSum = 0;
                    for (j = 0; j < 16; j++, offset++) {
                      codeLengthSum += codeLengths[j] = data[offset];
                    }
                    requestMemoryAllocation(16 + codeLengthSum);
                    var huffmanValues = new Uint8Array(codeLengthSum);
                    for (j = 0; j < codeLengthSum; j++, offset++)
                      huffmanValues[j] = data[offset];
                    i += 17 + codeLengthSum;
                    (huffmanTableSpec >> 4 === 0 ? huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] = buildHuffmanTable(codeLengths, huffmanValues);
                  }
                  break;
                case 65501:
                  readUint16();
                  resetInterval = readUint16();
                  break;
                case 65500:
                  readUint16();
                  readUint16();
                  break;
                case 65498:
                  var scanLength = readUint16();
                  var selectorsCount = data[offset++];
                  var components = [], component;
                  for (i = 0; i < selectorsCount; i++) {
                    component = frame.components[data[offset++]];
                    var tableSpec = data[offset++];
                    component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
                    component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
                    components.push(component);
                  }
                  var spectralStart = data[offset++];
                  var spectralEnd = data[offset++];
                  var successiveApproximation = data[offset++];
                  var processed = decodeScan(
                    data,
                    offset,
                    frame,
                    components,
                    resetInterval,
                    spectralStart,
                    spectralEnd,
                    successiveApproximation >> 4,
                    successiveApproximation & 15,
                    this.opts
                  );
                  offset += processed;
                  break;
                case 65535:
                  if (data[offset] !== 255) {
                    offset--;
                  }
                  break;
                default:
                  if (data[offset - 3] == 255 && data[offset - 2] >= 192 && data[offset - 2] <= 254) {
                    offset -= 3;
                    break;
                  } else if (fileMarker === 224 || fileMarker == 225) {
                    if (malformedDataOffset !== -1) {
                      throw new Error(`first unknown JPEG marker at offset ${malformedDataOffset.toString(16)}, second unknown JPEG marker ${fileMarker.toString(16)} at offset ${(offset - 1).toString(16)}`);
                    }
                    malformedDataOffset = offset - 1;
                    const nextOffset = readUint16();
                    if (data[offset + nextOffset - 2] === 255) {
                      offset += nextOffset - 2;
                      break;
                    }
                  }
                  throw new Error("unknown JPEG marker " + fileMarker.toString(16));
              }
              fileMarker = readUint16();
            }
            if (frames.length != 1)
              throw new Error("only single frame JPEGs supported");
            for (var i = 0; i < frames.length; i++) {
              var cp = frames[i].components;
              for (var j in cp) {
                cp[j].quantizationTable = quantizationTables[cp[j].quantizationIdx];
                delete cp[j].quantizationIdx;
              }
            }
            this.width = frame.samplesPerLine;
            this.height = frame.scanLines;
            this.jfif = jfif;
            this.adobe = adobe;
            this.components = [];
            for (var i = 0; i < frame.componentsOrder.length; i++) {
              var component = frame.components[frame.componentsOrder[i]];
              this.components.push({
                lines: buildComponentData(frame, component),
                scaleX: component.h / frame.maxH,
                scaleY: component.v / frame.maxV
              });
            }
          },
          getData: function getData(width, height) {
            var scaleX = this.width / width, scaleY = this.height / height;
            var component1, component2, component3, component4;
            var component1Line, component2Line, component3Line, component4Line;
            var x, y;
            var offset = 0;
            var Y, Cb, Cr, K, C, M, Ye, R, G, B;
            var colorTransform;
            var dataLength = width * height * this.components.length;
            requestMemoryAllocation(dataLength);
            var data = new Uint8Array(dataLength);
            switch (this.components.length) {
              case 1:
                component1 = this.components[0];
                for (y = 0; y < height; y++) {
                  component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
                  for (x = 0; x < width; x++) {
                    Y = component1Line[0 | x * component1.scaleX * scaleX];
                    data[offset++] = Y;
                  }
                }
                break;
              case 2:
                component1 = this.components[0];
                component2 = this.components[1];
                for (y = 0; y < height; y++) {
                  component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
                  component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
                  for (x = 0; x < width; x++) {
                    Y = component1Line[0 | x * component1.scaleX * scaleX];
                    data[offset++] = Y;
                    Y = component2Line[0 | x * component2.scaleX * scaleX];
                    data[offset++] = Y;
                  }
                }
                break;
              case 3:
                colorTransform = true;
                if (this.adobe && this.adobe.transformCode)
                  colorTransform = true;
                else if (typeof this.opts.colorTransform !== "undefined")
                  colorTransform = !!this.opts.colorTransform;
                component1 = this.components[0];
                component2 = this.components[1];
                component3 = this.components[2];
                for (y = 0; y < height; y++) {
                  component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
                  component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
                  component3Line = component3.lines[0 | y * component3.scaleY * scaleY];
                  for (x = 0; x < width; x++) {
                    if (!colorTransform) {
                      R = component1Line[0 | x * component1.scaleX * scaleX];
                      G = component2Line[0 | x * component2.scaleX * scaleX];
                      B = component3Line[0 | x * component3.scaleX * scaleX];
                    } else {
                      Y = component1Line[0 | x * component1.scaleX * scaleX];
                      Cb = component2Line[0 | x * component2.scaleX * scaleX];
                      Cr = component3Line[0 | x * component3.scaleX * scaleX];
                      R = clampTo8bit(Y + 1.402 * (Cr - 128));
                      G = clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
                      B = clampTo8bit(Y + 1.772 * (Cb - 128));
                    }
                    data[offset++] = R;
                    data[offset++] = G;
                    data[offset++] = B;
                  }
                }
                break;
              case 4:
                if (!this.adobe)
                  throw new Error("Unsupported color mode (4 components)");
                colorTransform = false;
                if (this.adobe && this.adobe.transformCode)
                  colorTransform = true;
                else if (typeof this.opts.colorTransform !== "undefined")
                  colorTransform = !!this.opts.colorTransform;
                component1 = this.components[0];
                component2 = this.components[1];
                component3 = this.components[2];
                component4 = this.components[3];
                for (y = 0; y < height; y++) {
                  component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
                  component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
                  component3Line = component3.lines[0 | y * component3.scaleY * scaleY];
                  component4Line = component4.lines[0 | y * component4.scaleY * scaleY];
                  for (x = 0; x < width; x++) {
                    if (!colorTransform) {
                      C = component1Line[0 | x * component1.scaleX * scaleX];
                      M = component2Line[0 | x * component2.scaleX * scaleX];
                      Ye = component3Line[0 | x * component3.scaleX * scaleX];
                      K = component4Line[0 | x * component4.scaleX * scaleX];
                    } else {
                      Y = component1Line[0 | x * component1.scaleX * scaleX];
                      Cb = component2Line[0 | x * component2.scaleX * scaleX];
                      Cr = component3Line[0 | x * component3.scaleX * scaleX];
                      K = component4Line[0 | x * component4.scaleX * scaleX];
                      C = 255 - clampTo8bit(Y + 1.402 * (Cr - 128));
                      M = 255 - clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
                      Ye = 255 - clampTo8bit(Y + 1.772 * (Cb - 128));
                    }
                    data[offset++] = 255 - C;
                    data[offset++] = 255 - M;
                    data[offset++] = 255 - Ye;
                    data[offset++] = 255 - K;
                  }
                }
                break;
              default:
                throw new Error("Unsupported color mode");
            }
            return data;
          },
          copyToImageData: function copyToImageData(imageData, formatAsRGBA) {
            var width = imageData.width, height = imageData.height;
            var imageDataArray = imageData.data;
            var data = this.getData(width, height);
            var i = 0, j = 0, x, y;
            var Y, K, C, M, R, G, B;
            switch (this.components.length) {
              case 1:
                for (y = 0; y < height; y++) {
                  for (x = 0; x < width; x++) {
                    Y = data[i++];
                    imageDataArray[j++] = Y;
                    imageDataArray[j++] = Y;
                    imageDataArray[j++] = Y;
                    if (formatAsRGBA) {
                      imageDataArray[j++] = 255;
                    }
                  }
                }
                break;
              case 3:
                for (y = 0; y < height; y++) {
                  for (x = 0; x < width; x++) {
                    R = data[i++];
                    G = data[i++];
                    B = data[i++];
                    imageDataArray[j++] = R;
                    imageDataArray[j++] = G;
                    imageDataArray[j++] = B;
                    if (formatAsRGBA) {
                      imageDataArray[j++] = 255;
                    }
                  }
                }
                break;
              case 4:
                for (y = 0; y < height; y++) {
                  for (x = 0; x < width; x++) {
                    C = data[i++];
                    M = data[i++];
                    Y = data[i++];
                    K = data[i++];
                    R = 255 - clampTo8bit(C * (1 - K / 255) + K);
                    G = 255 - clampTo8bit(M * (1 - K / 255) + K);
                    B = 255 - clampTo8bit(Y * (1 - K / 255) + K);
                    imageDataArray[j++] = R;
                    imageDataArray[j++] = G;
                    imageDataArray[j++] = B;
                    if (formatAsRGBA) {
                      imageDataArray[j++] = 255;
                    }
                  }
                }
                break;
              default:
                throw new Error("Unsupported color mode");
            }
          }
        };
        var totalBytesAllocated = 0;
        var maxMemoryUsageBytes = 0;
        function requestMemoryAllocation(increaseAmount = 0) {
          var totalMemoryImpactBytes = totalBytesAllocated + increaseAmount;
          if (totalMemoryImpactBytes > maxMemoryUsageBytes) {
            var exceededAmount = Math.ceil((totalMemoryImpactBytes - maxMemoryUsageBytes) / 1024 / 1024);
            throw new Error(`maxMemoryUsageInMB limit exceeded by at least ${exceededAmount}MB`);
          }
          totalBytesAllocated = totalMemoryImpactBytes;
        }
        constructor.resetMaxMemoryUsage = function(maxMemoryUsageBytes_) {
          totalBytesAllocated = 0;
          maxMemoryUsageBytes = maxMemoryUsageBytes_;
        };
        constructor.getBytesAllocated = function() {
          return totalBytesAllocated;
        };
        constructor.requestMemoryAllocation = requestMemoryAllocation;
        return constructor;
      })();
      if (typeof module !== "undefined") {
        module.exports = decode;
      } else if (typeof window !== "undefined") {
        window["jpeg-js"] = window["jpeg-js"] || {};
        window["jpeg-js"].decode = decode;
      }
      function decode(jpegData, userOpts = {}) {
        var defaultOpts = {
          // "undefined" means "Choose whether to transform colors based on the image’s color model."
          colorTransform: void 0,
          useTArray: false,
          formatAsRGBA: true,
          tolerantDecoding: true,
          maxResolutionInMP: 100,
          // Don't decode more than 100 megapixels
          maxMemoryUsageInMB: 512
          // Don't decode if memory footprint is more than 512MB
        };
        var opts = { ...defaultOpts, ...userOpts };
        var arr = new Uint8Array(jpegData);
        var decoder = new JpegImage();
        decoder.opts = opts;
        JpegImage.resetMaxMemoryUsage(opts.maxMemoryUsageInMB * 1024 * 1024);
        decoder.parse(arr);
        var channels = opts.formatAsRGBA ? 4 : 3;
        var bytesNeeded = decoder.width * decoder.height * channels;
        try {
          JpegImage.requestMemoryAllocation(bytesNeeded);
          var image = {
            width: decoder.width,
            height: decoder.height,
            exifBuffer: decoder.exifBuffer,
            data: opts.useTArray ? new Uint8Array(bytesNeeded) : Buffer.alloc(bytesNeeded)
          };
          if (decoder.comments.length > 0) {
            image["comments"] = decoder.comments;
          }
        } catch (err) {
          if (err instanceof RangeError) {
            throw new Error("Could not allocate enough memory for the image. Required: " + bytesNeeded);
          }
          if (err instanceof ReferenceError) {
            if (err.message === "Buffer is not defined") {
              throw new Error("Buffer is not globally defined in this environment. Consider setting useTArray to true");
            }
          }
          throw err;
        }
        decoder.copyToImageData(image, opts.formatAsRGBA);
        return image;
      }
    }
  });

  // node_modules/jpeg-js/index.js
  var require_jpeg_js = __commonJS({
    "node_modules/jpeg-js/index.js"(exports, module) {
      var encode = require_encoder();
      var decode = require_decoder();
      module.exports = {
        encode,
        decode
      };
    }
  });

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
  var fs4 = __toESM(__require("fs"));
  var os = __toESM(__require("os"));
  var path2 = __toESM(__require("path"));
  var import_url = __require("url");

  // src/image-prep.ts
  var fs = __toESM(__require("fs"));
  var path = __toESM(__require("path"));
  var import_jpeg_js = __toESM(require_jpeg_js());
  var import_pngjs = __toESM(require_png());

  // src/limits.ts
  var MAX_TRACE_PIXELS = 4e6;
  var MAX_DECODE_PIXELS = 2e7;
  var ASPECT_TOLERANCE = 0.02;

  // src/image-prep.ts
  var ImagePrepError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "ImagePrepError";
    }
  };
  function byteAt(data, index) {
    return data[index] ?? 0;
  }
  function aspectMismatch(pixelWidth, pixelHeight, widthPt, heightPt) {
    if (pixelWidth <= 0 || pixelHeight <= 0 || widthPt <= 0 || heightPt <= 0) return true;
    const fileAspect = pixelWidth / pixelHeight;
    const placedAspect = widthPt / heightPt;
    return Math.abs(fileAspect - placedAspect) / fileAspect > ASPECT_TOLERANCE;
  }
  async function readRasterSize(filePath) {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, 2 * 1024 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      return sizeFromBuffer(buffer);
    } finally {
      await handle.close();
    }
  }
  function sizeFromBuffer(buffer) {
    if (isPng(buffer)) {
      if (buffer.length < 24) return null;
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (isJpeg(buffer)) return jpegSize(buffer);
    return null;
  }
  async function prepareTracePng(sourcePath, destPath, maxPixels = MAX_TRACE_PIXELS, maxDecodePixels = MAX_DECODE_PIXELS) {
    const header = await readRasterSize(sourcePath);
    if (header && header.width * header.height > maxDecodePixels) {
      throw new ImagePrepError("\u0E20\u0E32\u0E1E\u0E43\u0E2B\u0E0D\u0E48\u0E40\u0E01\u0E34\u0E19\u0E07\u0E1A\u0E16\u0E2D\u0E14\u0E23\u0E2B\u0E31\u0E2A\u0E43\u0E19\u0E1E\u0E32\u0E40\u0E19\u0E25");
    }
    const buffer = await fs.promises.readFile(sourcePath);
    const decoded = decodeRaster(buffer);
    const sourcePixels = decoded.width * decoded.height;
    if (sourcePixels > maxDecodePixels) throw new ImagePrepError("\u0E20\u0E32\u0E1E\u0E43\u0E2B\u0E0D\u0E48\u0E40\u0E01\u0E34\u0E19\u0E07\u0E1A\u0E16\u0E2D\u0E14\u0E23\u0E2B\u0E31\u0E2A\u0E43\u0E19\u0E1E\u0E32\u0E40\u0E19\u0E25");
    const fitted = fit(decoded, maxPixels);
    const sameFile = pathKey(sourcePath) === pathKey(destPath);
    if (!fitted.resized && isPng(buffer)) {
      if (!sameFile) await fs.promises.writeFile(destPath, buffer);
      return { width: decoded.width, height: decoded.height, resized: false };
    }
    const png = new import_pngjs.PNG({ width: fitted.width, height: fitted.height });
    Buffer.from(fitted.data).copy(png.data);
    await fs.promises.writeFile(destPath, import_pngjs.PNG.sync.write(png));
    return { width: fitted.width, height: fitted.height, resized: fitted.resized };
  }
  function pathKey(filePath) {
    return path.resolve(filePath);
  }
  function decodeRaster(buffer) {
    try {
      if (isPng(buffer)) {
        const png = import_pngjs.PNG.sync.read(buffer);
        return { width: png.width, height: png.height, data: png.data };
      }
      if (isJpeg(buffer)) {
        const image = (0, import_jpeg_js.decode)(buffer, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true });
        return { width: image.width, height: image.height, data: image.data };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ImagePrepError("\u0E16\u0E2D\u0E14\u0E23\u0E2B\u0E31\u0E2A\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: " + message);
    }
    throw new ImagePrepError("\u0E16\u0E2D\u0E14\u0E23\u0E2B\u0E31\u0E2A\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
  }
  function fit(decoded, maxPixels) {
    const pixels = decoded.width * decoded.height;
    if (pixels <= maxPixels || pixels <= 0) return { ...decoded, resized: false };
    const scale = Math.sqrt(maxPixels / pixels);
    const width = Math.max(1, Math.floor(decoded.width * scale));
    const height = Math.max(1, Math.floor(decoded.height * scale));
    return { width, height, data: downscale(decoded, width, height), resized: true };
  }
  function downscale(source, width, height) {
    const dest = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const y0 = Math.floor(y * source.height / height);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * source.height / height));
      for (let x = 0; x < width; x++) {
        const x0 = Math.floor(x * source.width / width);
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * source.width / width));
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        let count = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const index = (yy * source.width + xx) * 4;
            const covered = byteAt(source.data, index + 3) / 255;
            red += byteAt(source.data, index) * covered;
            green += byteAt(source.data, index + 1) * covered;
            blue += byteAt(source.data, index + 2) * covered;
            alpha += byteAt(source.data, index + 3);
            count += 1;
          }
        }
        const offset = (y * width + x) * 4;
        const outAlpha = count > 0 ? alpha / count : 0;
        const restore = outAlpha === 0 ? 0 : 255 / outAlpha;
        dest[offset] = clampByte(red / count * restore);
        dest[offset + 1] = clampByte(green / count * restore);
        dest[offset + 2] = clampByte(blue / count * restore);
        dest[offset + 3] = clampByte(outAlpha);
      }
    }
    return dest;
  }
  function clampByte(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 255) return 255;
    return Math.round(value);
  }
  function isPng(buffer) {
    return buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71;
  }
  function isJpeg(buffer) {
    return buffer.length >= 2 && buffer[0] === 255 && buffer[1] === 216;
  }
  function jpegSize(buffer) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 255) return null;
      const marker = buffer[offset + 1] ?? 0;
      if (isStartOfFrame(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (marker === 216 || marker === 217) return null;
      if (marker === 0 || marker === 1 || marker >= 208 && marker <= 215) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }
  function isStartOfFrame(marker) {
    if (marker >= 192 && marker <= 195) return true;
    if (marker >= 197 && marker <= 199) return true;
    if (marker >= 201 && marker <= 203) return true;
    return marker >= 205 && marker <= 207;
  }

  // src/trace-client.ts
  var import_module = __require("module");
  var fs3 = __toESM(__require("fs"));

  // src/trace-job.ts
  var childProcess = __toESM(__require("child_process"));
  var fs2 = __toESM(__require("fs"));

  // src/svg-summary.ts
  function summarizeSvg(svg) {
    if (svg.toLowerCase().indexOf("<svg") === -1) throw new Error("\u0E44\u0E1F\u0E25\u0E4C\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 SVG");
    const matches = svg.match(/<path\b/gi);
    const pathCount = matches ? matches.length : 0;
    if (pathCount <= 0) throw new Error("VTracer \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E43\u0E19 SVG");
    return { pathCount };
  }

  // src/trace-job.ts
  async function runTraceJob(request, hooks) {
    if (hooks.isCancelled()) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    hooks.onProgress("prepare");
    writeThreadMarker(hooks.thread);
    const prepared = await prepareTracePng(request.sourcePath, request.pngPath, request.maxPixels, request.maxDecodePixels);
    if (hooks.isCancelled()) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    const stat = await fs2.promises.stat(request.pngPath);
    if (!stat.isFile() || stat.size <= 0) throw new Error("\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E44\u0E1F\u0E25\u0E4C PNG \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
    hooks.onProgress("trace");
    await spawnVtracer(request, hooks);
    if (hooks.isCancelled()) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
    hooks.onProgress("svg");
    const svg = await fs2.promises.readFile(request.svgPath, "utf8");
    const summary = summarizeSvg(svg);
    return { width: prepared.width, height: prepared.height, resized: prepared.resized, pathCount: summary.pathCount };
  }
  function spawnVtracer(request, hooks) {
    return new Promise((resolve2, reject) => {
      const args = [request.pngPath, request.svgPath, ...request.flags];
      const child = childProcess.spawn(request.binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      hooks.registerChild(() => {
        child.kill();
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        if (stderr.length < 4e3) stderr += chunk.toString("utf8").slice(0, 4e3 - stderr.length);
      });
      child.once("error", (error) => reject(error));
      child.once("close", (code) => {
        if (hooks.isCancelled()) {
          reject(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
        } else if (code === 0 && fs2.existsSync(request.svgPath) && fs2.statSync(request.svgPath).size > 0) {
          resolve2();
        } else {
          reject(new Error("VTracer \u0E41\u0E1B\u0E25\u0E07\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" + (stderr ? ": " + stderr.trim() : "")));
        }
      });
    });
  }
  function writeThreadMarker(thread) {
    const file = process.env["VECTOR_PANEL_TRACE_DEBUG"];
    if (!file || !thread) return;
    fs2.appendFileSync(file, JSON.stringify({ threadId: thread.threadId, isMainThread: thread.isMainThread }) + "\n");
  }

  // src/trace-client.ts
  var TraceRunner = class {
    constructor(workerPath) {
      this.workerPath = workerPath;
      this.worker = null;
      this.nextId = 1;
      this.activeId = 0;
      this.cancelled = false;
      this.killInline = null;
      this.allowWorker = process.env["VECTOR_PANEL_NO_WORKER"] !== "1";
    }
    cancel() {
      this.cancelled = true;
      if (this.killInline) this.killInline();
      if (this.worker) this.worker.postMessage({ type: "cancel", id: this.activeId });
    }
    dispose() {
      this.cancel();
      if (this.worker) {
        void this.worker.terminate();
        this.worker = null;
      }
    }
    run(request, onProgress) {
      this.cancelled = false;
      this.killInline = null;
      if (!this.allowWorker) return this.runInline(request, onProgress);
      return this.runInWorker(request, onProgress).catch((error) => {
        if (this.cancelled || !isStartupError(error)) throw error;
        this.allowWorker = false;
        if (this.worker) {
          void this.worker.terminate();
          this.worker = null;
        }
        return this.runInline(request, onProgress);
      });
    }
    async runInWorker(request, onProgress) {
      const worker = this.ensureWorker();
      const id = this.nextId++;
      this.activeId = id;
      return new Promise((resolve2, reject) => {
        let settled = false;
        const finish = (handler) => {
          if (settled) return;
          settled = true;
          worker.off("message", onMessage);
          worker.off("error", onError);
          handler();
        };
        const onMessage = (message) => {
          if (message.id !== id) return;
          if (message.type === "progress") {
            onProgress(message.stage);
            return;
          }
          if (message.type === "done") {
            finish(() => resolve2(message.result));
            return;
          }
          finish(() => reject(errorFromWorker(message.message, message.code)));
        };
        const onError = (error) => {
          finish(() => reject(error));
        };
        worker.on("message", onMessage);
        worker.on("error", onError);
        worker.postMessage({ type: "run", id, request });
      });
    }
    ensureWorker() {
      if (this.worker) return this.worker;
      if (!fs3.existsSync(this.workerPath)) throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A trace worker");
      const loaded = loadWorkerThreads();
      if (loaded === null) throw new Error("worker_threads \u0E44\u0E21\u0E48\u0E1E\u0E23\u0E49\u0E2D\u0E21");
      this.worker = new loaded.Worker(this.workerPath);
      return this.worker;
    }
    runInline(request, onProgress) {
      return runTraceJob(request, {
        onProgress,
        isCancelled: () => this.cancelled,
        registerChild: (kill) => {
          this.killInline = kill;
        },
        thread: { threadId: 0, isMainThread: true }
      });
    }
  };
  function loadWorkerThreads() {
    try {
      const nodeRequire = (0, import_module.createRequire)(process.execPath);
      return nodeRequire("worker_threads");
    } catch {
      return null;
    }
  }
  function errorFromWorker(message, code) {
    if (code === "prep") return new ImagePrepError(message);
    return new Error(message);
  }
  function isStartupError(error) {
    if (!(error instanceof Error)) return false;
    return error.message === "\u0E44\u0E21\u0E48\u0E1E\u0E1A trace worker" || error.message === "worker_threads \u0E44\u0E21\u0E48\u0E1E\u0E23\u0E49\u0E2D\u0E21" || error.message.indexOf("Cannot find module") !== -1;
  }

  // src/panel.ts
  var HostTimeoutError = class extends Error {
    constructor() {
      super("Illustrator \u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E20\u0E32\u0E22\u0E43\u0E19\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14");
    }
  };
  var EMPTY_SELECTION = "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E20\u0E32\u0E1E raster \u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E\u0E1A\u0E19 artboard";
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
      root: getElement("panel-root"),
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
      steps: {
        check: getElement("step-check"),
        read: getElement("step-read"),
        trace: getElement("step-trace"),
        apply: getElement("step-apply")
      }
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
    if (parts.length !== 15) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const itemType = parts[3];
    if (itemType !== "PlacedItem" && itemType !== "RasterItem") throw new Error("\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E1E raster \u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E");
    const uuid = parts[4];
    if (!uuid) throw new Error("\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E21\u0E35 Illustrator UUID");
    const acquire = parts[11];
    if (acquire !== "file" && acquire !== "capture") throw new Error("\u0E42\u0E2B\u0E21\u0E14\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E23\u0E39\u0E49\u0E08\u0E31\u0E01");
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
      fromResult: parts[10] === "1",
      acquire,
      linkedPath: parts[12] ?? "",
      clipped: parts[13] === "1",
      viaGroup: parts[14] === "1"
    };
  }
  function parseCapture(parts) {
    const mode = parts[0];
    const filePath = parts[1] ?? "";
    if (mode !== "file" && mode !== "capture" || filePath === "") throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const bytes = Number(parts[2] ?? "0");
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("\u0E44\u0E1F\u0E25\u0E4C\u0E20\u0E32\u0E1E\u0E27\u0E48\u0E32\u0E07");
    return { mode, filePath, bytes };
  }
  function callHost(host, method, args = []) {
    const encoded = args.map((value) => '"' + encodeURIComponent(value) + '"').join(",");
    const script = method + "(" + encoded + ")";
    return new Promise((resolve2, reject) => {
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
          resolve2(parseHostResult(raw));
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
    const directory = fs4.mkdtempSync(path2.join(os.tmpdir(), "vector-panel-"));
    return {
      id: crypto.randomBytes(8).toString("hex"),
      directory,
      pngPath: path2.join(directory, "source.png"),
      svgPath: path2.join(directory, "result.svg"),
      settings,
      cancelled: false
    };
  }
  function cleanJob(job) {
    try {
      fs4.rmSync(job.directory, { recursive: true, force: true });
    } catch (_) {
    }
  }
  async function cleanStaleJobs() {
    try {
      const root = os.tmpdir();
      const names = await fs4.promises.readdir(root);
      const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
      for (const name of names) {
        if (!name.startsWith("vector-panel-")) continue;
        const directory = path2.join(root, name);
        const stat = await fs4.promises.stat(directory);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) await fs4.promises.rm(directory, { recursive: true, force: true });
      }
    } catch (_) {
    }
  }
  function vtracerArguments(job) {
    const args = [job.pngPath, job.svgPath];
    const preset = job.settings.preset;
    if (preset === "photo") {
      args.push("--preset", "photo", "--max-colors", String(job.settings.maxColors));
    } else {
      args.push("--preset", "poster", "--hierarchical", "cutout", "--max-colors", String(job.settings.maxColors));
      if (preset === "icon") args.push("--mode", "polygon");
    }
    if (job.settings.simplify > 0) args.push("--simplify", String(job.settings.simplify));
    args.push("--optimize", "1");
    return args;
  }
  function vtracerBinary(extensionPath) {
    const override = process.env["VECTOR_PANEL_VTRACER"];
    if (override) return override;
    return path2.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
  }
  function readSettings(ui) {
    const preset = ui.preset.value;
    if (preset !== "logo" && preset !== "icon" && preset !== "photo") throw new Error("Preset \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    const maxColors = Number(ui.colors.value);
    const simplify = Number(ui.smooth.value) / 10;
    if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error("\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    if (!Number.isFinite(simplify) || simplify < 0 || simplify > 3) throw new Error("\u0E04\u0E48\u0E32\u0E04\u0E27\u0E32\u0E21\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    return { preset, maxColors, simplify };
  }
  function showSelection(ui, selection) {
    if (selection === null) {
      if (ui.selection.dataset["signature"] === "empty" && ui.selection.textContent === EMPTY_SELECTION) return;
      if (ui.selection.childElementCount === 0 && ui.selection.textContent === EMPTY_SELECTION) {
        ui.selection.dataset["signature"] = "empty";
        return;
      }
      ui.selection.dataset["signature"] = "empty";
      ui.selection.textContent = EMPTY_SELECTION;
      return;
    }
    const signature = [selection.uuid, selection.documentIdentity, selection.acquire, selection.viaGroup ? "1" : "0", selection.clipped ? "1" : "0", selection.fromResult ? "1" : "0"].join("|");
    if (ui.selection.dataset["signature"] === signature) return;
    ui.selection.dataset["signature"] = signature;
    ui.selection.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = selection.itemName || selection.itemType;
    const detail = document.createElement("small");
    let text = selection.documentName + " \xB7 " + (selection.embedded ? "embedded" : "linked") + " \xB7 " + Math.round(selection.widthPt) + " \xD7 " + Math.round(selection.heightPt) + " pt";
    if (selection.viaGroup) text += " \xB7 \u0E2D\u0E22\u0E39\u0E48\u0E43\u0E19\u0E01\u0E25\u0E38\u0E48\u0E21";
    if (selection.clipped) text += " \xB7 \u0E21\u0E35\u0E04\u0E25\u0E34\u0E1B";
    text += selection.acquire === "file" ? " \xB7 \u0E2D\u0E48\u0E32\u0E19\u0E44\u0E1F\u0E25\u0E4C\u0E25\u0E34\u0E07\u0E01\u0E4C" : " \xB7 \u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23";
    if (selection.fromResult) text += " \xB7 \u0E41\u0E1B\u0E25\u0E07\u0E0B\u0E49\u0E33\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48";
    detail.textContent = text;
    ui.selection.append(title, detail);
  }
  function currentSelection(state) {
    switch (state.kind) {
      case "empty":
        return null;
      case "checking":
        return state.previous;
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
  function isBusy(state) {
    return state.kind === "checking" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying";
  }
  function phaseText(state) {
    switch (state.kind) {
      case "checking":
        return "\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E";
      case "capturing":
        return "\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E";
      case "tracing":
        if (state.stage === "trace") return "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E1B\u0E25\u0E07";
        if (state.stage === "svg") return "\u0E2D\u0E48\u0E32\u0E19\u0E1C\u0E25";
        return "\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E20\u0E32\u0E1E";
      case "applying":
        return "\u0E43\u0E2A\u0E48\u0E1C\u0E25";
      case "preview":
        return "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25";
      default:
        return "\u0E1E\u0E23\u0E49\u0E2D\u0E21";
    }
  }
  function stepStates(state) {
    if (state.kind === "checking") return { check: "current", read: "idle", trace: "idle", apply: "idle" };
    if (state.kind === "capturing") return { check: "done", read: "current", trace: "idle", apply: "idle" };
    if (state.kind === "tracing" && state.stage === "prepare") return { check: "done", read: "current", trace: "idle", apply: "idle" };
    if (state.kind === "tracing") return { check: "done", read: "done", trace: "current", apply: "idle" };
    if (state.kind === "preview") return { check: "done", read: "done", trace: "done", apply: "ready" };
    if (state.kind === "applying") return { check: "done", read: "done", trace: "done", apply: "current" };
    return { check: "idle", read: "idle", trace: "idle", apply: "idle" };
  }
  function setPreview(ui, url) {
    if (url) {
      if (ui.preview.getAttribute("src") !== url) ui.preview.src = url;
      ui.preview.hidden = false;
      ui.previewEmpty.hidden = true;
      return;
    }
    if (ui.preview.hidden && ui.previewEmpty.hidden === false) return;
    ui.preview.removeAttribute("src");
    ui.preview.hidden = true;
    ui.previewEmpty.hidden = false;
  }
  async function linkedFileDecision(filePath, selection) {
    let size = null;
    try {
      size = await readRasterSize(filePath);
    } catch {
      return "\u0E2D\u0E48\u0E32\u0E19\u0E44\u0E1F\u0E25\u0E4C\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u2026";
    }
    if (size === null) return "\u0E2D\u0E48\u0E32\u0E19\u0E02\u0E19\u0E32\u0E14\u0E44\u0E1F\u0E25\u0E4C\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u2026";
    if (size.width * size.height > MAX_DECODE_PIXELS) return "\u0E20\u0E32\u0E1E\u0E15\u0E49\u0E19\u0E17\u0E32\u0E07\u0E43\u0E2B\u0E0D\u0E48\u0E01\u0E27\u0E48\u0E32\u0E07\u0E1A\u0E16\u0E2D\u0E14\u0E23\u0E2B\u0E31\u0E2A \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u2026";
    if (aspectMismatch(size.width, size.height, selection.widthPt, selection.heightPt)) return "\u0E2A\u0E31\u0E14\u0E2A\u0E48\u0E27\u0E19\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E44\u0E1F\u0E25\u0E4C\u0E15\u0E49\u0E19\u0E17\u0E32\u0E07 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u2026";
    return null;
  }
  function start() {
    const ui = getUi();
    let state = { kind: "empty" };
    const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
    const host = typeof CSInterface === "undefined" ? null : new CSInterface();
    const runner = host === null ? null : new TraceRunner(path2.join(extensionPath, "js", "trace-worker.js"));
    function message(value, isError = false) {
      ui.status.textContent = value;
      ui.status.classList.toggle("error", isError);
      const role = isError ? "alert" : "status";
      if (ui.status.getAttribute("role") !== role) ui.status.setAttribute("role", role);
    }
    function render() {
      showSelection(ui, currentSelection(state));
      const busy = isBusy(state);
      ui.root.setAttribute("aria-busy", busy ? "true" : "false");
      ui.refresh.disabled = busy;
      ui.trace.disabled = busy || state.kind === "empty" || state.kind === "checking";
      ui.trace.textContent = currentSelection(state)?.fromResult ? "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48" : "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07";
      ui.apply.disabled = state.kind !== "preview";
      ui.cancel.disabled = state.kind !== "capturing" && state.kind !== "tracing";
      const phase = phaseText(state);
      if (ui.phase.textContent !== phase) ui.phase.textContent = phase;
      const steps = stepStates(state);
      Object.keys(steps).forEach((key) => {
        const element = ui.steps[key];
        const value = steps[key];
        if (element.getAttribute("data-state") !== value) element.setAttribute("data-state", value);
        if (value === "current") {
          if (element.getAttribute("aria-current") !== "step") element.setAttribute("aria-current", "step");
        } else if (element.hasAttribute("aria-current")) {
          element.removeAttribute("aria-current");
        }
      });
      if (state.kind === "preview" || state.kind === "applying") setPreview(ui, state.previewUrl);
      else setPreview(ui, null);
    }
    async function refresh() {
      if (host === null) {
        message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
        return;
      }
      if (isBusy(state)) return;
      const previous = currentSelection(state);
      const jobToClean = state.kind === "preview" ? state.job : null;
      state = { kind: "checking", previous };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E\u2026");
      render();
      if (jobToClean) cleanJob(jobToClean);
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
    async function capturePixels(selection, job, mode) {
      if (host === null) throw new Error("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19");
      const captured = parseCapture(await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity, mode]));
      if (job.cancelled) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
      return captured;
    }
    async function trace() {
      if (host === null || runner === null) return;
      if (state.kind !== "selected" && state.kind !== "preview") return;
      const selection = state.selection;
      const jobToClean = state.kind === "preview" ? state.job : null;
      let job = null;
      try {
        if (jobToClean) cleanJob(jobToClean);
        job = newJob(readSettings(ui));
        state = { kind: "capturing", selection, job };
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator\u2026");
        render();
        let captured = await capturePixels(selection, job, "");
        if (captured.mode === "file") {
          const reason = await linkedFileDecision(captured.filePath, selection);
          if (reason !== null) {
            if (job.cancelled) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
            message(reason);
            render();
            captured = await capturePixels(selection, job, "capture");
          }
        }
        const binary = vtracerBinary(extensionPath);
        if (!fs4.existsSync(binary)) throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A VTracer binary \u0E43\u0E19 extension/bin");
        const request = {
          binary,
          sourcePath: captured.filePath,
          pngPath: job.pngPath,
          svgPath: job.svgPath,
          flags: vtracerArguments(job).slice(2),
          maxPixels: MAX_TRACE_PIXELS,
          maxDecodePixels: MAX_DECODE_PIXELS
        };
        state = { kind: "tracing", selection, job, stage: "prepare" };
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E20\u0E32\u0E1E\u2026");
        render();
        let result;
        try {
          result = await runner.run(request, (stage) => {
            if (state.kind !== "tracing" || state.job !== job) return;
            state = { kind: "tracing", selection, job, stage };
            message(stage === "trace" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C\u2026" : stage === "svg" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C\u2026" : "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E20\u0E32\u0E1E\u2026");
            render();
          });
        } catch (error) {
          if (captured.mode === "file" && error instanceof ImagePrepError && job !== null && !job.cancelled) {
            message("\u0E16\u0E2D\u0E14\u0E23\u0E2B\u0E31\u0E2A\u0E44\u0E1F\u0E25\u0E4C\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u2026");
            state = { kind: "capturing", selection, job };
            render();
            captured = await capturePixels(selection, job, "capture");
            state = { kind: "tracing", selection, job, stage: "prepare" };
            message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E20\u0E32\u0E1E\u2026");
            render();
            result = await runner.run({ ...request, sourcePath: captured.filePath }, (stage) => {
              if (state.kind !== "tracing" || state.job !== job) return;
              state = { kind: "tracing", selection, job, stage };
              message(stage === "trace" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C\u2026" : stage === "svg" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C\u2026" : "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E20\u0E32\u0E1E\u2026");
              render();
            });
          } else {
            throw error;
          }
        }
        if (job.cancelled) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
        state = { kind: "preview", selection, job, previewUrl: (0, import_url.pathToFileURL)(job.svgPath).href };
        message("\u0E14\u0E39\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E43\u0E2A\u0E48\u0E43\u0E19 Illustrator \xB7 SVG " + result.pathCount + " paths");
        render();
      } catch (error) {
        if (job !== null) cleanJob(job);
        const cancelled = errorMessage(error) === "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27";
        state = { kind: "selected", selection };
        message(cancelled ? "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27 \u0E20\u0E32\u0E1E\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19" : errorMessage(error), !cancelled);
        render();
      }
    }
    async function apply() {
      if (host === null || state.kind !== "preview") return;
      const { selection, job, previewUrl } = state;
      state = { kind: "applying", selection, job, previewUrl };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E19\u0E33 path \u0E40\u0E02\u0E49\u0E32 Illustrator\u2026");
      render();
      try {
        const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";simplify=" + job.settings.simplify;
        const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
        state = { kind: "selected", selection };
        render();
        cleanJob(job);
        message("\u0E43\u0E2A\u0E48\u0E1C\u0E25\u0E41\u0E25\u0E49\u0E27: " + (result[1] ?? "0") + " paths \xB7 \u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48");
      } catch (error) {
        if (error instanceof HostTimeoutError) {
          message("Illustrator \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A \u0E15\u0E23\u0E27\u0E08 Layers \u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E25\u0E0B\u0E49\u0E33", true);
          state = { kind: "selected", selection };
        } else {
          message(errorMessage(error), true);
          state = { kind: "preview", selection, job, previewUrl };
        }
        render();
      }
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
      if (state.kind !== "capturing" && state.kind !== "tracing") return;
      state.job.cancelled = true;
      if (runner) runner.cancel();
      message(state.kind === "capturing" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026 \u0E23\u0E2D Illustrator \u0E08\u0E1A\u0E01\u0E32\u0E23\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E" : "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
    });
    ui.colors.addEventListener("input", () => {
      ui.colorsValue.value = ui.colors.value;
    });
    ui.smooth.addEventListener("input", () => {
      ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
    });
    ui.preset.addEventListener("change", () => {
      ui.colors.value = ui.preset.value === "photo" ? "24" : ui.preset.value === "icon" ? "4" : "8";
      ui.colorsValue.value = ui.colors.value;
    });
    window.addEventListener("beforeunload", () => {
      if (runner) runner.dispose();
      if (state.kind === "preview" || state.kind === "applying") cleanJob(state.job);
      if (state.kind === "tracing" || state.kind === "capturing") {
        state.job.cancelled = true;
        cleanJob(state.job);
      }
    });
    render();
    void cleanStaleJobs();
    void refresh();
  }
  start();
})();
