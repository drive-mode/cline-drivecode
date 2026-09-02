/**
 * A visible pointer for the recordings.
 *
 * Screen recordings do not capture the OS cursor, and a browser draws no touch
 * indicator at all — so without this a viewer sees panels changing with no idea
 * what was pressed. This draws the input on top of the page: an arrow for the
 * desktop panes, an Apple-style touch ring for the phone, a ripple on press and
 * a fading trail on swipe.
 *
 * It is a *readout*, never a substitute: the recorder moves this overlay and
 * dispatches the real input to the same coordinates, so what you see is what
 * actually happened. Nothing here synthesises an interaction.
 *
 * Self-installs on load and works in any page — the stage loads it with a
 * script tag, and the recorder injects the same file into the hub dashboard,
 * which it does not own. It lives in a shadow root and never takes pointer
 * events, so it cannot restyle or intercept anything on the host page.
 */

const installDemoPointer = () => {
	if (window.__demoPointer) return;

	const host = document.createElement("div");
	host.id = "demo-pointer-host";
	host.style.cssText =
		"position:fixed;inset:0;pointer-events:none;z-index:2147483647";
	const root = host.attachShadow({ mode: "open" });

	root.innerHTML = `
	<style>
		:host { all: initial; }
		.layer { position: fixed; inset: 0; pointer-events: none; }
		.pointer {
			position: fixed; top: 0; left: 0;
			transition: transform .42s cubic-bezier(.22,.61,.36,1), opacity .2s linear;
			opacity: 0;
			will-change: transform;
		}
		.pointer.on { opacity: 1; }
		/* all:initial on the host drops the UA rule for [hidden], so the
		   arrow and the ring would otherwise both draw in every mode. */
		.pointer [hidden] { display: none !important; }
		.arrow { filter: drop-shadow(0 2px 4px rgba(0,0,0,.55)); }
		.touch {
			width: 46px; height: 46px; margin: -23px 0 0 -23px;
			border-radius: 50%;
			background: rgba(255,255,255,.24);
			border: 2px solid rgba(255,255,255,.85);
			box-shadow: 0 0 14px rgba(255,255,255,.35);
		}
		.pointer.press .touch { transform: scale(.82); background: rgba(255,255,255,.4); }
		.touch { transition: transform .12s ease, background .12s ease; }

		.ripple {
			position: fixed; top: 0; left: 0;
			width: 18px; height: 18px; margin: -9px 0 0 -9px;
			border-radius: 50%;
			border: 2px solid var(--ink, #fff);
			animation: burst .55s cubic-bezier(.2,.7,.3,1) forwards;
		}
		@keyframes burst {
			from { transform: scale(.5); opacity: .85; }
			to   { transform: scale(4.2); opacity: 0; }
		}

		.trail { position: fixed; inset: 0; overflow: visible; animation: fade 1s ease forwards; }
		.trail path {
			fill: none; stroke: rgba(255,255,255,.9); stroke-width: 4;
			stroke-linecap: round; stroke-linejoin: round;
			filter: drop-shadow(0 0 6px rgba(255,255,255,.5));
		}
		@keyframes fade { 0%,55% { opacity: 1; } 100% { opacity: 0; } }
	</style>
	<div class="layer" id="layer">
		<div class="pointer" id="ptr">
			<svg class="arrow" id="arrow" width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
				<path d="M2 1.4 L2 20.2 L6.9 15.7 L10.1 23.4 L13.6 22 L10.4 14.4 L17 14.1 Z"
					fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>
			</svg>
			<div class="touch" id="touch" style="display:none"></div>
		</div>
	</div>`;

	document.documentElement.appendChild(host);

	const layer = root.getElementById("layer");
	const ptr = root.getElementById("ptr");
	const arrow = root.getElementById("arrow");
	const touch = root.getElementById("touch");

	let x = window.innerWidth / 2;
	let y = window.innerHeight / 2;
	let kind = "mouse";

	const paint = () => {
		// The arrow's hotspot is its tip (top-left); the ring is centred.
		ptr.style.transform =
			kind === "touch"
				? `translate(${x}px, ${y}px)`
				: `translate(${x - 1}px, ${y - 1}px)`;
	};

	const api = {
		/** "mouse" | "touch" | "hidden" */
		mode(next) {
			if (next === "hidden") {
				ptr.classList.remove("on");
				return;
			}
			kind = next;
			// Set display outright: `hidden` is an HTML attribute and the UA
			// rule behind it does not reach an SVG element, so the arrow would
			// keep drawing underneath the touch ring.
			arrow.style.display = next === "mouse" ? "block" : "none";
			touch.style.display = next === "touch" ? "block" : "none";
			ptr.classList.add("on");
			paint();
		},

		/** Glide to a point. The recorder drives real input to the same place. */
		moveTo(nextX, nextY, nextKind) {
			if (nextKind) api.mode(nextKind);
			x = nextX;
			y = nextY;
			paint();
		},

		/** Snap without the glide — for the intermediate points of a swipe. */
		jumpTo(nextX, nextY) {
			ptr.style.transition = "none";
			x = nextX;
			y = nextY;
			paint();
			// Force a reflow so the next move animates again.
			void ptr.offsetWidth;
			ptr.style.transition = "";
		},

		/** A press at the current point: ring squash plus an expanding ripple. */
		press(ink) {
			ptr.classList.add("press");
			setTimeout(() => ptr.classList.remove("press"), 160);
			const r = document.createElement("div");
			r.className = "ripple";
			r.style.transform = `translate(${x}px, ${y}px)`;
			r.style.setProperty("--ink", ink ?? "#fff");
			layer.appendChild(r);
			setTimeout(() => r.remove(), 600);
		},

		/** Draw the path a swipe took, then let it fade. */
		trail(points) {
			if (!points || points.length < 2) return;
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("class", "trail");
			const path = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"path",
			);
			path.setAttribute(
				"d",
				points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" "),
			);
			svg.appendChild(path);
			layer.appendChild(svg);
			setTimeout(() => svg.remove(), 1100);
		},

		hide() {
			ptr.classList.remove("on");
		},
	};

	window.__demoPointer = api;
};

// The recorder injects this file with `addInitScript`, which runs before the
// document exists — `document.documentElement` is null at that point, and an
// unguarded install throws and leaves the page with no overlay at all. Install
// now when there is a document, otherwise wait for one.
if (document.documentElement) {
	installDemoPointer();
} else {
	document.addEventListener("DOMContentLoaded", installDemoPointer, {
		once: true,
	});
}
