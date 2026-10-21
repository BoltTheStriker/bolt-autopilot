import { fetchT } from "@/lib/fetchT";

/** Space Grotesk from Google Fonts (TTF, only the glyphs used) for share images; null falls back to the default font. */
export async function ogFont(weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetchT(`https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@${weight}&text=${encodeURIComponent(text)}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetchT(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}
