import * as ui from "./ui.js";
import Canvas from "./canvas.js";
import Optimizer from "./optimizer.js";

const nodes = {
	output: document.querySelector("#output"),
	original: document.querySelector("#original"),
	steps: document.querySelector("#steps"),
	raster: document.querySelector("#raster"),
	vector: document.querySelector("#vector"),
	vectorText: document.querySelector("#vector-text"),
	types: Array.from(document.querySelectorAll("#output [name=type]")),
	gifPanel: document.querySelector("#gif-panel"),
	gifStatus: document.querySelector("#gif-status"),
	gifProgress: document.querySelector("#gif-progress"),
	gifPreview: document.querySelector("#gif-preview"),
	gifDownload: document.querySelector("#gif-download"),
	gifEnabled: document.querySelector("#gif-enabled"),
	webmPanel: document.querySelector("#webm-panel"),
	webmStatus: document.querySelector("#webm-status"),
	webmPreview: document.querySelector("#webm-preview"),
	webmDownload: document.querySelector("#webm-download"),
	webmEnabled: document.querySelector("#webm-enabled"),
	progressBar: document.querySelector("#progress-bar")
}

let steps;

function initGifRecorder(width, height) {
	if (typeof GIF === "undefined") { return null; }

	let recorder = null;
	let pendingFrames = [];

	let workerUrl = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";
	fetch(workerUrl)
		.then(r => r.blob())
		.then(blob => {
			let blobUrl = URL.createObjectURL(blob);
			recorder = new GIF({
				workers: 2,
				quality: 10,
				width: width,
				height: height,
				workerScript: blobUrl
			});

			recorder.on("progress", p => {
				if (nodes.gifProgress) {
					nodes.gifProgress.style.width = Math.round(p * 100) + "%";
				}
				if (nodes.gifStatus) {
					nodes.gifStatus.textContent = "Encoding GIF... " + Math.round(p * 100) + "%";
				}
			});

			recorder.on("finished", blob => {
				let url = URL.createObjectURL(blob);
				if (nodes.gifPreview) {
					let img = document.createElement("img");
					img.src = url;
					nodes.gifPreview.innerHTML = "";
					nodes.gifPreview.appendChild(img);
				}
				if (nodes.gifDownload) {
					nodes.gifDownload.href = url;
					nodes.gifDownload.style.display = "inline-block";
				}
				if (nodes.gifStatus) {
					nodes.gifStatus.textContent = "GIF ready!";
				}
				URL.revokeObjectURL(blobUrl);
			});

			pendingFrames.forEach(canvas => {
				recorder.addFrame(canvas, { copy: true, delay: 100 });
			});
			pendingFrames = [];
		})
		.catch(() => {
			/* worker fetch failed, GIF silently disabled */
		});

	return {
		addFrame(canvas) {
			if (recorder) {
				recorder.addFrame(canvas, { copy: true, delay: 100 });
			} else {
				pendingFrames.push(canvas);
			}
		},
		render() {
			if (recorder) {
				recorder.render();
			}
		}
	};
}

function initWebmRecorder(canvasNode) {
	if (!canvasNode.captureStream || !window.MediaRecorder) { return null; }

	let stream = canvasNode.captureStream(0);
	let mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
		? "video/webm;codecs=vp9"
		: "video/webm";
	let mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
	let chunks = [];

	mediaRecorder.ondataavailable = (e) => {
		if (e.data && e.data.size > 0) {
			chunks.push(e.data);
		}
	};

	mediaRecorder.onstop = () => {
		let blob = new Blob(chunks, { type: mimeType });
		let url = URL.createObjectURL(blob);
		if (nodes.webmPreview) {
			let video = document.createElement("video");
			video.src = url;
			video.controls = true;
			video.loop = true;
			video.autoplay = true;
			video.muted = true;
			nodes.webmPreview.innerHTML = "";
			nodes.webmPreview.appendChild(video);
		}
		if (nodes.webmDownload) {
			nodes.webmDownload.href = url;
			nodes.webmDownload.style.display = "inline-block";
		}
		if (nodes.webmStatus) {
			nodes.webmStatus.textContent = "WebM ready!";
		}
	};

	mediaRecorder.start();

	return {
		captureFrame() {
			let track = stream.getVideoTracks()[0];
			if (track && track.requestFrame) {
				track.requestFrame();
			}
		},
		stop() {
			if (mediaRecorder.state === "recording") {
				mediaRecorder.stop();
			}
		}
	};
}

function go(original, cfg) {
	ui.lock();

	nodes.steps.innerHTML = "";
	nodes.original.innerHTML = "";
	nodes.raster.innerHTML = "";
	nodes.vector.innerHTML = "";
	nodes.vectorText.value = "";

	nodes.output.style.display = "block";
	nodes.original.appendChild(original.node);

	/* Progress bar */
	let progressBarContainer = nodes.progressBar;
	let progressBarFill = progressBarContainer ? progressBarContainer.querySelector(".progress-bar-fill") : null;
	if (progressBarContainer) {
		progressBarContainer.style.display = "block";
		if (progressBarFill) progressBarFill.style.width = "0%";
	}

	/* GIF panel reset */
	let gifRecording = nodes.gifEnabled && nodes.gifEnabled.checked;
	let gifRecorder = null;
	if (nodes.gifPanel) nodes.gifPanel.style.display = "none";
	if (nodes.gifDownload) nodes.gifDownload.style.display = "none";
	if (nodes.gifPreview) nodes.gifPreview.innerHTML = "";
	if (nodes.gifProgress) nodes.gifProgress.style.width = "0%";
	if (nodes.gifStatus) nodes.gifStatus.textContent = "Waiting for generation to finish...";

	/* WebM panel reset */
	let webmRecording = nodes.webmEnabled && nodes.webmEnabled.checked;
	let webmRecorder = null;
	if (nodes.webmPanel) nodes.webmPanel.style.display = "none";
	if (nodes.webmDownload) nodes.webmDownload.style.display = "none";
	if (nodes.webmPreview) nodes.webmPreview.innerHTML = "";
	if (nodes.webmStatus) nodes.webmStatus.textContent = "Recording...";

	let optimizer = new Optimizer(original, cfg);
	steps = 0;

	let cfg2 = Object.assign({}, cfg, {width:cfg.scale*cfg.width, height:cfg.scale*cfg.height});
	let result = Canvas.empty(cfg2, false);
	result.ctx.scale(cfg.scale, cfg.scale);
	nodes.raster.appendChild(result.node);

	let svg = Canvas.empty(cfg, true);
	svg.setAttribute("width", cfg2.width);
	svg.setAttribute("height", cfg2.height);
	nodes.vector.appendChild(svg);

	let serializer = new XMLSerializer();

	/* GIF init */
	let gifFrameInterval = Math.max(1, Math.ceil(cfg.steps / 60));
	if (gifRecording) {
		gifRecorder = initGifRecorder(cfg2.width, cfg2.height);
		if (nodes.gifPanel) nodes.gifPanel.style.display = "block";
	}

	/* WebM init */
	if (webmRecording) {
		webmRecorder = initWebmRecorder(result.node);
		if (nodes.webmPanel) nodes.webmPanel.style.display = "block";
	}

	optimizer.onStep = (step) => {
		steps++;

		/* Update progress bar */
		if (progressBarFill) {
			let pct = (steps / cfg.steps * 100).toFixed(1);
			progressBarFill.style.width = pct + "%";
		}

		if (step) {
			result.drawStep(step);
			svg.appendChild(step.toSVG());
			let percent = (100*(1-step.distance)).toFixed(2);
			nodes.vectorText.value = serializer.serializeToString(svg);
			nodes.steps.innerHTML = `(${steps} of ${cfg.steps}, ${percent}% similar)`;

			/* Capture GIF frame */
			if (gifRecorder && steps % gifFrameInterval === 0) {
				gifRecorder.addFrame(result.node);
			}

			/* Capture WebM frame */
			if (webmRecorder) {
				webmRecorder.captureFrame();
			}
		}
	}

	optimizer.onFinish = () => {
		/* finalize progress bar */
		if (progressBarFill) progressBarFill.style.width = "100%";

		/* finalize GIF */
		if (gifRecorder) {
			/* add final frame */
			gifRecorder.addFrame(result.node);
			if (nodes.gifStatus) {
				nodes.gifStatus.textContent = "Encoding GIF...";
			}
			gifRecorder.render();
		}

		/* finalize WebM */
		if (webmRecorder) {
			webmRecorder.captureFrame();
			if (nodes.webmStatus) {
				nodes.webmStatus.textContent = "Finalizing WebM...";
			}
			setTimeout(() => webmRecorder.stop(), 200);
		}
	};

	optimizer.start();

	document.documentElement.scrollTop = document.documentElement.scrollHeight;
}

function onSubmit(e) {
	e.preventDefault();

	let inputFile = document.querySelector("input[type=file]");
	let inputUrl = document.querySelector("input[name=url]");

	let url = "test";
	if (inputFile.files.length > 0) {
		let file = inputFile.files[0];
		url = URL.createObjectURL(file);
	} else if (inputUrl.value) {
		url = inputUrl.value;
	}

	let cfg = ui.getConfig();

	Canvas.original(url, cfg).then(original => go(original, cfg));
}

function init() {
	nodes.output.style.display = "none";
	nodes.types.forEach(input => input.addEventListener("click", syncType));
	ui.init();
	syncType();
	document.querySelector("form").addEventListener("submit", onSubmit);
}

function syncType() {
	nodes.output.className = "";
	nodes.types.forEach(input => {
		if (input.checked) { nodes.output.classList.add(input.value); }
	});
}

init();
