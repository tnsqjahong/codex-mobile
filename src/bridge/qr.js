const LOW_ECC_CODEWORDS = {
  1: { data: 19, ecc: 7 },
  2: { data: 34, ecc: 10 },
  3: { data: 55, ecc: 15 },
  4: { data: 80, ecc: 20 },
};

const ALIGNMENT_POSITIONS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
};

const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
let value = 1;
for (let index = 0; index < 255; index += 1) {
  GF_EXP[index] = value;
  GF_LOG[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < 512; index += 1) GF_EXP[index] = GF_EXP[index - 255];

export function createQrSvg(text, options = {}) {
  const matrix = createQrMatrix(text);
  const quiet = options.quietZone ?? 4;
  const moduleSize = options.moduleSize ?? 8;
  const foreground = options.foreground ?? "#111111";
  const background = options.background ?? "#ffffff";
  const modules = matrix.length;
  const size = (modules + quiet * 2) * moduleSize;
  const rects = [];

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!matrix[row][col]) continue;
      rects.push(
        `<rect x="${(col + quiet) * moduleSize}" y="${(row + quiet) * moduleSize}" width="${moduleSize}" height="${moduleSize}"/>`,
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Codex Mobile pairing QR code" shape-rendering="crispEdges">`,
    `<rect width="100%" height="100%" fill="${background}"/>`,
    `<g fill="${foreground}">${rects.join("")}</g>`,
    "</svg>",
  ].join("");
}

export function createQrMatrix(text) {
  const bytes = [...Buffer.from(text, "utf8")];
  const version = chooseVersion(bytes.length);
  const size = version * 4 + 17;
  const modules = createGrid(size, false);
  const reserved = createGrid(size, false);

  drawFunctionPatterns(modules, reserved, version);
  const data = encodeData(bytes, version);
  const ecc = reedSolomonRemainder(data, LOW_ECC_CODEWORDS[version].ecc);
  drawCodewords(modules, reserved, [...data, ...ecc]);
  drawFormatBits(modules, reserved, 0);

  return modules;
}

function chooseVersion(byteLength) {
  for (const [versionText, spec] of Object.entries(LOW_ECC_CODEWORDS)) {
    const capacityBits = spec.data * 8;
    const requiredBits = 4 + 8 + byteLength * 8;
    if (requiredBits <= capacityBits) return Number(versionText);
  }
  throw new Error("Pairing URL is too long for the built-in QR generator");
}

function encodeData(bytes, version) {
  const bitBuffer = [];
  appendBits(bitBuffer, 0b0100, 4);
  appendBits(bitBuffer, bytes.length, 8);
  for (const byte of bytes) appendBits(bitBuffer, byte, 8);

  const dataCodewords = LOW_ECC_CODEWORDS[version].data;
  const capacityBits = dataCodewords * 8;
  appendBits(bitBuffer, 0, Math.min(4, capacityBits - bitBuffer.length));
  while (bitBuffer.length % 8) bitBuffer.push(0);

  const data = [];
  for (let index = 0; index < bitBuffer.length; index += 8) {
    data.push(bitsToByte(bitBuffer.slice(index, index + 8)));
  }
  for (let pad = 0xec; data.length < dataCodewords; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);
  return data;
}

function appendBits(target, valueToAppend, length) {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push((valueToAppend >>> bit) & 1);
}

function bitsToByte(bits) {
  return bits.reduce((byte, bit) => (byte << 1) | bit, 0);
}

function reedSolomonRemainder(data, degree) {
  const generator = reedSolomonGenerator(degree);
  const result = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let index = 0; index < degree; index += 1) {
      result[index] ^= gfMultiply(generator[index], factor);
    }
  }
  return result;
}

function reedSolomonGenerator(degree) {
  let coefficients = [1];
  for (let degreeIndex = 0; degreeIndex < degree; degreeIndex += 1) {
    const next = new Array(coefficients.length + 1).fill(0);
    for (let index = 0; index < coefficients.length; index += 1) {
      next[index] ^= coefficients[index];
      next[index + 1] ^= gfMultiply(coefficients[index], GF_EXP[degreeIndex]);
    }
    coefficients = next;
  }
  return coefficients.slice(1);
}

function gfMultiply(left, right) {
  if (left === 0 || right === 0) return 0;
  return GF_EXP[GF_LOG[left] + GF_LOG[right]];
}

function createGrid(size, initialValue) {
  return Array.from({ length: size }, () => new Array(size).fill(initialValue));
}

function drawFunctionPatterns(modules, reserved, version) {
  const size = modules.length;
  drawFinder(modules, reserved, 3, 3);
  drawFinder(modules, reserved, size - 4, 3);
  drawFinder(modules, reserved, 3, size - 4);

  for (let index = 8; index < size - 8; index += 1) {
    setFunction(modules, reserved, 6, index, index % 2 === 0);
    setFunction(modules, reserved, index, 6, index % 2 === 0);
  }

  for (const row of ALIGNMENT_POSITIONS[version]) {
    for (const col of ALIGNMENT_POSITIONS[version]) {
      if (reserved[row][col]) continue;
      drawAlignment(modules, reserved, col, row);
    }
  }

  setFunction(modules, reserved, size - 8, 8, true);
  reserveFormatAreas(reserved);
}

function drawFinder(modules, reserved, centerCol, centerRow) {
  for (let rowOffset = -4; rowOffset <= 4; rowOffset += 1) {
    for (let colOffset = -4; colOffset <= 4; colOffset += 1) {
      const row = centerRow + rowOffset;
      const col = centerCol + colOffset;
      if (!isInside(modules, row, col)) continue;
      const distance = Math.max(Math.abs(rowOffset), Math.abs(colOffset));
      setFunction(modules, reserved, row, col, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(modules, reserved, centerCol, centerRow) {
  for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
    for (let colOffset = -2; colOffset <= 2; colOffset += 1) {
      const distance = Math.max(Math.abs(rowOffset), Math.abs(colOffset));
      setFunction(modules, reserved, centerRow + rowOffset, centerCol + colOffset, distance !== 1);
    }
  }
}

function reserveFormatAreas(reserved) {
  const size = reserved.length;
  for (let index = 0; index <= 8; index += 1) {
    if (index !== 6) {
      reserved[8][index] = true;
      reserved[index][8] = true;
    }
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[size - 1 - index][8] = true;
    reserved[8][size - 1 - index] = true;
  }
}

function drawCodewords(modules, reserved, codewords) {
  const bits = [];
  for (const codeword of codewords) appendBits(bits, codeword, 8);

  const size = modules.length;
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (reserved[row][col]) continue;
        const mask = (row + col) % 2 === 0;
        modules[row][col] = ((bits[bitIndex] ?? 0) === 1) !== mask;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function drawFormatBits(modules, reserved, mask) {
  const size = modules.length;
  const bits = getFormatBits(mask);
  for (let index = 0; index < 15; index += 1) {
    const bit = ((bits >>> index) & 1) === 1;
    if (index < 6) setFunction(modules, reserved, index, 8, bit);
    else if (index === 6) setFunction(modules, reserved, 7, 8, bit);
    else if (index === 7) setFunction(modules, reserved, 8, 8, bit);
    else if (index === 8) setFunction(modules, reserved, 8, 7, bit);
    else setFunction(modules, reserved, 8, 14 - index, bit);

    if (index < 8) setFunction(modules, reserved, 8, size - 1 - index, bit);
    else setFunction(modules, reserved, size - 15 + index, 8, bit);
  }
}

function getFormatBits(mask) {
  const errorCorrectionLevelLow = 0b01;
  let data = (errorCorrectionLevelLow << 3) | mask;
  let remainder = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((remainder >>> bit) & 1) !== 0) remainder ^= 0x537 << (bit - 10);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function setFunction(modules, reserved, row, col, isDark) {
  if (!isInside(modules, row, col)) return;
  modules[row][col] = isDark;
  reserved[row][col] = true;
}

function isInside(modules, row, col) {
  return row >= 0 && col >= 0 && row < modules.length && col < modules.length;
}
