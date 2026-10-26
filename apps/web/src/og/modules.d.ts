declare module '*.bin' { const data: ArrayBuffer; export default data }
declare module '*.wasm?module' { const module: WebAssembly.Module; export default module }
