/**
 * The genre table the app uses: the `genres` seam. Every component and the worker read it from
 * here, so adding a genre (a third-party one included) is one entry in one place.
 */
import { builtInGenres, type GenreTable } from 'shaping';

export const genres: GenreTable = { ...builtInGenres };
