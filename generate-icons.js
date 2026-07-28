const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const iconsDir = path.join(__dirname, 'public', 'icons');

if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

// Create simple PNG icons using minimal PNG specification
function createMinimalPNG(size, r, g, b) {
    const width = size;
    const height = size;

    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 2; // color type (RGB)
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace

    const ihdr = createChunk('IHDR', ihdrData);

    // IDAT chunk - create raw image data with filter bytes
    const rawData = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        rawData[y * (width * 3 + 1)] = 0; // filter byte (None)
        for (let x = 0; x < width; x++) {
            const offset = y * (width * 3 + 1) + 1 + x * 3;
            // Create circular gradient pattern
            const cx = width / 2;
            const cy = height / 2;
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            const maxDist = width / 2;

            if (dist < maxDist * 0.85) {
                // Inner circle - emerald green
                const factor = 1 - (dist / maxDist) * 0.3;
                rawData[offset] = Math.floor(r * factor);
                rawData[offset + 1] = Math.floor(g * factor);
                rawData[offset + 2] = Math.floor(b * factor);
            } else if (dist < maxDist * 0.95) {
                // Border - gold
                rawData[offset] = 217;
                rawData[offset + 1] = 119;
                rawData[offset + 2] = 6;
            } else {
                // Background - transparent (white for non-transparent PNG)
                rawData[offset] = 252;
                rawData[offset + 1] = 251;
                rawData[offset + 2] = 247;
            }
        }
    }

    const zlib = require('zlib');
    const compressed = zlib.deflateSync(rawData);
    const idat = createChunk('IDAT', compressed);

    // IEND chunk
    const iend = createChunk('IEND', Buffer.alloc(0));

    // Combine all chunks
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const typeBuffer = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeBuffer, data]);

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);

    return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
        crc = crc ^ buf[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >>> 1) ^ 0xEDB88320;
            } else {
                crc = crc >>> 1;
            }
        }
    }
    return (crc ^ (-1)) >>> 0;
}

// Generate icons with Tanzeel emerald green (#047857)
const r = 4, g = 120, b = 87;

sizes.forEach(size => {
    const png = createMinimalPNG(size, r, g, b);
    const filePath = path.join(iconsDir, `icon-${size}.png`);
    fs.writeFileSync(filePath, png);
    console.log(`Created: icon-${size}.png (${png.length} bytes)`);
});

console.log('\nAll icons generated successfully!');
console.log('For production, replace these with your actual logo at each size.');
