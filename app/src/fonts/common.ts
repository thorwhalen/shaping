/**
 * The families the picker offers first and the cache keeps longest: a short, broad selection of
 * widely used open fonts (text faces, display faces, handwriting, monospace), by catalogue id.
 * Ids the catalogue does not have are ignored, so the list may age without harm.
 */
export const COMMON_FONT_IDS: readonly string[] = [
  'roboto', 'open-sans', 'lato', 'montserrat', 'oswald', 'source-sans-3', 'raleway', 'poppins', 'inter', 'nunito',
  'work-sans', 'dm-sans', 'josefin-sans', 'quicksand', 'comfortaa', 'ubuntu', 'fira-sans', 'noto-sans',
  'playfair-display', 'merriweather', 'lora', 'pt-serif', 'noto-serif', 'roboto-slab', 'cinzel', 'fraunces',
  'bebas-neue', 'anton', 'archivo-black', 'abril-fatface', 'righteous', 'bungee', 'lobster', 'pacifico',
  'dancing-script', 'caveat', 'permanent-marker', 'roboto-mono', 'source-code-pro', 'fira-code', 'press-start-2p',
  'roboto-flex', 'recursive',
];
