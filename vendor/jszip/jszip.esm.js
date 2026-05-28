/** Browser ESM shim for the JSZip UMD build (offline use). */
const src = new URL('./dist/jszip.min.js', import.meta.url).href;

if (!globalThis.JSZip) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load JSZip from ' + src));
    document.head.appendChild(s);
  });
}

export default globalThis.JSZip;
