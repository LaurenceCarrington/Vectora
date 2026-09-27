// v0.4.0 ships its declarations at dist/clipper2z.d.ts, not its package.json types path.
declare module 'clipper2-wasm/dist/es/clipper2z.js' {
  const factory: import('clipper2-wasm/dist/clipper2z').Clipper2ZFactoryFunction;
  export default factory;
}
