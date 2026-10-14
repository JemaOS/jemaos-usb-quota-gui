'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

function generateIcons(root = path.join(__dirname, '..')) {
  const output = path.join(root, 'assets');
  fs.mkdirSync(output, { recursive: true });
  const mark = fs.readFileSync(path.join(root, 'ui', 'logo.svg'), 'utf8')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect x="24" y="24" width="464" height="464" rx="112" fill="#111317"/>
    <g transform="translate(96 96) scale(13.333333)" fill="none" stroke="#f4f5f6"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${mark}</g>
  </svg>`;
  const png = size => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(output, 'icon.png'), png(512));
  const linux = path.join(output, 'linux');
  fs.mkdirSync(linux, { recursive: true });
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    fs.writeFileSync(path.join(linux, `${size}x${size}.png`), png(size));
  }

  // Modern Windows ICO entries can contain lossless PNG images.
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = sizes.map(png);
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([header, ...images]));

  const types = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
  const entries = types.map(([type, size]) => {
    const data = png(size);
    const entry = Buffer.alloc(8);
    entry.write(type, 0, 'ascii');
    entry.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([entry, data]);
  });
  const container = Buffer.alloc(8);
  container.write('icns', 0, 'ascii');
  container.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4);
  fs.writeFileSync(path.join(output, 'icon.icns'), Buffer.concat([container, ...entries]));
  return output;
}

if (require.main === module) {
  console.log(`Native USB icons generated: ${generateIcons()}`);
}

module.exports = { generateIcons };
