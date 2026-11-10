// Vite fingerprints approved artwork in the build asset graph. Missing originals
// use CSS surfaces, without broken requests. Artwork is decorative, never data.
const artwork = import.meta.glob<string>("../assets/studio/*.{webp,png,avif}", {
  eager: true, query: "?url", import: "default",
});
function image(name: string) {
  return ["webp", "avif", "png"].map(extension => artwork[`../assets/studio/${name}.${extension}`]).find(Boolean);
}
export const studioArtwork = {
  sidebar: image("sidebar-landscape"),
  header: image("landscape-master"),
  mobileHeader: image("landscape-mobile"),
};
