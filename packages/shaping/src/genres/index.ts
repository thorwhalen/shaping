/** The built-in genre table. A plain object: adding a genre is adding an entry. */
import type { GenreTable } from '../core.js';
import { shadowBlocks } from './shadow-blocks.js';
import { turned } from './turned.js';

export { shadowBlocks, turned };
export const builtInGenres: GenreTable = { [turned.id]: turned, [shadowBlocks.id]: shadowBlocks };
