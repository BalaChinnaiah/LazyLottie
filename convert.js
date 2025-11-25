const fs = require("fs-extra");
const GIFEncoder = require("gifencoder");
const puppeteer = require("puppeteer");
const { createCanvas, loadImage } = require("canvas");
const path = require("path");

async function convertLottieToGIF(inputJSON, outputGIF) {
    if (!fs.existsSync(inputJSON)) {
        console.log("❌ JSON file not found.");
        return;
    }

    const animationData = await fs.readJSON(inputJSON);
    const width = animationData.w || 512;
    const height = animationData.h || 512;
    const totalFrames = Math.round(animationData.op - animationData.ip);
    const fps = animationData.fr || 30;

    console.log(`🎬 Rendering ${totalFrames} frames at ${fps} FPS using SVG renderer...`);

    // Create frames directory
    const framesDir = path.join(__dirname, "frames");
    await fs.ensureDir(framesDir);
    await fs.emptyDir(framesDir);

    // Load lottie-web inline
    const lottieJS = fs.readFileSync(
        require.resolve("lottie-web/build/player/lottie_svg.js"),
        "utf8"
    );

    // Launch puppeteer
    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width, height });

    // Build HTML
    const html = `
        <html>
        <body style="margin:0;overflow:hidden;background:transparent;">
            <div id="animation" style="width:${width}px;height:${height}px;"></div>
            <script>${lottieJS}</script>
            <script>
                window.anim = lottie.loadAnimation({
                    container: document.getElementById("animation"),
                    renderer: "svg",
                    loop: false,
                    autoplay: false,
                    animationData: ${JSON.stringify(animationData)}
                });
            </script>
        </body>
        </html>
    `;

    await page.setContent(html, { waitUntil: "load", timeout: 0 });

    // rendering canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // EXPORT PNG FRAMES
    for (let frame = 0; frame < totalFrames; frame++) {
        await page.evaluate((f) => {
            window.anim.goToAndStop(f, true);
        }, frame);

        // Extract SVG
        const svgData = await page.$eval("#animation svg", (el) => el.outerHTML);

        // convert SVG → PNG in canvas
        const svgBuffer = Buffer.from(svgData);
        const svg64 = "data:image/svg+xml;base64," + svgBuffer.toString("base64");
        const img = await loadImage(svg64);

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const pngPath = path.join(framesDir, `frame_${String(frame).padStart(4, "0")}.png`);
        const buffer = canvas.toBuffer("image/png");
        fs.writeFileSync(pngPath, buffer);

        process.stdout.write(`Saving PNG ${frame + 1}/${totalFrames}\r`);
    }

    await browser.close();

    console.log("\n\n📦 PNG frames generated. Now building GIF...");

    // CREATE TRANSPARENT GIF FROM PNGS
    const encoder = new GIFEncoder(width, height);
    const gifStream = fs.createWriteStream(outputGIF);
    encoder.createReadStream().pipe(gifStream);

    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(1000 / fps);
    encoder.setQuality(10);

    // Load PNGs in order
    const frameFiles = fs.readdirSync(framesDir).sort();

    for (let i = 0; i < frameFiles.length; i++) {
        const filePath = path.join(framesDir, frameFiles[i]);
        const img = await loadImage(filePath);

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        encoder.addFrame(ctx);

        process.stdout.write(`Adding ${i + 1}/${frameFiles.length} to GIF\r`);
    }

    encoder.finish();

    console.log(`\n\n✅ GIF created successfully → ${outputGIF}`);

    // ✅ Wait until GIF file is fully written, then delete frames folder
    gifStream.on("finish", async () => {
        try {
            await fs.remove(framesDir);
            console.log("\n🧹 Frames folder deleted successfully.");
        } catch (err) {
            console.error("\n⚠️ Failed to delete frames folder:", err);
        }
    });
}

if (process.argv.length < 4) {
    console.log("Usage: node convert.js input.json output.gif");
    process.exit();
}

convertLottieToGIF(process.argv[2], process.argv[3]);
