// Duplicate of the host's `src/utils/markdown/mermaidRender.ts` —
// the plugin ships its own `mermaid` dep so the dynamic import
// resolves inside the plugin bundle rather than reaching into the
// host. Kept in sync with the host module; edits here should mirror
// there.

type MermaidRuntime = typeof import("mermaid").default;

/** Localised strings the render pipeline surfaces when it fails.
 *  See the host module (`src/utils/markdown/mermaidRender.ts`) for
 *  the design rationale — kept in sync manually. */
export interface MermaidRenderLabels {
  loadFailed: (error: string) => string;
  renderFailed: (error: string) => string;
}

const DEFAULT_LABELS: MermaidRenderLabels = {
  loadFailed: (error) => `⚠ Mermaid failed to load: ${error}`,
  renderFailed: (error) => `⚠ Mermaid render failed: ${error}`,
};

let mermaidPromise: Promise<MermaidRuntime> | null = null;

async function loadMermaid(): Promise<MermaidRuntime> {
  if (mermaidPromise) return mermaidPromise;
  const attempt = import("mermaid").then((mod) => {
    const mermaid = mod.default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
    return mermaid;
  });
  // Reset the cache on rejection so a transient import failure
  // (offline / stale chunk after deploy) can be retried by the next
  // fence to render, matching the host module's contract.
  attempt.catch(() => {
    if (mermaidPromise === attempt) mermaidPromise = null;
  });
  mermaidPromise = attempt;
  return attempt;
}

function placeLoadError(nodes: HTMLElement[], err: unknown, labels: MermaidRenderLabels): void {
  const message = labels.loadFailed(String(err));
  for (const node of nodes) {
    const errBox = document.createElement("pre");
    errBox.className = "mermaid-error";
    errBox.textContent = message;
    node.replaceWith(errBox);
  }
}

let renderCounter = 0;
function nextRenderId(): string {
  renderCounter += 1;
  return `mulmo-mermaid-plugin-${renderCounter}`;
}

function pendingNodes(root: Element | Document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid[data-mermaid-pending]"));
}

/** Mirrors host `adoptSvg` — DOMParser adoption in HTML5 mode so
 *  `<foreignObject>`-nested HTML in mermaid's SVG output parses
 *  cleanly, and opengrep's `innerHTML =` XSS heuristic stays quiet.
 *  Exported so `test/plugins/markdown/test_mermaidRender.ts` can
 *  guard this copy independently of the host tests. */
export function adoptSvg(svgMarkup: string): SVGElement | null {
  const parsed = new DOMParser().parseFromString(svgMarkup, "text/html");
  const svgEl = parsed.body.querySelector("svg");
  if (!svgEl) return null;
  return document.importNode(svgEl, true) as unknown as SVGElement;
}

async function renderOne(node: HTMLElement, mermaid: MermaidRuntime, labels: MermaidRenderLabels): Promise<void> {
  const source = node.textContent ?? "";
  const svgId = nextRenderId();
  try {
    const { svg } = await mermaid.render(svgId, source);
    const svgNode = adoptSvg(svg);
    if (!svgNode) throw new Error("mermaid produced malformed SVG");
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-diagram";
    wrapper.appendChild(svgNode);
    node.replaceWith(wrapper);
  } catch (err) {
    const errBox = document.createElement("pre");
    errBox.className = "mermaid-error";
    errBox.textContent = `${labels.renderFailed(String(err))}\n---\n${source}`;
    node.replaceWith(errBox);
  }
}

export async function renderMermaidNodes(root: Element | Document | null | undefined, labels: MermaidRenderLabels = DEFAULT_LABELS): Promise<void> {
  if (!root) return;
  const nodes = pendingNodes(root);
  if (nodes.length === 0) return;
  let mermaid: MermaidRuntime;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    placeLoadError(nodes, err, labels);
    return;
  }
  await Promise.all(nodes.map((node) => renderOne(node, mermaid, labels)));
}
