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

    console.log(`🎬 Rendering ${totalFrames} frames at ${fps} FPS...`);

    const framesDir = path.join(__dirname, "frames");
    await fs.ensureDir(framesDir);
    await fs.emptyDir(framesDir);

    const lottieJS = fs.readFileSync(
        require.resolve("lottie-web/build/player/lottie_svg.js"),
        "utf8"
    );

    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width, height });

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

    await page.setContent(html, { waitUntil: "load" });

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // EXPORT PNG FRAMES
    for (let f = 0; f < totalFrames; f++) {
        await page.evaluate((frame) => window.anim.goToAndStop(frame, true), f);

        const svg = await page.$eval("#animation svg", (el) => el.outerHTML);
        const svg64 =
            "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");

        const img = await loadImage(svg64);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);

        const pngPath = path.join(
            framesDir,
            `frame_${String(f).padStart(4, "0")}.png`
        );
        fs.writeFileSync(pngPath, canvas.toBuffer("image/png"));

        process.stdout.write(`Saving frame ${f + 1}/${totalFrames}\r`);
    }

    await browser.close();

    console.log("\n📦 Frames ready. Building Transparent GIF...\n");

    // FINAL & STABLE: GIFENCODER
    const encoder = new GIFEncoder(width, height);
    const gifStream = fs.createWriteStream(outputGIF);

    encoder.createReadStream().pipe(gifStream);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(1000 / fps);
    encoder.setQuality(10);
    encoder.setTransparent(0); // index 0 transparent

    const frameFiles = fs.readdirSync(framesDir).sort();

    for (let i = 0; i < frameFiles.length; i++) {
        const img = await loadImage(path.join(framesDir, frameFiles[i]));

        ctx.clearRect(0, 0, width, height);

        // transparent background for index 0
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0);

        const rgba = ctx.getImageData(0, 0, width, height).data;
        encoder.addFrame(ctx);

        process.stdout.write(`Adding GIF frame ${i + 1}/${frameFiles.length}\r`);
    }

    encoder.finish();

    console.log(`\n\n✅ Transparent GIF created → ${outputGIF}`);

    await fs.remove(framesDir);
    console.log("🧹 Frames folder removed.");
}

if (process.argv.length < 4) {
    console.log("Usage: node convert.js input.json output.gif");
    process.exit();
}

convertLottieToGIF(process.argv[2], process.argv[3]);
