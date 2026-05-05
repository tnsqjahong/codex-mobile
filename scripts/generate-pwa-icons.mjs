import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const svgPath = path.join(root, "public", "icon.svg")
const publicDir = path.join(root, "public")

const BG = { r: 21, g: 21, b: 19, alpha: 1 }

const targets = [
  { name: "icon-192.png", size: 192, padding: 0 },
  { name: "icon-512.png", size: 512, padding: 0 },
  { name: "icon-maskable-512.png", size: 512, padding: 0.2 },
  { name: "apple-touch-icon.png", size: 180, padding: 0 },
]

const svg = await readFile(svgPath)

for (const { name, size, padding } of targets) {
  const inner = Math.round(size * (1 - padding * 2))
  const offset = Math.round((size - inner) / 2)
  const composite = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: "contain", background: BG })
    .png()
    .toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: composite, top: offset, left: offset }])
    .png()
    .toFile(path.join(publicDir, name))
  console.log(`✓ ${name} (${size}×${size})`)
}
